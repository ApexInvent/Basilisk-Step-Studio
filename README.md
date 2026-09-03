# Basilisk Step Studio

A Windows interface for [stl2step](https://github.com/BlinkingSun/stl2step), a tool for converting STL meshes into STEP B-Rep solids.

stl2step handles the conversion well, but it is a command-line tool with a fairly large set of options, and the upstream desktop app is currently macOS-only. Basilisk Step Studio provides the Windows interface: a batch queue, a 3D viewer for checking results, and a visible command line.

---

## Install

Download and run **Basilisk Step Studio_0.1.0_x64-setup.exe**. The converter is bundled, so there is nothing else to download and nothing to configure. Roughly 16 MB to download, 53 MB installed.

The installer is not code signed, so Windows shows **"Windows protected your PC"** on first run. Click **More info**, then **Run anyway**.

Drop STL files onto the window and press **Convert**. STEP files are written next to the originals, unless an output folder is set in Settings.

---

## Updates

The app and the engine update separately, because they are separate projects on separate schedules. A new stl2step release has nothing to do with a new build of this interface, and tying the two together would mean reinstalling the whole app to pick up a converter fix.

**The engine** is fetched from the Engine screen. It installs into `%LOCALAPPDATA%\BasiliskStepStudio\engine\`, which is the first place the app looks, so a downloaded engine takes over from the one that came with the installer. The bundled copy is left alone underneath, and removing the downloaded one puts it back.

The download is checked against a published SHA-256 and then run once before it is moved into place. A build that will not start, usually a missing OpenCASCADE DLL, is discarded rather than installed over a working engine.

**The app** updates itself. The Engine screen shows the current version and offers a newer one when there is one, which downloads the installer, runs it and restarts.

Both feeds are release assets on this repository, so neither check can succeed while it is private. They fail quietly and everything else carries on working.

---

## Conversion modes

**Verbatim** is fast and preserves the mesh exactly, but the STEP remains faceted.

**TrueForm** takes longer because it tries to recover cylinders, planes and other analytic surfaces from the mesh. The result is much closer to what you would expect from native CAD geometry.

### Batch conversion

Files can be queued and converted one after another, for the cases where thirty or forty parts need converting and running the same command per file is not practical. A failed conversion is marked and the queue continues.

### 3D viewer

The viewer shows both the STL going in and the converted result. For STEP results the engine's B-Rep edges are drawn over the shaded model, which is what separates a recovered analytic surface from a re-triangulated one: the same bushing gives 576 edge segments through Verbatim and 9 through TrueForm.

### Command line preview

The generated stl2step command is always visible, and changing an option updates it immediately. It also works in reverse: paste an existing stl2step command into the interface and the options are filled in from it. Commands can be exported as `.bat` files.

The idea is not to hide the CLI, only to make it easier to reach.

---

## Running from source

Only needed to work on the app itself. Installing the release is the normal path.

### Requirements

- [Node.js](https://nodejs.org) 20 or newer
- the stl2step engine, unless only the interface is needed
- Rust and the MSVC C++ build tools, to build the installer

```bash
git clone https://github.com/ApexInvent/Basilisk-Step-Studio.git
cd Basilisk-Step-Studio
npm install
npm start
```

`npm start` builds the interface and starts the local helper, which prints a local URL containing an authentication token. Open that URL in a browser.

The interface still works without stl2step installed. Files can be added, options configured, commands built and STL meshes inspected. Only conversion is disabled until an engine is available.

### Getting the engine

stl2step is a C++ application built on OpenCASCADE. Upstream does not currently publish a Windows binary, so this repository includes a GitHub Actions workflow that builds one.

1. Open the **Actions** tab
2. Select **Build engine**, then **Run workflow**
3. Download the `stl2step-windows-x64` artifact when the build completes
4. Extract it into an `engine` folder in the project root

Keep the DLLs alongside the executable. They are part of the OpenCASCADE runtime and the executable will not start without them.

Ticking **Attach the result to a release** also publishes it. The workflow writes a manifest describing the build and uploads both to a rolling `engine-latest` release, which is the feed the installed app polls, so publishing is what actually ships an engine update to anyone running it.

To point the helper at an existing stl2step build instead:

```bash
npm run sidecar -- --engine C:\path\to\stl2step.exe
```

### Building the installer

Requires Rust, the MSVC C++ build tools, and an `engine` folder as above, which is bundled into the installer.

```bash
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/nsis/`.

### Releasing

The **Build app** workflow builds the installer, signs it and publishes it as an update. It needs two repository secrets:

| Secret | What it is |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the updater private key, generated with `npm run tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password on that key, empty if it has none |

The public half lives in `src-tauri/tauri.conf.json` and an installed app will only accept an update signed by its matching private key. Losing the private key means installed copies can no longer be updated, so it is worth keeping somewhere durable.

To cut a release, set the same version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then tag it:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow refuses to build if the tag and the version disagree. That mismatch is otherwise invisible: the installer works, and the updater silently never offers it.

---

## How it works

```text
                                   +-- desktop shell --+
Vue 3 interface  ->  engine adapter +                   +-> stl2step.exe
   (UI)              (shared API)   +-- local helper ---+     (RESULT json)
```

Most of the separation happens in `src/engine/`.

The interface talks to one engine API, with three implementations behind it:

- **desktop shell**, used inside the installed app, where files have real paths and the shell launches the engine directly
- **local helper**, used when running from source, reached over loopback
- **mock engine**, returning realistic results with no engine present, for UI development

Nothing outside that layer needs to know how the converter is being run.

### Desktop shell

`src-tauri/` is kept deliberately thin. It launches a process, forwards its output and reads files. Option handling, the queue and result interpretation stay in JavaScript, so the browser and desktop builds cannot drift apart.

### Local helper

A browser cannot directly launch executables or freely access filesystem paths, which is exactly how it should be. The helper in `sidecar/` handles those jobs instead.

It only listens on loopback, and requests must include a token generated on first run and stored in the application's data directory. That prevents another random page open in the browser from sending commands to the local converter.

### Options

All stl2step options are defined in one place:

```text
src/engine/options.js
```

The options form, command preview and command parser are all built from that same definition. Adding or changing a flag therefore does not require maintaining three separate copies of the same option list.

### Viewer

Based on the STL viewer used in [The 3D Printing Network](https://the3dprintingnetwork.com/). It renders only when something changes instead of keeping a permanent animation loop running.

STL parsing is also handled directly rather than through `STLLoader`. This allows invalid files to be rejected immediately instead of relying on the triangle count stored in the STL header.

### Project layout

```text
src/
  engine/      adapter, flag model, command builder and parser, update feeds
  components/  drop zone, queue, options, command bar, viewer
  views/       Convert, Engine, Settings
  stores/      queue, options, engine state, updates
  utils/       STL parsing

sidecar/       local helper that launches the engine and streams progress
src-tauri/     desktop shell, the same job inside the installed app
.github/       engine build and app release workflows
```

---

## Engine notes

Details of how the bundled engine is built and how its output is interpreted.

### OpenCASCADE 7.9.3

The Windows build pins OpenCASCADE to version **7.9.3**. stl2step's results are calibrated against a specific OpenCASCADE version, so changing versions can affect the resulting geometry.

The build uses the prebuilt conda-forge package instead of compiling OpenCASCADE from source. That cuts the GitHub Actions build from roughly an hour to a few minutes.

### Exit code 2

stl2step uses exit code `2` for cases where a STEP file was created, but the result needs attention. Examples include an open shell, or a converted volume that does not match the source.

Basilisk Step Studio treats this separately from both success and failure. The output exists, but it should be checked.

### Windows build

Only the stl2step CLI target is built. One of the upstream unit tests currently does not compile under modern MSVC, and none of the test executables are needed by Basilisk Step Studio anyway.

The GitHub Actions workflow instead performs a smoke test on the finished executable by converting a sample part with a minimal `PATH`. This also catches missing runtime DLLs before the artifact is published.

---

## Development

```bash
npm run dev          # UI only, mock engine, hot reload
npm run build        # production build
npm run sidecar      # start helper against an existing build
npm start            # build and serve

npm run tauri dev    # desktop app, hot reload
npm run tauri build  # installer
```

`npm run dev` does not require stl2step or the local helper. It uses a mock engine that returns realistic-looking conversion results and progress events, which makes it possible to work on the interface entirely in the browser.

The application clearly shows when the mock engine is active, so test conversions cannot be mistaken for files that were actually written to disk.

---

## Credits

All STL-to-STEP conversion is performed by [stl2step](https://github.com/BlinkingSun/stl2step), created by BlinkingSun and built on [OpenCASCADE](https://dev.opencascade.org/).

Basilisk Step Studio provides the Windows interface, queue, viewer and integration around it. The geometry conversion itself belongs entirely to the upstream project.
