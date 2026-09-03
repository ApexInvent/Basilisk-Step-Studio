<script setup>
/**
 * Where the engine is, and how to replace it.
 *
 * Upstream publishes a macOS app and no Windows binary, so on Windows "you do not have an
 * engine yet" is the normal first run. This screen has to explain that without making the
 * user feel they have installed something broken.
 *
 * It is also where the two update tracks meet. The engine and the app are separate downloads
 * on separate schedules, and this is the only screen where that difference is visible.
 */
import { onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/shell/AppIcon.vue'
import { useEngineStore } from '@/stores/engine'
import { useUpdatesStore } from '@/stores/updates'
import { useJobsStore } from '@/stores/jobs'
import { formatBytes } from '@/engine/updates'

const engine = useEngineStore()
const updates = useUpdatesStore()
const jobs = useJobsStore()
const { info, checking, error, ready, simulated } = storeToRefs(engine)
const {
  engineChecking,
  engineBusy,
  engineError,
  engineChecked,
  engineUnsupported,
  engineLatest,
  engineAvailable,
  engineProgressLabel,
  engineFraction,
  appChecking,
  appBusy,
  appError,
  appChecked,
  appAvailable,
  appProgressLabel
} = storeToRefs(updates)

const APP_VERSION = __APP_VERSION__

const SEARCH_ORDER = [
  {
    key: 'managed',
    label: 'Installed here',
    path: '%LOCALAPPDATA%\\BasiliskStepStudio\\engine\\stl2step.exe'
  },
  { key: 'bundled', label: 'Bundled with the app', path: 'resources\\engine\\stl2step.exe' },
  { key: 'path', label: 'On PATH', path: 'stl2step.exe' }
]

const SOURCE_LABEL = {
  managed: 'Installed here',
  bundled: 'Bundled with the app',
  path: 'On PATH',
  mock: 'Simulated'
}

const sourceLabel = computed(() => SOURCE_LABEL[info.value?.source] ?? info.value?.source)

/** Only the managed copy can be removed. The bundled one belongs to the installer. */
const canRemove = computed(() => info.value?.source === 'managed')

/**
 * Replacing the engine directory while the engine is running fails at the filesystem, which
 * is the right outcome but a poor way to find out. Held back while the queue is working.
 */
const converting = computed(() => jobs.running)

/** What the feed offers, whether or not it is newer than what is installed. */
const latest = computed(() => engineAvailable.value ?? engineLatest.value)

async function checkEngine() {
  await updates.checkEngine(info.value?.version)
}

async function install(manifest) {
  if (await updates.installEngine(manifest)) await engine.detect()
}

async function revert() {
  if (await updates.removeEngine()) await engine.detect()
}

// Checked on arrival rather than on launch. This is the screen the answer belongs on, and a
// network call on every start to report that nothing has changed is not worth making.
onMounted(() => {
  checkEngine()
  updates.checkApp()
})
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-6">
    <header class="mb-6">
      <h1 class="display text-2xl">Engine</h1>
      <p class="mt-0.5 text-xs text-white/45">
        Basilisk Step Studio is the interface. stl2step does the conversion.
      </p>
    </header>

    <div class="panel mb-4">
      <div class="panel-header">
        <h2 class="display text-sm tracking-wide">Status</h2>
        <button type="button" class="btn-quiet" :disabled="checking" @click="engine.detect()">
          <AppIcon name="refresh" :size="14" :class="{ 'animate-spin': checking }" />
          Check again
        </button>
      </div>

      <div class="p-4">
        <div class="flex items-start gap-3">
          <AppIcon
            :name="ready ? 'check' : 'warn'"
            :size="20"
            :class="ready ? 'text-state-ok' : 'text-state-warn'"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white/90">
              {{ checking ? 'Looking for the engine' : ready ? 'Engine found' : 'No engine installed' }}
            </p>

            <dl v-if="info?.found" class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5">
              <div v-for="f in [
                  { k: 'Version', v: info.version },
                  { k: 'OCCT', v: info.occt },
                  { k: 'Source', v: sourceLabel }
                ].filter((f) => f.v)" :key="f.k">
                <dt class="text-[11px] text-white/40">{{ f.k }}</dt>
                <dd class="figure text-sm text-white/85">{{ f.v }}</dd>
              </div>
              <div v-if="info.path" class="col-span-2">
                <dt class="text-[11px] text-white/40">Path</dt>
                <dd class="truncate font-mono text-xs text-white/70">{{ info.path }}</dd>
              </div>
            </dl>

            <p v-if="error" class="mt-2 font-mono text-xs text-state-fail">{{ error }}</p>
          </div>
        </div>

        <div v-if="simulated" class="mt-4 border-l-2 border-state-warn bg-state-warn/5 px-3 py-2">
          <div class="eyebrow mb-1 text-state-warn">Simulated</div>
          <p class="text-xs leading-relaxed text-white/70">
            {{ info.note }} Every screen works and the numbers are plausible, but nothing is
            written to disk. This is how the interface is developed before the real engine
            is wired in.
          </p>
        </div>
      </div>
    </div>

    <div class="panel mb-4">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Engine location</h2></div>
      <div class="p-4">
        <p class="mb-3 text-xs leading-relaxed text-white/50">
          The first match wins, so a copy you install yourself takes precedence over one on PATH.
        </p>
        <ol class="space-y-2">
          <li
            v-for="(s, i) in SEARCH_ORDER"
            :key="s.path"
            class="flex items-baseline gap-3"
            :class="{ 'opacity-40': info?.found && info.source !== s.key }"
          >
            <span class="figure text-[11px] text-white/30">{{ i + 1 }}</span>
            <span class="min-w-0">
              <span class="block text-xs text-white/75">
                {{ s.label }}
                <span v-if="info?.source === s.key" class="ml-1.5 text-[10px] text-accent">in use</span>
              </span>
              <span class="block truncate font-mono text-[11px] text-white/40">{{ s.path }}</span>
            </span>
          </li>
        </ol>
      </div>
    </div>

    <div class="panel mb-4">
      <div class="panel-header">
        <h2 class="display text-sm tracking-wide">Engine updates</h2>
        <button
          type="button"
          class="btn-quiet"
          :disabled="engineChecking || engineBusy"
          @click="checkEngine"
        >
          <AppIcon name="refresh" :size="14" :class="{ 'animate-spin': engineChecking }" />
          Check for updates
        </button>
      </div>

      <div class="p-4">
        <p class="mb-4 text-xs leading-relaxed text-white/50">
          The engine has its own version, separate from the app. Installing one here puts it in
          the first location above, where it takes over from the copy that came with the
          installer without replacing it.
        </p>

        <div v-if="engineBusy" class="mb-3">
          <div class="h-1 w-full bg-white/10">
            <div
              class="h-full bg-accent transition-[width] duration-200"
              :style="{ width: engineFraction === null ? '100%' : engineFraction * 100 + '%' }"
            />
          </div>
          <p class="mt-1.5 font-mono text-[11px] text-white/50">
            {{ engineProgressLabel ?? 'Working' }}
          </p>
        </div>

        <div v-else-if="engineUnsupported" class="border-l-2 border-white/15 px-3 py-2">
          <p class="text-xs leading-relaxed text-white/50">{{ engineUnsupported }}</p>
        </div>

        <template v-else>
          <div
            v-if="engineAvailable"
            class="mb-3 border-l-2 border-accent bg-accent/5 px-3 py-2"
          >
            <div class="eyebrow mb-1 text-accent">Available</div>
            <p class="text-xs text-white/80">
              stl2step {{ engineAvailable.version }}
              <span v-if="engineAvailable.occt" class="text-white/45">
                against OpenCASCADE {{ engineAvailable.occt }}
              </span>
            </p>
            <p v-if="engineAvailable.size" class="mt-0.5 font-mono text-[11px] text-white/40">
              {{ formatBytes(engineAvailable.size) }}
            </p>
          </div>

          <p v-else-if="engineChecked && !engineError" class="mb-3 text-xs text-white/40">
            <template v-if="latest">
              stl2step {{ latest.version }} is the current build, and it is the one in use.
            </template>
            <template v-else>Nothing published yet.</template>
          </p>

          <p v-if="engineError" class="mb-3 text-xs leading-relaxed text-state-warn">
            {{ engineError }}
          </p>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="latest"
              type="button"
              class="btn-primary"
              :disabled="engineBusy || converting"
              @click="install(latest)"
            >
              <AppIcon name="download" :size="15" />
              {{ engineAvailable ? 'Install update' : ready ? 'Reinstall' : 'Install engine' }}
            </button>
            <button
              v-if="canRemove"
              type="button"
              class="btn-ghost"
              :disabled="engineBusy || converting"
              @click="revert"
            >
              Remove installed copy
            </button>
          </div>

          <p v-if="converting" class="mt-2 text-[11px] text-white/40">
            The queue is running. The engine cannot be replaced while it is in use.
          </p>
        </template>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="display text-sm tracking-wide">Application</h2>
        <button
          type="button"
          class="btn-quiet"
          :disabled="appChecking || appBusy"
          @click="updates.checkApp()"
        >
          <AppIcon name="refresh" :size="14" :class="{ 'animate-spin': appChecking }" />
          Check for updates
        </button>
      </div>

      <div class="p-4">
        <p class="mb-3 text-xs text-white/50">
          Basilisk Step Studio <span class="figure text-white/80">{{ APP_VERSION }}</span>
        </p>

        <div v-if="appBusy">
          <p class="font-mono text-[11px] text-white/50">{{ appProgressLabel }}</p>
          <p class="mt-1 text-[11px] text-white/35">The app restarts once this finishes.</p>
        </div>

        <template v-else>
          <div v-if="appAvailable" class="mb-3 border-l-2 border-accent bg-accent/5 px-3 py-2">
            <div class="eyebrow mb-1 text-accent">Available</div>
            <p class="text-xs text-white/80">Version {{ appAvailable.version }}</p>
            <p v-if="appAvailable.notes" class="mt-1 text-[11px] leading-relaxed text-white/50">
              {{ appAvailable.notes }}
            </p>
          </div>

          <p v-else-if="appChecked && !appError" class="mb-3 text-xs text-white/40">
            This is the current version.
          </p>

          <p v-if="appError" class="mb-3 text-xs leading-relaxed text-state-warn">
            {{ appError }}
          </p>

          <button v-if="appAvailable" type="button" class="btn-primary" @click="updates.installApp()">
            <AppIcon name="download" :size="15" />Install and restart
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
