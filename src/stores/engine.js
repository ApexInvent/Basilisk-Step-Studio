/**
 * Where the engine is, and whether we have one.
 *
 * The app has to be useful without a working engine. Upstream ships no Windows binary, so
 * "not installed yet" is the state a first run lands in, and it is a normal state rather
 * than an error: the viewer, the options form and the command builder all still work, and
 * only the convert button is held back.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useEngine, isDesktop } from '@/engine'

export const useEngineStore = defineStore('engine', () => {
  const info = ref(null)
  const checking = ref(false)
  const error = ref(null)
  const unauthorized = ref(false)

  const ready = computed(() => Boolean(info.value?.found))
  const simulated = computed(() => info.value?.source === 'mock')

  /** What the status bar shows, in one word. */
  const state = computed(() => {
    if (checking.value) return 'checking'
    if (unauthorized.value) return 'unauthorized'
    if (error.value) return 'error'
    if (!info.value) return 'unknown'
    return info.value.found ? 'ready' : 'missing'
  })

  const label = computed(() => {
    if (checking.value) return 'Checking engine'
    if (unauthorized.value) return 'Token out of date'
    if (error.value) return 'Engine check failed'
    if (!info.value) return 'Engine not checked'
    if (!info.value.found) return 'Engine not installed'
    const version = info.value.version ? ` ${info.value.version}` : ''
    const occt = info.value.occt ? ` (OCCT ${info.value.occt})` : ''
    return `stl2step${version}${occt}`
  })

  async function detect() {
    checking.value = true
    error.value = null
    unauthorized.value = false
    try {
      info.value = await useEngine().detect()
    } catch (err) {
      error.value = err?.message ?? String(err)
      unauthorized.value = Boolean(err?.unauthorized)
      info.value = { found: false }
    } finally {
      checking.value = false
    }
  }

  return {
    info,
    checking,
    error,
    unauthorized,
    ready,
    simulated,
    state,
    label,
    detect,
    isDesktop
  }
})
