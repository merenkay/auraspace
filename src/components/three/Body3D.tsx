// Realistic 3D anatomy viewer (BodyParts3D-derived GLB). Loaded lazily; see BodyViewer for the fallback.
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { SystemId } from '../../data/systems'
import { STATUS_COLOR, type Status } from '../../data/vitals'

export const NODE_SYSTEM: Record<string, SystemId> = {
  sys_heart: 'heart',
  sys_arteries: 'heart',
  sys_veins: 'heart',
  sys_lungs: 'lungs',
  sys_brain: 'brain',
  sys_nerves: 'brain',
  sys_eyes: 'eyes',
  sys_metabolism: 'metabolism',
  sys_renal: 'renal',
  sys_immune: 'immune',
  sys_bones: 'bones',
  sys_muscles: 'bones',
  sys_skin: 'radiation',
}

export type LayerId = 'skin' | 'muscles' | 'skeleton' | 'organs' | 'arteries' | 'veins' | 'nerves'

export const LAYER_NODES: Record<LayerId, string[]> = {
  skin: ['sys_skin'],
  muscles: ['sys_muscles'],
  skeleton: ['sys_bones'],
  organs: ['sys_brain', 'sys_eyes', 'sys_heart', 'sys_lungs', 'sys_metabolism', 'sys_renal', 'sys_immune'],
  arteries: ['sys_arteries'],
  veins: ['sys_veins'],
  nerves: ['sys_nerves'],
}

const BASE_COLOR: Record<string, string> = {
  sys_bones: '#e9dfc9',
  sys_muscles: '#b9574d',
  sys_skin: '#7fd4f0',
  sys_heart: '#c8372d',
  sys_lungs: '#e9a3a0',
  sys_brain: '#eab8bb',
  sys_eyes: '#f4f4f4',
  sys_metabolism: '#a8573a',
  sys_renal: '#8f3a48',
  sys_immune: '#8a5cc2',
  sys_arteries: '#e0362f',
  sys_veins: '#3f6ae0',
  sys_nerves: '#f5d547',
}

const SHELLS = new Set(['sys_skin', 'sys_muscles'])

function sysNameOf(o: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = o
  while (cur) {
    if (cur.name && BASE_COLOR[cur.name]) return cur.name
    const extra = (cur.userData as { system?: string } | undefined)?.system
    if (extra && BASE_COLOR[`sys_${extra}`]) return `sys_${extra}`
    cur = cur.parent
  }
  return null
}

type ModelProps = {
  files: string[]
  layers: Record<LayerId, boolean>
  statuses: Record<SystemId, Status>
  hovered: SystemId | null
  selected: SystemId | null
  onHover: (id: SystemId | null, e?: ThreeEvent<PointerEvent>) => void
  onSelect: (id: SystemId) => void
}

