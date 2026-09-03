<script setup>
/**
 * The part viewer, sitting on the main screen rather than behind a menu.
 *
 * It used to be a separate route that opened empty and stayed empty until you found the
 * dropdown and chose something, which made a working viewer look broken. Here it is
 * always in view, it picks a part on its own, and the queue promotes each job to it as
 * that job finishes. Nothing to select, nothing to navigate to.
 *
 * The comparison is the reason it earns the space. A STEP that opens without error can
 * still be wrong, and the quickest way to see it is the edge overlay: a real analytic
 * face has a handful of clean boundary curves, a re-triangulated one has thousands.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/shell/AppIcon.vue'
import ThreeViewer from './ThreeViewer.vue'
import { LIGHTING_PRESETS } from './lighting'
import { useJobsStore } from '@/stores/jobs'
import { useEngine } from '@/engine'

const jobs = useJobsStore()
const { jobs: queue, selectedId } = storeToRefs(jobs)

const side = ref('output')
const lighting = ref('studio')
const showEdges = ref(true)
const showSurface = ref(true)
const wireframe = ref(false)
const viewer = ref(null)
const geometry = ref(null)
const edges = ref(null)
const stats = ref(null)
const loading = ref(false)
const failure = ref(null)

/** Anything with geometry to show: a converted result, or a file still waiting to run. */
const viewable = computed(() =>
  queue.value.filter((j) => ['ok', 'warning'].includes(j.status) || j.file)
)

const selected = computed(() => queue.value.find((j) => j.id === selectedId.value) ?? null)
const hasOutput = computed(() => Boolean(selected.value?.result?.ok))

async function load() {
  const job = selected.value

  if (!job) {
    geometry.value = null
    edges.value = null
    stats.value = null
    return
  }

  loading.value = true
  failure.value = null

  try {
    const engine = useEngine()

    if (side.value === 'input' || !hasOutput.value) {
      // A dropped file is already in memory, so there is no reason to ask for it back.
      geometry.value = job.file
        ? await job.file.arrayBuffer()
        : await engine.readFile(job.inputPath)
      edges.value = null
      return
    }

    // A STEP cannot be drawn directly: it holds surfaces and curves, not triangles. The
    // engine tessellates it back and writes the real face boundaries alongside.
    const preview = await engine.preview(job.outputPath)
    geometry.value = preview.mesh
    edges.value = preview.edges ?? null
  } catch (err) {
    failure.value = err?.message ?? String(err)
    geometry.value = null
    edges.value = null
  } finally {
    loading.value = false
  }
}

/**
 * Adopt the newest part whenever nothing is selected.
 *
 * This has to be a watcher rather than a one off on mount. The screen loads with an empty
 * queue, so a check that runs once at startup finds nothing, and every file dropped after
 * that arrives with nobody watching: the queue fills up and the viewport stays empty,
 * which is exactly the bug this replaces.
 */
watch(
  viewable,
  (list) => {
    if (!list.length) {
      if (selectedId.value) jobs.select(null)
      return
    }
    const stillThere = list.some((j) => j.id === selectedId.value)
    if (!stillThere) jobs.select(list[list.length - 1].id)
  },
  { immediate: true }
)

// A finished job flips the view to its result; picking a different part reloads. Keyed on
// id rather than the object, so a progress tick on the running job does not reload it.
watch(
  () => selected.value?.id,
  () => {
    side.value = selected.value?.result?.ok ? 'output' : 'input'
    load()
  }
)

// A part converted while being looked at should show its result, not stay on the mesh.
watch(
  () => selected.value?.status,
  (status) => {
    if (status === 'ok' || status === 'warning') {
      side.value = 'output'
      load()
    }
  }
)

watch(side, load)

const VIEWS = [
  { id: 'iso', label: 'Iso' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'right', label: 'Right' }
]

const view = (name) => viewer.value?.setView(name)
const fit = () => viewer.value?.frameCamera()
const zoom = (factor) => viewer.value?.zoomBy(factor)

onMounted(load)
</script>

