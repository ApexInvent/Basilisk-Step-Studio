/**
 * The local bridge between the browser and stl2step.
 *
 * A web page cannot spawn a process or read a path off your disk, and it should not be
 * able to. So this is a small server that runs on your machine, owns those two abilities,
 * and exposes them to the app on loopback only.
 *
 * It exists to avoid needing Rust and a C++ toolchain just to run a conversion. The trade
 * is that this is a script rather than a double clickable app, which the desktop build
 * addresses later. Nothing in the Vue app knows the difference: both are just an engine
 * adapter behind the same interface.
 *
 * On the security of a localhost server that runs binaries: any page in your browser can
 * make requests to 127.0.0.1. So every endpoint requires a token that is generated fresh
 * at startup and only ever appears in the URL this script prints. A page that did not get
 * that token cannot reach the engine, and Origin is checked as well.
 *
 * Usage:  node sidecar/server.js [--engine <path to stl2step.exe>] [--port 4319]
 */

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, stat, access, mkdir } from 'node:fs/promises'
import { constants, createWriteStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, extname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const args = process.argv.slice(2)
const argOf = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}

const PORT = Number(argOf('--port') ?? 4319)

/**
 * The token survives a restart.
 *
 * It used to be generated fresh each time, which meant every restart silently invalidated
 * whatever tab you already had open. The page then failed every call with a 403 and
 * reported it as the engine being unreachable, which points at entirely the wrong problem.
 *
 * So it is written once and reused. It lives in the user's own app data, readable only by
 * them, which is the same bargain a local notebook server makes: a secret on your disk is
 * a fair trade for not having to re-open a link every time the server bounces.
 *
 * Pass --new-token to rotate it, which invalidates every page holding the old one.
 */
const TOKEN_FILE = join(
  process.env.LOCALAPPDATA ?? process.env.HOME ?? tmpdir(),
  'BasiliskStepStudio',
  'token'
)

function resolveToken() {
  if (!args.includes('--new-token')) {
    try {
      const saved = readFileSync(TOKEN_FILE, 'utf8').trim()
      if (/^[a-f0-9]{32}$/.test(saved)) return saved
    } catch {
      // No token yet, or unreadable. Either way, make a new one.
    }
  }

  const fresh = randomBytes(16).toString('hex')
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true })
    writeFileSync(TOKEN_FILE, fresh, { mode: 0o600 })
  } catch {
    // If it cannot be saved the server still works, the token just will not
    // outlive this run.
  }
  return fresh
}

const TOKEN = resolveToken()

/**
 * Where uploaded meshes and their results live when the browser had no path to give.
 * Per run, so two sessions cannot collide on a common filename like part.stl.
 */
const WORK_DIR = join(tmpdir(), 'basilisk-step-studio', randomBytes(4).toString('hex'))
const MAX_UPLOAD = 500e6

/**
 * Where to look for the engine, in order. First match wins, so a copy you place beside
 * the app beats one that happens to be on PATH.
 */
function candidatePaths() {
  const local = process.env.LOCALAPPDATA
  return [
    argOf('--engine'),
    process.env.STL2STEP_PATH,
    join(ROOT, 'engine', 'stl2step.exe'),
    join(ROOT, 'engine', 'stl2step'),
    local ? join(local, 'BasiliskStepStudio', 'engine', 'stl2step.exe') : null,
    'stl2step.exe',
    'stl2step'
  ].filter(Boolean)
}

let engine = null

/** What the build workflow recorded beside the binary, if anything did. */
async function recordedBeside(exe) {
  try {
    return JSON.parse(await readFile(join(dirname(exe), 'engine.json'), 'utf8'))
  } catch {
    return null
  }
}

