//! The desktop shell.
//!
//! Everything the interface does lives in the Vue app. This layer exists only because a web
//! page cannot start a process or read a path off your disk, so it owns those two abilities
//! and nothing else. It is the same contract the local Node helper implements, which is why
//! the two are interchangeable behind the engine adapter in `src/engine/`.
//!
//! Deliberately small. The temptation with a Rust layer is to move logic into it, and every
//! bit that moves is a bit that has to be kept in step with the browser build. Flag building,
//! queue handling and result interpretation all stay in JavaScript; this file spawns a
//! process, forwards its output, and reads files.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, State};

mod update;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Stops a console window flashing up behind the app every time the engine is invoked.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn hidden(mut cmd: Command) -> Command {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[derive(Default)]
struct Running(Arc<Mutex<HashMap<String, Child>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    occt: Option<String>,
    source: String,
}

/// Events forwarded to the interface while a conversion runs.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum RunEvent {
    Started {
        command: String,
    },
    Log {
        stream: String,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        ok: bool,
        exit_code: i32,
        result: Option<serde_json::Value>,
        error: Option<String>,
    },
}

/// Where the engine might be, in order.
///
/// A copy the user installed themselves wins. The engine changes on its own schedule, and if
/// the copy bundled into the installer took priority then a newer engine could only arrive by
/// reinstalling the whole app. The bundled copy is the floor, not the ceiling: it is what
/// makes a fresh install work with nothing downloaded, and what the app falls back to if a
/// managed install is removed.
fn candidates(app: &tauri::AppHandle) -> Vec<(PathBuf, &'static str)> {
    let mut out = Vec::new();

    if let Some(dir) = update::managed_engine_dir() {
        out.push((dir.join("stl2step.exe"), "managed"));
    }
    if let Ok(dir) = app.path().resource_dir() {
        out.push((dir.join("engine").join("stl2step.exe"), "bundled"));
    }
    // A bare name asks the OS to search PATH.
    out.push((PathBuf::from("stl2step.exe"), "path"));
    out
}

/// What the build workflow recorded beside the binary, if anything did.
///
/// Upstream does not document a `--version` flag, so parsing its output is a guess that can
/// come back empty. The workflow knows exactly which upstream ref and which OpenCASCADE it
/// compiled, so it writes that down and this reads it.
fn recorded(exe: &PathBuf) -> Option<serde_json::Value> {
    let note = exe.parent()?.join("engine.json");
    serde_json::from_slice(&std::fs::read(note).ok()?).ok()
}

#[tauri::command]
fn engine_detect(app: tauri::AppHandle) -> EngineInfo {
    for (candidate, source) in candidates(&app) {
        let named = candidate.parent().is_none_or(|p| p.as_os_str().is_empty());
        if !named && !candidate.exists() {
            continue;
        }

        let mut cmd = hidden(Command::new(&candidate));
        // A non zero exit is not disqualifying, because the flag may not exist. What matters
        // is whether the binary started at all.
        let probe = cmd.arg("--version").output();

        if let Ok(out) = probe {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let printed = text
                .split_whitespace()
                .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
                .map(|s| s.trim_matches(|c: char| !c.is_ascii_digit() && c != '.').to_string());

            let note = recorded(&candidate);
            let field = |key: &str| {
                note.as_ref()
                    .and_then(|n| n.get(key))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            };

            return EngineInfo {
                found: true,
                path: Some(candidate.to_string_lossy().to_string()),
                version: field("version").or(printed),
                occt: field("occt"),
                source: source.into(),
            };
        }
    }

    EngineInfo {
        found: false,
        path: None,
        version: None,
        occt: None,
        source: "none".into(),
    }
}

