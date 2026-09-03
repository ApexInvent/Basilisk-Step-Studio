<script setup>
import { computed } from 'vue'
import AppIcon from '@/components/shell/AppIcon.vue'
import { useJobsStore } from '@/stores/jobs'
import { useEngine, isDesktop } from '@/engine'

const props = defineProps({
  job: { type: Object, required: true },
  expanded: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle', 'inspect'])
const jobs = useJobsStore()

const STATUS = {
  queued: { label: 'Queued', icon: 'file', class: 'text-white/40' },
  running: { label: 'Running', icon: 'refresh', class: 'text-accent' },
  ok: { label: 'Converted', icon: 'check', class: 'text-state-ok' },
  warning: { label: 'Check output', icon: 'warn', class: 'text-state-warn' },
  failed: { label: 'Failed', icon: 'fail', class: 'text-state-fail' },
  cancelled: { label: 'Cancelled', icon: 'close', class: 'text-white/35' }
}

const status = computed(() => STATUS[props.job.status] ?? STATUS.queued)
const result = computed(() => props.job.result)

/**
 * Jumping to the file only makes sense where the file is somewhere the user can be sent.
 *
 * In the app the STEP is written beside the input, at a path they chose. Running from source
 * a browser drop lands in the helper's working directory, which is a temporary folder, so
 * that build offers Save instead and this stays hidden.
 */
const canReveal = computed(
  () => isDesktop() && Boolean(props.job.result?.ok) && Boolean(props.job.outputPath)
)

async function reveal() {
  try {
    await useEngine().revealInFolder(props.job.outputPath)
  } catch {
    // Explorer refusing to open is not worth a dialog. The path is on the expanded row.
  }
}

const elapsed = computed(() => {
  const j = props.job
  if (j.result?.seconds != null) return `${j.result.seconds.toFixed(2)}s`
  if (j.startedAt && j.status === 'running') return null
  return null
})

/**
 * The two or three numbers worth showing on a collapsed row.
 *
 * Face count before and after unify is the one that tells you most at a glance: it is the
 * difference between a STEP made of ten thousand triangles and one made of forty faces.
 */
const headline = computed(() => {
  const r = result.value
  if (!r?.ok) return []
  const out = []
  if (r.facesAfterUnify != null) out.push({ label: 'faces', value: r.facesAfterUnify.toLocaleString() })
  if (r.triangles != null) out.push({ label: 'tris', value: r.triangles.toLocaleString() })
  if (r.watertight != null) {
    out.push({ label: '', value: r.watertight ? 'watertight' : 'open shell' })
  }
  return out
})

/**
 * How far the solid drifted from the mesh it came from.
 *
 * This is not the engine's `volumeDeltaPct`, which is the verify pass re-reading the
 * written file and checking it against what it just built: that catches a broken write,
 * and it reads 0 even when the solid differs from the original mesh.
 *
 * The number people actually want is mesh against solid. In TrueForm it is expected to be
 * non zero and positive: the mesh facets are inscribed in the true surface, so fitting a
 * real cylinder back onto them recovers the volume the faceting shaved off. A large value
 * means the fit wandered, which is worth seeing.
 */
const shapeDrift = computed(() => {
  const r = result.value
  if (!r?.ok || r.meshVolumeMM3 == null || r.stepVolumeMM3 == null) return null
  if (!r.meshVolumeMM3) return null
  return ((r.stepVolumeMM3 - r.meshVolumeMM3) / r.meshVolumeMM3) * 100
})

/** What TrueForm managed to rebuild. Absent entirely on a verbatim run. */
const recovered = computed(() => {
  const r = result.value
  if (!r?.ok || r.smoothPlanes == null) return null
  return [
    { k: 'Planes', v: r.smoothPlanes },
    { k: 'Cylinders', v: r.smoothCylinders },
    { k: 'Fillets', v: r.smoothFillets },
    { k: 'Rejected', v: r.smoothRejected },
    { k: 'Left faceted', v: r.smoothFacetFaces },
    {
      k: 'Max deviation',
      v: r.smoothMaxDevMM != null ? `${r.smoothMaxDevMM.toFixed(4)} mm` : null
    }
  ].filter((f) => f.v !== null && f.v !== undefined)
})

const canCancel = computed(() => ['queued', 'running'].includes(props.job.status))
const canRetry = computed(() => ['ok', 'warning', 'failed', 'cancelled'].includes(props.job.status))
</script>

<template>
  <div class="border-b border-white/[0.07] last:border-b-0">
    <div
      class="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.03]"
      :class="{ 'bg-white/[0.03]': expanded }"
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-3 text-left"
        @click="emit('toggle')"
      >
        <AppIcon
          :name="status.icon"
          :size="16"
          :class="[status.class, job.status === 'running' ? 'animate-spin' : '']"
        />

        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm text-white/90" :title="job.inputPath">
            {{ job.name }}
          </span>

          <!-- While running, the phase name is more use than a percentage: it says what
               the engine is actually doing and which stage is the slow one. -->
          <span v-if="job.status === 'running'" class="figure block truncate text-[11px] text-accent">
            {{ job.phase || 'Working' }}
          </span>
          <span v-else-if="job.error" class="block truncate text-[11px] text-state-fail" :title="job.error">
            {{ job.error }}
          </span>
          <span v-else class="figure block truncate text-[11px] text-white/35">
            {{ status.label }}
            <template v-for="(h, i) in headline" :key="i">
              <span class="mx-1 text-white/15">/</span>{{ h.value }}<template v-if="h.label"> {{ h.label }}</template>
            </template>
          </span>
        </span>
      </button>

      <span v-if="elapsed" class="figure shrink-0 text-[11px] text-white/40">{{ elapsed }}</span>

      <div class="flex shrink-0 items-center gap-1">
        <button
          v-if="jobs.needsSave(job)"
          type="button"
          class="btn-quiet text-accent"
          title="Save the STEP file"
          @click="jobs.save(job.id)"
        >
          <AppIcon name="download" :size="14" />
        </button>
        <button
          v-if="canReveal"
          type="button"
          class="btn-quiet"
          title="Show the STEP file in Explorer"
          @click="reveal"
        >
          <AppIcon name="folder" :size="14" />
        </button>
        <button
          v-if="result?.ok"
          type="button"
          class="btn-quiet"
          title="Open in viewer"
          @click="emit('inspect')"
        >
          <AppIcon name="viewer" :size="14" />
        </button>
        <button v-if="canRetry" type="button" class="btn-quiet" title="Run again" @click="jobs.requeue(job.id)">
          <AppIcon name="refresh" :size="14" />
        </button>
        <button v-if="canCancel" type="button" class="btn-quiet" title="Cancel" @click="jobs.cancel(job.id)">
          <AppIcon name="stop" :size="14" />
        </button>
        <button type="button" class="btn-quiet" title="Remove" @click="jobs.remove(job.id)">
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </div>

    <!-- Progress reads as a hairline under the row rather than a bar in it, so a queue of
         forty rows does not turn into forty competing bars. -->
    <div v-if="job.status === 'running'" class="h-px bg-white/10">
      <div
        class="h-full bg-accent transition-[width] duration-150"
        :style="{ width: Math.round(job.progress * 100) + '%' }"
      />
    </div>

    <div v-if="expanded" class="border-t border-white/[0.07] bg-pit px-4 py-3">
      <dl v-if="result?.ok" class="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        <div v-for="f in [
            { k: 'Triangles', v: result.triangles?.toLocaleString() },
            { k: 'Vertices', v: result.vertices?.toLocaleString() },
            { k: 'Components', v: result.components },
            { k: 'Solids', v: result.solids },
            { k: 'Open shells', v: result.openShells },
            { k: 'Faces before', v: result.facesBeforeUnify?.toLocaleString() },
            { k: 'Faces after', v: result.facesAfterUnify?.toLocaleString() },
            { k: 'Mesh volume', v: result.meshVolumeMM3 != null ? result.meshVolumeMM3.toFixed(1) + ' mm3' : null },
            { k: 'Solid volume', v: result.stepVolumeMM3 != null ? result.stepVolumeMM3.toFixed(1) + ' mm3' : null },
            {
              k: 'Shape drift',
              v: shapeDrift != null ? (shapeDrift >= 0 ? '+' : '') + shapeDrift.toFixed(3) + ' %' : null
            }
          ].filter((f) => f.v !== null && f.v !== undefined)"
          :key="f.k"
        >
          <dt class="text-[11px] text-white/40">{{ f.k }}</dt>
          <dd class="figure text-sm text-white/85">{{ f.v }}</dd>
        </div>
      </dl>

      <!-- Only present on a TrueForm run, and the most interesting thing it reports: how
           much of the part came back as real geometry rather than triangles. -->
      <div v-if="recovered" class="mt-3 border-l-2 border-accent bg-accent/5 px-3 py-2">
        <div class="eyebrow mb-1.5 text-accent">Surfaces recovered</div>
        <dl class="grid grid-cols-3 gap-x-4 gap-y-1 sm:grid-cols-6">
          <div v-for="f in recovered" :key="f.k">
            <dt class="text-[11px] text-white/40">{{ f.k }}</dt>
            <dd class="figure text-sm text-white/85">{{ f.v }}</dd>
          </div>
        </dl>
      </div>

      <!-- Exit code 2 lands here. The file exists and is probably usable, so the wording
           has to invite a look rather than announce a failure. -->
      <div v-if="result?.warnings?.length" class="mt-3 border-l-2 border-state-warn bg-state-warn/5 px-3 py-2">
        <div class="eyebrow mb-1 text-state-warn">Written, with warnings</div>
        <ul class="space-y-0.5">
          <li v-for="(w, i) in result.warnings" :key="i" class="text-xs text-white/70">{{ w }}</li>
        </ul>
      </div>

      <div v-if="job.error" class="mt-3 border-l-2 border-state-fail bg-state-fail/5 px-3 py-2">
        <div class="eyebrow mb-1 text-state-fail">Failed</div>
        <p class="font-mono text-xs text-white/70">{{ job.error }}</p>
      </div>

      <div class="mt-3 space-y-1 font-mono text-[11px]">
        <div class="text-white/30">In</div>
        <div class="truncate text-white/60">{{ job.inputPath }}</div>
        <div class="pt-1 text-white/30">Out</div>
        <div class="truncate text-white/60">{{ job.outputPath }}</div>
      </div>

      <details v-if="job.logs.length" class="mt-3">
        <summary class="cursor-pointer text-[11px] text-white/40 hover:text-accent">
          Engine output ({{ job.logs.length }} lines)
        </summary>
        <pre class="well mt-2 max-h-48 overflow-auto p-2 font-mono text-[11px] leading-relaxed"><span
          v-for="(line, i) in job.logs"
          :key="i"
          :class="line.stream === 'stderr' ? 'text-state-fail' : line.stream === 'meta' ? 'text-accent' : 'text-white/55'"
        >{{ line.text }}
</span></pre>
      </details>
    </div>
  </div>
</template>
