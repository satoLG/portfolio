precision highp float;

varying vec2 vUv;

uniform float time;
uniform vec3 color;

void main() {
    vec2 uv = vUv;
    
    // Animação simples com gradiente
    float wave = sin(uv.x * 10.0 + time) * 0.1;
    vec3 finalColor = color * (0.5 + wave);
    
    gl_FragColor = vec4(finalColor, 1.0);
}