<template>
  <div class="panel flex min-h-0 min-w-0 flex-col overflow-hidden">
    <div class="panel-header">
      <div class="flex min-w-0 items-center gap-2">
        <AppIcon name="viewer" :size="15" class="shrink-0 text-accent" />
        <h2 class="display shrink-0 text-sm tracking-wide">Viewer</h2>
        <span v-if="selected" class="truncate text-xs text-white/45">{{ selected.name }}</span>
      </div>

      <div v-if="selected" class="flex shrink-0 items-center gap-1">
        <!-- Input and output are one object seen twice, so they are one control. -->
        <div class="flex border border-white/15">
          <button
            v-for="s in [
              { id: 'input', label: 'Mesh', enabled: true },
              { id: 'output', label: 'Solid', enabled: hasOutput }
            ]"
            :key="s.id"
            type="button"
            class="px-2.5 py-1 text-[11px] transition-colors disabled:opacity-30"
            :class="side === s.id ? 'bg-accent text-ink' : 'text-white/60 hover:text-white'"
            :disabled="!s.enabled"
            :title="s.enabled ? '' : 'Not converted yet'"
            @click="side = s.id"
          >
            {{ s.label }}
          </button>
        </div>

        <button
          type="button"
          class="btn-quiet"
          :class="{ 'text-accent': showEdges }"
          :disabled="!edges"
          :title="edges ? 'B-Rep edges: the real face boundaries' : 'No edge data for this part'"
          @click="showEdges = !showEdges"
        >
          Edges
        </button>
        <button
          type="button"
          class="btn-quiet"
          :class="{ 'text-accent': showSurface }"
          title="Surface"
          @click="showSurface = !showSurface"
        >
          Surface
        </button>

        <select v-model="lighting" class="field w-24 py-1 text-[11px]">
          <option v-for="p in LIGHTING_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>
    </div>

    <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-pit">
      <ThreeViewer
        v-if="geometry"
        ref="viewer"
        :geometry="geometry"
        :edges="edges"
        :show-edges="showEdges"
        :show-surface="showSurface"
        :wireframe="wireframe"
        :lighting="lighting"
        @stats="stats = $event"
      />

      <!-- Camera controls sit on the viewport rather than in the header, next to the
           thing they move. Orbit by dragging works too, but a part you have spun into a
           corner needs a way back, and standard views are how a drawing is read. -->
      <div v-if="geometry" class="absolute right-3 top-3 flex flex-col items-end gap-2">
        <div class="flex border border-white/15 bg-ink/85 backdrop-blur">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            type="button"
            class="px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            :title="`Look from ${v.label.toLowerCase()}`"
            @click="view(v.id)"
          >
            {{ v.label }}
          </button>
        </div>

        <div class="flex border border-white/15 bg-ink/85 backdrop-blur">
          <button
            type="button"
            class="px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="Frame the part"
            @click="fit()"
          >
            Fit
          </button>
          <button
            type="button"
            class="border-l border-white/15 px-2.5 py-1 text-[13px] leading-none text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="Zoom in"
            @click="zoom(0.8)"
          >
            +
          </button>
          <button
            type="button"
            class="border-l border-white/15 px-2.5 py-1 text-[13px] leading-none text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="Zoom out"
            @click="zoom(1.25)"
          >
            &minus;
          </button>
          <button
            type="button"
            class="border-l border-white/15 px-2.5 py-1 text-[11px] transition-colors hover:bg-white/10"
            :class="wireframe ? 'text-accent' : 'text-white/60 hover:text-white'"
            title="Wireframe: see the triangles themselves"
            @click="wireframe = !wireframe"
          >
            Wire
          </button>
        </div>
      </div>

      <div v-else class="flex h-full items-center justify-center px-6 text-center">
        <div>
          <AppIcon name="viewer" :size="30" class="mx-auto mb-2 text-white/12" />
          <p class="text-xs text-white/40">
            {{ loading ? 'Loading geometry' : failure ? failure : 'Drop a part to see it here' }}
          </p>
        </div>
      </div>

      <p v-if="loading && geometry" class="figure absolute right-3 top-2 text-[11px] text-accent">
        Loading
      </p>

      <!-- Measurements over the viewport rather than in a side panel: there are only
           three of them and the viewport is the thing that wants the room. -->
      <div
        v-if="stats"
        class="pointer-events-none absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-ink/80 px-3 py-1.5 backdrop-blur"
      >
        <span class="figure text-[11px] text-white/60">
          {{ stats.triangles.toLocaleString() }}<span class="text-white/30"> tris</span>
        </span>
        <span v-if="edges" class="figure text-[11px] text-accent">
          {{ (edges.byteLength / 24).toLocaleString() }}<span class="text-white/30"> edges</span>
        </span>
        <span class="figure text-[11px] text-white/60">
          {{ stats.size.x.toFixed(1) }} x {{ stats.size.y.toFixed(1) }} x
          {{ stats.size.z.toFixed(1) }}<span class="text-white/30"> mm</span>
        </span>
        <span
          v-if="selected?.result?.facesAfterUnify != null && side === 'output'"
          class="figure text-[11px] text-white/60"
        >
          {{ selected.result.facesAfterUnify.toLocaleString() }}<span class="text-white/30"> faces</span>
        </span>
      </div>
    </div>
  </div>
</template>
