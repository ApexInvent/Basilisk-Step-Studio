/**
 * The engine, reached through the local sidecar.
 *
 * Same interface as MockEngine, so nothing above the adapter changes when this is the one
 * in use. The flag building stays on this side: the server is handed a finished argv and
 * never has an opinion about what the options mean, which keeps a single source of truth
 * for the command in src/engine/options.js.
 */

import { buildConvertArgs, buildMeshArgs } from './command.js'
import { updatesUnavailable } from './updates.js'

/**
 * Progress, inferred from what the engine prints.
 *
 * Upstream documents that progress goes to stdout but not the exact wording, so this maps
 * the phases it is known to move through and treats anything unrecognised as "still on the
 * last known phase". A percentage in the line wins over the table if one is present.
 * Getting this wrong costs a slightly wrong progress bar, never a wrong result.
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

export class HttpEngine {
  constructor({ base, token }) {
    this.name = 'sidecar'
    this.base = base
    this.token = token
  }

  get headers() {
    return { 'content-type': 'application/json', 'x-token': this.token }
  }

  /**
   * A 403 means this page is holding a token the sidecar does not accept, which is a
   * different problem from the engine being absent and needs to say so. Reporting it as
   * "no engine" sends you looking at the engine, which is fine.
   */
  #refused(res) {
    const err = new Error(
      'This page is using an out of date access token. Reopen the link the sidecar printed in its console.'
    )
    err.unauthorized = true
    err.status = res.status
    return err
  }

  /**
   * The helper does not install engines.
   *
   * Running from source, the engine comes out of the build workflow and into the project's
   * own engine folder, where it is under version control of a sort already. A local server
   * that would overwrite executables when asked to is a worse idea than it sounds.
   */
  async checkEngineUpdate() {
    return updatesUnavailable(
      'Running from source. Build the engine with the workflow and unzip it into the engine folder.'
    )
  }

  async detect() {
    const res = await fetch(`${this.base}/api/engine`, { headers: this.headers })
    if (res.status === 403) throw this.#refused(res)
    if (!res.ok) throw new Error(`Sidecar returned ${res.status}`)
    const info = await res.json()
    return { ...info, source: info.found ? 'sidecar' : undefined }
  }

  async cancel(jobId) {
    await fetch(`${this.base}/api/cancel`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ jobId })
    }).catch(() => {})
  }

  /**
   * Stream a conversion.
   *
   * The response is newline delimited JSON rather than a single body, because the useful
   * part is what arrives during the run, not at the end of it.
   */
  async #streamed(path, payload, { onProgress, onLog } = {}) {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    })

    if (res.status === 403) throw this.#refused(res)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Sidecar returned ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let progress = 0
    let phase = ''
    let done = null

    while (true) {
      const { value, done: finished } = await reader.read()
      if (finished) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }

        if (event.type === 'started') {
          onLog?.({ stream: 'meta', text: event.command })
        } else if (event.type === 'log') {
          onLog?.(event)
          if (event.stream === 'stdout') {
            progress = inferProgress(event.text, progress)
            phase = event.text.slice(0, 60)
            onProgress?.({ progress, phase })
          }
        } else if (event.type === 'done') {
          done = event
        }
      }
    }

    if (!done) throw new Error('The engine stopped without reporting a result')

    onProgress?.({ progress: 1, phase: done.ok ? 'Done' : 'Failed' })

    // The RESULT payload is the authority when there is one. Exit code fills the gap if
    // the engine died before printing it.
    return {
      ...(done.result ?? {}),
      ok: done.ok,
      exitCode: done.exitCode,
      error: done.error ?? done.result?.error ?? null
    }
  }

  /**
   * Put a browser File on the sidecar's disk and return where it landed.
   *
   * A dropped file exists only as bytes in the page. The browser deliberately withholds
   * its real location, so there is no path to hand the engine and the contents have to
   * make the trip instead. Sent as a raw body rather than multipart, since there is
   * exactly one file and no fields to go with it.
   */
  async upload(file, onProgress) {
    onProgress?.({ progress: 0, phase: `Sending ${file.name}` })

    const res = await fetch(`${this.base}/api/upload`, {
      method: 'POST',
      headers: {
        'x-token': this.token,
        'x-filename': encodeURIComponent(file.name),
        'content-type': 'application/octet-stream'
      },
      body: file
    })

    if (res.status === 403) throw this.#refused(res)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Upload failed with ${res.status}`)
    }

    const { path } = await res.json()
    return path
  }

  /**
   * Decide where the STEP should be written.
   *
   * If the user named an output folder, honour it: that puts real files somewhere they
   * chose, which is the whole point of running this locally. Otherwise write beside the
   * input, which for an uploaded file means the work directory, and the UI offers it
   * back as a download.
   */
  #outputFor(inputPath, name, outputDir) {
    const stem = name.replace(/\.[^.]+$/, '')
    if (outputDir) return `${outputDir.replace(/[\\/]+$/, '')}\\${stem}.step`
    const cut = Math.max(inputPath.lastIndexOf('\\'), inputPath.lastIndexOf('/'))
    return cut === -1 ? `${stem}.step` : `${inputPath.slice(0, cut)}\\${stem}.step`
  }

  async convert({ jobId, input, output, file, options, outputDir }, handlers) {
    let realInput = input
    let realOutput = output

    if (file) {
      realInput = await this.upload(file, handlers?.onProgress)
      realOutput = this.#outputFor(realInput, file.name, outputDir)
      handlers?.onLog?.({ stream: 'meta', text: `Uploaded to ${realInput}` })
    }

    const args = buildConvertArgs(options, { input: realInput, output: realOutput })
    const result = await this.#streamed(
      '/api/convert',
      { jobId, input: realInput, output: realOutput, args },
      handlers
    )

    // Hand back the paths actually used so the queue shows where the file really is,
    // rather than the bare name the browser gave us.
    return { ...result, input: realInput, output: result.output ?? realOutput }
  }

  /** Fetch a produced file and let the browser save it. */
  async save(path, filename) {
    const buffer = await this.readFile(path)
    const url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async mesh({ jobId, input, output, edges, threads }, handlers) {
    const args = buildMeshArgs({ input, output, edges, threads })
    return this.#streamed('/api/mesh', { jobId, input, output, args }, handlers)
  }

  async readFile(path) {
    const res = await fetch(
      `${this.base}/api/file?path=${encodeURIComponent(path)}`,
      { headers: { 'x-token': this.token } }
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Could not read ${path}`)
    }
    return res.arrayBuffer()
  }

  /**
   * Turn a STEP into something drawable.
   *
   * A STEP holds surfaces and curves, not triangles, so it cannot be handed to a mesh
   * loader. Reading the file directly was the bug this replaces: the STL loader took the
   * bytes at offset 80 as a face count, got about 1.7 billion, and tried to allocate an
   * array of 15 billion floats.
   */
  async preview(stepPath) {
    const res = await fetch(`${this.base}/api/preview`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ path: stepPath })
    })

    if (res.status === 403) throw this.#refused(res)
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.error ?? `Could not tessellate the result (${res.status})`)
    }

    const info = await res.json()
    const [mesh, edges] = await Promise.all([
      this.readFile(info.mesh),
      info.edges ? this.readFile(info.edges).catch(() => null) : Promise.resolve(null)
    ])

    return { mesh, edges, faces: info.faces, edgeCount: info.edgeCount }
  }

  async tempDir() {
    const res = await fetch(`${this.base}/api/tmp`, { headers: this.headers })
    return (await res.json()).dir
  }

  async pickInputFiles() {
    throw new Error('Drag files onto the drop zone. A native picker needs the desktop build.')
  }

  async pickDirectory() {
    throw new Error('Type the folder path in Settings. A native picker needs the desktop build.')
  }

  async revealInFolder() {
    throw new Error('Opening Explorer needs the desktop build.')
  }
}
