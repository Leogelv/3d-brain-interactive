import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Параметры физики
const WAVE_STRENGTH = 3.0
const WAVE_SPEED = 0.15
const MAGNETIC_FORCE = 0.08
const FRICTION = 0.92
const INTERACTION_RADIUS = 2.5
const SWIRL_STRENGTH = 0.3
const TURBULENCE = 0.4

interface ParticlePhysics {
  velocity: THREE.Vector3
  originalPosition: THREE.Vector3
  offset: THREE.Vector3
  wavePhase: number
  turbulence: THREE.Vector3
}

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const animationIdRef = useRef<number | null>(null)
  const brainMeshRef = useRef<THREE.Mesh | null>(null)
  const originalPositionsRef = useRef<THREE.BufferAttribute | null>(null)
  const particlePhysicsRef = useRef<Map<number, ParticlePhysics>>(new Map())
  
  // Состояние взаимодействия
  const isInteractingRef = useRef(false)
  const mousePositionRef = useRef(new THREE.Vector2())
  const previousMousePositionRef = useRef(new THREE.Vector2())
  const mouseVelocityRef = useRef(new THREE.Vector2())
  const interactionPointRef = useRef<THREE.Vector3 | null>(null)
  const waveTimeRef = useRef(0)

  // Функция для получения 3D позиции из экранных координат
  const getWorldPosition = (clientX: number, clientY: number): THREE.Vector3 | null => {
    if (!mountRef.current || !cameraRef.current || !brainMeshRef.current) return null
    
    const rect = mountRef.current.getBoundingClientRect()
    const mouse = new THREE.Vector2()
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
    
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, cameraRef.current)
    
    const intersects = raycaster.intersectObject(brainMeshRef.current)
    
    if (intersects.length > 0) {
      return intersects[0].point
    }
    
    // Если не попали в мозг, проецируем на плоскость
    const planeNormal = new THREE.Vector3(0, 0, 1)
    const planePoint = new THREE.Vector3(0, 0, 0)
    const plane = new THREE.Plane(planeNormal, -planePoint.dot(planeNormal))
    
    const intersection = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, intersection)
    
    return intersection
  }

  // Обработка начала взаимодействия
  const handleInteractionStart = (clientX: number, clientY: number) => {
    isInteractingRef.current = true
    mousePositionRef.current.set(clientX, clientY)
    previousMousePositionRef.current.set(clientX, clientY)
    
    const worldPos = getWorldPosition(clientX, clientY)
    if (worldPos) {
      interactionPointRef.current = worldPos
      waveTimeRef.current = 0
    }
  }

  // Обработка движения
  const handleInteractionMove = (clientX: number, clientY: number) => {
    if (!isInteractingRef.current) return
    
    // Вычисляем скорость движения мыши
    const deltaX = clientX - previousMousePositionRef.current.x
    const deltaY = clientY - previousMousePositionRef.current.y
    
    mouseVelocityRef.current.set(deltaX * 0.1, -deltaY * 0.1)
    previousMousePositionRef.current.set(clientX, clientY)
    mousePositionRef.current.set(clientX, clientY)
    
    const worldPos = getWorldPosition(clientX, clientY)
    if (worldPos) {
      interactionPointRef.current = worldPos
    }
  }

  // Обработка конца взаимодействия
  const handleInteractionEnd = () => {
    isInteractingRef.current = false
    mouseVelocityRef.current.set(0, 0)
  }

  const loadModel = async () => {
    if (!sceneRef.current || !cameraRef.current) return
    
    setIsLoading(true)
    setLoadingError(null)

    try {
      const loader = new GLTFLoader()
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.load('/brain_hologram.glb', resolve, undefined, reject)
      })
      
      const modelGroup = gltf.scene

      modelGroup.traverse((child: any) => {
        if (child.isMesh) {
          if (!brainMeshRef.current) {
            brainMeshRef.current = child
            originalPositionsRef.current = child.geometry.attributes.position.clone()
            
            // Инициализируем физику для каждой частицы
            for (let i = 0; i < originalPositionsRef.current!.count; i++) {
              const originalPos = new THREE.Vector3().fromBufferAttribute(originalPositionsRef.current!, i)
              particlePhysicsRef.current.set(i, {
                velocity: new THREE.Vector3(),
                originalPosition: originalPos.clone(),
                offset: new THREE.Vector3(),
                wavePhase: Math.random() * Math.PI * 2,
                turbulence: new THREE.Vector3(
                  (Math.random() - 0.5) * 0.1,
                  (Math.random() - 0.5) * 0.1,
                  (Math.random() - 0.5) * 0.1
                )
              })
            }
          }
        }
      })

      if (brainMeshRef.current) {
        const box = new THREE.Box3().setFromObject(modelGroup)
        const center = box.getCenter(new THREE.Vector3())
        modelGroup.position.sub(center)

        if (isMobile) {
          modelGroup.position.y = 0.3
        }

        sceneRef.current.add(modelGroup)
        
        const size = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const fov = cameraRef.current.fov * (Math.PI / 180)
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))
        cameraZ *= 1.8
        cameraRef.current.position.set(0, 0, cameraZ)
      } else {
        throw new Error("Не удалось найти 3D-модель в файле.")
      }
      
      setIsLoading(false)
    } catch (error) {
      console.error('Ошибка загрузки модели:', error)
      setLoadingError(`Ошибка загрузки: ${(error as Error).message}`)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const checkIsMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
      const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i
      setIsMobile(mobileRegex.test(userAgent.toLowerCase()) || window.innerWidth <= 768)
    }
    
    checkIsMobile()
    window.addEventListener('resize', checkIsMobile)

    if (!mountRef.current) return

    const currentMount = mountRef.current

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf5f5f5)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000)
    camera.position.z = 5
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.domElement.style.touchAction = 'none'
    currentMount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    scene.add(ambientLight)
    
    // События мыши
    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault()
      handleInteractionStart(event.clientX, event.clientY)
    }

    const onMouseMove = (event: MouseEvent) => {
      event.preventDefault()
      handleInteractionMove(event.clientX, event.clientY)
    }

    const onMouseUp = (event: MouseEvent) => {
      event.preventDefault()
      handleInteractionEnd()
    }

    // Touch события
    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault()
      if (event.touches.length > 0) {
        const touch = event.touches[0]
        handleInteractionStart(touch.clientX, touch.clientY)
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      if (event.touches.length > 0) {
        const touch = event.touches[0]
        handleInteractionMove(touch.clientX, touch.clientY)
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      event.preventDefault()
      handleInteractionEnd()
    }

    // Добавляем слушатели событий
    currentMount.addEventListener('mousedown', onMouseDown)
    currentMount.addEventListener('mousemove', onMouseMove)
    currentMount.addEventListener('mouseup', onMouseUp)
    currentMount.addEventListener('mouseleave', handleInteractionEnd)
    currentMount.addEventListener('touchstart', onTouchStart, { passive: false })
    currentMount.addEventListener('touchmove', onTouchMove, { passive: false })
    currentMount.addEventListener('touchend', onTouchEnd, { passive: false })

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      
      const brainGroup = scene.children.find(child => child.type === 'Group')
      const brainMesh = brainMeshRef.current

      if (brainGroup) {
        brainGroup.rotation.y += 0.003
      }

      if (brainMesh && originalPositionsRef.current && brainGroup) {
        const currentPositionAttribute = brainMesh.geometry.attributes.position
        let needsUpdate = false
        
        // Увеличиваем время волны
        if (isInteractingRef.current) {
          waveTimeRef.current += 0.1
        }
        
        // Обновляем физику каждой частицы
        for (let i = 0; i < currentPositionAttribute.count; i++) {
          const physics = particlePhysicsRef.current.get(i)
          if (!physics) continue
          
          const currentPos = new THREE.Vector3().fromBufferAttribute(currentPositionAttribute, i)
          
          // Если есть точка взаимодействия
          if (interactionPointRef.current && isInteractingRef.current) {
            // Преобразуем точку взаимодействия в локальные координаты
            const localInteractionPoint = brainGroup.worldToLocal(interactionPointRef.current.clone())
            const distance = physics.originalPosition.distanceTo(localInteractionPoint)
            
            if (distance < INTERACTION_RADIUS) {
              // Направление от точки взаимодействия
              const direction = physics.originalPosition.clone().sub(localInteractionPoint)
              if (direction.lengthSq() > 0) {
                direction.normalize()
              } else {
                direction.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
              }
              
              // Волновой эффект
              const waveOffset = Math.sin(waveTimeRef.current - distance * WAVE_SPEED) * 0.5 + 0.5
              const distanceFactor = 1 - (distance / INTERACTION_RADIUS)
              
              // Добавляем завихрение на основе скорости мыши
              const swirl = new THREE.Vector3(
                -mouseVelocityRef.current.y * SWIRL_STRENGTH,
                mouseVelocityRef.current.x * SWIRL_STRENGTH,
                0
              )
              
              // Комбинируем все силы
              const force = direction
                .multiplyScalar(WAVE_STRENGTH * distanceFactor * waveOffset)
                .add(swirl.multiplyScalar(distanceFactor))
                .add(physics.turbulence.clone().multiplyScalar(TURBULENCE * waveOffset))
              
              physics.velocity.add(force.multiplyScalar(0.1))
            }
          }
          
          // Магнитная сила возврата
          const returnForce = physics.originalPosition.clone().sub(currentPos)
          physics.velocity.add(returnForce.multiplyScalar(MAGNETIC_FORCE))
          
          // Применяем трение
          physics.velocity.multiplyScalar(FRICTION)
          
          // Обновляем позицию
          const newPos = currentPos.add(physics.velocity)
          currentPositionAttribute.setXYZ(i, newPos.x, newPos.y, newPos.z)
          
          // Добавляем небольшое дыхание даже в покое
          const breathingOffset = Math.sin(Date.now() * 0.001 + physics.wavePhase) * 0.01
          const breathingPos = newPos.clone().add(
            physics.originalPosition.clone().normalize().multiplyScalar(breathingOffset)
          )
          currentPositionAttribute.setXYZ(i, breathingPos.x, breathingPos.y, breathingPos.z)
          
          needsUpdate = true
        }
        
        if (needsUpdate) {
          currentPositionAttribute.needsUpdate = true
          brainMesh.geometry.computeBoundingSphere()
        }
      }

      renderer.render(scene, camera)
    }

    loadModel()
    animate()

    const handleResize = () => {
      if (!currentMount || !camera || !renderer) return
      
      const newWidth = currentMount.clientWidth
      const newHeight = currentMount.clientHeight
      
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      
      renderer.setSize(newWidth, newHeight)
      
      checkIsMobile()
    }

    window.addEventListener('resize', handleResize)

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current)
      }
      if (currentMount && renderer.domElement) {
        currentMount.removeChild(renderer.domElement)
      }
      currentMount.removeEventListener('mousedown', onMouseDown)
      currentMount.removeEventListener('mousemove', onMouseMove)
      currentMount.removeEventListener('mouseup', onMouseUp)
      currentMount.removeEventListener('mouseleave', handleInteractionEnd)
      currentMount.removeEventListener('touchstart', onTouchStart)
      currentMount.removeEventListener('touchmove', onTouchMove)
      currentMount.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('resize', checkIsMobile)
      renderer.dispose()
    }
  }, [isMobile])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#f5f5f5' }}>
      <div 
        ref={mountRef} 
        style={{ 
          width: '100%', 
          height: '100%',
          touchAction: 'none',
          userSelect: 'none',
          cursor: isInteractingRef.current ? 'grabbing' : 'grab'
        }} 
      />
      
      {isLoading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(245, 245, 245, 0.9)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '48px',
              height: '48px',
              border: '2px solid #3b82f6',
              borderTop: '2px solid transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px'
            }} />
            <p style={{ color: '#6b7280', fontWeight: 500 }}>Загрузка модели мозга...</p>
          </div>
        </div>
      )}
      
      {loadingError && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(245, 245, 245, 0.9)'
        }}>
          <div style={{ textAlign: 'center', maxWidth: '384px', padding: '0 24px' }}>
            <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '24px' }}>⚠️</div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#1f2937', marginBottom: '8px' }}>Ошибка загрузки</h3>
            <p style={{ color: '#6b7280', fontSize: '14px' }}>{loadingError}</p>
            <button 
              onClick={() => window.location.reload()} 
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => (e.target as HTMLElement).style.backgroundColor = '#2563eb'}
              onMouseOut={(e) => (e.target as HTMLElement).style.backgroundColor = '#3b82f6'}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      )}
      
      {!isLoading && !loadingError && (
        <div style={{
          position: 'absolute',
          bottom: isMobile ? '16px' : '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
          padding: isMobile ? '0 20px' : '0'
        }}>
          <p style={{
            color: '#6b7280',
            fontWeight: 500,
            fontSize: isMobile ? '16px' : '18px',
            letterSpacing: '0.025em',
            lineHeight: isMobile ? '1.4' : '1.2'
          }}>
            Твой путь в Brain Programming начинается здесь...
          </p>
        </div>
      )}
      
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default App 