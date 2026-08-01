import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import Lenis from 'lenis'

import frontUrl from './front.png'
import backUrl from './back.png'
import spineUrl from './spine.png'
import frontBumpUrl from './front-bump.png'
import backBumpUrl from './back-bump.png'
import spineBumpUrl from './spine-bump.png'
import grainUrl from './paper-grain.png'
import pageEdgeUrl from './page-edge.png'

const clamp = THREE.MathUtils.clamp

// Real proportions: 148 × 210 mm, spine 30.5 mm.
const BOOK = {
  width: 2.819,
  height: 4,
  depth: 0.581,
  coverThickness: 0.034,
  overhang: 0.025,
  pageInset: 0.045,
}

function useBookScroll(sectionRef) {
  const progress = useRef(0)
  const velocity = useRef(0)

  useEffect(() => {
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.085,
      smoothWheel: true,
      syncTouch: false,
    })

    const update = ({ velocity: nextVelocity = 0 } = {}) => {
      const section = sectionRef.current
      if (!section) return

      const rect = section.getBoundingClientRect()
      const travel = Math.max(1, section.offsetHeight - window.innerHeight)

      progress.current = clamp(-rect.top / travel, 0, 1)
      velocity.current = THREE.MathUtils.lerp(
        velocity.current,
        clamp(nextVelocity / 30, -1, 1),
        0.18,
      )
    }

    lenis.on('scroll', update)
    window.addEventListener('resize', update)
    update()

    return () => {
      window.removeEventListener('resize', update)
      lenis.destroy()
    }
  }, [sectionRef])

  return { progress, velocity }
}

function prepareTexture(texture, renderer, options = {}) {
  const { flipX = false, repeat = false, isColor = true } = options

  if (isColor) {
    texture.colorSpace = THREE.SRGBColorSpace
  }

  texture.anisotropy = Math.min(
    12,
    renderer.capabilities.getMaxAnisotropy(),
  )
  texture.wrapS = repeat
    ? THREE.RepeatWrapping
    : THREE.ClampToEdgeWrapping
  texture.wrapT = repeat
    ? THREE.RepeatWrapping
    : THREE.ClampToEdgeWrapping

  if (flipX) {
    texture.repeat.x = -1
    texture.offset.x = 1
  }

  texture.needsUpdate = true
}

