// Animated 3D backdrop for the login screen: a wireframe Mars mesh, orbit rings and a star field.
import { Float, Stars } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

function Planet() {
  const group = useRef<THREE.Group>(null)
  const ship = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => new THREE.IcosahedronGeometry(1.6, 5), [])
  const wire = useMemo(() => new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.64, 3)), [])

  useFrame(({ clock, pointer }) => {
    const t = clock.getElapsedTime()
    if (group.current) {
      group.current.rotation.y = t * 0.08
      group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, pointer.y * 0.15, 0.05)
      group.current.position.x = THREE.MathUtils.lerp(group.current.position.x, 1.8 + pointer.x * 0.25, 0.05)
    }
    if (ship.current) {
      const a = t * 0.45
      ship.current.position.set(Math.cos(a) * 2.6, Math.sin(a) * 0.5, Math.sin(a) * 2.6)
    }
  })

  return (
    <group ref={group} position={[1.8, 0, 0]}>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#9c4a2c" roughness={0.9} metalness={0} emissive="#3b1406" emissiveIntensity={0.4} />
      </mesh>
      <lineSegments geometry={wire}>
        <lineBasicMaterial color="#F6BD60" transparent opacity={0.22} />
      </lineSegments>
      <mesh rotation={[Math.PI / 2.3, 0, 0]}>
        <torusGeometry args={[2.6, 0.006, 8, 200]} />
        <meshBasicMaterial color="#53D7FF" transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[Math.PI / 2.8, 0.4, 0]}>
        <torusGeometry args={[3.2, 0.004, 8, 200]} />
        <meshBasicMaterial color="#A5E9FF" transparent opacity={0.25} />
      </mesh>
      <mesh ref={ship}>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshBasicMaterial color="#A5E9FF" />
      </mesh>
    </group>
  )
}

function Particles() {
  const ref = useRef<THREE.Points>(null)
  const positions = useMemo(() => {
    const a = new Float32Array(600 * 3)
    for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 14
    return a
  }, [])
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.015
  })
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color="#53D7FF" transparent opacity={0.6} />
    </points>
  )
}

export default function SpaceScene() {
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 7], fov: 50 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={0.25} />
      <directionalLight position={[-4, 2, 5]} intensity={2.2} color="#ffd9b8" />
      <pointLight position={[4, -2, 2]} intensity={1.2} color="#53D7FF" />
      <Stars radius={60} depth={40} count={2500} factor={3} saturation={0} fade speed={0.6} />
      <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.6}>
        <Planet />
      </Float>
      <Particles />
    </Canvas>
  )
}
