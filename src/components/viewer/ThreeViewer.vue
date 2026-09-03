<script setup>
/**
 * The part viewer.
 *
 * Structured after the STL viewer on The 3D Printing Network rather than written afresh:
 * that one already serves the public across every browser and GPU that visits the site,
 * which is a far better guarantee than anything reasoned out here.
 *
 * The important thing carried over is that it renders on demand. There is no animation
 * loop. A frame is drawn when something changes: the model, the lighting, the size of the
 * panel, or the camera, the last through the controls' own change event. A static part has
 * no reason to keep a GPU busy sixty times a second.
 *
 * Damping is off for the same reason. Damping keeps moving the camera after the pointer
 * stops, which only works if something drives frames continuously, so the two choices go
 * together and cannot be mixed.
 *
 * Also carried over: three.js is imported on first use, and STL parsing does not go
 * through STLLoader. See src/utils/stl.js for why that matters.
 *
 * What is new is the edge overlay, drawn from the buffer `--edges` writes: little endian
 * float32 xyz pairs, 24 bytes per segment, which is already the layout of a
 * BufferAttribute. That overlay is the reason this viewer earns its place, because shaded
 * triangles cannot tell you whether TrueForm recovered a real cylinder or merely
 * re-triangulated the mesh.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { createLightRig, DEFAULT_LIGHTING } from './lighting'
import { parseStlMesh } from '@/utils/stl'

const props = defineProps({
  /** Binary or ASCII STL. */
  geometry: { type: ArrayBuffer, default: null },
  /** Format A edge buffer: float32 xyz pairs. */
  edges: { type: ArrayBuffer, default: null },
  showEdges: { type: Boolean, default: true },
  showSurface: { type: Boolean, default: true },
  wireframe: { type: Boolean, default: false },
  lighting: { type: String, default: DEFAULT_LIGHTING }
})

const emit = defineEmits(['stats'])

const host = ref(null)
const ready = ref(false)
const failure = ref(null)

// Plain variables, not refs. Vue must never make a three.js object reactive: proxying a
// BufferGeometry is both ruinously slow and enough to break the renderer outright.
let three = null
let renderer = null
let scene = null
let camera = null
let controls = null
let modelMesh = null
let edgeLines = null
let lightRig = null
let envRT = null
let resizeObserver = null

/** The only place a frame is drawn. Everything that changes anything calls this. */
function render() {
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function applyLighting() {
  if (!renderer || !scene) return
  const { THREE, RoomEnvironment } = three

  if (lightRig) {
    scene.remove(lightRig.group)
    lightRig.dispose()
    lightRig = null
  }

  const rig = createLightRig(THREE, props.lighting)
  scene.add(rig.group)
  lightRig = rig

  renderer.toneMapping = rig.toneMapping
  renderer.toneMappingExposure = rig.exposure

  if (rig.usesEnvironment) {
    // Built once and cached for the life of the viewer. RoomEnvironment is a procedural
    // box of emissive panels, so no file is fetched, and PMREM pre-filters it into the
    // roughness aware cubemap that MeshStandardMaterial samples.
    if (!envRT) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
      pmrem.dispose() // the generator, not the render target
    }
    scene.environment = envRT.texture
    scene.environmentIntensity = rig.environmentIntensity
  } else {
    // Cleared rather than ignored: a leftover environment would keep lighting the presets
    // that were tuned without one, and they come out far too bright.
    scene.environment = null
  }
}

async function ensureViewer() {
  if (!three) {
    const [THREE, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
      import('three'),
      import('three/examples/jsm/controls/OrbitControls.js'),
      import('three/examples/jsm/environments/RoomEnvironment.js')
    ])
    three = { THREE, OrbitControls, RoomEnvironment }
  }

  if (renderer) return true

  const el = host.value
  if (!el) return false
  const { THREE, OrbitControls } = three

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000)

  // Z up, like the machine, and set BEFORE OrbitControls is constructed: the controls
  // capture this vector to build their orbit axis, so setting it afterwards leaves them
  // spinning the model around Y while the camera believes it is Z. That mismatch is what
  // makes an orbit feel wrong.
  camera.up.set(0, 0, 1)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  // CSS sizes the canvas while the drawing buffer is sized in device pixels, which is why
  // setSize is called with updateStyle false. Without these the canvas lays out at its
  // buffer size and overflows the panel.
  Object.assign(renderer.domElement.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    // Otherwise a trackpad drag is claimed by the browser as a page scroll gesture and
    // the controls never see it.
    touchAction: 'none'
  })

  el.appendChild(renderer.domElement)

  applyLighting()

  controls = new OrbitControls(camera, renderer.domElement)
  // Damping needs a continuous loop to settle, and there is not one. The two go together.
  controls.enableDamping = false
  controls.addEventListener('change', render)

  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(el)

  return true
}

function disposeObject(obj) {
  if (!obj) return
  obj.geometry?.dispose()
  if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
  else obj.material?.dispose()
}