function Book({ progress, velocity }) {
  const book = useRef(null)
  const model = useRef(null)
  const pointer = useRef({ x: 0, y: 0 })
  const drag = useRef({
    active: false,
    lastX: 0,
    lastY: 0,
    rotationX: 0,
    rotationY: 0,
  })
  const hovered = useRef(false)
  const { gl, viewport } = useThree()

  const [
    front,
    back,
    spine,
    frontBump,
    backBump,
    spineBump,
    grain,
    pageEdge,
  ] = useLoader(THREE.TextureLoader, [
    frontUrl,
    backUrl,
    spineUrl,
    frontBumpUrl,
    backBumpUrl,
    spineBumpUrl,
    grainUrl,
    pageEdgeUrl,
  ])

  const pageWidth = BOOK.width - BOOK.pageInset * 2
  const pageHeight = BOOK.height - BOOK.pageInset * 2
  const pageDepth = BOOK.depth - BOOK.coverThickness * 2
  const coverWidth = BOOK.width + BOOK.overhang * 2
  const coverHeight = BOOK.height + BOOK.overhang * 2
  const frontZ = BOOK.depth / 2 + BOOK.coverThickness / 2

  const pageMaterials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({
      color: '#eee8df',
      map: pageEdge,
      roughness: 1,
      metalness: 0,
    })
    const paper = new THREE.MeshStandardMaterial({
      color: '#f3eee7',
      roughness: 1,
      metalness: 0,
    })

    // BoxGeometry material order: right, left, top, bottom, front, back.
    return [edge, edge, edge, edge, paper, paper]
  }, [pageEdge])

  useEffect(() => {
    prepareTexture(front, gl)
    prepareTexture(back, gl)
    prepareTexture(spine, gl)

    prepareTexture(frontBump, gl, { isColor: false })
    prepareTexture(backBump, gl, { isColor: false })
    prepareTexture(spineBump, gl, { isColor: false })

    prepareTexture(grain, gl, { repeat: true, isColor: false })
    prepareTexture(pageEdge, gl, { repeat: true })

    grain.repeat.set(7, 10)
    pageEdge.repeat.set(1, 5)

    return () => {
      pageMaterials.forEach((material) => material.dispose())
    }
  }, [
    back,
    backBump,
    front,
    frontBump,
    gl,
    grain,
    pageEdge,
    pageMaterials,
    spine,
    spineBump,
  ])

  useEffect(() => {
    const onPointerMove = (event) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1

      if (!drag.current.active) return

      const dx = event.clientX - drag.current.lastX
      const dy = event.clientY - drag.current.lastY

      drag.current.rotationY += dx * 0.007
      drag.current.rotationX = clamp(
        drag.current.rotationX + dy * 0.004,
        -0.45,
        0.45,
      )

      drag.current.lastX = event.clientX
      drag.current.lastY = event.clientY
    }

    const stopDrag = () => {
      drag.current.active = false
      document.body.style.cursor = hovered.current ? 'grab' : ''
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
      document.body.style.cursor = ''
    }
  }, [])

  const startDrag = (event) => {
    event.stopPropagation()
    drag.current.active = true
    drag.current.lastX = event.clientX
    drag.current.lastY = event.clientY
    document.body.style.cursor = 'grabbing'
  }

  useFrame((state, delta) => {
    if (!book.current || !model.current) return

    const p = progress.current
    const mouseX = pointer.current.x
    const mouseY = pointer.current.y
    const elapsed = state.clock.getElapsedTime()

    // Starts almost directly on the spine, then turns to the front cover.
    const scrollRotationY = THREE.MathUtils.lerp(1.49, -0.08, p)
    const targetRotationY =
      scrollRotationY +
      mouseX * 0.085 +
      drag.current.rotationY +
      velocity.current * 0.018

    const targetRotationX =
      -0.07 -
      mouseY * 0.055 +
      drag.current.rotationX +
      Math.sin(p * Math.PI) * 0.055

    const targetRotationZ =
      THREE.MathUtils.lerp(-0.025, 0.018, p) + mouseX * 0.012

    book.current.rotation.x = THREE.MathUtils.damp(
      book.current.rotation.x,
      targetRotationX,
      6.5,
      delta,
    )
    book.current.rotation.y = THREE.MathUtils.damp(
      book.current.rotation.y,
      targetRotationY,
      6.5,
      delta,
    )
    book.current.rotation.z = THREE.MathUtils.damp(
      book.current.rotation.z,
      targetRotationZ,
      6.5,
      delta,
    )

    const isDesktop = viewport.width >= 5.2
    const targetXBase = isDesktop
      ? THREE.MathUtils.lerp(-1.45, -1.05, p)
      : THREE.MathUtils.lerp(-0.06, 0.04, p)
    const targetX = targetXBase + mouseX * 0.035
    const targetY = Math.sin(p * Math.PI) * 0.08 - mouseY * 0.025

    book.current.position.x = THREE.MathUtils.damp(
      book.current.position.x,
      targetX,
      5.5,
      delta,
    )
    book.current.position.y = THREE.MathUtils.damp(
      book.current.position.y,
      targetY,
      5.5,
      delta,
    )

    const responsiveScale = isDesktop
      ? Math.min(0.78, viewport.width / 5.2)
      : Math.min(0.86, viewport.width / 3.8)
    const hoverScale = hovered.current ? 1.012 : 1
    const breathing = 1 + Math.sin(elapsed * 0.8) * 0.0025
    const scale = responsiveScale * hoverScale * breathing

    model.current.scale.x = THREE.MathUtils.damp(
      model.current.scale.x,
      scale,
      7,
      delta,
    )
    model.current.scale.y = THREE.MathUtils.damp(
      model.current.scale.y,
      scale,
      7,
      delta,
    )
    model.current.scale.z = THREE.MathUtils.damp(
      model.current.scale.z,
      scale,
      7,
      delta,
    )
  })

  const coverMaterial = {
    color: '#ffffff',
    roughness: 0.86,
    metalness: 0,
    clearcoat: 0.035,
    clearcoatRoughness: 0.78,
    bumpScale: 0.012,
  }

  return (
    <group
      ref={book}
      rotation={[-0.07, 1.49, -0.025]}
      onPointerDown={startDrag}
      onPointerOver={(event) => {
        event.stopPropagation()
        hovered.current = true
        if (!drag.current.active) document.body.style.cursor = 'grab'
      }}
      onPointerOut={() => {
        hovered.current = false
        if (!drag.current.active) document.body.style.cursor = ''
      }}
    >
      <group ref={model}>
        <mesh
          material={pageMaterials}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[pageWidth, pageHeight, pageDepth]} />
        </mesh>

        <mesh position={[0, 0, frontZ]} castShadow receiveShadow>
          <boxGeometry
            args={[coverWidth, coverHeight, BOOK.coverThickness]}
          />
          <meshPhysicalMaterial
            {...coverMaterial}
            bumpMap={grain}
            color="#e7cbd8"
          />
        </mesh>

        <mesh position={[0, 0, -frontZ]} castShadow receiveShadow>
          <boxGeometry
            args={[coverWidth, coverHeight, BOOK.coverThickness]}
          />
          <meshPhysicalMaterial
            {...coverMaterial}
            bumpMap={grain}
            color="#e7cbd8"
          />
        </mesh>

        <mesh
          position={[-coverWidth / 2, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[
              BOOK.coverThickness,
              coverHeight,
              BOOK.depth + BOOK.coverThickness,
            ]}
          />
          <meshPhysicalMaterial
            {...coverMaterial}
            bumpMap={grain}
            color="#e7cbd8"
          />
        </mesh>

        <mesh position={[0, 0, frontZ + BOOK.coverThickness / 2 + 0.002]}>
          <planeGeometry args={[coverWidth - 0.02, coverHeight - 0.02]} />
          <meshBasicMaterial
            map={front}
            toneMapped={false}
          />
        </mesh>

        <mesh
          position={[0, 0, -frontZ - BOOK.coverThickness / 2 - 0.002]}
          rotation={[0, Math.PI, 0]}
        >
          <planeGeometry args={[coverWidth - 0.02, coverHeight - 0.02]} />
          <meshBasicMaterial
            map={back}
            toneMapped={false}
          />
        </mesh>

        <mesh
          position={[-coverWidth / 2 - BOOK.coverThickness / 2 - 0.002, 0, 0]}
          rotation={[0, -Math.PI / 2, 0]}
        >
          <planeGeometry
            args={[
              BOOK.depth + BOOK.coverThickness - 0.01,
              coverHeight - 0.02,
            ]}
          />
          <meshBasicMaterial
            map={spine}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}

