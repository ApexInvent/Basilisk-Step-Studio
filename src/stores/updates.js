/**
 * Keeping the app and the engine current, separately.
 *
 * State is per track rather than one shared "updating" flag. The engine and the app are two
 * different downloads with two different failure modes, and a user who has just installed a
 * new engine should not be told the app failed to check for one.
 *
 * Nothing here interrupts. A failed check leaves a line of text on the Engine screen and
 * nothing else: the app either has a working engine or it does not, and neither of those
 * facts changes because GitHub was unreachable.
 */

import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useEngine, isDesktop } from '@/engine'
import { formatBytes } from '@/engine/updates'

export const useUpdatesStore = defineStore('updates', () => {
  const engineChecking = ref(false)
  const engineBusy = ref(false)
  const engineError = ref(null)
  const engineChecked = ref(false)
  const engineUnsupported = ref(null)
  const engineProgress = ref(null)

  /** The published build, whatever it is. */
  const engineLatest = ref(null)
  /** The same thing, but only when it is newer than what is installed. */
  const engineAvailable = ref(null)

  const appChecking = ref(false)
  const appBusy = ref(false)
  const appError = ref(null)
  const appChecked = ref(false)
  const appAvailable = ref(null)
  const appProgress = ref(null)

  /** Held outside the reactive state: it is a plugin object, not something to render. */
  let appUpdate = null

  function label(progress) {
    if (!progress) return null
    if (!progress.total) return `${progress.phase}: ${formatBytes(progress.received)}`
    const pct = Math.round((progress.received / progress.total) * 100)
    return `${progress.phase}: ${formatBytes(progress.received)} of ${formatBytes(progress.total)} (${pct}%)`
  }

  const engineProgressLabel = computed(() => label(engineProgress.value))
  const appProgressLabel = computed(() => label(appProgress.value))

  const engineFraction = computed(() => {
    const p = engineProgress.value
    if (!p?.total) return null
    return Math.min(1, p.received / p.total)
  })

  async function checkEngine(currentVersion) {
    engineChecking.value = true
    engineError.value = null
    engineUnsupported.value = null
    try {
      const result = await useEngine().checkEngineUpdate?.(currentVersion)

      if (!result) {
        engineUnsupported.value = 'Engine updates are not available here.'
      } else if (result.supported === false) {
        engineUnsupported.value = result.reason
      } else if (result.error) {
        engineError.value = result.error
      } else {
        engineLatest.value = result.manifest
        engineAvailable.value = result.available ? result.manifest : null
      }
      engineChecked.value = true
    } catch (err) {
      engineError.value = err?.message ?? String(err)
    } finally {
      engineChecking.value = false
    }
  }

  /**
   * Install a published engine build.
   *
   * Takes the manifest rather than reading it back, so what gets installed is exactly the
   * build the user was shown a version number for.
   */
  async function installEngine(manifest) {
    engineBusy.value = true
    engineError.value = null
    engineProgress.value = { phase: 'Starting', received: 0, total: manifest?.size ?? null }
    try {
      await useEngine().installEngine(manifest, (event) => {
        engineProgress.value = event
      })
      engineAvailable.value = null
      return true
    } catch (err) {
      engineError.value = err?.message ?? String(err)
      return false
    } finally {
      engineBusy.value = false
      engineProgress.value = null
    }
  }

  async function removeEngine() {
    engineBusy.value = true
    engineError.value = null
    try {
      await useEngine().removeEngine()
      return true
    } catch (err) {
      engineError.value = err?.message ?? String(err)
      return false
    } finally {
      engineBusy.value = false
    }
  }

  /**
   * Ask whether a newer build of the app itself is published.
   *
   * Imported on demand: the browser build has no updater behind it, and there is no reason
   * for the plugin to sit in the initial chunk of either build.
   */
  async function checkApp() {
    if (!isDesktop()) {
      appChecked.value = true
      return
    }
    appChecking.value = true
    appError.value = null
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      appUpdate = await check()
      appAvailable.value = appUpdate
        ? { version: appUpdate.version, notes: appUpdate.body || null }
        : null
      appChecked.value = true
    } catch (err) {
      const message = err?.message ?? String(err)
      // Until a release is published the feed is a 404, and so it is while the repository is
      // private. That is not a fault worth showing someone a stack trace for.
      appError.value = /404|not found/i.test(message) ? 'No update feed published yet.' : message
    } finally {
      appChecking.value = false
    }
  }

  /**
   * Download, install and restart.
   *
   * The restart is not optional tidiness. The installer replaces files the running app is
   * using, so it has to be the last thing that happens.
   */
  async function installApp() {
    if (!appUpdate) return false

    appBusy.value = true
    appError.value = null
    appProgress.value = { phase: 'Downloading', received: 0, total: null }
    try {
      let received = 0
      let total = null
      await appUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data?.contentLength ?? null
        else if (event.event === 'Progress') received += event.data?.chunkLength ?? 0
        appProgress.value = { phase: 'Downloading', received, total }
      })
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
      return true
    } catch (err) {
      appError.value = err?.message ?? String(err)
      return false
    } finally {
      appBusy.value = false
      appProgress.value = null
    }
  }

  return {
    engineChecking,
    engineBusy,
    engineError,
    engineChecked,
    engineUnsupported,
    engineProgress,
    engineLatest,
    engineAvailable,
    engineProgressLabel,
    engineFraction,
    appChecking,
    appBusy,
    appError,
    appChecked,
    appAvailable,
    appProgress,
    appProgressLabel,
    checkEngine,
    installEngine,
    removeEngine,
    checkApp,
    installApp
  }
})
