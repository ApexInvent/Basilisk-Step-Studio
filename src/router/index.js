import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * Hash history, because this is loaded from the filesystem inside a desktop window rather
 * than served by something that can rewrite paths.
 *
 * Every view except Convert is lazy. The viewer in particular drags three.js behind it and
 * there is no reason for that to be in the first paint.
 */
const routes = [
  {
    path: '/',
    name: 'convert',
    component: () => import('@/views/ConvertView.vue'),
    meta: { title: 'Convert', icon: 'convert' }
  },
  {
    path: '/engine',
    name: 'engine',
    component: () => import('@/views/EngineView.vue'),
    meta: { title: 'Engine', icon: 'engine' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/SettingsView.vue'),
    meta: { title: 'Settings', icon: 'settings' }
  },
  {
    path: '/about',
    name: 'about',
    component: () => import('@/views/AboutView.vue'),
    meta: { title: 'About', icon: 'about' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

export default createRouter({
  history: createWebHashHistory(),
  routes
})
