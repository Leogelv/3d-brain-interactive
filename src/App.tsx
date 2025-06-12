import React, { useRef, useEffect, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const PUSH_STRENGTH = 0.8
const LERP_FACTOR = 0.08
const INTERACTION_RADIUS_SQ = 1.5
const DECAY_FACTOR = 0.95

const App: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)

  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const animationIdRef = useRef<number | null>(null)
  const brainMeshRef = useRef<THREE.Mesh | null>(null)
  const originalPositionsRef = useRef<THREE.BufferAttribute | null>(null)
  const targetOffsetsRef = useRef(new Map<number, THREE.Vector3>())

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
          // Находим первую же модель и работаем с ней
          if (!brainMeshRef.current) {
            brainMeshRef.current = child
            // Клонируем исходные позиции вершин
            originalPositionsRef.current = child.geometry.attributes.position.clone()
          }
        }
      })

      if (brainMeshRef.current) {
        const box = new THREE.Box3().setFromObject(modelGroup)
        const center = box.getCenter(new THREE.Vector3())
        modelGroup.position.sub(center)

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
    currentMount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    scene.add(ambientLight)
    
    const raycaster = new THREE.Raycaster()
    
    const onMouseDown = (event: MouseEvent) => {
      if (!currentMount || !cameraRef.current || !brainMeshRef.current || !originalPositionsRef.current) return
      
      const rect = currentMount.getBoundingClientRect()
      const mouse = new THREE.Vector2()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      
      raycaster.setFromCamera(mouse, cameraRef.current)

      const intersects = raycaster.intersectObject(brainMeshRef.current)

      if (intersects.length > 0) {
        const intersection = intersects[0]
        const face = intersection.face

        // Если у геометрии нет полигонов (например, это облако точек), выходим
        if (!face) return
        
        // Используем первую вершину полигона, на который кликнули, как центр эффекта
        const hitIndex = face.a
        
        if (hitIndex !== undefined) {
          const hitPointOriginalPos = new THREE.Vector3().fromBufferAttribute(originalPositionsRef.current, hitIndex)
          
          for (let i = 0; i < originalPositionsRef.current.count; i++) {
            const currentOriginalPos = new THREE.Vector3().fromBufferAttribute(originalPositionsRef.current, i)
            const distSq = currentOriginalPos.distanceToSquared(hitPointOriginalPos)
            
            if (distSq < INTERACTION_RADIUS_SQ) {
              let direction = currentOriginalPos.clone().sub(hitPointOriginalPos)
              if (direction.lengthSq() === 0) {
                direction.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5))
              }
              direction.normalize()
              
              const strength = PUSH_STRENGTH * (1 - Math.sqrt(distSq) / Math.sqrt(INTERACTION_RADIUS_SQ))
              const offset = direction.multiplyScalar(strength)
              
              const existingOffset = targetOffsetsRef.current.get(i) || new THREE.Vector3()
              targetOffsetsRef.current.set(i, existingOffset.add(offset))
            }
          }
        }
      }
    }
    currentMount.addEventListener('mousedown', onMouseDown)

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
        
        for (let i = 0; i < currentPositionAttribute.count; i++) {
          const currentVec = new THREE.Vector3().fromBufferAttribute(currentPositionAttribute, i)
          const originalVec = new THREE.Vector3().fromBufferAttribute(originalPositionsRef.current, i)
          
          let targetPos = originalVec.clone()
          const offset = targetOffsetsRef.current.get(i)
          
          if (offset) {
            targetPos.add(offset)
            
            currentVec.lerp(targetPos, LERP_FACTOR)
            
            offset.multiplyScalar(DECAY_FACTOR)
            if (offset.lengthSq() < 0.001) {
              targetOffsetsRef.current.delete(i)
            }
            
            needsUpdate = true
          } else {
            currentVec.lerp(originalVec, LERP_FACTOR)
            if (currentVec.distanceToSquared(originalVec) > 0.001) {
              needsUpdate = true
            }
          }
          
          currentPositionAttribute.setXYZ(i, currentVec.x, currentVec.y, currentVec.z)
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
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
    }
  }, [])

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#f5f5f5' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      
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
          bottom: '32px',
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center'
        }}>
          <p style={{
            color: '#6b7280',
            fontWeight: 500,
            fontSize: '18px',
            letterSpacing: '0.025em'
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