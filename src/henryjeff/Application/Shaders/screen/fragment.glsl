uniform vec3 uColor;
uniform float uAlpha;

varying vec2 vUv;

void main()
{
    // Edge fade
    float edgeX = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 3.0);
    float edgeY = 1.0 - pow(abs(vUv.y - 0.5) * 2.0, 3.0);
    float edge = edgeX * edgeY;

    // Scanlines
    float scanlines = sin(vUv.y * 400.0) * 0.04 + 1.0;

    float alpha = edge * uAlpha * scanlines;

    gl_FragColor = vec4(uColor, alpha);
}
