<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useJobsStore } from '@/stores/jobs'
import { useEngineStore } from '@/stores/engine'

const APP_VERSION = __APP_VERSION__

const jobs = useJobsStore()
const engine = useEngineStore()

const { counts, progress, running } = storeToRefs(jobs)
const { simulated } = storeToRefs(engine)

const percent = computed(() => Math.round(progress.value * 100))

/** Only the counts that are non zero, so a clean run does not read as a scoreboard. */
const tallies = computed(() =>
  [
    { key: 'ok', label: 'ok', value: counts.value.ok, class: 'text-state-ok' },
    { key: 'warning', label: 'warnings', value: counts.value.warning, class: 'text-state-warn' },
    { key: 'failed', label: 'failed', value: counts.value.failed, class: 'text-state-fail' }
  ].filter((t) => t.value > 0)
)
</script>

<template>
  <footer
    class="flex h-8 shrink-0 items-center gap-4 border-t border-white/10 bg-pit px-4 text-[11px] text-white/50"
  >
    <!-- The simulated engine warning is deliberately loud. Nothing is worse than
         believing you converted forty parts when nothing was written. -->
    <span
      v-if="simulated"
      class="figure bg-state-warn/15 px-2 py-0.5 font-semibold uppercase tracking-wider text-state-warn"
    >
      Simulated engine
    </span>

    <span v-if="counts.total" class="figure">
      {{ counts.total }} {{ counts.total === 1 ? 'file' : 'files' }}
    </span>

    <span v-for="t in tallies" :key="t.key" class="figure" :class="t.class">
      {{ t.value }} {{ t.label }}
    </span>

    <div v-if="running" class="flex flex-1 items-center gap-3">
      <div class="h-1 max-w-64 flex-1 bg-white/10">
        <div class="h-full bg-accent transition-[width] duration-200" :style="{ width: percent + '%' }" />
      </div>
      <span class="figure text-white/70">{{ percent }}%</span>
    </div>
    <div v-else class="flex-1" />

    <span class="figure text-white/30">Basilisk Step Studio {{ APP_VERSION }}</span>
  </footer>
</template>
