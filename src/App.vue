<script setup>
import { onMounted } from 'vue'
import AppSidebar from '@/components/shell/AppSidebar.vue'
import StatusBar from '@/components/shell/StatusBar.vue'
import { useEngineStore } from '@/stores/engine'

const engine = useEngineStore()

// Look for the engine once on launch. Every screen keys off the answer, and asking later
// would mean each of them handling an unknown state of its own.
onMounted(() => engine.detect())
</script>

<template>
  <div class="flex h-full flex-col bg-ink">
    <div class="flex min-h-0 flex-1">
      <AppSidebar />
      <main class="min-w-0 flex-1 overflow-y-auto">
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>
    </div>
    <StatusBar />
  </div>
</template>
