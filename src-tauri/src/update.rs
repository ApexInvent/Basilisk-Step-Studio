//! Installing the engine, and replacing it later.
//!
//! The engine is the part of this app most likely to change without the app changing. It is
//! someone else's project, it is pinned to a specific OpenCASCADE release, and a new build of
//! it has nothing to do with a new build of the interface. Tying the two together would mean
//! shipping a whole installer every time upstream tags a release.
//!
//! So the engine gets its own copy under LOCALAPPDATA, and that copy is the first place the
//! app looks. Installing a newer one is a download and a directory swap, and the copy bundled
//! with the installer stays untouched underneath as the fallback.
//!
//! Replacing a directory while something might be reading from it is the one genuinely
//! delicate part. The download is verified and smoke tested in a staging directory before
//! anything live is touched, and the swap itself is two renames.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;

/// What an engine release says about itself. Written by the build workflow, read here.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineManifest {
    pub version: String,
    pub url: String,
    #[serde(default)]
    pub occt: Option<String>,
    #[serde(default)]
    pub built: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum InstallEvent {
    Progress {
        phase: String,
        received: u64,
        total: Option<u64>,
    },
}

/// `%LOCALAPPDATA%\BasiliskStepStudio`. Per user, so installing an engine never needs elevation.
pub fn managed_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|local| PathBuf::from(local).join("BasiliskStepStudio"))
}

pub fn managed_engine_dir() -> Option<PathBuf> {
    managed_root().map(|root| root.join("engine"))
}

fn progress(channel: &Channel<InstallEvent>, phase: &str, received: u64, total: Option<u64>) {
    let _ = channel.send(InstallEvent::Progress {
        phase: phase.into(),
        received,
        total,
    });
}

/// Read an engine release manifest.
///
/// Returns None when the feed is simply not there yet, which is the normal state before the
/// first engine release is published and is not a failure worth colouring red.
#[tauri::command]
pub async fn engine_manifest(url: String) -> Result<Option<EngineManifest>, String> {
    let response = reqwest::Client::builder()
        .user_agent("BasiliskStepStudio")
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Could not reach the update feed: {e}"))?;

    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("The update feed is not readable. A private repository needs a token.".into());
    }
    if !status.is_success() {
        return Err(format!("The update feed answered {}.", status.as_u16()));
    }

    response
        .json::<EngineManifest>()
        .await
        .map(Some)
        .map_err(|e| format!("The update feed is not readable: {e}"))
}

/// Download, verify, unpack and swap in an engine build.
#[tauri::command]
pub async fn engine_install(
    manifest: EngineManifest,
    on_event: Channel<InstallEvent>,
) -> Result<String, String> {
    let root = managed_root().ok_or("Could not find the local application data folder")?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let archive = root.join("engine-download.zip");
    let staging = root.join("engine.incoming");
    let previous = root.join("engine.previous");
    let live = root.join("engine");

    // Anything left behind by an install that did not finish.
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&previous);

    download(&manifest, &archive, &on_event).await?;

    let expected = manifest.sha256.clone();
    let unpack_manifest = manifest.clone();
    let unpack_archive = archive.clone();
    let unpack_staging = staging.clone();

    // Hashing and unzipping are both long enough to block the UI thread if left inline.
    let unpacked = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if let Some(sum) = expected {
            verify(&unpack_archive, &sum)?;
        }
        extract(&unpack_archive, &unpack_staging)?;
        record(&unpack_staging, &unpack_manifest)
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Err(err) = unpacked {
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_file(&archive);
        return Err(err);
    }

    progress(&on_event, "Checking the build", 1, Some(1));
    let exe = staging.join("stl2step.exe");
    if let Err(err) = smoke_test(&exe) {
        let _ = std::fs::remove_dir_all(&staging);
        let _ = std::fs::remove_file(&archive);
        return Err(err);
    }

    progress(&on_event, "Installing", 1, Some(1));
    swap(&live, &staging, &previous)?;

    let _ = std::fs::remove_dir_all(&previous);
    let _ = std::fs::remove_file(&archive);

    Ok(live.join("stl2step.exe").to_string_lossy().to_string())
}

