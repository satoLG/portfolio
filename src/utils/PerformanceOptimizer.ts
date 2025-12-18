import * as THREE from 'three'

/**
 * Performance optimization utilities for mobile devices
 */
export class PerformanceOptimizer {
  private static isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  }

  private static isLowEndDevice(): boolean {
    // Simple heuristic for low-end devices
    return (
      navigator.hardwareConcurrency <= 2 || 
      (navigator as any).deviceMemory <= 2 ||
      this.isMobile()
    )
  }

  static getOptimalSettings(): {
    pixelRatio: number
    shadowMapSize: number
    antialiasing: boolean
    shadows: boolean
    fog: boolean
    postProcessing: boolean
  } {
    const isMobile = this.isMobile()
    const isLowEnd = this.isLowEndDevice()

    if (isLowEnd || isMobile) {
      return {
        pixelRatio: Math.min(window.devicePixelRatio, 1.5),
        shadowMapSize: 512,
        antialiasing: false,
        shadows: false,
        fog: true,
        postProcessing: false
      }
    }

    return {
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      shadowMapSize: 2048,
      antialiasing: true,
      shadows: true,
      fog: true,
      postProcessing: true
    }
  }

  static logDeviceInfo(): void {
    console.log('Device Info:', {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: (navigator as any).deviceMemory,
      isMobile: this.isMobile(),
      isLowEnd: this.isLowEndDevice(),
      screen: `${screen.width}x${screen.height}`,
      devicePixelRatio: window.devicePixelRatio
    })
  }

  static setupFrustumCulling(camera: THREE.PerspectiveCamera, scene: THREE.Scene): void {
    // Enable frustum culling for better performance
    camera.updateMatrixWorld()
    
    const frustum = new THREE.Frustum()
    const matrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    )
    frustum.setFromProjectionMatrix(matrix)

    scene.traverse((object) => {
      if (object.type === 'Mesh') {
        // This is handled automatically by Three.js, but you could add custom logic here
        object.frustumCulled = true
      }
    })
  }
}