/// Run the engine, forwarding its output line by line.
///
/// `--quiet` is deliberately not passed. Upstream suggests it so the RESULT line is alone on
/// stdout, but the progress lines are what drives the progress bar, and picking RESULT out is
/// a single prefix check.
fn spawn_and_stream(
    exe: &str,
    args: Vec<String>,
    job_id: String,
    channel: Channel<RunEvent>,
    running: Arc<Mutex<HashMap<String, Child>>>,
) -> Result<(), String> {
    let mut cmd = hidden(Command::new(exe));
    cmd.args(&args).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Could not start the engine: {e}"))?;

    let _ = channel.send(RunEvent::Started {
        command: format!("{exe} {}", args.join(" ")),
    });

    let stdout = child.stdout.take().ok_or("No stdout from the engine")?;
    let stderr = child.stderr.take().ok_or("No stderr from the engine")?;

    running.lock().unwrap().insert(job_id.clone(), child);

    // stderr on its own thread so a chatty warning stream cannot block progress reporting.
    let err_channel = channel.clone();
    let err_thread = std::thread::spawn(move || {
        let mut collected = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            collected.push_str(&line);
            collected.push('\n');
            let _ = err_channel.send(RunEvent::Log {
                stream: "stderr".into(),
                text: line,
            });
        }
        collected
    });

    let mut result: Option<serde_json::Value> = None;

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        // The machine readable payload is the line beginning RESULT or MESH_RESULT.
        // Everything else on stdout is human progress.
        let payload = line
            .strip_prefix("RESULT ")
            .or_else(|| line.strip_prefix("MESH_RESULT "));

        if let Some(json) = payload {
            match serde_json::from_str(json.trim()) {
                Ok(value) => result = Some(value),
                Err(_) => {
                    let _ = channel.send(RunEvent::Log {
                        stream: "stderr".into(),
                        text: "Could not read the engine's result line".into(),
                    });
                }
            }
            continue;
        }

        let _ = channel.send(RunEvent::Log {
            stream: "stdout".into(),
            text: line,
        });
    }

    let stderr_text = err_thread.join().unwrap_or_default();

    let status = {
        let mut guard = running.lock().unwrap();
        match guard.get_mut(&job_id) {
            Some(child) => child.wait().map_err(|e| e.to_string())?,
            // Cancelled: the handle was taken and killed elsewhere.
            None => {
                let _ = channel.send(RunEvent::Done {
                    ok: false,
                    exit_code: 1,
                    result: None,
                    error: Some("Cancelled".into()),
                });
                return Ok(());
            }
        }
    };
    running.lock().unwrap().remove(&job_id);

    let code = status.code().unwrap_or(1);
    // Exit 2 means written with warnings, which is a success carrying something to read.
    let ok = code == 0 || code == 2;

    let error = if ok {
        result
            .as_ref()
            .and_then(|r| r.get("error"))
            .and_then(|e| e.as_str())
            .map(str::to_string)
    } else {
        let trimmed = stderr_text.trim();
        Some(if trimmed.is_empty() {
            format!("The engine exited with code {code}")
        } else {
            trimmed.chars().rev().take(500).collect::<String>().chars().rev().collect()
        })
    };

    let _ = channel.send(RunEvent::Done {
        ok,
        exit_code: code,
        result,
        error,
    });

    Ok(())
}

#[tauri::command]
async fn convert(
    app: tauri::AppHandle,
    job_id: String,
    args: Vec<String>,
    on_event: Channel<RunEvent>,
    running: State<'_, Running>,
) -> Result<(), String> {
    let info = engine_detect(app);
    let exe = info.path.ok_or("No engine is installed")?;
    let handles = running.0.clone();

    tauri::async_runtime::spawn_blocking(move || {
        spawn_and_stream(&exe, args, job_id, on_event, handles)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel(job_id: String, running: State<'_, Running>) {
    if let Some(mut child) = running.0.lock().unwrap().remove(&job_id) {
        let _ = child.kill();
    }
}

/// Tessellate a STEP so it can be drawn, writing the real B-Rep edges alongside.
///
/// A STEP holds surfaces and curves, not triangles, so it cannot go to a mesh loader
/// directly. Mesh mode is the engine's own answer to that.
#[tauri::command]
async fn preview(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    let info = engine_detect(app.clone());
    let exe = info.path.ok_or("No engine is installed")?;

    let dir = std::env::temp_dir().join("basilisk-step-studio");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let stem = format!("preview-{}", std::process::id());
    let mesh = dir.join(format!("{stem}.stl"));
    let edges = dir.join(format!("{stem}.edges"));

    let mesh_s = mesh.to_string_lossy().to_string();
    let edges_s = edges.to_string_lossy().to_string();

    let out = tauri::async_runtime::spawn_blocking({
        let mesh_s = mesh_s.clone();
        let edges_s = edges_s.clone();
        move || {
            hidden(Command::new(&exe))
                .args(["--mesh", &path, "-o", &mesh_s, "--edges", &edges_s])
                .output()
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Could not run mesh mode: {e}"))?;

    if !mesh.exists() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(if stderr.trim().is_empty() {
            "Tessellation produced nothing".into()
        } else {
            stderr.trim().to_string()
        });
    }

    Ok(serde_json::json!({
        "mesh": mesh_s,
        // Edges are optional: a result is still worth looking at without them.
        "edges": if edges.exists() { Some(edges_s) } else { None },
    }))
}

#[tauri::command]
async fn read_file(path: String) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    // The viewer only ever asks for geometry, and a file this size would take the webview
    // down long before it rendered.
    if meta.len() > 300_000_000 {
        return Err("That file is too large to preview".into());
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Write a text file the user has already chosen a location for.
///
/// Only reached after the save dialog has returned a path, so the choice of where to write
/// is the user's rather than this app's. Used for exporting a command as a batch script.
#[tauri::command]
async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Could not write that file: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Running::default())
        .invoke_handler(tauri::generate_handler![
            engine_detect,
            convert,
            cancel,
            preview,
            read_file,
            write_text_file,
            update::engine_manifest,
            update::engine_install,
            update::engine_remove
        ])
        .run(tauri::generate_context!())
        .expect("could not start Basilisk Step Studio");
}
