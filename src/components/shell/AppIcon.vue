<script setup>
/**
 * The icons the app uses, drawn inline.
 *
 * An icon font would be a dependency, a webfont request and a licence to think about, for
 * about a dozen glyphs. These are drawn on a 24 unit grid with square caps and no rounding,
 * to sit with the square cornered brand rather than fight it.
 */
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 }
})

const PATHS = {
  convert: 'M3 7h11M3 7l3-3M3 7l3 3M21 17H10M21 17l-3-3M21 17l-3 3',
  viewer: 'M12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  engine: 'M4 6h16M4 12h16M4 18h10M17 15v6M14 18h6',
  settings: 'M4 8h16M4 16h16M9 5v6M15 13v6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  folder: 'M3 6h6l2 2h10v12H3z',
  play: 'M7 4l12 8-12 8z',
  stop: 'M6 6h12v12H6z',
  close: 'M5 5l14 14M19 5L5 19',
  check: 'M4 12l5 5L20 6',
  warn: 'M12 3 2 20h20zM12 10v5M12 17.5v.5',
  fail: 'M12 3 2 20h20zM12 9v5M12 17.5v.5',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16',
  refresh: 'M20 5v6h-6M4 19v-6h6M19 13a7 7 0 0 1-12 4M5 11a7 7 0 0 1 12-4',
  chevron: 'M9 5l7 7-7 7',
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3M13 15h4',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'
}

const path = (name) => PATHS[name] ?? PATHS.file
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="square"
    stroke-linejoin="miter"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <path :d="path(name)" />
  </svg>
</template>
