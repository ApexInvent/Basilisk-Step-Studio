/**
 * The engine, running inside the desktop app.
 *
 * Same interface as the mock and the local helper, so nothing above the adapter changes.
 * The difference from the helper is only in how the process is reached: there is no server,
 * no port and no token, because the app already owns the ability to spawn it.
 *
 * Two things get simpler here as a result. A dropped file has a real path, so nothing needs
 * uploading, and results are written straight beside the input where the user can find them.
 */

import { invoke, Channel } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { buildConvertArgs } from './command.js'
import { ENGINE_FEED, isNewer } from './updates.js'

/**
 * Progress, inferred from what the engine prints.
 *
 * Upstream documents that progress goes to stdout but not its exact wording, so this maps
 * the phases it is known to move through and treats anything unrecognised as still being on
 * the last known phase. Getting it wrong costs a slightly wrong bar, never a wrong result.
 */
const PHASE_HINTS = [
  [/read|load|pars/i, 0.08],
  [/weld|vertex|vertices/i, 0.2],
  [/shell|build/i, 0.32],
  [/segment|region/i, 0.42],
  [/fit|surface|analytic/i, 0.55],
  [/fillet/i, 0.66],
  [/sew|repair/i, 0.72],
  [/unif/i, 0.8],
  [/writ|step|export/i, 0.9],
  [/verif|check/i, 0.96]
]

function inferProgress(line, current) {
  const explicit = line.match(/(\d{1,3})\s*%/)
  if (explicit) return Math.min(1, Number(explicit[1]) / 100)
  for (const [pattern, value] of PHASE_HINTS) {
    // Never let progress run backwards: two phases can mention the same word.
    if (pattern.test(line)) return Math.max(current, value)
  }
  return current
}

export class TauriEngine {
  constructor() {
    this.name = 'desktop'
  }

  async detect() {
    return invoke('engine_detect')
  }

  /**
   * Is there a newer engine than the one in use?
   *
   * A failed check is not an error worth interrupting anyone over. The engine that is already
   * installed keeps working, so this reports the reason and leaves the app alone.
   */
  async checkEngineUpdate(current) {
    try {
      const manifest = await invoke('engine_manifest', { url: ENGINE_FEED })
      return {
        supported: true,
        manifest,
        available: isNewer(manifest.version, current)
      }
    } catch (err) {
      return { supported: true, error: err?.message ?? String(err) }
    }
  }

  /**
   * Fetch and install an engine build.
   *
   * Everything real happens in the shell: the download, the checksum, the unzip, a test run
   * of the binary, and the swap into place. Doing it there rather than here is not a style
   * preference. A browser context cannot verify a hash over a file it never sees whole, and
   * the swap has to be able to put the old engine back if the new one will not start.
   */
  async installEngine(manifest, onProgress) {
    const channel = new Channel()
    channel.onmessage = (event) => {
      if (event.type === 'progress') onProgress?.(event)
    }
    return invoke('engine_install', { manifest, onEvent: channel })
  }

  /** Drop the downloaded engine and fall back to the one that came with the app. */
  async removeEngine() {
    await invoke('engine_remove')
  }

  async cancel(jobId) {
    await invoke('cancel', { jobId }).catch(() => {})
  }

  /** Run the engine, resolving when it reports a result. */
  #run(jobId, args, { onProgress, onLog } = {}) {
    return new Promise((resolve, reject) => {
      let progress = 0
      const channel = new Channel()

      channel.onmessage = (event) => {
        if (event.type === 'started') {
          onLog?.({ stream: 'meta', text: event.command })
          return
        }

        if (event.type === 'log') {
          onLog?.(event)
          if (event.stream === 'stdout') {
            progress = inferProgress(event.text, progress)
            onProgress?.({ progress, phase: event.text.slice(0, 60) })
          }
          return
        }

        if (event.type === 'done') {
          onProgress?.({ progress: 1, phase: event.ok ? 'Done' : 'Failed' })
          resolve({
            ...(event.result ?? {}),
            ok: event.ok,
            exitCode: event.exitCode,
            error: event.error ?? event.result?.error ?? null
          })
        }
      }

      invoke('convert', { jobId, args, onEvent: channel }).catch(reject)
    })
  }

  async convert({ jobId, input, output, options }, handlers) {
    const args = buildConvertArgs(options, { input, output })
    const result = await this.#run(jobId, args, handlers)
    return { ...result, input, output: result.output ?? output }
  }

  /**
   * A STEP holds surfaces and curves, not triangles, so it cannot be drawn directly. The
   * engine tessellates it back and writes the real face boundaries alongside.
   */
  async preview(stepPath) {
    const paths = await invoke('preview', { path: stepPath })
    const [mesh, edges] = await Promise.all([
      this.readFile(paths.mesh),
      paths.edges ? this.readFile(paths.edges).catch(() => null) : Promise.resolve(null)
    ])
    return { mesh, edges }
  }

  async readFile(path) {
    const bytes = await invoke('read_file', { path })
    return new Uint8Array(bytes).buffer
  }

  async pickInputFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: 'STL meshes', extensions: ['stl'] }]
    })
    if (!picked) return []
    return Array.isArray(picked) ? picked : [picked]
  }

  async pickDirectory() {
    return open({ directory: true })
  }

  async revealInFolder(path) {
    await revealItemInDir(path)
  }
}
