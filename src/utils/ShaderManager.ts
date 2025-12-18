// Exemplo de como usar os shaders em outros componentes
import vertexShader from '../resources/shaders/vertex.glsl'
import fragmentShader from '../resources/shaders/fragment.glsl'
import customVertexShader from '../resources/shaders/customVertex.glsl'
import * as THREE from 'three'

export class ShaderManager {
  static createAnimatedMaterial(color: THREE.Color = new THREE.Color(0xff6b6b)): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: customVertexShader,
      fragmentShader: fragmentShader,
      uniforms: {
        time: { value: 0.0 },
        color: { value: color }
      },
      side: THREE.DoubleSide
    })
  }

  static createBasicMaterial(color: THREE.Color = new THREE.Color(0x00ff00)): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: {
        time: { value: 0.0 },
        color: { value: color }
      }
    })
  }

  static updateMaterial(material: THREE.ShaderMaterial, time: number): void {
    if (material.uniforms.time) {
      material.uniforms.time.value = time
    }
  }
}