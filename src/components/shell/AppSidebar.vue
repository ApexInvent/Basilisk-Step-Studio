<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import AppIcon from './AppIcon.vue'
import { useEngineStore } from '@/stores/engine'
import { useJobsStore } from '@/stores/jobs'
import logoUrl from '../../../logos/bss_logo.svg'

const route = useRoute()
const engine = useEngineStore()
const jobs = useJobsStore()

const { state: engineState, label: engineLabel } = storeToRefs(engine)
const { counts } = storeToRefs(jobs)

const NAV = [
  { to: '/', icon: 'convert', label: 'Convert', hint: 'Queue files, run them, inspect the result' },
  { to: '/engine', icon: 'engine', label: 'Engine', hint: 'Where stl2step lives' },
  { to: '/settings', icon: 'settings', label: 'Settings', hint: 'Output paths and defaults' },
  { to: '/about', icon: 'about', label: 'About', hint: 'Versions, credits and licence' }
]

const isActive = (to) => (to === '/' ? route.path === '/' : route.path.startsWith(to))

/** A queue badge, but only when there is something to say about it. */
const badge = computed(() => {
  const c = counts.value
  if (c.running) return { text: String(c.running), tone: 'accent' }
  if (c.queued) return { text: String(c.queued), tone: 'muted' }
  return null
})

const DOT = {
  ready: 'bg-state-ok',
  checking: 'bg-accent animate-pulse',
  missing: 'bg-state-warn',
  unauthorized: 'bg-state-fail',
  error: 'bg-state-fail',
  unknown: 'bg-white/25'
}
</script>

<template>
  <aside class="flex w-56 shrink-0 flex-col border-r border-white/10 bg-pit">
    <!-- The artwork is a complete lockup: the mark and the wordmark together, drawn as
         paths at roughly 5:1. So it stands on its own and must keep that ratio. Setting
         the name in text beside it would print the name twice, and constraining it to a
         square would squash it. -->
    <div class="px-4 py-5">
      <img :src="logoUrl" alt="Basilisk Step Studio" class="w-full" />
    </div>

    <nav class="flex flex-col px-2">
      <RouterLink
        v-for="item in NAV"
        :key="item.to"
        :to="item.to"
        :title="item.hint"
        class="group flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors"
        :class="
          isActive(item.to)
            ? 'border-accent bg-white/[0.04] text-white'
            : 'border-transparent text-white/55 hover:border-white/20 hover:text-white'
        "
      >
        <AppIcon
          :name="item.icon"
          :class="isActive(item.to) ? 'text-accent' : 'text-current'"
        />
        <span class="font-medium">{{ item.label }}</span>
        <span
          v-if="item.to === '/' && badge"
          class="figure ml-auto px-1.5 py-0.5 text-[11px]"
          :class="badge.tone === 'accent' ? 'bg-accent text-ink' : 'bg-white/10 text-white/70'"
        >
          {{ badge.text }}
        </span>
      </RouterLink>
    </nav>

    <div class="flex-1" />

    <!-- Engine state lives here rather than only on its own screen: whether there is an
         engine changes what every other screen can do, so it should always be visible. -->
    <RouterLink
      to="/engine"
      class="m-2 block border border-white/10 px-3 py-2.5 transition-colors hover:border-white/25"
    >
      <div class="eyebrow mb-1.5">Engine</div>
      <div class="flex items-center gap-2">
        <span class="h-2 w-2 shrink-0" :class="DOT[engineState] ?? DOT.unknown" />
        <span class="truncate font-mono text-[11px] text-white/70">{{ engineLabel }}</span>
      </div>
    </RouterLink>
  </aside>
</template>
