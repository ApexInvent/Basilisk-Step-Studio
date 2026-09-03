/**
 * The conversion settings, plus the presets that save you dialling them in again.
 *
 * Settings persist to localStorage. A desktop app that forgets how you had it set up
 * every time you open it is an app you stop trusting with a long batch.
 */

import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { defaultOptions, changedKeys, OPTION_SPEC } from '@/engine/options'
import { buildConvertArgs, formatCommand, parseCommand, describeOptions } from '@/engine/command'

const STORAGE_KEY = 'bss.options.v1'
const PRESET_KEY = 'bss.presets.v1'

/**
 * Starting points, chosen to cover the three jobs people actually arrive with.
 *
 * These are stated in terms of the flags upstream documents. Where upstream does not
 * publish a default we leave the value unset rather than guessing a number, so a preset
 * never silently changes engine behaviour it was not meant to touch.
 */
export const BUILT_IN_PRESETS = [
  {
    id: 'faithful',
    name: 'Faithful',
    builtIn: true,
    description: 'Every triangle preserved as a planar face. Fast, exact, and produces heavy files.',
    options: { ...defaultOptions() }
  },
  {
    id: 'watertight',
    name: 'Watertight solid',
    builtIn: true,
    description: 'Push hard for a closed solid: force the repair pass and verify the result.',
    options: { ...defaultOptions(), forceSew: true, verify: true, solid: true }
  },
  {
    id: 'trueform',
    name: 'TrueForm smooth',
    builtIn: true,
    description: 'Recover analytic surfaces so cylinders and fillets come back as real geometry.',
    options: { ...defaultOptions(), engine: 'trueform', smoothFillets: true }
  },
  {
    id: 'ap242',
    name: 'AP242 exchange',
    builtIn: true,
    description: 'Newest schema, for a downstream tool that wants tolerancing data.',
    options: { ...defaultOptions(), schema: 'AP242' }
  }
]

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    // A corrupt or blocked store should cost you your saved settings, not the app.
    return fallback
  }
}

export const useOptionsStore = defineStore('options', () => {
  const options = ref({ ...defaultOptions(), ...readJson(STORAGE_KEY, {}) })
  const userPresets = ref(readJson(PRESET_KEY, []))
  const activePresetId = ref(null)

  const presets = computed(() => [...BUILT_IN_PRESETS, ...userPresets.value])
  const changed = computed(() => changedKeys(options.value))
  const summary = computed(() => describeOptions(options.value))

  /** The exact invocation, with placeholder paths so it reads as a template. */
  const previewArgs = computed(() =>
    buildConvertArgs(options.value, { input: 'part.stl', output: 'part.step' })
  )
  const previewCommand = computed(() => formatCommand(previewArgs.value))

  watch(
    options,
    (v) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(v))
      } catch {
        // Private browsing or a locked profile. Not worth interrupting the user over.
      }
    },
    { deep: true }
  )

  watch(
    userPresets,
    (v) => {
      try {
        localStorage.setItem(PRESET_KEY, JSON.stringify(v))
      } catch {
        // As above.
      }
    },
    { deep: true }
  )

  function set(key, value) {
    options.value[key] = value
    // Once you hand edit a value you are no longer on the preset, and saying so stops
    // the header claiming settings you are not actually using.
    activePresetId.value = null
  }

  function reset() {
    options.value = defaultOptions()
    activePresetId.value = null
  }

  function applyPreset(id) {
    const preset = presets.value.find((p) => p.id === id)
    if (!preset) return false
    options.value = { ...defaultOptions(), ...preset.options }
    activePresetId.value = id
    return true
  }

  function savePreset(name, description = '') {
    const id = `user-${Date.now().toString(36)}`
    userPresets.value.push({
      id,
      name,
      description,
      builtIn: false,
      options: { ...options.value }
    })
    activePresetId.value = id
    return id
  }

  function deletePreset(id) {
    userPresets.value = userPresets.value.filter((p) => p.id !== id)
    if (activePresetId.value === id) activePresetId.value = null
  }

  /**
   * Load a pasted command into the form.
   *
   * Returns the parse report rather than throwing, so the UI can apply the twenty flags
   * it understood and still tell you about the one it did not.
   */
  function applyCommand(text) {
    const parsed = parseCommand(text)
    options.value = { ...parsed.options }
    activePresetId.value = null
    return parsed
  }

  /** Only the keys that differ from default, for sharing a preset without the noise. */
  function exportOptions() {
    const out = {}
    for (const spec of OPTION_SPEC) {
      if (options.value[spec.key] !== spec.default) out[spec.key] = options.value[spec.key]
    }
    return out
  }

  return {
    options,
    presets,
    userPresets,
    activePresetId,
    changed,
    summary,
    previewArgs,
    previewCommand,
    set,
    reset,
    applyPreset,
    savePreset,
    deletePreset,
    applyCommand,
    exportOptions
  }
})
