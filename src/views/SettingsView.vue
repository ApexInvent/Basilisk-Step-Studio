<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useJobsStore } from '@/stores/jobs'
import { useOptionsStore } from '@/stores/options'
import { useEngine, isDesktop } from '@/engine'

const jobs = useJobsStore()
const options = useOptionsStore()
const { outputMode, outputDir, concurrency, stopOnError } = storeToRefs(jobs)

const browseError = ref(null)

/**
 * Only the desktop build can raise a folder picker. In a browser the field stays what it has
 * always been, a path typed by hand, because there is no dialog to open.
 */
const canBrowse = isDesktop()

async function browse() {
  browseError.value = null
  try {
    const dir = await useEngine().pickDirectory()
    if (dir) outputDir.value = dir
  } catch (err) {
    browseError.value = err?.message ?? String(err)
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-6">
    <header class="mb-6">
      <h1 class="display text-2xl">Settings</h1>
      <p class="mt-0.5 text-xs text-white/45">Where output goes, and how the queue behaves.</p>
    </header>

    <div class="panel mb-4">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Output</h2></div>
      <div class="space-y-4 p-4">
        <div>
          <label class="field-label">Where to write STEP files</label>
          <select v-model="outputMode" class="field">
            <option value="beside">Beside the input file</option>
            <option value="directory">Into one folder</option>
          </select>
          <p class="mt-1.5 text-[11px] text-white/40">
            Beside the input keeps a part and its conversion together, which is usually what
            you want when working through a folder of models.
          </p>
        </div>

        <div v-if="outputMode === 'directory'">
          <label class="field-label">Output folder</label>
          <div class="flex gap-2">
            <input
              v-model="outputDir"
              class="field min-w-0 flex-1 font-mono text-xs"
              placeholder="C:\Parts\step"
            />
            <button v-if="canBrowse" type="button" class="btn-ghost shrink-0" @click="browse">
              Browse
            </button>
          </div>
          <p v-if="browseError" class="mt-1.5 text-[11px] text-state-fail">{{ browseError }}</p>
        </div>
      </div>
    </div>

    <div class="panel mb-4">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Queue</h2></div>
      <div class="space-y-4 p-4">
        <div>
          <label class="field-label">Files at once</label>
          <input v-model.number="concurrency" type="number" min="1" max="8" class="field w-28" />
          <p class="mt-1.5 text-[11px] leading-relaxed text-white/40">
            Leave this at one unless you have reason not to. The engine already uses every
            core on a single file, so running four at once tends to be slower overall, not
            faster, and it makes the progress reporting much harder to read.
          </p>
        </div>

        <label class="flex cursor-pointer items-start gap-2.5">
          <input
            v-model="stopOnError"
            type="checkbox"
            class="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none border border-white/25 bg-pit checked:border-accent checked:bg-accent"
          />
          <span>
            <span class="block text-sm text-white/85">Stop the batch on first failure</span>
            <span class="mt-0.5 block text-[11px] leading-relaxed text-white/40">
              Off by default. One bad mesh in a folder of forty is normal, and the other
              thirty nine should still convert.
            </span>
          </span>
        </label>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Conversion defaults</h2></div>
      <div class="p-4">
        <p class="mb-3 text-xs leading-relaxed text-white/50">
          Options are saved as you change them and restored next time. Reset returns every
          option to the engine's own defaults.
        </p>
        <button type="button" class="btn-ghost" @click="options.reset()">Reset conversion options</button>
      </div>
    </div>
  </div>
</template>
