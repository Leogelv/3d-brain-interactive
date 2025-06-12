import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const PUSH_STRENGTH = 2.5
const MAGNETIC_FORCE = 0.15
const FRICTION = 0.98
const INTERACTION_RADIUS = 2.0
const DEPTH_FACTOR = 0.8 // Усиливает эффект для частиц ближе к камере

interface ParticlePhysics {
  velocity: THREE.Vector3
  force: THREE.Vector3
  isAffected: boolean
  originalPosition: THREE.Vector3
  depth: number // расстояние от камеры
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
  const isInteractingRef = useRef(false)
  const lastInteractionPointRef = useRef<THREE.Vector3 | null>(null)

  // Функция для вычисления глубины частицы относительно камеры
  const calculateParticleDepth = (position: THREE.Vector3, camera: THREE.Camera): number => {
    const worldPosition = position.clone()
    const cameraPosition = camera.position
    return worldPosition.distanceTo(cameraPosition)
  }

  // Функция для обработки взаимодействия (мышь или touch)
  const handleInteraction = (clientX: number, clientY: number, isStart: boolean = true) => {
    if (!mountRef.current || !cameraRef.current || !brainMeshRef.current || !originalPositionsRef.current || !rendererRef.current) {
      return
    }
    
    // Проверяем что модель загружена
    if (isLoading || loadingError) {
      return
    }
    
    // Получаем координаты относительно canvas элемента
    const canvas = rendererRef.current.domElement
    const rect = canvas.getBoundingClientRect()
    const mouse = new THREE.Vector2()
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
    
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, cameraRef.current)

    const intersects = raycaster.intersectObject(brainMeshRef.current)

    if (intersects.length > 0 && isStart) {
      isInteractingRef.current = true
      const intersection = intersects[0]
      const hitWorldPosition = intersection.point
      lastInteractionPointRef.current = hitWorldPosition.clone()

      // Преобразуем мировую позицию в локальную позицию модели
      const brainGroup = brainMeshRef.current.parent
      if (brainGroup) {
        const localHitPosition = brainGroup.worldToLocal(hitWorldPosition.clone())
        
        // Применяем физику ко всем частицам
        for (let i = 0; i < originalPositionsRef.current.count; i++) {
          const originalPos = new THREE.Vector3().fromBufferAttribute(originalPositionsRef.current, i)
          const distance = originalPos.distanceTo(localHitPosition)
          
          if (distance < INTERACTION_RADIUS) {
            // Вычисляем глубину частицы
            const worldParticlePos = brainGroup.localToWorld(originalPos.clone())
            const depth = calculateParticleDepth(worldParticlePos, cameraRef.current)
            
            // Направление от точки удара к частице
            let direction = originalPos.clone().sub(localHitPosition)
            if (direction.lengthSq() === 0) {
              direction.set(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
              )
            }
            direction.normalize()
            
            // Сила зависит от расстояния и глубины
            const distanceFactor = 1 - (distance / INTERACTION_RADIUS)
            const depthFactor = Math.max(0.3, 1 - (depth * DEPTH_FACTOR / 10))
            const finalStrength = PUSH_STRENGTH * distanceFactor * depthFactor
            
            // Добавляем случайность для более органичного эффекта
            const randomness = new THREE.Vector3(
              (Math.random() - 0.5) * 0.3,
              (Math.random() - 0.5) * 0.3,
              (Math.random() - 0.5) * 0.3
            )
            direction.add(randomness).normalize()
            
            const force = direction.multiplyScalar(finalStrength)
            
            // Получаем или создаем физику для частицы
            let physics = particlePhysicsRef.current.get(i)
            if (!physics) {
              physics = {
                velocity: new THREE.Vector3(),
                force: new THREE.Vector3(),
                isAffected: false,
                originalPosition: originalPos.clone(),
                depth: depth
              }
              particlePhysicsRef.current.set(i, physics)
            }
            
            // Применяем силу
            physics.force.add(force)
            physics.isAffected = true
            physics.depth = depth
          }
        }
      }
    }
  }

  const handleInteractionEnd = () => {
    isInteractingRef.current = false
    lastInteractionPointRef.current = null
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
          }
        }
      })

      if (brainMeshRef.current) {
        const box = new THREE.Box3().setFromObject(modelGroup)
        const center = box.getCenter(new THREE.Vector3())
        modelGroup.position.sub(center)

        // Позиционирование мозга для мобильных устройств
        if (isMobile) {
          modelGroup.position.y = 0.3 // Чуть выше центра
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
    // Определение мобильного устройства
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
    renderer.domElement.style.touchAction = 'none' // Предотвращаем стандартные touch действия
    currentMount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    scene.add(ambientLight)
    
    // Обработчики событий мыши
    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault()
      handleInteraction(event.clientX, event.clientY, true)
    }

    const onMouseUp = (event: MouseEvent) => {
      event.preventDefault()
      handleInteractionEnd()
    }

    // Обработчики touch событий
    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault()
      if (event.touches.length > 0) {
        const touch = event.touches[0]
        handleInteraction(touch.clientX, touch.clientY, true)
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      event.preventDefault()
      handleInteractionEnd()
    }

    // Добавляем события на canvas сразу
    const canvas = renderer.domElement
    canvas.addEventListener('mousedown', onMouseDown)
    canvas.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd, { passive: false })

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      
      const brainGroup = scene.children.find(child => child.type === 'Group')
      const brainMesh = brainMeshRef.current

      if (brainGroup) {
        brainGroup.rotation.y += 0.003
      }

      if (brainMesh && originalPositionsRef.current) {
        const currentPositionAttribute = brainMesh.geometry.attributes.position
        let needsUpdate = false
        
        // Физическое обновление для каждой частицы
        for (let i = 0; i < currentPositionAttribute.count; i++) {
          const physics = particlePhysicsRef.current.get(i)
          
          if (physics) {
            const currentPos = new THREE.Vector3().fromBufferAttribute(currentPositionAttribute, i)
            
            // Применяем силы к скорости
            physics.velocity.add(physics.force)
            
            // Магнитная сила обратно к исходной позиции (когда не взаимодействуем)
            if (!isInteractingRef.current && physics.isAffected) {
              const returnForce = physics.originalPosition.clone().sub(currentPos)
              returnForce.multiplyScalar(MAGNETIC_FORCE)
              physics.velocity.add(returnForce)
            }
            
            // Применяем трение
            physics.velocity.multiplyScalar(FRICTION)
            
            // Обновляем позицию
            const newPos = currentPos.clone().add(physics.velocity)
            currentPositionAttribute.setXYZ(i, newPos.x, newPos.y, newPos.z)
            
            // Сбрасываем силу
            physics.force.set(0, 0, 0)
            
            // Проверяем, вернулась ли частица близко к исходной позиции
            if (!isInteractingRef.current && 
                newPos.distanceTo(physics.originalPosition) < 0.01 && 
                physics.velocity.length() < 0.001) {
              // Возвращаем точно в исходную позицию
              currentPositionAttribute.setXYZ(i, 
                physics.originalPosition.x, 
                physics.originalPosition.y, 
                physics.originalPosition.z
              )
              physics.isAffected = false
              physics.velocity.set(0, 0, 0)
            }
            
            needsUpdate = true
          }
        }
        
        if (needsUpdate) {
          currentPositionAttribute.needsUpdate = true
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
      // Удаляем события с canvas
      const canvas = renderer.domElement
      canvas.removeEventListener('mousedown', onMouseDown)
      canvas.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchend', onTouchEnd)
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
          touchAction: 'none', // Предотвращаем стандартные touch действия
          userSelect: 'none' // Предотвращаем выделение текста
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