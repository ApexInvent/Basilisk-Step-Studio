<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import AppIcon from '@/components/shell/AppIcon.vue'
import { useJobsStore } from '@/stores/jobs'
import { useEngine, isDesktop } from '@/engine'

const props = defineProps({
  compact: { type: Boolean, default: false }
})

const jobs = useJobsStore()
const dragging = ref(false)
const message = ref(null)
const inputEl = ref(null)

// Counts nested enter and leave events. Dragging over a child element fires leave on the
// parent, so a plain boolean flickers the highlight off while the pointer is still inside.
let depth = 0

const hint = computed(() =>
  isDesktop() ? 'Drop STL files here, or click to browse' : 'Drop STL files here'
)

function accept(items) {
  const added = jobs.addFiles(items)
  const rejected = items.length - added.length

  if (!added.length) {
    message.value = rejected
      ? 'Nothing added. STL files only, and duplicates are skipped.'
      : 'Nothing added.'
  } else {
    message.value =
      `Queued ${added.length} ${added.length === 1 ? 'file' : 'files'}` +
      (rejected ? `, skipped ${rejected}` : '')
  }

  setTimeout(() => (message.value = null), 4000)
}

/**
 * A drop in the browser, where the file arrives in memory.
 *
 * The desktop app never reaches this. Tauri intercepts file drops at the window before the
 * page sees them, so the handler below is what serves the installed app.
 */
function onDrop(event) {
  depth = 0
  dragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) accept(files)
}

/**
 * A drop in the desktop app.
 *
 * Tauri reports these itself, with real paths attached, which is the reason the installed
 * app can convert a dropped file where it lies instead of copying it anywhere first. Without
 * this listener the drop zone is decorative in the app: the invitation to drop a file is
 * right there on the main screen and nothing happens.
 *
 * The event covers the whole window rather than this element. For a converter whose main
 * screen is one big drop target, accepting a file dropped anywhere is the kinder behaviour,
 * and it avoids comparing Tauri's physical cursor position against CSS pixel bounds, which
 * disagree the moment display scaling is not 100 per cent.
 */
let stopListening = null

onMounted(async () => {
  if (!isDesktop()) return
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  stopListening = await getCurrentWebview().onDragDropEvent(({ payload }) => {
    // enter and over both mean a file is being held over the window. Treating enter as
    // anything else flickers the highlight off the moment the pointer arrives.
    if (payload.type === 'enter' || payload.type === 'over') {
      dragging.value = true
      return
    }
    dragging.value = false
    if (payload.type === 'drop' && payload.paths?.length) accept(payload.paths)
  })
})

onUnmounted(() => stopListening?.())

function onDragEnter() {
  depth++
  dragging.value = true
}

function onDragLeave() {
  depth = Math.max(0, depth - 1)
  if (depth === 0) dragging.value = false
}

async function browse() {
  if (!isDesktop()) {
    inputEl.value?.click()
    return
  }
  try {
    const paths = await useEngine().pickInputFiles()
    if (paths?.length) accept(paths)
  } catch (err) {
    message.value = err?.message ?? String(err)
  }
}

function onPick(event) {
  const files = Array.from(event.target.files ?? [])
  if (files.length) accept(files)
  event.target.value = ''
}
</script>

<template>
  <div
    class="well flex flex-col items-center justify-center border-dashed text-center transition-colors"
    :class="[
      compact ? 'gap-1 px-4 py-5' : 'gap-2 px-6 py-12',
      dragging ? 'border-accent bg-accent/5' : 'border-white/20 hover:border-white/35'
    ]"
    role="button"
    tabindex="0"
    @click="browse"
    @keydown.enter.prevent="browse"
    @keydown.space.prevent="browse"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <AppIcon
      name="download"
      :size="compact ? 20 : 30"
      :class="dragging ? 'text-accent' : 'text-white/35'"
    />

    <p :class="compact ? 'text-xs text-white/60' : 'text-sm text-white/70'">
      {{ dragging ? 'Release to queue' : hint }}
    </p>

    <p v-if="!compact" class="text-xs text-white/35">
      Batch is fine. Files are queued, not converted, until you press Convert.
    </p>

    <p v-if="message" class="figure text-xs text-accent">{{ message }}</p>

    <input
      ref="inputEl"
      type="file"
      accept=".stl"
      multiple
      class="hidden"
      @change="onPick"
      @click.stop
    />
  </div>
</template>
