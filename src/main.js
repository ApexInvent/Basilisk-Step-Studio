import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// Only the weights the design actually uses. Pulling a whole family would triple the
// bundle for faces nothing references.
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/500.css'
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './style.css'

createApp(App).use(createPinia()).use(router).mount('#app')
