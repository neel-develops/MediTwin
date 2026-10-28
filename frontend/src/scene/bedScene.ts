/*
 * MediTwin 3D resource stage (Three.js).
 *
 * One stylized bed per stored bed record, auto-laid-out in visual sections. Positions are display
 * coordinates computed from the bed's order in its ward — never stored, and not where a bed
 * physically is. "Section A, B…" are visual groups for large wards, not rooms.
 *
 * Every bed part is an InstancedMesh shared by all beds, so 100+ beds render in a handful of
 * draw calls. Picking uses the instance id.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry as RB } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { BedStatus } from '../lib/types'

// Graphite palette (same 10 colours as styles/graphite.css)
export const PAL = { base: '#111315', panel: '#1b1f23', raised: '#2c3238', slate: '#4f6e85', fog: '#8da4b3', pearl: '#eef3f6', accent: '#7db4e6', mint: '#5ed3a5', coral: '#f3786a', amber: '#f4c35a' }
export const STATUS_COLORS: Record<BedStatus, string> = {
  AVAILABLE: PAL.mint, OCCUPIED: PAL.coral, RESERVED: PAL.amber, CLEANING: PAL.fog, MAINTENANCE: PAL.slate,
}
const STATUS_LABEL: Record<BedStatus, string> = { AVAILABLE: 'Available', OCCUPIED: 'Occupied', RESERVED: 'Reserved', CLEANING: 'Cleaning', MAINTENANCE: 'Maintenance' }
const DIM = PAL.raised
const DIM_LIGHT = PAL.panel
const BED_W = 1.0, BED_L = 2.0, GAP_X = 0.42, GAP_Z = 0.75, PAD = 0.6, GROUP_GAP = 1.5

export interface SceneBed { id: number; bed_code: string; status: BedStatus }

export function groupName(i: number) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return 'Section ' + (i < 26 ? L[i] : L[Math.floor(i / 26) - 1] + L[i % 26])
}

interface GroupRect { index: number; x: number; z: number; w: number; d: number; count: number; start: number }
interface Layout { positions: { x: number; z: number; group: number }[]; groups: GroupRect[]; width: number; depth: number; groupSize: number }

/** Pure layout: index → display position. */
export function computeLayout(count: number, groupSize: number, aspect = 1): Layout {
  const cols = Math.max(2, Math.ceil(groupSize / 2))
  const rows = Math.ceil(groupSize / cols)
  const groups = Math.max(1, Math.ceil(count / groupSize))
  const groupW = cols * BED_W + (cols - 1) * GAP_X + 2 * PAD
  const groupD = rows * BED_L + (rows - 1) * GAP_Z + 2 * PAD
  const gCols = Math.max(1, Math.min(groups, Math.ceil(Math.sqrt((groups * groupD * aspect) / groupW))))
  const gRows = Math.ceil(groups / gCols)
  const totalW = gCols * groupW + (gCols - 1) * GROUP_GAP
  const totalD = gRows * groupD + (gRows - 1) * GROUP_GAP
  const ox = -totalW / 2, oz = -totalD / 2
  const groupRects: GroupRect[] = []
  for (let g = 0; g < groups; g++) {
    const gc = g % gCols, gr = Math.floor(g / gCols)
    const x0 = ox + gc * (groupW + GROUP_GAP), z0 = oz + gr * (groupD + GROUP_GAP)
    groupRects.push({ index: g, x: x0 + groupW / 2, z: z0 + groupD / 2, w: groupW, d: groupD, count: Math.min(groupSize, count - g * groupSize), start: g * groupSize })
  }
  const positions = []
  for (let i = 0; i < count; i++) {
    const g = Math.floor(i / groupSize), k = i % groupSize
    const r = groupRects[g]
    const col = k % cols, row = Math.floor(k / cols)
    positions.push({ x: r.x - r.w / 2 + PAD + col * (BED_W + GAP_X) + BED_W / 2, z: r.z - r.d / 2 + PAD + row * (BED_L + GAP_Z) + BED_L / 2, group: g })
  }
  return { positions, groups: groupRects, width: totalW, depth: totalD, groupSize }
}

interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; at: number[][]; color?: 'status' | 'light'; pick?: boolean; mesh?: THREE.InstancedMesh | null }

function bedParts(): Part[] {
  const metal = new THREE.MeshPhysicalMaterial({ color: PAL.raised, roughness: 0.35, metalness: 0.4, clearcoat: 0.6 })
  const dark = new THREE.MeshStandardMaterial({ color: PAL.base, roughness: 0.55 })
  const white = new THREE.MeshPhysicalMaterial({ color: PAL.pearl, roughness: 0.55, clearcoat: 0.25, envMapIntensity: 0.3 })
  const tinted = () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.42, clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 0.3 })
  const wheel = new THREE.CylinderGeometry(0.065, 0.065, 0.05, 16)
  wheel.rotateZ(Math.PI / 2)
  return [
    { geo: wheel, mat: dark, at: [[-0.4, 0.065, -0.8], [0.4, 0.065, -0.8], [-0.4, 0.065, 0.8], [0.4, 0.065, 0.8]] },
    { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10), mat: metal, at: [[-0.4, 0.25, -0.8], [0.4, 0.25, -0.8], [-0.4, 0.25, 0.8], [0.4, 0.25, 0.8]] },
    { geo: new RB(1.0, 0.12, 1.96, 2, 0.045), mat: metal, at: [[0, 0.44, 0]], pick: true },
    { geo: new RB(0.92, 0.17, 1.84, 3, 0.07), mat: white, at: [[0, 0.585, 0]], pick: true },
    { geo: new RB(0.6, 0.13, 0.34, 3, 0.06), mat: white, at: [[0, 0.72, -0.66]] },
    { geo: new RB(0.98, 0.1, 1.24, 3, 0.045), mat: tinted(), at: [[0, 0.68, 0.31]], color: 'status', pick: true },
    { geo: new RB(0.99, 0.07, 0.2, 3, 0.032), mat: tinted(), at: [[0, 0.725, -0.27]], color: 'light' },
    { geo: new RB(1.04, 0.68, 0.085, 3, 0.038), mat: tinted(), at: [[0, 0.75, -0.98]], color: 'status', pick: true },
    { geo: new RB(1.04, 0.42, 0.075, 3, 0.034), mat: tinted(), at: [[0, 0.63, 0.99]], color: 'status' },
    { geo: new RB(0.035, 0.04, 0.95, 2, 0.016), mat: metal, at: [[-0.53, 0.86, -0.3], [0.53, 0.86, -0.3]] },
    { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), mat: metal, at: [[-0.53, 0.78, -0.7], [-0.53, 0.78, 0.1], [0.53, 0.78, -0.7], [0.53, 0.78, 0.1]] },
  ]
}

function statusColor(status: BedStatus, role: 'status' | 'light') {
  if (role === 'light') return new THREE.Color(PAL.pearl) // folded sheet edge
  return new THREE.Color(STATUS_COLORS[status] || PAL.fog)
}

function addLights(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2c3238, 0.7))
  const sun = new THREE.DirectionalLight(0xffffff, 1.25)
  sun.position.set(-8, 16, 10)
  scene.add(sun)
  return sun
}

function configureRenderer(renderer: THREE.WebGLRenderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.NoToneMapping // keeps status colours saturated
}

let thumbCache: Promise<Record<BedStatus, string>> | null = null
/** Renders one bed per status to a PNG data URL, for detail panels. */
export function bedThumbnails(): Promise<Record<BedStatus, string>> {
  if (thumbCache) return thumbCache
  thumbCache = new Promise((resolve, reject) => {
    try {
      const W = 240, H = 180
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
      configureRenderer(renderer)
      renderer.setPixelRatio(1)
      renderer.setSize(W, H, false)
      const scene = new THREE.Scene()
      addLights(scene, renderer)
      const camera = new THREE.PerspectiveCamera(26, W / H, 0.1, 50)
      camera.position.set(3.1, 2.7, 3.3)
      camera.lookAt(0, 0.45, 0)
      const bed = new THREE.Group()
      const meshes: THREE.Mesh[] = []
      for (const p of bedParts()) for (const [x, y, z] of p.at) {
        const m = new THREE.Mesh(p.geo, p.color ? (p.mat as THREE.MeshPhysicalMaterial).clone() : p.mat)
        m.position.set(x, y, z)
        m.userData.role = p.color
        bed.add(m)
        meshes.push(m)
      }
      bed.rotation.y = Math.PI
      scene.add(bed)
      const out = {} as Record<BedStatus, string>
      for (const s of Object.keys(STATUS_COLORS) as BedStatus[]) {
        for (const m of meshes) if (m.userData.role) (m.material as THREE.MeshPhysicalMaterial).color.copy(statusColor(s, m.userData.role))
        renderer.render(scene, camera)
        out[s] = renderer.domElement.toDataURL('image/png')
      }
      renderer.dispose()
      renderer.forceContextLoss()
      resolve(out)
    } catch (e) {
      thumbCache = null
      reject(e)
    }
  })
  return thumbCache
}