async function findEngine() {
  for (const candidate of candidatePaths()) {
    // A bare name means "let the OS search PATH", which we test by running it.
    const isBare = !candidate.includes('/') && !candidate.includes('\\')
    if (!isBare) {
      try {
        await access(candidate, constants.X_OK)
      } catch {
        continue
      }
    }

    const probe = await run(candidate, ['--version'], { timeout: 8000 }).catch(() => null)
    // Upstream does not document --version, so a non zero exit is not disqualifying. What
    // matters is whether the binary started at all: ENOENT means it did not.
    if (probe && probe.spawned) {
      const text = `${probe.stdout} ${probe.stderr}`
      // The build workflow writes down exactly which upstream ref and which OpenCASCADE it
      // compiled, which beats guessing at it from output that may mention neither.
      const note = await recordedBeside(candidate)
      return {
        found: true,
        path: candidate,
        version: note?.version ?? text.match(/\d+\.\d+\.\d+/)?.[0] ?? null,
        occt: note?.occt ?? text.match(/OCCT[ :v]*([\d.]+)/i)?.[1] ?? null,
        source: 'local'
      }
    }
  }
  return { found: false }
}

/** Run to completion and collect output. Used for probes, not for conversions. */
function run(exe, argv, { timeout = 0 } = {}) {
  return new Promise((resolvePromise, reject) => {
    let child
    try {
      child = spawn(exe, argv, { windowsHide: true })
    } catch (err) {
      reject(err)
      return
    }

    let stdout = ''
    let stderr = ''
    let spawned = false
    let timer = null

    child.on('spawn', () => {
      spawned = true
    })
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      // ENOENT here means the candidate simply is not there, which is expected while
      // walking the search order and must not be treated as a failure.
      if (err.code === 'ENOENT') resolvePromise({ spawned: false, code: null, stdout, stderr })
      else reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ spawned, code, stdout, stderr })
    })

    if (timeout) {
      timer = setTimeout(() => {
        child.kill()
        resolvePromise({ spawned, code: null, stdout, stderr, timedOut: true })
      }, timeout)
    }
  })
}

/** Live jobs, so a cancel request can reach the right child process. */
const running = new Map()

/**
 * Run a conversion, streaming progress to the client as newline delimited JSON.
 *
 * Note that --quiet is deliberately not passed. Upstream suggests it so the RESULT line is
 * the only thing on stdout, but the progress lines are exactly what drives the progress
 * bar, and picking RESULT out is a single startsWith.
 */
