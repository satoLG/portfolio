import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { PMREMGenerator } from 'three/src/extras/PMREMGenerator.js'
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js'
import { WebGPURenderer } from 'three/webgpu'
import { PerformanceOptimizer } from './utils/PerformanceOptimizer.js'

// Importação dos shaders GLSL
import fragmentShader from '../resources/shaders/fragment.glsl'
import customVertexShader from '../resources/shaders/customVertex.glsl'

import './style.css'

class App {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer | WebGPURenderer
  private controls!: OrbitControls
  private loader!: GLTFLoader
  private pointLight!: THREE.PointLight
  private shaderMaterial!: THREE.ShaderMaterial | THREE.MeshStandardMaterial | any // Material com shader customizado (any for NodeMaterial)
  private isWebGPU: boolean = false
  private performanceSettings: any

  constructor() {
    // Get canvas element
    const canvas = document.getElementById('three-canvas') as HTMLCanvasElement
    if (!canvas) {
      throw new Error('Canvas element not found')
    }

    // Initialize scene
    this.scene = new THREE.Scene()

    this.scene.fog = new THREE.FogExp2('#b2b7be', 0.002)

    // Get optimal performance settings for this device
    this.performanceSettings = PerformanceOptimizer.getOptimalSettings()
    PerformanceOptimizer.logDeviceInfo()

    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(
      75, // FOV
      window.innerWidth / window.innerHeight, // Aspect ratio
      0.1, // Near plane
      1000 // Far plane
    )
    this.camera.position.set(3, 3, 3)
    this.camera.lookAt(0, 0, 0)

    // Initialize renderer and scene (async)
    this.init(canvas)

  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    // Initialize renderer with WebGPU support and fallback
    await this.initializeRenderer(canvas)

    // Initialize orbit controls (after renderer is initialized)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05

    // Initialize GLTF loader
    this.loader = new GLTFLoader()

    // Setup scene
    this.loadEnvironmentMap()
    this.setupLighting()
    this.createPlane()
    this.createShaderCube() // Novo cubo com shader customizado
    this.loadBurgerModel()

    // Handle window resize
    window.addEventListener('resize', this.onWindowResize.bind(this))

    // Start animation loop
    this.animate()
  }

  private async initializeRenderer(canvas: HTMLCanvasElement): Promise<void> {
    // Check if WebGPU is supported
    if (WebGPU.isAvailable()) {
      console.log('WebGPU is available! Initializing WebGPU renderer...')
      
      try {
        this.renderer = new WebGPURenderer({ 
          canvas: canvas,
          antialias: this.performanceSettings.antialiasing,
          forceWebGL: false
        })
        
        // Initialize WebGPU
        await this.renderer.init()
        this.isWebGPU = true
        console.log('WebGPU renderer initialized successfully!')
        
        // Add performance info to the page
        this.addPerformanceInfo('WebGPU')
        
      } catch (error) {
        console.warn('Failed to initialize WebGPU renderer, falling back to WebGL:', error)
        this.initWebGLRenderer(canvas)
      }
    } else {
      console.log('WebGPU not available, using WebGL renderer')
      this.initWebGLRenderer(canvas)
    }

    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(this.performanceSettings.pixelRatio) // Use optimized pixel ratio
    
    // Enable shadows based on performance settings
    if (this.performanceSettings.shadows) {
      if (this.isWebGPU) {
        // For WebGPU, try enabling shadow mapping like WebGL
        console.log('Enabling WebGPU shadows explicitly')
        try {
          // WebGPU renderer might also need shadowMap enabled
          (this.renderer as any).shadowMap = (this.renderer as any).shadowMap || {}
          ;(this.renderer as any).shadowMap.enabled = true
          ;(this.renderer as any).shadowMap.type = THREE.PCFSoftShadowMap
          console.log('WebGPU shadowMap configured:', (this.renderer as any).shadowMap)
        } catch (error) {
          console.warn('WebGPU shadow configuration failed:', error)
        }
      } else {
        // For WebGL, explicitly enable shadow mapping
        (this.renderer as THREE.WebGLRenderer).shadowMap.enabled = true;
        (this.renderer as THREE.WebGLRenderer).shadowMap.type = THREE.PCFSoftShadowMap
        console.log('WebGL shadows enabled')
      }
    }
  }