/// Remove the managed copy, falling back to whatever the app shipped with.
#[tauri::command]
pub fn engine_remove() -> Result<(), String> {
    let dir = managed_engine_dir().ok_or("Could not find the local application data folder")?;
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("Could not remove the installed engine: {e}"))
}

async fn download(
    manifest: &EngineManifest,
    target: &Path,
    channel: &Channel<InstallEvent>,
) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .user_agent("BasiliskStepStudio")
        .build()
        .map_err(|e| e.to_string())?
        .get(&manifest.url)
        .send()
        .await
        .map_err(|e| format!("Could not start the download: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("The download answered {}", response.status().as_u16()));
    }

    let total = response.content_length().or(manifest.size);
    let mut file = std::fs::File::create(target)
        .map_err(|e| format!("Could not write the download: {e}"))?;

    let mut received: u64 = 0;
    let mut stream = response.bytes_stream();
    // Reporting every chunk would be thousands of IPC messages for a file this size.
    let mut announced: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The download stopped early: {e}"))?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received - announced > 512 * 1024 {
            announced = received;
            progress(channel, "Downloading", received, total);
        }
    }

    file.flush().map_err(|e| e.to_string())?;
    progress(channel, "Downloading", received, total);
    Ok(())
}

fn verify(archive: &Path, expected: &str) -> Result<(), String> {
    let mut file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    let actual = format!("{:x}", hasher.finalize());

    if !actual.eq_ignore_ascii_case(expected.trim()) {
        return Err("The download does not match its published checksum, so it was discarded.".into());
    }
    Ok(())
}

/// Unpack into `target`, tolerating an archive that wraps everything in one folder.
fn extract(archive: &Path, target: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("The download is not a zip: {e}"))?;

    let prefix = common_root(&mut zip);
    std::fs::create_dir_all(target).map_err(|e| e.to_string())?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;

        // enclosed_name rejects paths that would escape the target directory.
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let relative = match &prefix {
            Some(root) => match name.strip_prefix(root) {
                Ok(rest) => rest.to_path_buf(),
                Err(_) => continue,
            },
            None => name,
        };
        if relative.as_os_str().is_empty() {
            continue;
        }

        let out = target.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut sink = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut sink).map_err(|e| e.to_string())?;
    }

    if !target.join("stl2step.exe").exists() {
        return Err("That archive does not contain stl2step.exe".into());
    }
    Ok(())
}

/// The single top level folder every entry sits under, if there is one.
fn common_root(zip: &mut zip::ZipArchive<std::fs::File>) -> Option<PathBuf> {
    let mut root: Option<PathBuf> = None;

    for i in 0..zip.len() {
        let entry = zip.by_index(i).ok()?;
        let name = entry.enclosed_name()?;
        let first = name.components().next()?;
        let candidate = PathBuf::from(first.as_os_str());

        // A file at the top level means there is no wrapping folder.
        if name.components().count() == 1 && !entry.is_dir() {
            return None;
        }
        match &root {
            None => root = Some(candidate),
            Some(existing) if *existing != candidate => return None,
            _ => {}
        }
    }
    root
}

/// Leave a machine readable note of what was installed, so the app can report a version
/// without depending on the engine having a `--version` flag.
fn record(dir: &Path, manifest: &EngineManifest) -> Result<(), String> {
    let note = serde_json::json!({
        "version": manifest.version,
        "occt": manifest.occt,
        "built": manifest.built,
        "source": "managed",
    });
    std::fs::write(
        dir.join("engine.json"),
        serde_json::to_vec_pretty(&note).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Start the downloaded binary once before trusting it.
///
/// A missing OpenCASCADE DLL does not fail the unzip and does not fail the spawn either. The
/// process starts and dies immediately with a negative NTSTATUS, which is exactly the failure
/// this catches, and exactly the failure that would otherwise show up as a broken install.
fn smoke_test(exe: &Path) -> Result<(), String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new(exe);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);

    let out = cmd
        .arg("--version")
        .output()
        .map_err(|e| format!("The downloaded engine would not start: {e}"))?;

    // An unrecognised flag is fine. A negative code is the loader refusing to run it.
    match out.status.code() {
        Some(code) if code < 0 => Err(format!(
            "The downloaded engine did not start (0x{:08X}). A runtime library is probably missing from the archive.",
            code as u32
        )),
        _ => Ok(()),
    }
}