function Model({ files, layers, statuses, hovered, selected, onHover, onSelect }: ModelProps) {
  const gltfs = useGLTF(files) as unknown as { scene: THREE.Group }[] | { scene: THREE.Group }
  const list = Array.isArray(gltfs) ? gltfs : [gltfs]

  const { root, mats, objs, fit } = useMemo(() => {
    const root = new THREE.Group()
    const mats = new Map<string, THREE.MeshStandardMaterial>()
    const objs = new Map<string, THREE.Object3D[]>()
    for (const g of list) root.add(g.scene.clone(true))
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const name = sysNameOf(mesh)
      if (!name) {
        mesh.visible = false
        return
      }
      let m = mats.get(name)
      if (!m) {
        const shell = SHELLS.has(name)
        m = new THREE.MeshStandardMaterial({
          color: BASE_COLOR[name],
          roughness: name === 'sys_bones' ? 0.55 : 0.42,
          metalness: 0.05,
          transparent: shell,
          opacity: shell ? (name === 'sys_skin' ? 0.1 : 0.16) : 1,
          depthWrite: !shell,
          side: shell ? THREE.DoubleSide : THREE.FrontSide,
          emissive: new THREE.Color('#000000'),
        })
        mats.set(name, m)
      }
      mesh.material = m
      mesh.castShadow = false
      if (SHELLS.has(name)) mesh.raycast = () => {}
      objs.set(name, [...(objs.get(name) ?? []), mesh])
    })
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    return { root, mats, objs, fit: { size, center } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.join('|')])

  useEffect(() => {
    for (const [layer, nodes] of Object.entries(LAYER_NODES) as [LayerId, string[]][]) {
      for (const n of nodes) for (const o of objs.get(n) ?? []) o.visible = layers[layer]
    }
    // make the muscle shell solid when it is the only thing shown
    const onlyShell = layers.muscles && !layers.skeleton && !layers.organs
    const mm = mats.get('sys_muscles')
    if (mm) {
      mm.opacity = onlyShell ? 0.95 : 0.16
      mm.depthWrite = onlyShell
    }
  }, [layers, objs, mats])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2)
    for (const [name, m] of mats) {
      if (SHELLS.has(name)) continue
      const sys = NODE_SYSTEM[name]
      const st = statuses[sys] ?? 'ok'
      const active = sys === hovered || sys === selected
      if (active) {
        m.emissive.set(sys === selected ? '#53D7FF' : STATUS_COLOR[st])
        m.emissiveIntensity = 0.55 + 0.25 * pulse
      } else if (st !== 'ok') {
        m.emissive.set(STATUS_COLOR[st])
        m.emissiveIntensity = (st === 'crit' ? 0.55 : 0.32) * pulse
      } else {
        m.emissiveIntensity = 0
      }
    }
  })

  const scale = 1.75 / Math.max(fit.size.y, 0.001)
  return (
    <group scale={scale} position={[-fit.center.x * scale, -fit.center.y * scale + 0.875, -fit.center.z * scale]}>
      <primitive
        object={root}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          const n = sysNameOf(e.object)
          onHover(n ? NODE_SYSTEM[n] : null, e)
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          const n = sysNameOf(e.object)
          if (n) onSelect(NODE_SYSTEM[n])
        }}
      />
    </group>
  )
}

function ScanRing() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    ref.current.position.y = 0.05 + ((Math.sin(t * 0.6) + 1) / 2) * 1.7
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.12 * Math.sin(t * 1.2)
  })
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.42, 0.45, 96]} />
      <meshBasicMaterial color="#53D7FF" transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function Platform() {
  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.57, 96]} />
        <meshBasicMaterial color="#53D7FF" transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.55, 64]} />
        <meshBasicMaterial color="#53D7FF" transparent opacity={0.06} />
      </mesh>
      <gridHelper args={[3, 30, '#1E3A55', '#12263A']} position={[0, -0.001, 0]} />
    </group>
  )
}

export type Body3DProps = Omit<ModelProps, 'onHover'> & {
  autoRotate: boolean
  onHover: (id: SystemId | null, x?: number, y?: number) => void
  onInteract: () => void
}

export default function Body3D({ autoRotate, onHover, onInteract, ...rest }: Body3DProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 1.05, 3.1], fov: 38, near: 0.05, far: 50 }}
      gl={{ antialias: true, alpha: true }}
      onPointerMissed={() => onHover(null)}
    >
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#bfe9ff', '#0b1a2c', 0.7]} />
      <directionalLight position={[2.5, 4, 3]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.7} color="#53D7FF" />
      <pointLight position={[0, 1.2, 1.5]} intensity={0.6} color="#A5E9FF" />
      <Suspense fallback={null}>
        <Model
          {...rest}
          onHover={(id, e) => {
            const ne = e?.nativeEvent as PointerEvent | undefined
            const rect = (ne?.target as HTMLElement | undefined)?.getBoundingClientRect()
            onHover(id, ne && rect ? ne.clientX - rect.left : undefined, ne && rect ? ne.clientY - rect.top : undefined)
          }}
        />
      </Suspense>
      <ScanRing />
      <Platform />
      <OrbitControls
        target={[0, 0.95, 0]}
        enablePan={false}
        minDistance={1.2}
        maxDistance={5}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI - 0.4}
        autoRotate={autoRotate}
        autoRotateSpeed={1.1}
        enableDamping
        onStart={onInteract}
      />
    </Canvas>
  )
}
