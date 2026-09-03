<script setup>
/**
 * The options form, generated from OPTION_SPEC.
 *
 * Nothing here knows the name of a single flag. Adding an option upstream means adding one
 * entry to the spec, and the control, its help text, its command preview and its parser
 * support all arrive together. Hand writing twenty controls would guarantee that one of
 * them eventually disagrees with the command being run.
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '@/components/shell/AppIcon.vue'
import { useOptionsStore } from '@/stores/options'
import { OPTION_GROUPS, OPTION_SPEC, isActive } from '@/engine/options'

defineProps({
  // The collapsing header is owned by the parent when the panel is folded away, so
  // rendering our own would show two of them.
  headless: { type: Boolean, default: false }
})

const store = useOptionsStore()
const { options, changed, presets, activePresetId } = storeToRefs(store)

const open = ref(new Set(['engine', 'geometry', 'output']))
const savingPreset = ref(false)
const presetName = ref('')

function toggle(id) {
  const next = new Set(open.value)
  next.has(id) ? next.delete(id) : next.add(id)
  open.value = next
}

const grouped = computed(() =>
  OPTION_GROUPS.map((group) => ({
    ...group,
    options: OPTION_SPEC.filter((o) => o.group === group.id),
    changedCount: OPTION_SPEC.filter(
      (o) => o.group === group.id && changed.value.includes(o.key)
    ).length
  }))
)

function update(spec, raw) {
  if (spec.type === 'number') {
    // An emptied number field means "unset", which is different from zero: it stops us
    // passing the flag at all and lets the engine default stand.
    store.set(spec.key, raw === '' || raw === null ? null : Number(raw))
    return
  }
  store.set(spec.key, raw)
}

function confirmSavePreset() {
  const name = presetName.value.trim()
  if (!name) return
  store.savePreset(name)
  presetName.value = ''
  savingPreset.value = false
}
</script>

<template>
  <div class="panel flex min-h-0 flex-col">
    <div v-if="!headless" class="panel-header">
      <h2 class="display text-sm tracking-wide">Options</h2>
      <div class="flex items-center gap-1">
        <span v-if="changed.length" class="figure text-[11px] text-accent">
          {{ changed.length }} changed
        </span>
        <button type="button" class="btn-quiet" title="Back to defaults" @click="store.reset()">
          Reset
        </button>
      </div>
    </div>

    <!-- Presets sit above the controls because picking one is usually the whole
         interaction. Most people want a known good starting point, not twenty dials. -->
    <div class="border-b border-white/10 px-4 py-3">
      <label class="eyebrow mb-2 block">Preset</label>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="p in presets"
          :key="p.id"
          type="button"
          class="border px-2.5 py-1 text-xs transition-colors"
          :class="
            activePresetId === p.id
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-white/15 text-white/60 hover:border-white/35 hover:text-white'
          "
          :title="p.description"
          @click="store.applyPreset(p.id)"
        >
          {{ p.name }}
          <span
            v-if="!p.builtIn"
            class="ml-1 text-white/30 hover:text-state-fail"
            title="Delete preset"
            @click.stop="store.deletePreset(p.id)"
          >x</span>
        </button>

        <button
          v-if="!savingPreset"
          type="button"
          class="border border-dashed border-white/20 px-2.5 py-1 text-xs text-white/45 hover:border-accent hover:text-accent"
          @click="savingPreset = true"
        >
          <AppIcon name="plus" :size="11" class="mr-1 inline" />Save current
        </button>
      </div>

      <div v-if="savingPreset" class="mt-2 flex gap-1.5">
        <input
          v-model="presetName"
          class="field py-1 text-xs"
          placeholder="Preset name"
          @keydown.enter="confirmSavePreset"
          @keydown.esc="savingPreset = false"
        />
        <button type="button" class="btn-primary px-3 py-1 text-xs" @click="confirmSavePreset">Save</button>
        <button type="button" class="btn-quiet" @click="savingPreset = false">Cancel</button>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <section v-for="group in grouped" :key="group.id" class="border-b border-white/[0.07] last:border-b-0">
        <button
          type="button"
          class="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
          @click="toggle(group.id)"
        >
          <AppIcon
            name="chevron"
            :size="13"
            class="text-white/30 transition-transform"
            :class="{ 'rotate-90': open.has(group.id) }"
          />
          <span class="display text-xs tracking-wide text-white/85">{{ group.label }}</span>
          <span v-if="group.changedCount" class="figure ml-auto text-[11px] text-accent">
            {{ group.changedCount }}
          </span>
        </button>

        <div v-if="open.has(group.id)" class="space-y-4 px-4 pb-4">
          <p class="text-[11px] leading-relaxed text-white/35">{{ group.help }}</p>

          <div
            v-for="spec in group.options"
            :key="spec.key"
            :class="{ 'pointer-events-none opacity-35': !isActive(spec, options) }"
          >
            <!-- Booleans read as a statement you are agreeing with, so the label goes
                 beside the control rather than above it. -->
            <label v-if="spec.type === 'bool'" class="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                class="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none border border-white/25 bg-pit checked:border-accent checked:bg-accent"
                :checked="options[spec.key]"
                @change="update(spec, $event.target.checked)"
              />
              <span class="min-w-0">
                <span class="block text-sm text-white/85">{{ spec.label }}</span>
                <span class="mt-0.5 block text-[11px] leading-relaxed text-white/40">{{ spec.help }}</span>
              </span>
            </label>

            <template v-else>
              <label class="field-label flex items-baseline justify-between gap-2">
                <span>{{ spec.label }}</span>
                <span v-if="spec.unit" class="figure text-[11px] text-white/30">{{ spec.unit }}</span>
              </label>

              <select
                v-if="spec.type === 'enum'"
                class="field"
                :value="options[spec.key] ?? ''"
                @change="update(spec, $event.target.value || null)"
              >
                <option v-if="spec.default === null" value="">Engine default</option>
                <option v-for="c in spec.choices" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>

              <input
                v-else
                type="number"
                class="field"
                :value="options[spec.key] ?? ''"
                :placeholder="spec.placeholder ?? 'Engine default'"
                :min="spec.min"
                :step="spec.step"
                @input="update(spec, $event.target.value)"
              />

              <p class="mt-1.5 text-[11px] leading-relaxed text-white/40">{{ spec.help }}</p>

              <!-- Per choice help for enums, because the difference between AP203 and
                   AP242 is exactly the thing someone needs explaining at this moment. -->
              <p
                v-if="spec.type === 'enum' && spec.choices.find((c) => c.value === options[spec.key])?.help"
                class="mt-1 border-l border-white/15 pl-2 text-[11px] leading-relaxed text-white/50"
              >
                {{ spec.choices.find((c) => c.value === options[spec.key]).help }}
              </p>
            </template>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
