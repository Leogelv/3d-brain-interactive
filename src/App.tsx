import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Физические константы
const MOUSE_INFLUENCE_RADIUS = 150 // радиус влияния в пикселях
const FORCE_MULTIPLIER = 0.5
const DAMPING = 0.92
const RETURN_FORCE = 0.08

interface Particle {
  originalPos: THREE.Vector3
  currentPos: THREE.Vector3
  velocity: THREE.Vector3
  screenPos: THREE.Vector2
  force: THREE.Vector3
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
  const particlesRef = useRef<Particle[]>([])
  const mouseRef = useRef({ x: 0, y: 0, isDown: false })
  const previousMouseRef = useRef({ x: 0, y: 0 })

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
      let meshFound = false

      modelGroup.traverse((child: any) => {
        if (child.isMesh && !meshFound) {
          meshFound = true
          brainMeshRef.current = child
          
          // Инициализируем частицы из вершин
          const positions = child.geometry.attributes.position
          const particles: Particle[] = []
          
          for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i)
            const y = positions.getY(i)
            const z = positions.getZ(i)
            
            particles.push({
              originalPos: new THREE.Vector3(x, y, z),
              currentPos: new THREE.Vector3(x, y, z),
              velocity: new THREE.Vector3(0, 0, 0),
              screenPos: new THREE.Vector2(0, 0),
              force: new THREE.Vector3(0, 0, 0)
            })
          }
          
          particlesRef.current = particles
        }
      })

      if (brainMeshRef.current) {
        const box = new THREE.Box3().setFromObject(modelGroup)
        const center = box.getCenter(new THREE.Vector3())
        modelGroup.position.sub(center)

        // Позиционирование для мобильных
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
    renderer.domElement.style.touchAction = 'none'
    currentMount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    scene.add(ambientLight)
    
    // Обработчики событий
    const handlePointerMove = (clientX: number, clientY: number) => {
      const rect = currentMount.getBoundingClientRect()
      previousMouseRef.current.x = mouseRef.current.x
      previousMouseRef.current.y = mouseRef.current.y
      mouseRef.current.x = clientX - rect.left
      mouseRef.current.y = clientY - rect.top
    }

    const onMouseMove = (event: MouseEvent) => {
      handlePointerMove(event.clientX, event.clientY)
    }

    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault()
      mouseRef.current.isDown = true
      handlePointerMove(event.clientX, event.clientY)
    }

    const onMouseUp = () => {
      mouseRef.current.isDown = false
    }

    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault()
      if (event.touches.length > 0) {
        const touch = event.touches[0]
        handlePointerMove(touch.clientX, touch.clientY)
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault()
      mouseRef.current.isDown = true
      if (event.touches.length > 0) {
        const touch = event.touches[0]
        handlePointerMove(touch.clientX, touch.clientY)
      }
    }

    const onTouchEnd = () => {
      mouseRef.current.isDown = false
    }

    // Добавляем обработчики
    currentMount.addEventListener('mousemove', onMouseMove)
    currentMount.addEventListener('mousedown', onMouseDown)
    currentMount.addEventListener('mouseup', onMouseUp)
    currentMount.addEventListener('mouseleave', onMouseUp)
    currentMount.addEventListener('touchmove', onTouchMove, { passive: false })
    currentMount.addEventListener('touchstart', onTouchStart, { passive: false })
    currentMount.addEventListener('touchend', onTouchEnd)

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      
      const brainGroup = scene.children.find(child => child.type === 'Group')
      const brainMesh = brainMeshRef.current

      if (brainGroup) {
        brainGroup.rotation.y += 0.003
      }

      if (brainMesh && particlesRef.current.length > 0 && cameraRef.current) {
        const positions = brainMesh.geometry.attributes.position
        const matrixWorld = brainMesh.matrixWorld
        
        // Вычисляем скорость движения мыши
        const mouseVelocity = {
          x: mouseRef.current.x - previousMouseRef.current.x,
          y: mouseRef.current.y - previousMouseRef.current.y
        }
        
        // Обновляем экранные позиции и физику частиц
        for (let i = 0; i < particlesRef.current.length; i++) {
          const particle = particlesRef.current[i]
          
          // Получаем мировые координаты частицы
          const worldPos = particle.currentPos.clone()
          worldPos.applyMatrix4(matrixWorld)
          
          // Проецируем в экранные координаты
          const screenPos = worldPos.clone()
          screenPos.project(cameraRef.current)
          
          // Конвертируем в пиксели
          particle.screenPos.x = (screenPos.x + 1) * currentMount.clientWidth / 2
          particle.screenPos.y = (-screenPos.y + 1) * currentMount.clientHeight / 2
          
          // Вычисляем расстояние до курсора
          const dx = particle.screenPos.x - mouseRef.current.x
          const dy = particle.screenPos.y - mouseRef.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          
          // Применяем силу если курсор близко
          if (distance < MOUSE_INFLUENCE_RADIUS) {
            const influence = 1 - (distance / MOUSE_INFLUENCE_RADIUS)
            const force = influence * influence * FORCE_MULTIPLIER
            
            if (mouseRef.current.isDown) {
              // При нажатии - отталкиваем частицы
              const angle = Math.atan2(dy, dx)
              particle.force.x += Math.cos(angle) * force * 2
              particle.force.y += Math.sin(angle) * force * 2
              particle.force.z += (Math.random() - 0.5) * force
              
              // Добавляем влияние скорости мыши
              particle.force.x += mouseVelocity.x * influence * 0.1
              particle.force.y += mouseVelocity.y * influence * 0.1
            } else {
              // При наведении - легкое волнение
              particle.force.x += (Math.random() - 0.5) * force * 0.3
              particle.force.y += (Math.random() - 0.5) * force * 0.3
              particle.force.z += (Math.random() - 0.5) * force * 0.3
            }
          }
          
          // Применяем силу возврата к исходной позиции
          const returnForce = particle.originalPos.clone().sub(particle.currentPos)
          returnForce.multiplyScalar(RETURN_FORCE)
          particle.force.add(returnForce)
          
          // Обновляем скорость и позицию
          particle.velocity.add(particle.force)
          particle.velocity.multiplyScalar(DAMPING)
          particle.currentPos.add(particle.velocity)
          
          // Сбрасываем силу
          particle.force.set(0, 0, 0)
          
          // Обновляем позицию в геометрии
          positions.setXYZ(i, particle.currentPos.x, particle.currentPos.y, particle.currentPos.z)
        }
        
        positions.needsUpdate = true
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
      currentMount.removeEventListener('mousemove', onMouseMove)
      currentMount.removeEventListener('mousedown', onMouseDown)
      currentMount.removeEventListener('mouseup', onMouseUp)
      currentMount.removeEventListener('mouseleave', onMouseUp)
      currentMount.removeEventListener('touchmove', onTouchMove)
      currentMount.removeEventListener('touchstart', onTouchStart)
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
          cursor: 'crosshair'
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
          padding: isMobile ? '0 20px' : '0',
          pointerEvents: 'none'
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