function stream(res, jobId, exe, argv) {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no'
  })

  const send = (obj) => res.write(JSON.stringify(obj) + '\n')
  const child = spawn(exe, argv, { windowsHide: true })
  running.set(jobId, child)

  send({ type: 'started', command: [exe, ...argv].join(' ') })

  let result = null
  let pending = ''
  let stderrText = ''

  const consume = (chunk, streamName) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      // The contract: the machine readable payload is the line beginning RESULT or
      // MESH_RESULT. Everything else on stdout is human progress.
      const marker = line.match(/^(RESULT|MESH_RESULT)\s+(.*)$/)
      if (marker) {
        try {
          result = JSON.parse(marker[2])
        } catch {
          send({ type: 'log', stream: 'stderr', text: `Could not parse ${marker[1]} line` })
        }
        continue
      }
      send({ type: 'log', stream: streamName, text: line })
    }
  }

  child.stdout.on('data', (d) => consume(String(d), 'stdout'))
  child.stderr.on('data', (d) => {
    stderrText += d
    consume(String(d), 'stderr')
  })

  child.on('error', (err) => {
    running.delete(jobId)
    send({ type: 'done', ok: false, exitCode: 1, error: err.message })
    res.end()
  })

  child.on('close', (code) => {
    running.delete(jobId)
    if (pending.trim()) consume('\n', 'stdout')
    send({
      type: 'done',
      // Exit 2 means written with warnings, which is a success with something to read.
      ok: code === 0 || code === 2,
      exitCode: code,
      result,
      error: result?.error ?? (code !== 0 && code !== 2 ? stderrText.trim().slice(-500) : null)
    })
    res.end()
  })
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    let body = ''
    req.on('data', (d) => {
      body += d
      // A request body this large is not something this API ever needs.
      if (body.length > 1e6) {
        reject(new Error('Request too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolvePromise(body ? JSON.parse(body) : {})
      } catch (err) {
        reject(err)
      }
    })
  })
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const isApi = url.pathname.startsWith('/api/')

  if (isApi) {
    // Loopback plus a per run token. Without this, any page you happen to have open
    // could ask this server to run a binary.
    const supplied = req.headers['x-token'] ?? url.searchParams.get('token')
    if (supplied !== TOKEN) {
      res.writeHead(403, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Bad or missing token' }))
      return
    }

    const origin = req.headers.origin
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.writeHead(403).end()
      return
    }

    res.setHeader('access-control-allow-origin', origin ?? '*')
    res.setHeader('access-control-allow-headers', 'content-type, x-token')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
  }

  const json = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }

  try {
    if (url.pathname === '/api/engine') {
      engine = await findEngine()
      return json(200, engine)
    }

    if (url.pathname === '/api/convert' && req.method === 'POST') {
      if (!engine?.found) return json(409, { error: 'No engine' })
      const { jobId, input, output, args: argv } = await readBody(req)
      if (!input || !output) return json(400, { error: 'input and output are required' })
      return stream(res, jobId, engine.path, argv)
    }

    if (url.pathname === '/api/mesh' && req.method === 'POST') {
      if (!engine?.found) return json(409, { error: 'No engine' })
      const { jobId, args: argv } = await readBody(req)
      return stream(res, jobId, engine.path, argv)
    }

    if (url.pathname === '/api/cancel' && req.method === 'POST') {
      const { jobId } = await readBody(req)
      running.get(jobId)?.kill()
      return json(200, { cancelled: running.has(jobId) })
    }

    if (url.pathname === '/api/file') {
      const path = url.searchParams.get('path')
      if (!path) return json(400, { error: 'path is required' })
      const info = await stat(path)
      // The viewer only ever asks for geometry, and a 400 MB mesh would take the
      // browser down long before it rendered.
      if (info.size > 300e6) return json(413, { error: 'File too large to preview' })
      const buf = await readFile(path)
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return res.end(buf)
    }

    if (url.pathname === '/api/tmp') {
      return json(200, { dir: WORK_DIR })
    }

    /**
     * Make a STEP file drawable.
     *
     * A STEP is analytic geometry: surfaces and curves, nothing a GPU can rasterise. So
     * viewing a result means asking the engine to tessellate it back, which is what mesh
     * mode exists for. It produces two files, and the second is the interesting one:
     *
     *   mesh    a plain STL, purely so there are triangles to shade
     *   edges   the real B-Rep face boundaries
     *
     * The edges are the whole reason to look. Shaded triangles cannot tell you whether
     * TrueForm recovered a real cylinder or merely re-triangulated the mesh. The edges
     * answer it at a glance: a handful of clean curves against thousands of facet lines.
     */
    if (url.pathname === '/api/preview' && req.method === 'POST') {
      if (!engine?.found) return json(409, { error: 'No engine' })

      const { path: stepPath } = await readBody(req)
      if (!stepPath) return json(400, { error: 'path is required' })

      try {
        await access(stepPath, constants.R_OK)
      } catch {
        return json(404, { error: 'That file is no longer there' })
      }

      await mkdir(WORK_DIR, { recursive: true })
      const stem = join(WORK_DIR, `preview-${randomBytes(4).toString('hex')}`)
      const meshPath = `${stem}.stl`
      const edgePath = `${stem}.edges`

      const out = await run(engine.path, ['--mesh', stepPath, '-o', meshPath, '--edges', edgePath])

      // Mesh mode reports through MESH_RESULT rather than RESULT.
      const line = out.stdout
        .split(/\r?\n/)
        .reverse()
        .find((l) => l.startsWith('MESH_RESULT'))

      let detail = null
      if (line) {
        try {
          detail = JSON.parse(line.slice('MESH_RESULT'.length).trim())
        } catch {
          // Payload changed shape or was truncated. The files are what matter, and
          // they are checked next.
        }
      }

      try {
        await access(meshPath, constants.R_OK)
      } catch {
        return json(500, {
          error: detail?.error || out.stderr.trim().slice(-300) || 'Tessellation produced nothing'
        })
      }

      // Edges are optional: a result is still worth looking at without them.
      let edgesOk = true
      try {
        edgesOk = (await stat(edgePath)).size > 0
      } catch {
        edgesOk = false
      }

      return json(200, {
        mesh: meshPath,
        edges: edgesOk ? edgePath : null,
        faces: detail?.faces ?? null,
        edgeCount: detail?.edges ?? null,
        triangles: detail?.triangles ?? null
      })
    }

    /**
     * Take a file the browser has in memory and put it on disk.
     *
     * A page that receives a drop event gets the file's contents and its name, and
     * nothing else. There is no path, by design: the browser will not tell a web page
     * where on your disk a file lives. So in browser mode the bytes have to travel to
     * this side before the engine, which only speaks in paths, can be pointed at them.
     *
     * Streamed rather than buffered because meshes are routinely hundreds of megabytes,
     * and holding one in memory to write it out again achieves nothing.
     */
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      const raw = req.headers['x-filename']
      const requested = raw ? decodeURIComponent(raw) : 'input.stl'

      // The name comes from the client, so it is not trusted with directories. Take the
      // basename, keep only benign characters, and never let it escape the work folder.
      const safe =
        basename(requested).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'input.stl'

      await mkdir(WORK_DIR, { recursive: true })
      const dest = join(WORK_DIR, safe)
      if (!dest.startsWith(WORK_DIR)) return json(400, { error: 'Bad filename' })

      const declared = Number(req.headers['content-length'] ?? 0)
      if (declared > MAX_UPLOAD) {
        return json(413, { error: `File is larger than ${MAX_UPLOAD / 1e6} MB` })
      }

      await new Promise((done, fail) => {
        let written = 0
        const out = createWriteStream(dest)
        req.on('data', (chunk) => {
          written += chunk.length
          if (written > MAX_UPLOAD) {
            out.destroy()
            req.destroy()
            fail(new Error('Upload exceeded the size limit'))
          }
        })
        req.pipe(out)
        out.on('finish', done)
        out.on('error', fail)
      })

      const info = await stat(dest)
      if (!info.size) return json(400, { error: 'Uploaded file was empty' })
      return json(200, { path: dest, size: info.size })
    }

    // Anything else is the built app, when one exists.
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = join(ROOT, 'dist', rel)
    if (!file.startsWith(join(ROOT, 'dist'))) return res.writeHead(403).end()
    try {
      const buf = await readFile(file)

      // Caching, split by what the filename promises.
      //
      // Built assets carry a content hash, so their name changes whenever they do and
      // they can be cached hard. index.html cannot: it is the thing that names those
      // hashes, and a cached copy points at files a later build has already deleted.
      // Without this a reload can quietly serve a build from an hour ago, which looks
      // like the app ignoring every fix that has been made since.
      const hashed = /-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|svg)$/.test(rel)
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-store, must-revalidate'
      })
      return res.end(buf)
    } catch {
      // A missing hashed asset means the page asking for it is from an older build.
      // Answering with index.html would hand back HTML where a script was expected, and
      // the resulting parse error says nothing useful. A 404 is the honest answer.
      if (/-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(rel)) {
        res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
        return res.end('Stale asset. Reload the page to pick up the current build.')
      }

      // Unbuilt, or a client route. Either way index.html is the right answer.
      try {
        const buf = await readFile(join(ROOT, 'dist', 'index.html'))
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
        return res.end(buf)
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' })
        return res.end('Not built yet. Run npm run build, or use npm run dev for the interface.')
      }
    }
  } catch (err) {
    json(500, { error: err.message })
  }
})

server.listen(PORT, '127.0.0.1', async () => {
  engine = await findEngine()

  const line = '-'.repeat(64)
  console.log(line)
  console.log('  Basilisk Step Studio')
  console.log(line)
  if (engine.found) {
    console.log(`  Engine   ${engine.path}`)
    if (engine.version) console.log(`  Version  ${engine.version}`)
  } else {
    console.log('  Engine   not found')
    console.log('           Put stl2step.exe and its DLLs in the engine folder,')
    console.log('           or start with --engine <path to stl2step.exe>')
  }
  console.log(line)
  console.log('  Open this address. The token is what lets the page reach the engine.')
  console.log('')
  console.log(`  http://127.0.0.1:${PORT}/?token=${TOKEN}`)
  console.log('')
  console.log(`  Developing? Use  http://localhost:5173/?token=${TOKEN}&api=${PORT}`)
  console.log(line)
})
