// Pure geometry for the AURA core: the geodesic lattice (shared by the WebGL scene and the flat SVG fallback).
// No three.js here, so the fallback and the unit tests never load the 3D engine.

export type Vec3 = [number, number, number]
export type Lattice = { vertices: Vec3[]; edges: [number, number][] }

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * A geodesic sphere of radius 1: an icosahedron whose faces are split into `frequency`² triangles.
 * 10·f² + 2 vertices and 30·f² edges (f = 2: 42 / 120, f = 3: 92 / 270).
 */
export function geodesic(frequency: number): Lattice {
  const f = Math.max(1, Math.floor(frequency))
  const t = (1 + Math.sqrt(5)) / 2
  const base: Vec3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as Vec3[]).map(norm)
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
  const vertices: Vec3[] = []
  const index = new Map<string, number>()
  const edgeKeys = new Set<string>()
  const edges: [number, number][] = []
  const add = (v: Vec3) => {
    const n = norm(v)
    const key = `${Math.round(n[0] * 1e4)},${Math.round(n[1] * 1e4)},${Math.round(n[2] * 1e4)}`
    let i = index.get(key)
    if (i === undefined) {
      i = vertices.length
      vertices.push(n)
      index.set(key, i)
    }
    return i
  }
  const link = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push(a < b ? [a, b] : [b, a])
  }
  for (const [ia, ib, ic] of faces) {
    const a = base[ia]
    const b = base[ib]
    const c = base[ic]
    // barycentric grid: row i has i + 1 points
    const grid: number[][] = []
    for (let i = 0; i <= f; i++) {
      const row: number[] = []
      for (let j = 0; j <= i; j++) {
        const wa = (f - i) / f
        const wb = (i - j) / f
        const wc = j / f
        row.push(add([a[0] * wa + b[0] * wb + c[0] * wc, a[1] * wa + b[1] * wb + c[1] * wc, a[2] * wa + b[2] * wb + c[2] * wc]))
      }
      grid.push(row)
    }
    for (let i = 1; i <= f; i++) {
      for (let j = 0; j <= i; j++) {
        if (j < i) {
          link(grid[i][j], grid[i - 1][j])
          link(grid[i][j], grid[i][j + 1])
        }
        if (j > 0) link(grid[i][j], grid[i - 1][j - 1])
      }
    }
  }
  return { vertices, edges }
}

export type FlatLattice = { front: string; back: string; dotsFront: string; dotsBack: string }

/**
 * Orthographic drawing of a lattice as SVG path data (y down), split into the half facing the viewer and the
 * half behind, so the flat fallback can draw the far side fainter, as the 3D scene does.
 */
export function projectLattice(l: Lattice, yaw: number, pitch: number, radius: number): FlatLattice {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const pts = l.vertices.map(([x, y, z]) => {
    const x1 = x * cy + z * sy
    const z1 = -x * sy + z * cy
    return [x1 * radius, -(y * cp - z1 * sp) * radius, y * sp + z1 * cp] as Vec3
  })
  const r = (v: number) => Math.round(v * 10) / 10
  let front = ''
  let back = ''
  let dotsFront = ''
  let dotsBack = ''
  for (const [a, b] of l.edges) {
    const seg = `M${r(pts[a][0])} ${r(pts[a][1])}L${r(pts[b][0])} ${r(pts[b][1])}`
    if (pts[a][2] + pts[b][2] >= 0) front += seg
    else back += seg
  }
  for (const p of pts) {
    const dot = `M${r(p[0])} ${r(p[1])}h0`
    if (p[2] >= 0) dotsFront += dot
    else dotsBack += dot
  }
  return { front, back, dotsFront, dotsBack }
}

/** A regular polygon in the XY plane, first corner turned by half a side so an octagon rests on a flat edge. */
export function polygon(sides: number, radius: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2
    out.push([Math.cos(a) * radius, Math.sin(a) * radius])
  }
  return out
}
