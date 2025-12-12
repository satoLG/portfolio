import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './style.css'

class App {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private loader: GLTFLoader
  private pointLight!: THREE.PointLight

  constructor() {
    // Get canvas element
    const canvas = document.getElementById('three-canvas') as HTMLCanvasElement
    if (!canvas) {
      throw new Error('Canvas element not found')
    }

    // Initialize scene
    this.scene = new THREE.Scene()

    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(
      75, // FOV
      window.innerWidth / window.innerHeight, // Aspect ratio
      0.1, // Near plane
      1000 // Far plane
    )
    this.camera.position.set(3, 3, 3)
    this.camera.lookAt(0, 0, 0)

    // Initialize renderer with shadows
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: canvas,
      antialias: true 
    })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    // Initialize orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05

    // Initialize GLTF loader
    this.loader = new GLTFLoader()

    // Setup scene
    this.setupLighting()
    this.createPlane()
    this.loadBurgerModel()

    // Handle window resize
    window.addEventListener('resize', this.onWindowResize.bind(this))

    // Start animation loop
    this.animate()
  }

  private setupLighting(): void {
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 4.0)
    this.scene.add(ambientLight)

    // Add point light with shadows
    this.pointLight = new THREE.PointLight(0xffffff, 7.5, 100)
    this.pointLight.position.set(5, 5, 5)
    this.pointLight.castShadow = true
    this.pointLight.shadow.mapSize.width = 2048
    this.pointLight.shadow.mapSize.height = 2048
    this.pointLight.shadow.camera.near = 0.1
    this.pointLight.shadow.camera.far = 25
    this.scene.add(this.pointLight)

    // Create a visible sphere for the point light
    const lightGeometry = new THREE.SphereGeometry(0.1, 16, 16)
    const lightMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 1.0
    })
    const lightSphere = new THREE.Mesh(lightGeometry, lightMaterial)

    this.pointLight.shadow.normalBias = 0.001
    this.pointLight.shadow.bias = -0.005

    this.pointLight.add(lightSphere)
  }

  private createPlane(): void {
    // Create a plane below the model
    const planeGeometry = new THREE.PlaneGeometry(10, 10)
    const planeMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc })
    const plane = new THREE.Mesh(planeGeometry, planeMaterial)
    plane.rotation.x = -Math.PI / 2
    plane.position.y = -1
    plane.receiveShadow = true
    this.scene.add(plane)
  }

  private loadBurgerModel(): void {
    this.loader.load(
      '/resources/models/burguer.glb',
      (gltf) => {
        const model = gltf.scene
        model.position.set(0, 0, 0)
        
        // Enable shadows on all meshes in the model
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
        })
        
        this.scene.add(model)
        console.log('Burger model loaded successfully!')
      },
      (progress) => {
        console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%')
      },
      (error) => {
        console.error('Error loading model:', error)
      }
    )
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

    // Update controls
    this.controls.update()

    this.renderer.render(this.scene, this.camera)
  }
}

// Initialize the app
new App()