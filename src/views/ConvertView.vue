<script setup>
/**
 * The whole app, on one screen.
 *
 * Layout follows the order of the work rather than a tidy grouping of features. The left
 * is the part: drop it, then look at it, and the viewer takes most of the room because
 * checking the result is the thing you actually spend time on. The right is the controls:
 * the command you are about to run, the queue running it, and the options underneath,
 * folded away because most runs never touch them.
 */
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/shell/AppIcon.vue'
import DropZone from '@/components/convert/DropZone.vue'
import JobRow from '@/components/convert/JobRow.vue'
import OptionsPanel from '@/components/convert/OptionsPanel.vue'
import CommandBar from '@/components/convert/CommandBar.vue'
import PartViewer from '@/components/viewer/PartViewer.vue'
import { useJobsStore } from '@/stores/jobs'
import { useEngineStore } from '@/stores/engine'
import { useOptionsStore } from '@/stores/options'

const jobs = useJobsStore()
const engine = useEngineStore()
const options = useOptionsStore()

const { jobs: queue, counts, running, selectedId } = storeToRefs(jobs)
const { ready: engineReady, simulated, unauthorized, error: engineError } = storeToRefs(engine)
const { changed } = storeToRefs(options)

const expandedId = ref(null)
// Folded by default. The presets cover most of what people need, and twenty controls
// open on load makes the screen look like a settings dialog rather than a tool.
const showOptions = ref(false)

const canConvert = computed(() => counts.value.queued > 0 && !running.value)

function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-3">
      <div>
        <h1 class="display text-xl">Convert</h1>
        <p class="mt-0.5 text-xs text-white/45">
          STL mesh to STEP B-Rep solid, through the stl2step engine.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button v-if="running" type="button" class="btn-ghost" @click="jobs.cancelAll()">
          <AppIcon name="stop" :size="15" />Stop
        </button>
        <button
          v-else
          type="button"
          class="btn-primary"
          :disabled="!canConvert"
          :title="counts.queued ? '' : 'Queue some files first'"
          @click="jobs.start()"
        >
          <AppIcon name="play" :size="15" />
          Convert{{ counts.queued ? ` ${counts.queued}` : '' }}
        </button>
      </div>
    </header>

    <!-- A refused token is not a missing engine, and saying so sends people to the wrong
         screen. It gets its own banner with the one action that fixes it. -->
    <div
      v-if="unauthorized"
      class="flex items-center gap-3 border-b border-state-fail/30 bg-state-fail/10 px-6 py-2"
    >
      <AppIcon name="warn" :size="15" class="shrink-0 text-state-fail" />
      <p class="flex-1 text-xs text-white/75">{{ engineError }}</p>
      <button type="button" class="btn-quiet text-state-fail hover:text-white" @click="engine.detect()">
        Try again
      </button>
    </div>
    <div
      v-else-if="!engineReady"
      class="flex items-center gap-3 border-b border-state-warn/30 bg-state-warn/10 px-6 py-2"
    >
      <AppIcon name="warn" :size="15" class="shrink-0 text-state-warn" />
      <p class="flex-1 text-xs text-white/75">
        No conversion engine found. You can still queue files, set options and build a command.
      </p>
      <RouterLink to="/engine" class="btn-quiet text-state-warn hover:text-white">Set up engine</RouterLink>
    </div>
    <div
      v-else-if="simulated"
      class="flex items-center gap-3 border-b border-white/10 bg-white/[0.03] px-6 py-2"
    >
      <AppIcon name="warn" :size="15" class="shrink-0 text-state-warn" />
      <p class="flex-1 text-xs text-white/70">
        Running against the simulated engine. Results look real but no STEP file is written.
      </p>
    </div>

    <div class="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[1fr_380px]">
      <!-- The part -->
      <div class="flex min-h-0 min-w-0 flex-col gap-3">
        <DropZone compact />
        <PartViewer class="min-h-0 flex-1" />
      </div>

      <!-- The controls -->
      <div class="flex min-h-0 min-w-0 flex-col gap-3">
        <CommandBar />

        <div class="panel flex min-h-0 flex-1 flex-col">
          <div class="panel-header">
            <h2 class="display text-sm tracking-wide">
              Queue
              <span v-if="counts.total" class="figure ml-1 text-white/35">{{ counts.total }}</span>
            </h2>
            <div v-if="counts.total" class="flex items-center gap-1">
              <button
                v-if="counts.ok || counts.warning || counts.failed"
                type="button"
                class="btn-quiet"
                @click="jobs.clearFinished()"
              >
                Clear finished
              </button>
              <button type="button" class="btn-quiet" title="Clear all" @click="jobs.clearAll()">
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </div>

          <div v-if="queue.length" class="min-h-0 flex-1 overflow-y-auto">
            <JobRow
              v-for="job in queue"
              :key="job.id"
              :job="job"
              :expanded="expandedId === job.id"
              :class="{ 'bg-accent/[0.06]': selectedId === job.id }"
              @toggle="toggle(job.id)"
              @inspect="jobs.select(job.id)"
            />
          </div>

          <div v-else class="flex flex-1 items-center justify-center px-4 py-8 text-center">
            <div>
              <p class="text-xs text-white/40">Nothing queued</p>
              <p class="mt-1 text-[11px] leading-relaxed text-white/25">
                Drop STL files on the left. They wait here until you press Convert.
              </p>
            </div>
          </div>
        </div>

        <!-- Options fold away: presets cover the common cases, and the command preview
             above already says exactly what will run. -->
        <div class="panel shrink-0">
          <button
            type="button"
            class="panel-header w-full text-left transition-colors hover:bg-white/[0.03]"
            @click="showOptions = !showOptions"
          >
            <span class="flex items-center gap-2">
              <AppIcon
                name="chevron"
                :size="13"
                class="text-white/30 transition-transform"
                :class="{ 'rotate-90': showOptions }"
              />
              <span class="display text-sm tracking-wide">Options</span>
            </span>
            <span v-if="changed.length" class="figure text-[11px] text-accent">
              {{ changed.length }} changed
            </span>
          </button>
        </div>

        <OptionsPanel v-if="showOptions" class="max-h-[50vh] shrink-0" :headless="true" />
      </div>
    </div>
  </div>
</template>