  private initWebGLRenderer(canvas: HTMLCanvasElement): void {
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: canvas,
      antialias: this.performanceSettings.antialiasing,
      powerPreference: 'high-performance' // Better for mobile performance
    })
    this.isWebGPU = false
    this.addPerformanceInfo('WebGL (Fallback)')
  }

  private addPerformanceInfo(rendererType: string): void {
    // Add a small indicator to show which renderer is being used
    const info = document.createElement('div')
    info.style.position = 'fixed'
    info.style.top = '10px'
    info.style.left = '10px'
    
    // Color coding: Green for WebGPU, Orange for WebGL fallback, Light green for optimized
    if (rendererType === 'WebGPU') {
      info.style.background = 'rgba(0, 255, 0, 0.9)' // Bright green for WebGPU
    } else if (rendererType.includes('Fallback')) {
      info.style.background = 'rgba(255, 165, 0, 0.8)' // Orange for fallback
    } else {
      info.style.background = 'rgba(0, 200, 100, 0.8)' // Light green for optimized
    }
    
    info.style.color = 'white'
    info.style.padding = '8px 12px'
    info.style.borderRadius = '4px'
    info.style.fontSize = '12px'
    info.style.fontFamily = 'monospace'
    info.style.zIndex = '1000'
    info.textContent = `Renderer: ${rendererType}`
    document.body.appendChild(info)

    // Remove after 3 seconds
    setTimeout(() => {
      if (info.parentNode) {
        info.parentNode.removeChild(info)
      }
    }, 3000)
  }

  private setupLighting(): void {
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 4.0)
    this.scene.add(ambientLight)

    // Add point light with performance-optimized shadows
    this.pointLight = new THREE.PointLight(0xffffff, 7.5, 100)
    this.pointLight.position.set(5, 5, 5)
    
    // Enable shadows if performance allows
    if (this.performanceSettings.shadows) {
      this.pointLight.castShadow = true
      
      if (this.isWebGPU) {
        // WebGPU shadow configuration - may need different settings
        this.pointLight.shadow.mapSize.width = this.performanceSettings.shadowMapSize
        this.pointLight.shadow.mapSize.height = this.performanceSettings.shadowMapSize
        this.pointLight.shadow.camera.near = 0.1
        this.pointLight.shadow.camera.far = 25
        // WebGPU may benefit from different shadow bias settings
        this.pointLight.shadow.normalBias = 0.002
        this.pointLight.shadow.bias = -0.001
        console.log('WebGPU point light shadows configured')
      } else {
        // WebGL shadow configuration
        this.pointLight.shadow.mapSize.width = this.performanceSettings.shadowMapSize
        this.pointLight.shadow.mapSize.height = this.performanceSettings.shadowMapSize
        this.pointLight.shadow.camera.near = 0.1
        this.pointLight.shadow.camera.far = 25
        this.pointLight.shadow.normalBias = 0.001
        this.pointLight.shadow.bias = -0.005
      }
    }
    
    this.scene.add(this.pointLight)

    // Create a visible sphere for the point light
    const lightGeometry = new THREE.SphereGeometry(0.1, 16, 16)
    const lightMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1.0
    })
    const lightSphere = new THREE.Mesh(lightGeometry, lightMaterial)

    this.pointLight.add(lightSphere)
  }

  private createPlane(): void {
    // Create a plane below the model
    const planeGeometry = new THREE.CircleGeometry(4000, 64)
    const planeMaterial = new THREE.MeshPhysicalMaterial({
      color: 'darkblue',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      // metalness: 0.3,
      // roughness: 0.1,
      // envMapIntensity: 0
    })
    const plane = new THREE.Mesh(planeGeometry, planeMaterial)
    plane.rotation.x = -Math.PI / 2
    plane.position.y = -1
    plane.receiveShadow = true
    plane.castShadow = true
    console.log('Plane created - receiveShadow:', plane.receiveShadow, 'material:', plane.material.type)
    this.scene.add(plane)
  }

  private createShaderCube(): void {
    // Criar geometria do cubo
    const geometry = new THREE.BoxGeometry(1, 1, 1)

    console.log('Creating shader cube - WebGPU:', this.isWebGPU)

    // Use different material approach based on renderer type
    if (this.isWebGPU) {
      // For WebGPU, use an animated material that achieves similar visual effect
      console.log('Using animated MeshStandardMaterial for WebGPU')
      this.shaderMaterial = new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        metalness: 0.1,
        roughness: 0.8,
        emissive: 0xff3333,
        emissiveIntensity: 0.3
      })
      
    } else {
      // For WebGL, use traditional GLSL shaders
      console.log('Using GLSL RawShaderMaterial for WebGL')
      try {
        this.shaderMaterial = new THREE.RawShaderMaterial({
          vertexShader: customVertexShader,
          fragmentShader: fragmentShader,
          uniforms: {
            time: { value: 0.0 },
            color: { value: new THREE.Color(0xff6b6b) }
          },
          side: THREE.DoubleSide
        })
      } catch (error) {
        console.warn('Raw shader material failed, using standard material:', error)
        // Fallback to standard material if shaders fail
        this.shaderMaterial = new THREE.MeshStandardMaterial({
          color: 0xff6b6b,
          emissive: 0x330000,
          emissiveIntensity: 0.2
        })
      }
    }

    // Criar mesh e adicionar à cena
    const cube = new THREE.Mesh(geometry, this.shaderMaterial)
    cube.position.set(2, 1, 0) // Posicionar ao lado do burger
    cube.castShadow = true
    cube.receiveShadow = true
    
    this.scene.add(cube)
  }

  private loadBurgerModel(): void {
    this.loader.load(
      '/resources/models/burguer.glb',
      (gltf) => {
        const model = gltf.scene
        model.position.set(0, 0, 0)
        
        // Enable shadows on all meshes in the model
        let meshCount = 0
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
            meshCount++
          }
        })
        
        this.scene.add(model)
        console.log(`Burger model loaded successfully! ${meshCount} meshes configured for shadows, WebGPU: ${this.isWebGPU}`)
      },
      (progress) => {
        console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%')
      },
      (error) => {
        console.error('Error loading model:', error)
      }
    )
  }

  private loadEnvironmentMap(): void {
    const loader = new THREE.CubeTextureLoader()
    const texture = loader.load([
      '/resources/environmentMaps/0/px.png',
      '/resources/environmentMaps/0/nx.png',
      '/resources/environmentMaps/0/py.png',
      '/resources/environmentMaps/0/ny.png',
      '/resources/environmentMaps/0/pz.png',
      '/resources/environmentMaps/0/nz.png',
    ])
    this.scene.background = texture
    this.scene.backgroundBlurriness = 0
    this.scene.environmentIntensity = 1

    // PMREMGenerator works with both WebGL and WebGPU renderers
    const pmremGenerator = new PMREMGenerator(this.renderer as any);
    pmremGenerator.compileEquirectangularShader();
    

    const HDRITextureLoader = new HDRLoader()
    HDRITextureLoader.load('resources/environmentMaps/cloudy_puresky_4k.hdr', (hdrEquirect) => {
      const envMap = pmremGenerator.fromEquirectangular(hdrEquirect).texture
      pmremGenerator.dispose();
      envMap.mapping = THREE.EquirectangularReflectionMapping
      this.scene.environment = envMap
    })

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // Recommended tone mapping
    this.renderer.toneMappingExposure = 2; // Adjust exposure as needed
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private animate(): void {
    requestAnimationFrame(this.animate.bind(this))

    // Rotate point light around the object
    const time = Date.now() * 0.001
    const radius = 2
    this.pointLight.position.x = Math.cos(time) * radius
    this.pointLight.position.z = Math.sin(time) * radius
    this.pointLight.position.y = 2

    // Update material animation based on renderer type
    if (this.shaderMaterial) {
      if (this.isWebGPU && this.shaderMaterial instanceof THREE.MeshStandardMaterial) {
        // For WebGPU, animate the material properties to simulate shader effects
        const material = this.shaderMaterial
        const wave = Math.sin(time * 3) * 0.5 + 0.5
        material.emissiveIntensity = 0.2 + wave * 0.4
        // Animate color similar to the wave effect in your fragment shader
        const colorWave = Math.sin(time * 2) * 0.3 + 0.7
        material.color.setRGB(colorWave, colorWave * 0.4, colorWave * 0.4)
      } else if (!this.isWebGPU && 'uniforms' in this.shaderMaterial) {
        // For WebGL, update shader uniforms
        const material = this.shaderMaterial as THREE.RawShaderMaterial
        if (material.uniforms && material.uniforms.time) {
          material.uniforms.time.value = time
        }
      }
    }

    // Update controls
    this.controls.update()

    this.renderer.render(this.scene, this.camera)
  }
}

// Initialize the app
try {
  new App()
  console.log('App initialization started...')
} catch (error) {
  console.error('Failed to initialize app:', error)
  // You could add fallback UI here
  document.body.innerHTML = '<div style="color: red; text-align: center; margin-top: 50px;">Failed to initialize WebGL/WebGPU renderer. Please check browser compatibility.</div>'
}