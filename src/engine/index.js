/**
 * The seam between the interface and the thing that actually converts.
 *
 * Everything above this line is ordinary Vue: no process spawning, no filesystem, no
 * checks scattered through components for which environment we are in. There are three
 * ways the app can be run and they differ only here.
 *
 *   sidecar   a local Node server owns the engine, the UI talks to it over loopback
 *   desktop   the packaged app spawns the engine directly
 *   mock      no engine at all, for building and judging the interface
 *
 * An implementation provides:
 *
 *   detect()                        -> EngineInfo
 *   convert(request, handlers)      -> Result        (the RESULT json)
 *   mesh(request, handlers)         -> MeshResult    (the MESH_RESULT json)
 *   readFile(path)                  -> ArrayBuffer
 *   readEdges(path)                 -> ArrayBuffer
 *   pickInputFiles()                -> string[]
 *   pickDirectory()                 -> string | null
 *   revealInFolder(path)            -> void
 *   cancel(jobId)                   -> void
 *
 * And, where the engine is something this build is allowed to replace:
 *
 *   checkEngineUpdate(version)      -> { supported, manifest, available } | { supported: false }
 *   installEngine(manifest, onStep) -> string        (the installed path)
 *   removeEngine()                  -> void
 */

import { MockEngine } from './mock.js'
import { HttpEngine } from './http.js'
import { TauriEngine } from './tauri.js'

const STORAGE_KEY = 'bss.sidecar'

/**
 * The sidecar hands the browser a token in the URL, because a localhost server that can
 * run binaries must not be reachable by any page that happens to be open. It is kept in
 * sessionStorage so a reload does not lose it, and stripped from the address bar so it
 * does not end up pasted into a screenshot or a bug report.
 */
function sidecarConfig() {
  if (typeof window === 'undefined') return null

  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  const port = params.get('api')

  if (token) {
    const base = port ? `http://127.0.0.1:${port}` : window.location.origin
    const config = { token, base }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      // Storage can be blocked. The token still works for this page load.
    }
    params.delete('token')
    params.delete('api')
    const query = params.toString()
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash
    )
    return config
  }

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

/** Tauri injects this global. Checked at runtime, since one bundle serves both. */
export function isDesktop() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let instance = null

export function useEngine() {
  if (instance) return instance

  // Desktop first: inside the app there is no helper to talk to and no token to carry,
  // because the shell already owns the ability to run the engine.
  if (isDesktop()) {
    instance = new TauriEngine()
    return instance
  }

  const sidecar = sidecarConfig()
  instance = sidecar ? new HttpEngine(sidecar) : new MockEngine()
  return instance
}

/** Which implementation is live, for the parts of the UI that have to say so. */
export function engineKind() {
  return useEngine().name
}

/** Exit codes, straight from the upstream contract. */
export const EXIT = {
  OK: 0,
  FAILED: 1,
  OK_WITH_WARNINGS: 2
}

/**
 * Exit code 2 is the one worth getting right. It means the STEP was written but something
 * about it is off: an open shell, a volume that does not match the source. Treating it as
 * failure would hide a usable file; treating it as success would hide a real problem. It is
 * its own state everywhere in this app.
 */
export function outcomeFromExit(code) {
  if (code === EXIT.OK) return 'ok'
  if (code === EXIT.OK_WITH_WARNINGS) return 'warning'
  return 'failed'
}

export { MockEngine, HttpEngine, TauriEngine }
