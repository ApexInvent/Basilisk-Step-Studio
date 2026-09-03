<script setup>
/**
 * What this is, what it is built on, and under what terms.
 *
 * The licence texts are imported as raw strings rather than read from the bundled resource
 * files at runtime. Same text either way, but this works identically in the browser and the
 * desktop build, and it cannot fail on a path that does not resolve. A licence notice that
 * only appears when a file read succeeds is not much of a notice.
 */
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/shell/AppIcon.vue'
import { useEngineStore } from '@/stores/engine'
import { openExternal } from '@/utils/links'
import licenceText from '../../LICENSE?raw'
import noticesText from '../../THIRD-PARTY-NOTICES.md?raw'

const engine = useEngineStore()
const { info } = storeToRefs(engine)

const APP_VERSION = __APP_VERSION__
const REPO = 'https://github.com/ApexInvent/Basilisk-Step-Studio'

const showing = ref(null)

function toggle(which) {
  showing.value = showing.value === which ? null : which
}

const CREDITS = [
  {
    name: 'stl2step',
    by: 'BlinkingSun',
    licence: 'MIT',
    url: 'https://github.com/BlinkingSun/stl2step',
    note: 'Performs every conversion. This app builds its command line and reads its results.'
  },
  {
    name: 'Open CASCADE Technology',
    by: 'Open CASCADE SAS',
    licence: 'LGPL 2.1, with the Open CASCADE exception',
    url: 'https://dev.opencascade.org/',
    note: 'The geometry kernel the engine is built on. Redistributed unmodified with this app.'
  },
  {
    name: 'three.js',
    by: 'mrdoob and contributors',
    licence: 'MIT',
    url: 'https://threejs.org/',
    note: 'Draws the viewer.'
  }
]
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-6">
    <header class="mb-6">
      <h1 class="display text-2xl">About</h1>
      <p class="mt-0.5 text-xs text-white/45">
        What this is built on, and the terms it comes under.
      </p>
    </header>

    <div class="panel mb-4">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Basilisk Step Studio</h2></div>
      <div class="p-4">
        <p class="mb-4 text-xs leading-relaxed text-white/60">
          A Windows interface for converting STL meshes into STEP B-Rep solids. The conversion
          itself is stl2step's work. This provides the queue, the viewer, the options and the
          command line around it.
        </p>

        <dl class="grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <dt class="text-[11px] text-white/40">Version</dt>
            <dd class="figure text-sm text-white/85">{{ APP_VERSION }}</dd>
          </div>
          <div>
            <dt class="text-[11px] text-white/40">Engine</dt>
            <dd class="figure text-sm text-white/85">
              {{ info?.version ? `stl2step ${info.version}` : 'not installed' }}
            </dd>
          </div>
          <div v-if="info?.occt">
            <dt class="text-[11px] text-white/40">OpenCASCADE</dt>
            <dd class="figure text-sm text-white/85">{{ info.occt }}</dd>
          </div>
          <div>
            <dt class="text-[11px] text-white/40">By</dt>
            <dd class="text-sm text-white/85">Apex Invent</dd>
          </div>
        </dl>

        <button type="button" class="btn-ghost mt-4" @click="openExternal(REPO)">
          <AppIcon name="link" :size="14" />Source on GitHub
        </button>
      </div>
    </div>

    <div class="panel mb-4">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Built on</h2></div>
      <div class="divide-y divide-white/5">
        <div v-for="c in CREDITS" :key="c.name" class="p-4">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-sm text-white/85">{{ c.name }}</span>
            <button
              type="button"
              class="btn-quiet shrink-0 text-[11px]"
              @click="openExternal(c.url)"
            >
              <AppIcon name="link" :size="12" />
            </button>
          </div>
          <p class="mt-0.5 text-[11px] text-white/40">
            {{ c.by }}
            <span class="mx-1.5 text-white/20">|</span>
            {{ c.licence }}
          </p>
          <p class="mt-1.5 text-xs leading-relaxed text-white/55">{{ c.note }}</p>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header"><h2 class="display text-sm tracking-wide">Licence</h2></div>
      <div class="p-4">
        <p class="mb-3 text-xs leading-relaxed text-white/60">
          Basilisk Step Studio is free software under the GNU General Public License, version 3
          or later. You may use, study, modify and pass it on, and anything you distribute that
          is built from it must carry the same freedoms.
        </p>

        <!-- The Open CASCADE exception asks for exactly this, in supporting documentation,
             in return for permission to redistribute the kernel. It stays visible rather than
             being folded away behind the notices. -->
        <p class="mb-4 border-l-2 border-white/15 px-3 py-2 text-xs leading-relaxed text-white/50">
          This software makes use of facilities provided by Open CASCADE Technology. The
          libraries are redistributed unmodified under LGPL 2.1 with the Open CASCADE
          exception, and may be replaced with another build of the same version.
        </p>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-ghost" @click="toggle('licence')">
            {{ showing === 'licence' ? 'Hide' : 'Read' }} the licence
          </button>
          <button type="button" class="btn-ghost" @click="toggle('notices')">
            {{ showing === 'notices' ? 'Hide' : 'Third party notices' }}
          </button>
        </div>

        <pre
          v-if="showing"
          class="well mt-3 max-h-96 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-white/70"
        >{{ showing === 'licence' ? licenceText : noticesText }}</pre>

        <p class="mt-4 text-[11px] leading-relaxed text-white/30">
          The Basilisk Step Studio name, logo and icon are trademarks of Apex Invent and are not
          covered by that grant.
        </p>
      </div>
    </div>
  </div>
</template>
