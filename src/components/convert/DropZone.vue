<script setup>
import { ref, computed } from 'vue'
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

function onDrop(event) {
  depth = 0
  dragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) accept(files)
}

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
