/**
 * Lighting rigs for the part viewer.
 *
 * A preset is more than a set of lights. The three differ on tone mapping and on whether
 * an environment map is present, and those have to move together: Studio's lights sit low
 * because the environment carries most of the ambient, and handing those same intensities
 * to Flat leaves the part nearly black. So each preset owns its whole look and the caller
 * applies it wholesale rather than mixing pieces from two of them.
 *
 * THREE is passed in rather than imported, so this file stays out of the main chunk. The
 * viewer already imports three.js dynamically and there is no reason to pull it forward.
 *
 * `usesEnvironment` is a request, not a texture: building the cubemap needs the renderer,
 * which belongs to the caller, so presets declare that they want one and the caller builds
 * and caches it once.
 */

export const LIGHTING_PRESETS = [
  { id: 'studio', label: 'Studio', hint: 'Soft environment light. Best for reading form.' },
  { id: 'direct', label: 'Direct', hint: 'Hard key light. Best for spotting facets.' },
  { id: 'flat', label: 'Flat', hint: 'Even light, no shading. Best for outlines.' }
]

export const DEFAULT_LIGHTING = 'studio'

function directional(THREE, group, intensity, x, y, z, color = 0xffffff) {
  const light = new THREE.DirectionalLight(color, intensity)
  light.position.set(x, y, z)
  group.add(light)
}

export function createLightRig(THREE, id) {
  const group = new THREE.Group()
  group.name = `lighting:${id}`

  // Three's lights hold no GPU resources, so disposing is just detaching them.
  const dispose = () => group.clear()

  if (id === 'flat') {
    // Ambient adds the same value to every face regardless of orientation, which is
    // exactly what hides curvature. That is the point: it is the honest way to read a
    // silhouette, and it is forgiving of a mesh with bad normals.
    group.add(new THREE.AmbientLight(0xffffff, 0.62))
    directional(THREE, group, 1.05, 1, 2, 3)
    directional(THREE, group, 0.32, -1, -1, 1)
    return {
      group,
      dispose,
      usesEnvironment: false,
      environmentIntensity: 0,
      toneMapping: THREE.NoToneMapping,
      exposure: 1
    }
  }

  if (id === 'direct') {
    // A hemisphere light instead of flat ambient: sky above, darker ground below, so an
    // upward face and a downward face already differ before the key light contributes.
    // Its position is the sky direction, and this scene is Z up, so it must be +Z or the
    // gradient runs across the part instead of down it.
    const hemi = new THREE.HemisphereLight(0xdfe7ff, 0x24242a, 0.5)
    hemi.position.set(0, 0, 1)
    group.add(hemi)
    directional(THREE, group, 1.0, 1, 2, 3)
    directional(THREE, group, 0.18, -1, -1, 1)
    // Rim light opposite the camera, to separate the part from a dark backdrop rather
    // than letting the silhouette dissolve into it.
    directional(THREE, group, 0.45, -2, -1.5, 0.5, 0x37c2ff)
    return {
      group,
      dispose,
      usesEnvironment: false,
      environmentIntensity: 0,
      toneMapping: THREE.ACESFilmicToneMapping,
      exposure: 1.05
    }
  }

  // Studio. The environment does the heavy lifting, so the lights only shape it.
  directional(THREE, group, 0.55, 1, 2, 3)
  directional(THREE, group, 0.15, -1.5, -1, 0.5)
  return {
    group,
    dispose,
    usesEnvironment: true,
    environmentIntensity: 0.85,
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.1
  }
}