async function loadGeometry() {
  if (!(await ensureViewer())) return
  if (!props.geometry) return
  const { THREE } = three

  failure.value = null

  try {
    const parsed = parseStlMesh(props.geometry)

    if (modelMesh) {
      scene.remove(modelMesh)
      disposeObject(modelMesh)
      modelMesh = null
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(parsed.positions.slice(), 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()

    modelMesh = new THREE.Mesh(
      geometry,
      // Standard rather than Phong so the material actually samples scene.environment.
      new THREE.MeshStandardMaterial({
        color: 0xc8ccd2,
        metalness: 0.2,
        roughness: 0.45,
        wireframe: props.wireframe
      })
    )
    modelMesh.visible = props.showSurface
    scene.add(modelMesh)

    frameView()
    emit('stats', { triangles: parsed.triangleCount, size: parsed.size })
    ready.value = true
    render()
  } catch (err) {
    // Clear the viewport. Leaving the previous part under an error message reads as "this
    // part failed" when it is a different part that loaded fine and is now stale.
    if (modelMesh) {
      scene.remove(modelMesh)
      disposeObject(modelMesh)
      modelMesh = null
    }
    failure.value = err?.message ?? String(err)
    ready.value = false
    render()
  }
}

function loadEdges() {
  if (!renderer || !three) return
  const { THREE } = three

  if (edgeLines) {
    scene.remove(edgeLines)
    disposeObject(edgeLines)
    edgeLines = null
  }

  if (props.edges && props.edges.byteLength) {
    // Format A is float32 xyz pairs, so a valid buffer is always a whole number of 24 byte
    // segments. Anything else is not an edge buffer and must not be trusted.
    if (props.edges.byteLength % 24 !== 0) {
      failure.value = `Edge data is ${props.edges.byteLength} bytes, not a whole number of segments`
      render()
      return
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(props.edges), 3))
    edgeLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x02aefc }))
    edgeLines.renderOrder = 1
    edgeLines.visible = props.showEdges
    scene.add(edgeLines)
  }

  render()
}

/** Standard viewpoints, named the way a drawing names them. Z up, so Top is +Z. */
const VIEWPOINTS = {
  iso: [0.9, -1.15, 0.85],
  top: [0, 0, 1],
  front: [0, -1, 0],
  right: [1, 0, 0]
}

function frameView(name = 'iso') {
  if (!camera || !controls || !modelMesh) return
  const sphere = modelMesh.geometry.boundingSphere
  if (!sphere) return

  const dir = VIEWPOINTS[name] ?? VIEWPOINTS.iso
  const radius = Math.max(sphere.radius, 0.001)
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.15
  const length = Math.hypot(...dir) || 1

  camera.position.set(
    sphere.center.x + (dir[0] / length) * distance,
    sphere.center.y + (dir[1] / length) * distance,
    sphere.center.z + (dir[2] / length) * distance
  )
  camera.near = Math.max(radius / 100, 0.01)
  camera.far = radius * 100
  camera.updateProjectionMatrix()

  // No camera.lookAt: OrbitControls.update() orients the camera from its target, and
  // calling both just fights it.
  controls.target.copy(sphere.center)
  controls.update()
  render()
}

function zoomBy(factor) {
  if (!camera || !controls) return
  const offset = camera.position.clone().sub(controls.target)
  const radius = modelMesh?.geometry.boundingSphere?.radius ?? 1
  offset.setLength(Math.min(Math.max(offset.length() * factor, radius * 0.05), radius * 200))
  camera.position.copy(controls.target).add(offset)
  controls.update()
  render()
}

function resize() {
  if (!renderer || !host.value) return
  const { clientWidth: w, clientHeight: h } = host.value
  if (!w || !h) return
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  render()
}

onMounted(async () => {
  await ensureViewer()
  if (props.geometry) await loadGeometry()
  loadEdges()
  resize()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  disposeObject(modelMesh)
  disposeObject(edgeLines)
  lightRig?.dispose()
  envRT?.dispose()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = scene = camera = controls = modelMesh = edgeLines = lightRig = envRT = null
})

watch(() => props.geometry, loadGeometry)
watch(() => props.edges, loadEdges)
watch(
  () => props.lighting,
  () => {
    applyLighting()
    render()
  }
)

// Visibility and wireframe are one property each, applied directly and drawn once rather
// than polled by a loop.
watch(
  () => [props.showSurface, props.showEdges, props.wireframe],
  ([surface, edgesOn, wire]) => {
    if (modelMesh) {
      modelMesh.visible = surface
      modelMesh.material.wireframe = wire
    }
    if (edgeLines) edgeLines.visible = edgesOn
    render()
  }
)

defineExpose({ frameCamera: () => frameView('iso'), setView: frameView, zoomBy })
</script>

<template>
  <div class="relative h-full w-full overflow-hidden">
    <div ref="host" class="h-full w-full overflow-hidden" />

    <div
      v-if="!ready"
      class="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center"
    >
      <p v-if="failure" class="max-w-sm text-xs text-state-fail">{{ failure }}</p>
      <p v-else class="text-xs text-white/30">Loading preview</p>
    </div>

    <div class="pointer-events-none absolute bottom-2 right-3">
      <span class="figure text-[10px] text-white/25">Z up</span>
    </div>
  </div>
</template>
