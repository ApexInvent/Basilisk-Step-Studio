/**
 * The conversion queue.
 *
 * Batch is the reason this app exists rather than a single file drop: converting one part
 * is not what hurts, converting forty is. So the queue is the primary object, a single
 * file is just a queue of one, and the rules that matter are about what happens when one
 * of the forty goes wrong.
 *
 * Two of those rules are load bearing:
 *
 * One failure must not stall the rest. A bad mesh in position three is normal, and the
 * other thirty seven still need converting.
 *
 * Exit code 2 is its own outcome, not a failure. The file was written but something about
 * it deserves a look, so it gets its own colour and stays in the list to be inspected.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useEngine, outcomeFromExit } from '@/engine'
import { useOptionsStore } from './options'

let counter = 0
const nextId = () => `job-${++counter}`

/** Terminal states, the ones a job does not leave on its own. */
const DONE = new Set(['ok', 'warning', 'failed', 'cancelled'])

export const useJobsStore = defineStore('jobs', () => {
  const jobs = ref([])
  const running = ref(false)
  const concurrency = ref(1)
  const outputMode = ref('beside') // 'beside' the input, or into outputDir
  const outputDir = ref(null)
  const stopOnError = ref(false)

  /** Which job the viewer is showing. Shared, because the viewer now sits beside the
   *  queue rather than on a screen of its own. */
  const selectedId = ref(null)

  const queued = computed(() => jobs.value.filter((j) => j.status === 'queued'))
  const active = computed(() => jobs.value.filter((j) => j.status === 'running'))
  const finished = computed(() => jobs.value.filter((j) => DONE.has(j.status)))
  const counts = computed(() => ({
    total: jobs.value.length,
    queued: queued.value.length,
    running: active.value.length,
    ok: jobs.value.filter((j) => j.status === 'ok').length,
    warning: jobs.value.filter((j) => j.status === 'warning').length,
    failed: jobs.value.filter((j) => j.status === 'failed').length
  }))

  /** Overall progress across the batch, so the status bar can show one number. */
  const progress = computed(() => {
    if (!jobs.value.length) return 0
    const total = jobs.value.reduce((sum, j) => {
      if (DONE.has(j.status)) return sum + 1
      if (j.status === 'running') return sum + j.progress
      return sum
    }, 0)
    return total / jobs.value.length
  })

  function outputPathFor(inputPath) {
    const normalized = String(inputPath).replace(/\\/g, '/')
    const name = normalized.split('/').pop().replace(/\.[^.]+$/, '') + '.step'
    if (outputMode.value === 'directory' && outputDir.value) {
      return `${outputDir.value.replace(/[\\/]$/, '')}\\${name}`
    }
    const dir = normalized.slice(0, normalized.lastIndexOf('/'))
    return dir ? `${dir}/${name}`.replace(/\//g, '\\') : name
  }

  /**
   * Add files to the queue.
   *
   * Accepts browser File objects (drag and drop in dev) or plain paths from the native
   * picker, and normalises both into the same job shape so nothing downstream cares which
   * door the file came in through.
   */
  function addFiles(items) {
    const added = []

    for (const item of items) {
      const isFile = typeof File !== 'undefined' && item instanceof File
      const path = isFile ? item.name : String(item)
      const name = path.replace(/\\/g, '/').split('/').pop()

      if (!/\.stl$/i.test(name)) continue

      // Re-adding a file that is already queued is almost always a double drop.
      if (jobs.value.some((j) => j.inputPath === path && !DONE.has(j.status))) continue

      const job = {
        id: nextId(),
        name,
        inputPath: path,
        outputPath: outputPathFor(path),
        file: isFile ? item : null,
        size: isFile ? item.size : null,
        status: 'queued',
        progress: 0,
        phase: '',
        result: null,
        error: null,
        logs: [],
        startedAt: null,
        finishedAt: null
      }

      jobs.value.push(job)
      added.push(job)
    }

    return added
  }

  function select(id) {
    selectedId.value = id
  }

  function remove(id) {
    const job = jobs.value.find((j) => j.id === id)
    if (job?.status === 'running') cancel(id)
    if (selectedId.value === id) selectedId.value = null
    jobs.value = jobs.value.filter((j) => j.id !== id)
  }

  function clearFinished() {
    jobs.value = jobs.value.filter((j) => !DONE.has(j.status))
  }

  function clearAll() {
    for (const job of active.value) cancel(job.id)
    jobs.value = []
  }

  function requeue(id) {
    const job = jobs.value.find((j) => j.id === id)
    if (!job || !DONE.has(job.status)) return
    Object.assign(job, {
      status: 'queued',
      progress: 0,
      phase: '',
      result: null,
      error: null,
      logs: [],
      startedAt: null,
      finishedAt: null
    })
  }

  function cancel(id) {
    const job = jobs.value.find((j) => j.id === id)
    if (!job) return
    if (job.status === 'queued') {
      job.status = 'cancelled'
      return
    }
    if (job.status === 'running') {
      useEngine().cancel(id)
      job.phase = 'Cancelling'
    }
  }

  async function runOne(job) {
    const engine = useEngine()
    const optionsStore = useOptionsStore()

    job.status = 'running'
    job.progress = 0
    job.startedAt = Date.now()
    job.outputPath = outputPathFor(job.inputPath)

    try {
      const result = await engine.convert(
        {
          jobId: job.id,
          input: job.inputPath,
          output: job.outputPath,
          file: job.file,
          // Only meaningful for a file that arrived without a path: the adapter needs to
          // know whether the user chose somewhere for the result to land.
          outputDir: outputMode.value === 'directory' ? outputDir.value : null,
          options: optionsStore.options
        },
        {
          onProgress: ({ progress: p, phase }) => {
            job.progress = p
            job.phase = phase
          },
          onLog: (line) => {
            job.logs.push(line)
            // A runaway engine should not be able to exhaust memory through the log.
            if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500)
          }
        }
      )

      job.result = result
      job.progress = 1
      job.finishedAt = Date.now()

      // An uploaded file is converted somewhere the browser could not have named, so the
      // queue takes the paths the engine actually used rather than the ones it guessed.
      if (result.input) job.inputPath = result.input
      if (result.output) job.outputPath = result.output

      if (result.cancelled) {
        job.status = 'cancelled'
        job.phase = 'Cancelled'
        return
      }

      job.status = outcomeFromExit(result.exitCode)
      job.error = result.error ?? null
      job.phase = job.status === 'failed' ? 'Failed' : 'Done'

      // Put the result on screen without being asked. Watching a part appear as it
      // finishes is the point of having the viewer next to the queue.
      if (job.status !== 'failed') selectedId.value = job.id
    } catch (err) {
      // A thrown error is the engine failing to run at all, which is different from a
      // conversion that ran and reported failure. Both land the job in 'failed', but the
      // message is the useful part and it must not be swallowed.
      job.status = 'failed'
      job.error = err?.message ?? String(err)
      job.phase = 'Failed'
      job.finishedAt = Date.now()
      job.logs.push({ stream: 'stderr', text: job.error })
    }
  }

  /**
   * Work the queue until it is empty.
   *
   * Concurrency is a setting because the engine already threads internally: running four
   * files at once on a machine where each conversion is using every core is slower than
   * running them one at a time, not faster.
   */
  async function start() {
    if (running.value) return
    running.value = true

    try {
      while (true) {
        const next = jobs.value.filter((j) => j.status === 'queued')
        if (!next.length) break

        const batch = next.slice(0, Math.max(1, concurrency.value))
        await Promise.all(batch.map(runOne))

        if (stopOnError.value && jobs.value.some((j) => j.status === 'failed')) break
      }
    } finally {
      running.value = false
    }
  }

  /**
   * Save a finished STEP.
   *
   * Needed whenever the result was written somewhere the user did not pick, which is the
   * normal case for a dropped file: it lands in the sidecar's work directory, and without
   * this the conversion would be real but effectively unreachable.
   */
  async function save(id) {
    const job = jobs.value.find((j) => j.id === id)
    if (!job?.result?.ok) return
    const engine = useEngine()
    if (typeof engine.save !== 'function') return
    const name = job.name.replace(/\.[^.]+$/, '') + '.step'
    await engine.save(job.outputPath, name)
  }

  /** Whether a job's result has to be fetched rather than just opened on disk. */
  function needsSave(job) {
    return Boolean(job.file) && ['ok', 'warning'].includes(job.status)
  }

  function cancelAll() {
    for (const job of jobs.value) {
      if (job.status === 'queued' || job.status === 'running') cancel(job.id)
    }
  }

  return {
    jobs,
    running,
    concurrency,
    outputMode,
    outputDir,
    stopOnError,
    queued,
    active,
    finished,
    counts,
    progress,
    addFiles,
    remove,
    selectedId,
    select,
    clearFinished,
    clearAll,
    requeue,
    cancel,
    cancelAll,
    start,
    save,
    needsSave,
    outputPathFor
  }
})
