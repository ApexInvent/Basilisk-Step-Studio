/**
 * Two things here update, and they update separately.
 *
 * The interface and the engine are different projects on different schedules. stl2step is
 * upstream's work, pinned to a particular OpenCASCADE release; this app is ours. Binding them
 * into one version number would mean a new installer every time upstream tags a release, and
 * a full reinstall to pick up a converter fix.
 *
 * So there are two feeds. The app updates itself through Tauri's updater. The engine is
 * fetched as a zip and unpacked into the per user engine folder, which is the first place the
 * shell looks, so a downloaded engine takes over from the one that came with the installer
 * without either of them being aware of the other.
 *
 * Both feeds are GitHub release assets, which means the repository has to be readable for the
 * checks to succeed. While it is private they will fail politely and the app carries on.
 */

const REPO = 'https://github.com/ApexInvent/Basilisk-Step-Studio'

/**
 * The engine feed. A rolling release tag rather than a versioned one, so this URL does not
 * have to change when the engine does.
 */
export const ENGINE_FEED = `${REPO}/releases/download/engine-latest/engine.json`

/** Where a user would go to fetch a build by hand. */
export const RELEASES_PAGE = `${REPO}/releases`

/**
 * Compare two dotted version strings.
 *
 * Deliberately small. Engine versions come from upstream tags, which are plain numbers, and a
 * full semver parser would only add ways to be wrong about a string we also control.
 */
export function isNewer(candidate, current) {
  if (!candidate) return false
  if (!current) return true

  const parts = (v) => String(v).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const a = parts(candidate)
  const b = parts(current)

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return false
}

/** Byte counts, for a download progress line. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The answer every adapter that cannot install an engine gives.
 *
 * Running from source, the engine comes from the build workflow and goes into the project's
 * own engine folder. There is no per user install to replace, and a helper that could
 * overwrite its own binaries on request would be a worse idea than it sounds.
 */
export function updatesUnavailable(reason) {
  return {
    supported: false,
    reason
  }
}