export interface Obstacle { l: number; r: number; t: number; b: number }
export interface StageOptions {
  onBedClick?: (id: number) => void
  onGroupClick?: (index: number) => void
  /** Overlay UI the page draws on top of the stage (title, status chips, tools), in stage pixels. */
  obstacles?: () => Obstacle[]
}

export type Stage = ReturnType<typeof createStage>

export function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

export function createStage(container: HTMLElement, opts: StageOptions = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  configureRenderer(renderer)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.className = 'stage-canvas'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none'
  container.appendChild(renderer.domElement)

  const overlay = document.createElement('div')
  overlay.className = 'stage-overlay'
  container.appendChild(overlay)
  const tooltip = document.createElement('div')
  tooltip.className = 'stage-tooltip'
  tooltip.hidden = true
  overlay.appendChild(tooltip)
  const selTag = document.createElement('div')
  selTag.className = 'stage-seltag'
  selTag.hidden = true
  overlay.appendChild(selTag)
  const compass = document.createElement('div')
  compass.className = 'compass'
  compass.setAttribute('aria-hidden', 'true')
  compass.innerHTML = '<div class="compass-rose"><span class="n">N</span><span class="e">E</span><span class="s">S</span><span class="w">W</span><i></i></div>'
  container.appendChild(compass)
  const rose = compass.firstChild as HTMLElement

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400)
  const sun = addLights(scene, renderer)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  scene.add(sun.target)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: PAL.base, opacity: 0.55 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.17
  ground.receiveShadow = true
  scene.add(ground)

  const parts = bedParts()
  const trayMat = new THREE.MeshPhysicalMaterial({ color: PAL.pearl, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, transparent: true, opacity: 0.07, envMapIntensity: 0.6 })
  const trayActive = trayMat.clone()
  trayActive.color.set(PAL.accent)
  trayActive.opacity = 0.16
  const rimMat = new THREE.MeshPhysicalMaterial({ color: PAL.pearl, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.16, envMapIntensity: 0.8 })
  const ringGeo = new THREE.RingGeometry(0.78, 0.92, 48)
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: PAL.accent, transparent: true, opacity: 0.95, side: THREE.DoubleSide }))
  ring.rotation.x = -Math.PI / 2
  ring.scale.set(1, 1.55, 1)
  ring.visible = false
  const hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: PAL.fog, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
  hoverRing.rotation.x = -Math.PI / 2
  hoverRing.scale.set(1, 1.55, 1)
  hoverRing.visible = false
  scene.add(ring, hoverRing)

  const world = new THREE.Group()
  scene.add(world)
  let beds: SceneBed[] = []
  let indexById = new Map<number, number>()
  let layout: Layout | null = null
  let trays: THREE.Mesh[] = []
  let groupTags: (HTMLButtonElement & { _w?: number; _h?: number })[] = []
  let matchSet: Set<number> | null = null
  let selectedId: number | null = null
  let hoverId: number | null = null
  let activeGroup: number | null = null
  const tmpM = new THREE.Matrix4()
  const tmpC = new THREE.Color()

  // ---------------------------------------------------------------- camera rig
  const rig = { target: new THREE.Vector3(), radius: 30, theta: 0.48, phi: 0.78, min: 5, max: 120, bounds: { x: 20, z: 20 } }
  type Tw = { tx: number; tz: number; radius: number; theta: number; phi: number }
  let tween: { from: Tw; to: Tw; t0: number; ms: number } | null = null
  let autoRotate = false
  let userMoved = false

  function applyCamera() {
    const r = rig.radius, sp = Math.sin(rig.phi)
    camera.position.set(rig.target.x + r * sp * Math.sin(rig.theta), rig.target.y + r * Math.cos(rig.phi), rig.target.z + r * sp * Math.cos(rig.theta))
    camera.lookAt(rig.target)
    rose.style.transform = `rotate(${rig.theta}rad)`
  }
  function clampRig() {
    rig.phi = Math.min(1.3, Math.max(0.2, rig.phi))
    rig.radius = Math.min(rig.max, Math.max(rig.min, rig.radius))
    rig.target.x = Math.min(rig.bounds.x, Math.max(-rig.bounds.x, rig.target.x))
    rig.target.z = Math.min(rig.bounds.z, Math.max(-rig.bounds.z, rig.target.z))
  }
  const obstacles = (): Obstacle[] => (opts.obstacles ? opts.obstacles() : [])
  /** Vertical screen band (NDC) left free by overlays at the top and bottom of the stage. */
  function freeBand() {
    const h = container.clientHeight || 1
    let top = 0, bottom = 0
    for (const o of obstacles()) {
      if (o.b <= h / 2) top = Math.max(top, o.b)
      else if (o.t >= h / 2) bottom = Math.max(bottom, h - o.t)
    }
    const gap = 14
    const topN = 1 - (2 * (top + gap)) / h, botN = -1 + (2 * (bottom + gap)) / h
    const halfH = Math.max(0.25, (topN - botN) / 2)
    return { halfH, centreY: (topN + botN) / 2 }
  }
  /**
   * Camera distance and target that make the whole grid fill the stage from the default angle.
   * Projects the real section trays (a part-filled last row leaves empty corners), scales by the
   * on-screen box and re-centres it inside the band the overlays leave free.
   */
  function fitView() {
    if (!layout || !layout.groups.length) return { r: 30, tx: 0, tz: 0 }
    const band = freeBand()
    const FIT = { halfW: 0.94, halfH: band.halfH, centreY: band.centreY }
    const pts: THREE.Vector3[] = []
    for (const g of layout.groups) {
      for (const x of [g.x - g.w / 2, g.x + g.w / 2]) for (const z of [g.z - g.d / 2, g.z + g.d / 2]) for (const y of [0, 1.2]) pts.push(new THREE.Vector3(x, y, z))
    }
    const saved = { radius: rig.radius, theta: rig.theta, phi: rig.phi, t: rig.target.clone() }
    const theta = 0.48, phi = 0.78, half = Math.tan((camera.fov * Math.PI) / 360)
    let r = 40, tx = 0, tz = 0
    for (let k = 0; k < 8; k++) {
      Object.assign(rig, { radius: r, theta, phi })
      rig.target.set(tx, 0, tz)
      applyCamera()
      camera.updateMatrixWorld()
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      for (const p of pts) {
        const q = p.clone().project(camera)
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y)
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      // move the target so the box centre lands at (0, centreY)
      const halfH = half * r, halfW = halfH * camera.aspect
      tx += Math.cos(theta) * cx * halfW; tz -= Math.sin(theta) * cx * halfW
      const back = ((cy - FIT.centreY) * halfH) / Math.cos(phi)
      tx -= Math.sin(theta) * back; tz -= Math.cos(theta) * back
      r *= Math.max((x1 - x0) / 2 / FIT.halfW, (y1 - y0) / 2 / FIT.halfH)
    }
    Object.assign(rig, { radius: saved.radius, theta: saved.theta, phi: saved.phi })
    rig.target.copy(saved.t)
    return { r, tx, tz }
  }
  function animateTo(to: Partial<Tw>, ms = 650) {
    const from: Tw = { tx: rig.target.x, tz: rig.target.z, radius: rig.radius, theta: rig.theta, phi: rig.phi }
    const dest: Tw = { ...from, ...to }
    while (dest.theta - from.theta > Math.PI) dest.theta -= Math.PI * 2
    while (dest.theta - from.theta < -Math.PI) dest.theta += Math.PI * 2
    tween = { from, to: dest, t0: performance.now(), ms }
    userMoved = true
    kick()
  }
  function resetView(instant = false) {
    const f = fitView()
    const to = { tx: f.tx, tz: f.tz, radius: f.r, theta: 0.48, phi: 0.78 }
    rig.max = Math.max(to.radius * 2, 20)
    if (instant) {
      tween = null
      rig.target.set(to.tx, 0, to.tz)
      Object.assign(rig, { radius: to.radius, theta: to.theta, phi: to.phi })
      clampRig()
      kick()
    } else animateTo(to)
    userMoved = false
  }

  // ---------------------------------------------------------------- build
  function clearWorld() {
    for (const child of world.children.slice()) {
      world.remove(child)
      if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose()
      else if (child.userData.ownGeo) (child as THREE.Mesh).geometry.dispose()
    }
    for (const t of groupTags) t.remove()
    trays = []
    groupTags = []
    for (const p of parts) p.mesh = null
  }

  function placeBed(i: number) {
    if (!layout) return
    const pos = layout.positions[i]
    const lift = beds[i].id === selectedId ? 0.16 : 0
    for (const p of parts) {
      p.at.forEach(([x, y, z], j) => {
        tmpM.makeTranslation(pos.x + x, y + lift, pos.z + z)
        p.mesh!.setMatrixAt(i * p.at.length + j, tmpM)
      })
      p.mesh!.instanceMatrix.needsUpdate = true
    }
  }
  function paintBed(i: number) {
    const b = beds[i]
    const dim = matchSet && !matchSet.has(b.id)
    for (const p of parts) {
      if (!p.color) continue
      if (dim) tmpC.set(p.color === 'light' ? DIM_LIGHT : DIM)
      else tmpC.copy(statusColor(b.status, p.color))
      p.at.forEach((_, j) => p.mesh!.setColorAt(i * p.at.length + j, tmpC))
      p.mesh!.instanceColor!.needsUpdate = true
    }
  }

  function setBeds(list: SceneBed[], options: { groupSize?: number; resetView?: boolean } = {}) {
    const groupSize = options.groupSize || 10
    const same = layout && layout.groupSize === groupSize && list.length === beds.length && list.every((b, i) => b.id === beds[i].id)
    beds = list.slice()
    if (same) {
      beds.forEach((_, i) => paintBed(i))
      refreshGroupTags()
      kick()
      return
    }
    clearWorld()
    indexById = new Map(beds.map((b, i) => [b.id, i]))
    layout = computeLayout(beds.length, groupSize, 1.0)
    if (!beds.length) {
      updateRings()
      kick()
      return
    }

    layout.groups.forEach((r) => {
      const tray = new THREE.Mesh(new RB(r.w, 0.16, r.d, 3, 0.14), trayMat)
      tray.userData.ownGeo = true
      tray.position.set(r.x, -0.08, r.z)
      tray.receiveShadow = true
      tray.userData.groupIndex = r.index
      world.add(tray)
      trays.push(tray)
      const rimH = 0.24, t = 0.07
      for (const [w, d, x, z] of [[r.w, t, r.x, r.z - r.d / 2 + t / 2], [r.w, t, r.x, r.z + r.d / 2 - t / 2], [t, r.d - 2 * t, r.x - r.w / 2 + t / 2, r.z], [t, r.d - 2 * t, r.x + r.w / 2 - t / 2, r.z]]) {
        const rim = new THREE.Mesh(new RB(w, rimH, d, 2, 0.03), rimMat)
        rim.userData.ownGeo = true
        rim.position.set(x, rimH / 2 - 0.02, z)
        world.add(rim)
      }
      const tag = document.createElement('button')
      tag.type = 'button'
      tag.className = 'group-tag'
      tag.addEventListener('click', (e) => {
        e.stopPropagation()
        opts.onGroupClick?.(r.index)
      })
      overlay.appendChild(tag)
      groupTags.push(tag)
    })

    for (const p of parts) {
      const m = new THREE.InstancedMesh(p.geo, p.mat, Math.max(1, beds.length * p.at.length))
      m.count = beds.length * p.at.length
      m.castShadow = true
      m.receiveShadow = true
      m.userData.perBed = p.at.length
      if (p.color) m.setColorAt(0, tmpC.set('#ffffff'))
      p.mesh = m
      world.add(m)
    }
    beds.forEach((_, i) => {
      placeBed(i)
      paintBed(i)
    })
    for (const p of parts) p.mesh!.computeBoundingSphere()

    const ext = Math.max(layout.width, layout.depth) / 2 + 4
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 80 })
    sun.shadow.camera.updateProjectionMatrix()
    sun.position.set(-9, 18, 11)
    sun.target.position.set(0, 0, 0)

    refreshGroupTags()
    rig.bounds = { x: layout.width / 2 + 2, z: layout.depth / 2 + 2 }
    if (selectedId != null && !indexById.has(selectedId)) selectedId = null
    updateRings()
    if (options.resetView !== false) resetView(true)
    kick()
  }

  function refreshGroupTags() {
    if (!layout) return
    layout.groups.forEach((r, i) => {
      const tag = groupTags[i]
      if (!tag) return
      const members = beds.slice(r.start, r.start + r.count)
      const avail = members.filter((b) => b.status === 'AVAILABLE').length
      const matching = matchSet ? members.filter((b) => matchSet!.has(b.id)).length : null
      tag.innerHTML = `<strong>${groupName(i)}</strong><span>${matching != null ? `${matching} match` : `${r.count} beds`}</span>`
      tag.setAttribute('aria-label', `${groupName(i)}: ${r.count} beds, ${avail} available. Open section.`)
      tag.classList.toggle('active', activeGroup === i)
      tag._w = 0
      trays[i].material = activeGroup === i ? trayActive : trayMat
    })
  }

  function updateRings() {
    const si = selectedId != null ? indexById.get(selectedId) : undefined
    ring.visible = si !== undefined && !!layout
    if (ring.visible && layout && si !== undefined) ring.position.set(layout.positions[si].x, 0.012, layout.positions[si].z)
    const hi = hoverId != null && hoverId !== selectedId ? indexById.get(hoverId) : undefined
    hoverRing.visible = hi !== undefined && !!layout
    if (hoverRing.visible && layout && hi !== undefined) hoverRing.position.set(layout.positions[hi].x, 0.01, layout.positions[hi].z)
  }

  // ---------------------------------------------------------------- input
  const el = renderer.domElement
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const pointers = new Map<number, { x: number; y: number }>()
  let drag: { x0?: number; y0?: number; x?: number; y?: number; moved: number; mode?: 'pan' | 'rotate'; button?: number; pinch?: number; mx?: number; my?: number } | null = null

  function pick(clientX: number, clientY: number): { bedId?: number; groupIndex?: number } | null {
    if (!layout || !beds.length) return null
    const rect = el.getBoundingClientRect()
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObjects(parts.filter((p) => p.pick && p.mesh).map((p) => p.mesh!), false)[0]
    if (hit && hit.instanceId != null) return { bedId: beds[Math.floor(hit.instanceId / hit.object.userData.perBed)].id }
    const t = raycaster.intersectObjects(trays, false)[0]
    if (t) return { groupIndex: t.object.userData.groupIndex }
    return null
  }

  function pan(dx: number, dy: number) {
    const k = rig.radius * 0.0016
    const right = new THREE.Vector3(Math.cos(rig.theta), 0, -Math.sin(rig.theta))
    const fwd = new THREE.Vector3(Math.sin(rig.theta), 0, Math.cos(rig.theta))
    rig.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k)
  }

  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    tween = null
    if (pointers.size === 1) drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, mode: e.button === 2 || e.shiftKey || e.ctrlKey ? 'pan' : 'rotate', button: e.button }
    else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values())
      drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: 99 }
    }
  })
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      hoverAt(e.clientX, e.clientY)
      return
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (!drag) return
    if (pointers.size >= 2 && drag.pinch) {
      const [a, b] = Array.from(pointers.values())
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      rig.radius *= drag.pinch / Math.max(d, 1)
      pan(mx - drag.mx!, my - drag.my!)
      Object.assign(drag, { pinch: d, mx, my })
    } else {
      const dx = e.clientX - drag.x!, dy = e.clientY - drag.y!
      drag.x = e.clientX
      drag.y = e.clientY
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x0!, e.clientY - drag.y0!))
      if (drag.moved < 4) return // small jitter during a click is not a drag
      if (drag.mode === 'pan') pan(dx, dy)
      else {
        rig.theta -= dx * 0.006
        rig.phi -= dy * 0.005
      }
      el.classList.add('dragging')
    }
    userMoved = true
    clampRig()
    kick()
  })
  const endPointer = (e: PointerEvent) => {
    const wasClick = drag && !drag.pinch && drag.moved < 6 && drag.button === 0 && pointers.size === 1
    pointers.delete(e.pointerId)
    el.classList.remove('dragging')
    if (wasClick && e.type === 'pointerup') {
      const p = pick(e.clientX, e.clientY)
      if (p?.bedId != null) opts.onBedClick?.(p.bedId)
      else if (p?.groupIndex != null) opts.onGroupClick?.(p.groupIndex)
    }
    if (pointers.size === 0) drag = null
  }
  el.addEventListener('pointerup', endPointer)
  el.addEventListener('pointercancel', endPointer)
  el.addEventListener('pointerleave', () => {
    if (!pointers.size) setHover(null)
  })
  el.addEventListener('wheel', (e) => {
    e.preventDefault()
    tween = null
    userMoved = true
    rig.radius *= Math.exp(e.deltaY * 0.0012)
    clampRig()
    kick()
  }, { passive: false })

  let hoverFrame = 0
  function hoverAt(x: number, y: number) {
    cancelAnimationFrame(hoverFrame)
    hoverFrame = requestAnimationFrame(() => {
      const p = pick(x, y)
      setHover(p?.bedId != null ? p.bedId : null, x, y)
      el.style.cursor = p ? 'pointer' : ''
    })
  }
  function setHover(id: number | null, x = 0, y = 0) {
    if (id === hoverId && id == null) return
    hoverId = id
    if (id == null) {
      tooltip.hidden = true
      updateRings()
      kick()
      return
    }
    const b = beds[indexById.get(id)!]
    const rect = container.getBoundingClientRect()
    tooltip.innerHTML = `<strong>${b.bed_code}</strong> · ${STATUS_LABEL[b.status]}`
    tooltip.style.transform = `translate(${x - rect.left + 14}px, ${y - rect.top + 14}px)`
    tooltip.hidden = false
    updateRings()
    kick()
  }

  // ---------------------------------------------------------------- render loop
  let needsRender = true
  let raf = 0
  let disposed = false
  const v = new THREE.Vector3()
  function kick() {
    needsRender = true
    if (!raf && !disposed) raf = requestAnimationFrame(frame)
  }
  function project(x: number, y: number, z: number) {
    v.set(x, y, z).project(camera)
    return { x: (v.x * 0.5 + 0.5) * el.clientWidth, y: (-v.y * 0.5 + 0.5) * el.clientHeight, visible: v.z < 1 }
  }
  function frame(now: number) {
    raf = 0
    if (disposed) return
    let animating = false
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.ms)
      const k = 1 - Math.pow(1 - t, 4) // strong ease-out
      const f = tween.from, d = tween.to
      rig.target.set(f.tx + (d.tx - f.tx) * k, 0, f.tz + (d.tz - f.tz) * k)
      rig.radius = f.radius + (d.radius - f.radius) * k
      rig.theta = f.theta + (d.theta - f.theta) * k
      rig.phi = f.phi + (d.phi - f.phi) * k
      if (t >= 1) tween = null
      animating = true
    }
    if (autoRotate && !drag) {
      rig.theta += 0.0025
      animating = true
    }
    if (needsRender || animating) {
      applyCamera()
      renderer.render(scene, camera)
      needsRender = false
      if (layout && beds.length) {
        // Section labels float above each tray's back edge; drop any that would overlap.
        // drop labels that would overlap another label or the page's overlay UI (title, chips, tools)
        const placed: Obstacle[] = obstacles().map((o) => ({ l: o.l - 4, r: o.r + 4, t: o.t - 4, b: o.b + 4 }))
        const sel = selectedId != null ? indexById.get(selectedId) : undefined
        if (sel !== undefined && layout) { // the selected-bed tag wins over section labels
          const sp = project(layout.positions[sel].x, 1.55, layout.positions[sel].z - 0.9)
          placed.push({ l: sp.x - 40, r: sp.x + 40, t: sp.y - 28, b: sp.y + 2 })
        }
        const order = layout.groups.map((_, i) => i).sort((a, b) => Number(b === activeGroup) - Number(a === activeGroup) || a - b)
        for (const i of order) {
          const r = layout.groups[i]
          const p = project(r.x, 1.4, r.z - r.d / 2 + 0.3)
          const tag = groupTags[i]
          if (!tag) continue
          if (!tag._w) {
            tag._w = tag.offsetWidth || 90
            tag._h = tag.offsetHeight || 34
          }
          const box = { l: p.x - tag._w / 2 - 3, r: p.x + tag._w / 2 + 3, t: p.y - tag._h! - 3, b: p.y + 3 }
          const clash = placed.some((q) => box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t)
          tag.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`
          const show = p.visible && !clash
          tag.style.visibility = show ? 'visible' : 'hidden'
          if (show) placed.push(box)
        }
      }
      const si = selectedId != null ? indexById.get(selectedId) : undefined
      if (si !== undefined && layout) {
        const pos = layout.positions[si]
        const p = project(pos.x, 1.55, pos.z - 0.9)
        selTag.textContent = beds[si].bed_code
        selTag.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`
        selTag.hidden = !p.visible
      } else selTag.hidden = true
    }
    if (animating) raf = requestAnimationFrame(frame)
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    if (layout && !userMoved && !tween) resetView(true)
    kick()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(container)
  resize()

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowLeft: () => (rig.theta += 0.12), ArrowRight: () => (rig.theta -= 0.12), ArrowUp: () => (rig.phi -= 0.08), ArrowDown: () => (rig.phi += 0.08),
      '+': () => (rig.radius *= 0.85), '=': () => (rig.radius *= 0.85), '-': () => (rig.radius *= 1.18),
    }
    if (e.target !== container || !map[e.key]) return
    e.preventDefault()
    tween = null
    userMoved = true
    map[e.key]()
    clampRig()
    kick()
  }
  container.addEventListener('keydown', onKey)

  return {
    setBeds,
    setMatch(set: Set<number> | null) {
      matchSet = set
      beds.forEach((_, i) => paintBed(i))
      refreshGroupTags()
      kick()
    },
    select(id: number | null, { focus = false } = {}) {
      const prev = selectedId != null ? indexById.get(selectedId) : undefined
      selectedId = id != null && indexById.has(id) ? id : null
      if (prev !== undefined) placeBed(prev)
      if (selectedId != null) placeBed(indexById.get(selectedId)!)
      updateRings()
      if (focus && selectedId != null && layout) {
        const pos = layout.positions[indexById.get(selectedId)!]
        animateTo({ tx: pos.x, tz: pos.z, radius: Math.min(rig.radius, 24), phi: 0.8 })
      }
      kick()
    },
    setActiveGroup(i: number | null, { focus = false } = {}) {
      activeGroup = i
      refreshGroupTags()
      if (focus && i != null && layout?.groups[i]) {
        const r = layout.groups[i]
        animateTo({ tx: r.x, tz: r.z, radius: Math.max(r.w, r.d) * 3.4, phi: 0.8 })
      }
      kick()
    },
    zoom(f: number) {
      tween = null
      userMoved = true
      rig.radius *= f
      clampRig()
      kick()
    },
    rotate(rad: number) {
      animateTo({ theta: rig.theta + rad }, 350)
    },
    resetView: () => resetView(false),
    /** Re-fit after the page's overlay UI changed size, unless the user has moved the camera. */
    refit() {
      if (layout && !userMoved && !tween) resetView(true)
      else kick()
    },
    setAutoRotate(on: boolean) {
      autoRotate = on
      kick()
    },
    get autoRotate() {
      return autoRotate
    },
    dispose() {
      disposed = true
      ro.disconnect()
      cancelAnimationFrame(raf)
      container.removeEventListener('keydown', onKey)
      clearWorld()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      overlay.remove()
      compass.remove()
    },
  }
}
