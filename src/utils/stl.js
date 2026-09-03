/**
 * Reading an STL into a vertex buffer.
 *
 * Ported from the STL scaler on The 3D Printing Network, which has been serving this to
 * the public for a while. Preferred over three's STLLoader for two reasons.
 *
 * It is honest about what it was given. The binary check requires the file length to match
 * exactly what the declared triangle count implies, so a file that is not an STL is
 * rejected on the spot. STLLoader instead trusts the count at byte 80: handed a STEP file
 * it read 1.7 billion triangles from it and tried to allocate an array of fifteen billion
 * floats, which is how a wrong file type turned into an out of memory error.
 *
 * And it keeps three.js out of the parsing path entirely, so the geometry is a plain
 * Float32Array that the viewer wraps in a BufferAttribute.
 */

const HEADER_BYTES = 80
const BYTES_PER_TRIANGLE = 50

/**
 * A binary STL declares its triangle count at byte 80. If the file length matches that
 * exactly it is binary. An ASCII STL long enough to satisfy the arithmetic by coincidence
 * is not a thing that happens.
 */
function isBinary(buffer) {
  if (buffer.byteLength < HEADER_BYTES + 4) return false
  const count = new DataView(buffer).getUint32(HEADER_BYTES, true)
  return buffer.byteLength === HEADER_BYTES + 4 + count * BYTES_PER_TRIANGLE
}

function parseBinary(buffer) {
  const view = new DataView(buffer)
  const count = view.getUint32(HEADER_BYTES, true)
  const positions = new Float32Array(count * 9)
  let o = HEADER_BYTES + 4
  let p = 0

  for (let i = 0; i < count; i++) {
    o += 12 // Stored facet normal, skipped: normals are recomputed and are often wrong anyway.
    for (let v = 0; v < 9; v++) {
      positions[p++] = view.getFloat32(o, true)
      o += 4
    }
    o += 2 // Attribute byte count.
  }

  return positions
}

function parseAscii(text) {
  const re = /vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g
  const verts = []
  let m
  while ((m = re.exec(text)) !== null) verts.push(+m[1], +m[2], +m[3])
  if (verts.length === 0 || verts.length % 9 !== 0) {
    throw new Error('Bad ASCII STL vertex count')
  }
  return new Float32Array(verts)
}

/**
 * Parse an STL, binary or ASCII, and measure it in the same pass.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ positions: Float32Array, triangleCount: number,
 *             min: {x:number,y:number,z:number}, max: {x:number,y:number,z:number},
 *             size: {x:number,y:number,z:number} }}
 */
export function parseStlMesh(buffer) {
  let positions

  if (isBinary(buffer)) {
    positions = parseBinary(buffer)
  } else {
    const text = new TextDecoder().decode(buffer)
    if (!text.trimStart().toLowerCase().startsWith('solid')) {
      throw new Error('This file is not an STL')
    }
    positions = parseAscii(text)
  }

  if (positions.length === 0) throw new Error('This STL has no triangles')

  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    if (x < min.x) min.x = x
    if (y < min.y) min.y = y
    if (z < min.z) min.z = z
    if (x > max.x) max.x = x
    if (y > max.y) max.y = y
    if (z > max.z) max.z = z
  }

  return {
    positions,
    triangleCount: positions.length / 9,
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z }
  }
}