function Scene({ progress, velocity }) {
  return (
    <>
      <ambientLight intensity={0.95} />
      <hemisphereLight args={['#fff9fb', '#5a414d', 1.1]} />

      <directionalLight
        position={[4.5, 6, 5.5]}
        intensity={2.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={18}
        shadow-camera-left={-5}
        shadow-camera-right={5}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-bias={-0.00012}
      />

      <directionalLight
        position={[-4, 1, -3]}
        intensity={0.9}
        color="#e8d7ff"
      />

      <Suspense fallback={null}>
        <Book progress={progress} velocity={velocity} />
      </Suspense>

      <mesh
        position={[0, -2.18, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[16, 16]} />
        <shadowMaterial transparent opacity={0.18} />
      </mesh>
    </>
  )
}

export default function BookExperience() {
  const sectionRef = useRef(null)
  const { progress, velocity } = useBookScroll(sectionRef)

  return (
    <section ref={sectionRef} className="book-experience">
      <div className="book-experience__sticky">
        <Canvas
          shadows
          dpr={[1, 1.65]}
          camera={{
            position: [0, 0.02, 9.1],
            fov: 30,
            near: 0.1,
            far: 50,
          }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
          }}
        >
          <Scene progress={progress} velocity={velocity} />
        </Canvas>
      </div>
    </section>
  )
}
