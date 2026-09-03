/**
 * A stand in for stl2step, so the interface can be built and judged before the real
 * binary exists.
 *
 * It is not a toy. It emits the same RESULT and MESH_RESULT shapes, takes a realistic
 * amount of time, streams progress lines, and can be told to fail or to return warnings.
 * That matters because the states worth designing carefully are the unhappy ones, and a
 * mock that always succeeds instantly would let every one of them go unbuilt.
 *
 * Geometry is generated rather than fetched: a browser tab has no sample files to hand,
 * and a procedural part gives the viewer something honest to draw.
 */

import { buildConvertArgs, buildMeshArgs, formatCommand } from './command.js'
import { ENGINE_TRUEFORM } from './options.js'
import { updatesUnavailable } from './updates.js'
import { downloadText } from '@/utils/download.js'

const PHASES = [
  { at: 0.0, text: 'Reading mesh' },
  { at: 0.12, text: 'Welding vertices' },
  { at: 0.28, text: 'Building shells' },
  { at: 0.46, text: 'Sewing faces' },
  { at: 0.62, text: 'Unifying coplanar faces' },
  { at: 0.78, text: 'Writing STEP' },
  { at: 0.9, text: 'Verifying output' }
]

const TRUEFORM_PHASES = [
  { at: 0.34, text: 'Segmenting surface regions' },
  { at: 0.5, text: 'Fitting analytic surfaces' },
  { at: 0.66, text: 'Recovering fillets' }
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function baseName(path) {
  return String(path).replace(/\\/g, '/').split('/').pop()
}

function stem(path) {
  return baseName(path).replace(/\.[^.]+$/, '')
}

/**
 * Deterministic pseudo random, seeded off the filename.
 *
 * The same file should always report the same triangle count, otherwise the numbers
 * flicker between runs and stop looking like measurements.
 */
function seeded(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = h
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class MockEngine {
  constructor() {
    this.name = 'mock'
    this.cancelled = new Set()

    /**
     * Drives the unhappy paths without needing broken files. A filename containing
     * "fail" fails, one containing "open" comes back with warnings and exit 2.
     */
    this.rules = { failOn: /fail|broken/i, warnOn: /open|shell|leak/i }
  }

  async detect() {
    await sleep(180)
    return {
      found: true,
      path: 'mock://stl2step',
      version: '1.2.0',
      occt: '7.9.3',
      source: 'mock',
      note: 'Simulated engine. Conversions are not real.'
    }
  }

  async checkEngineUpdate() {
    return updatesUnavailable('There is no engine to update. This is the simulated one.')
  }

  cancel(jobId) {
    this.cancelled.add(jobId)
  }

  async convert(request, { onProgress, onLog } = {}) {
    const { jobId, input, output, options } = request
    const rand = seeded(baseName(input))
    const argv = buildConvertArgs(options, { input, output })

    onLog?.({ stream: 'meta', text: formatCommand(argv) })

    const triangles = 8000 + Math.floor(rand() * 240000)
    const trueform = options.engine === ENGINE_TRUEFORM
    // TrueForm has to fit surfaces, so it is meaningfully slower. Scaling the mock's
    // duration with the work keeps the progress UI honest about what costs time.
    const duration = (900 + triangles * 0.004) * (trueform ? 2.4 : 1)

    const phases = [...PHASES, ...(trueform ? TRUEFORM_PHASES : [])].sort((a, b) => a.at - b.at)

    const started = performance.now()
    let emitted = 0

    while (true) {
      const elapsed = performance.now() - started
      const t = Math.min(elapsed / duration, 1)

      if (this.cancelled.has(jobId)) {
        this.cancelled.delete(jobId)
        return { ok: false, cancelled: true, exitCode: 1, input, output, error: 'Cancelled' }
      }

      while (emitted < phases.length && phases[emitted].at <= t) {
        onLog?.({ stream: 'stdout', text: phases[emitted].text })
        emitted++
      }

      onProgress?.({ jobId, progress: t, phase: phases[Math.max(0, emitted - 1)]?.text ?? '' })

      if (t >= 1) break
      await sleep(60)
    }

    const seconds = Number(((performance.now() - started) / 1000).toFixed(2))
    const willFail = this.rules.failOn.test(baseName(input))
    const willWarn = this.rules.warnOn.test(baseName(input))

    if (willFail) {
      const error = 'No closed shell could be built from the input mesh'
      onLog?.({ stream: 'stderr', text: error })
      return { ok: false, exitCode: 1, input, output, error, seconds, triangles }
    }

    const facesBefore = triangles
    const facesAfter = options.unify === false
      ? triangles
      : Math.max(6, Math.round(triangles * (trueform ? 0.008 : 0.06)))

    const volume = Number((rand() * 90000 + 1200).toFixed(3))
    const warnings = []

    if (willWarn) {
      warnings.push('Open shell: 2 free edges remain after sewing')
      warnings.push('Volume differs from mesh by 0.42 percent')
    }
    if (trueform && rand() > 0.7) {
      warnings.push('3 fillet regions could not be fitted and were left as facets')
    }

    // Faithful to the contract: exit 2 means written, but check it.
    const exitCode = warnings.length ? 2 : 0

    return {
      ok: true,
      exitCode,
      input,
      output,
      triangles,
      vertices: Math.round(triangles * 0.52),
      components: 1 + (rand() > 0.85 ? Math.floor(rand() * 3) : 0),
      solids: willWarn ? 0 : 1,
      openShells: willWarn ? 1 : 0,
      facesBeforeUnify: facesBefore,
      facesAfterUnify: facesAfter,
      meshVolumeMM3: volume,
      stepVolumeMM3: Number((volume * (willWarn ? 0.9958 : 1)).toFixed(3)),
      volumeDeltaPct: willWarn ? 0.42 : 0,
      watertight: !willWarn,
      seconds,
      warnings
    }
  }

  async mesh(request) {
    const { input, output, edges } = request
    buildMeshArgs({ input, output, edges })
    await sleep(500)
    const rand = seeded(baseName(input))
    return {
      ok: true,
      exitCode: 0,
      input,
      output,
      edgesFile: edges ?? null,
      faces: 20 + Math.floor(rand() * 300),
      edges: 60 + Math.floor(rand() * 900),
      triangles: 4000 + Math.floor(rand() * 40000),
      seconds: 0.5
    }
  }

  /**
   * Returns a binary STL. Which shape you get depends on the path, so the input preview
   * and the converted preview are visibly different objects rather than the same blob.
   */
  async readFile(path) {
    const isResult = /\.(step|stp)$/i.test(path) || path.includes('.out.')
    return buildSampleStl(stem(path), isResult ? 48 : 20)
  }

  /**
   * Stands in for mesh mode: a tessellation of the result plus its B-Rep edges, in
   * upstream's Format A of little endian float32 xyz pairs, 24 bytes per segment.
   */
  async preview(path) {
    await sleep(300)
    return {
      mesh: buildSampleStl(stem(path), 48),
      edges: buildSampleEdges(),
      faces: 6,
      edgeCount: 6 * 72
    }
  }

  async pickInputFiles() {
    // A browser cannot open a native dialog, and the drop zone covers this case in dev.
    throw new Error('File picker is a desktop feature. Drag files onto the drop zone instead.')
  }

  /**
   * Save a generated text file. In a browser that means a download.
   */
  async saveTextFile(name, text) {
    return downloadText(name, text)
  }

  async pickDirectory() {
    throw new Error('Folder picker is a desktop feature.')
  }

  async revealInFolder() {
    throw new Error('Reveal in folder is a desktop feature.')
  }
}

/**
 * A flanged bushing, as binary STL. Recognisably a machined part rather than a primitive,
 * with a bore and a fillet, so the viewer's shading and the edge overlay have something
 * with real curvature to show.
 */
function buildSampleStl(seed, segments) {
  const rand = seeded(seed)
  const rOuter = 18 + rand() * 6
  const rBore = 7 + rand() * 2
  const rFlange = rOuter + 8
  const height = 26 + rand() * 10
  const flangeH = 5

  const tris = []
  const push = (a, b, c) => tris.push([a, b, c])

  const ring = (r, z) =>
    Array.from({ length: segments }, (_, i) => {
      const a = (i / segments) * Math.PI * 2
      return [Math.cos(a) * r, Math.sin(a) * r, z]
    })

  const flangeBottomOuter = ring(rFlange, 0)
  const flangeTopOuter = ring(rFlange, flangeH)
  const bodyBottom = ring(rOuter, flangeH)
  const bodyTop = ring(rOuter, height)
  const boreBottom = ring(rBore, 0)
  const boreTop = ring(rBore, height)
  const flangeBottomBore = ring(rBore, 0)

  const tube = (lower, upper) => {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      push(lower[i], lower[j], upper[j])
      push(lower[i], upper[j], upper[i])
    }
  }

  const annulus = (inner, outer, flip) => {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      if (flip) {
        push(inner[i], outer[j], outer[i])
        push(inner[i], inner[j], outer[j])
      } else {
        push(inner[i], outer[i], outer[j])
        push(inner[i], outer[j], inner[j])
      }
    }
  }

  tube(flangeBottomOuter, flangeTopOuter)
  tube(bodyBottom, bodyTop)
  tube(boreTop, boreBottom)
  annulus(flangeBottomBore, flangeBottomOuter, true)
  annulus(bodyBottom, flangeTopOuter, false)
  annulus(boreTop, bodyTop, false)

  const buffer = new ArrayBuffer(84 + tris.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, tris.length, true)

  let offset = 84
  for (const [a, b, c] of tris) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len

    view.setFloat32(offset, nx, true)
    view.setFloat32(offset + 4, ny, true)
    view.setFloat32(offset + 8, nz, true)
    offset += 12
    for (const p of [a, b, c]) {
      view.setFloat32(offset, p[0], true)
      view.setFloat32(offset + 4, p[1], true)
      view.setFloat32(offset + 8, p[2], true)
      offset += 12
    }
    view.setUint16(offset, 0, true)
    offset += 2
  }

  return buffer
}

/** Circles and seams at the feature boundaries, in the same layout the engine writes. */
function buildSampleEdges() {
  const segs = []
  const circle = (r, z, n = 72) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      segs.push([Math.cos(a0) * r, Math.sin(a0) * r, z, Math.cos(a1) * r, Math.sin(a1) * r, z])
    }
  }

  circle(26, 0); circle(26, 5); circle(18, 5); circle(18, 36)
  circle(8, 0); circle(8, 36)

  const buffer = new ArrayBuffer(segs.length * 24)
  const view = new DataView(buffer)
  let offset = 0
  for (const s of segs) {
    for (const v of s) {
      view.setFloat32(offset, v, true)
      offset += 4
    }
  }
  return buffer
}