/// Two renames, so there is no moment where the engine directory is half written.
fn swap(live: &Path, staging: &Path, previous: &Path) -> Result<(), String> {
    if live.exists() {
        std::fs::rename(live, previous).map_err(|e| {
            format!("Could not replace the installed engine, it may still be in use: {e}")
        })?;
    }

    if let Err(err) = std::fs::rename(staging, live) {
        // Put back what was there rather than leaving the user with nothing.
        if previous.exists() {
            let _ = std::fs::rename(previous, live);
        }
        return Err(format!("Could not move the new engine into place: {err}"));
    }
    Ok(())
}

/// The file replacing code, exercised directly.
///
/// This is the one part of the app that overwrites things on someone's disk, and the two ways
/// it can be wrong are silent: unpacking an archive one level too deep, so nothing is found,
/// and losing the working engine when a swap fails halfway.
#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bss-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn zip_with(path: &Path, entries: &[&str]) {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        for name in entries {
            writer.start_file(*name, SimpleFileOptions::default()).unwrap();
            writer.write_all(b"x").unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn unpacks_a_flat_archive() {
        let dir = scratch("flat");
        let archive = dir.join("a.zip");
        zip_with(&archive, &["stl2step.exe", "TKernel.dll"]);

        let out = dir.join("out");
        extract(&archive, &out).unwrap();

        assert!(out.join("stl2step.exe").exists());
        assert!(out.join("TKernel.dll").exists());
    }

    /// 7z and the Actions artifact download disagree about whether to wrap the contents in a
    /// folder, so the unpack has to cope with either.
    #[test]
    fn strips_a_single_wrapping_folder() {
        let dir = scratch("wrapped");
        let archive = dir.join("a.zip");
        zip_with(&archive, &["stage/stl2step.exe", "stage/TKernel.dll"]);

        let out = dir.join("out");
        extract(&archive, &out).unwrap();

        assert!(out.join("stl2step.exe").exists(), "the stage folder was not stripped");
        assert!(!out.join("stage").exists());
    }

    #[test]
    fn refuses_an_archive_with_no_engine_in_it() {
        let dir = scratch("empty");
        let archive = dir.join("a.zip");
        zip_with(&archive, &["readme.txt"]);

        assert!(extract(&archive, &dir.join("out")).is_err());
    }

    #[test]
    fn swap_puts_the_new_engine_in_place() {
        let dir = scratch("swap");
        let live = dir.join("engine");
        let staging = dir.join("engine.incoming");
        let previous = dir.join("engine.previous");

        std::fs::create_dir_all(&live).unwrap();
        std::fs::write(live.join("mark"), b"old").unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("mark"), b"new").unwrap();

        swap(&live, &staging, &previous).unwrap();

        assert_eq!(std::fs::read(live.join("mark")).unwrap(), b"new");
        assert_eq!(std::fs::read(previous.join("mark")).unwrap(), b"old");
    }

    /// The case worth being sure about: if the new engine cannot be moved into place, the one
    /// that was working has to come back rather than the user being left with nothing.
    #[test]
    fn swap_restores_the_old_engine_when_the_move_fails() {
        let dir = scratch("restore");
        let live = dir.join("engine");
        let previous = dir.join("engine.previous");
        // Never created, so the second rename has nothing to move.
        let staging = dir.join("engine.incoming");

        std::fs::create_dir_all(&live).unwrap();
        std::fs::write(live.join("mark"), b"old").unwrap();

        assert!(swap(&live, &staging, &previous).is_err());
        assert_eq!(std::fs::read(live.join("mark")).unwrap(), b"old");
    }

    #[test]
    fn rejects_a_download_that_does_not_match_its_checksum() {
        let dir = scratch("hash");
        let file = dir.join("a.zip");
        std::fs::write(&file, b"hello").unwrap();

        let right = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify(&file, right).is_ok());
        assert!(verify(&file, &"0".repeat(64)).is_err());
    }
}
