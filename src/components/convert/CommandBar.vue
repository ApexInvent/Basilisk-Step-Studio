<script setup>
/**
 * The command line, shown rather than hidden.
 *
 * This is the piece that makes the app worth using for someone who already knows the CLI,
 * and the piece that teaches it to someone who does not. It runs in both directions:
 *
 *   options -> command   the preview is the exact invocation, live, copyable
 *   command -> options   paste one in and the form fills from it
 *
 * Plus an export to .bat, which is the honest exit route. If you outgrow the GUI you
 * should be able to leave with a working script rather than starting again.
 */
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/shell/AppIcon.vue'
import { useOptionsStore } from '@/stores/options'
import { toBatchScript } from '@/engine/command'
import { useEngine } from '@/engine'

const store = useOptionsStore()
const { previewCommand, summary } = storeToRefs(store)

const mode = ref('preview') // 'preview' or 'paste'
const exporting = ref(false)
const exported = ref(false)
const exportError = ref(null)
const pasted = ref('')
const report = ref(null)
const copied = ref(false)

const hasIssues = computed(
  () => report.value && (report.value.unknown.length || report.value.errors.length)
)

async function copy() {
  try {
    await navigator.clipboard.writeText(previewCommand.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard can be refused by permissions policy. The text is selectable, so this
    // is a convenience that failed, not a broken feature.
  }
}

function applyPasted() {
  if (!pasted.value.trim()) return
  report.value = store.applyCommand(pasted.value)
  if (!report.value.unknown.length && !report.value.errors.length) {
    mode.value = 'preview'
    pasted.value = ''
  }
}

/**
 * Hand over the script.
 *
 * Where it goes is the adapter's business: a download in the browser, a save dialog in the
 * app. Doing it here would mean this component knowing which build it is running in, which
 * is exactly the assumption that left the desktop viewer blank.
 */
async function exportBat() {
  exporting.value = true
  try {
    const saved = await useEngine().saveTextFile('convert.bat', toBatchScript(store.options))
    // Null means the save dialog was dismissed, which is not worth reporting back.
    if (saved) {
      exported.value = true
      setTimeout(() => (exported.value = false), 2400)
    }
  } catch (err) {
    exportError.value = err?.message ?? String(err)
    setTimeout(() => (exportError.value = null), 5000)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="panel">
    <div class="panel-header">
      <div class="flex items-center gap-2">
        <AppIcon name="terminal" :size="15" class="text-accent" />
        <h2 class="display text-sm tracking-wide">Command</h2>
      </div>

      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn-quiet"
          :class="{ 'text-accent': mode === 'paste' }"
          @click="mode = mode === 'paste' ? 'preview' : 'paste'"
        >
          Paste a command
        </button>
        <button
          type="button"
          class="btn-quiet"
          :class="{ 'text-state-ok': exported }"
          title="Save as a .bat script"
          :disabled="exporting"
          @click="exportBat"
        >
          <AppIcon :name="exported ? 'check' : 'download'" :size="14" />
        </button>
        <button type="button" class="btn-quiet" :class="{ 'text-state-ok': copied }" @click="copy">
          <AppIcon :name="copied ? 'check' : 'copy'" :size="14" />
        </button>
      </div>
    </div>

    <div class="p-3">
      <template v-if="mode === 'preview'">
        <pre class="well overflow-x-auto p-3 font-mono text-xs leading-relaxed text-white/85">{{ previewCommand }}</pre>

        <p class="mt-2 text-[11px] leading-relaxed text-white/35">
          Paths shown are placeholders. Each queued file is run with its own input and output.
        </p>

        <p v-if="exportError" class="mt-2 text-[11px] leading-relaxed text-state-fail">
          {{ exportError }}
        </p>

        <div v-if="summary.length" class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="(s, i) in summary"
            :key="i"
            class="figure border border-white/10 px-1.5 py-0.5 text-[11px] text-white/50"
          >{{ s }}</span>
        </div>
      </template>

      <template v-else>
        <textarea
          v-model="pasted"
          rows="3"
          class="field font-mono text-xs"
          placeholder="stl2step part.stl --engine trueform --schema AP242 -o part.step"
          @keydown.ctrl.enter="applyPasted"
        />

        <div class="mt-2 flex items-center gap-2">
          <button type="button" class="btn-primary px-3 py-1.5 text-xs" @click="applyPasted">
            Load into form
          </button>
          <button type="button" class="btn-quiet" @click="mode = 'preview'; report = null">Cancel</button>
          <span class="text-[11px] text-white/30">Input and output paths are ignored.</span>
        </div>

        <!-- Reporting what was not understood matters more than accepting silently. A
             dropped flag would mean the app runs something different from what you
             pasted, without ever saying so. -->
        <div v-if="hasIssues" class="mt-2 border-l-2 border-state-warn bg-state-warn/5 px-3 py-2">
          <div class="eyebrow mb-1 text-state-warn">Loaded, with exceptions</div>
          <ul class="space-y-0.5 text-[11px] text-white/70">
            <li v-for="(e, i) in report.errors" :key="'e' + i">{{ e }}</li>
            <li v-for="(u, i) in report.unknown" :key="'u' + i">
              Not recognised, ignored: <span class="font-mono">{{ u }}</span>
            </li>
          </ul>
        </div>
        <p
          v-else-if="report"
          class="mt-2 text-[11px] text-state-ok"
        >
          Loaded {{ report.touched.length }} {{ report.touched.length === 1 ? 'option' : 'options' }}.
        </p>
      </template>
    </div>
  </div>
</template>
