precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float time;

varying vec2 vUv;

void main() {
    vUv = uv;
    
    // Efeito de onda no vértice
    vec3 pos = position;
    pos.z += sin(pos.x * 4.0 + time) * 0.1;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}