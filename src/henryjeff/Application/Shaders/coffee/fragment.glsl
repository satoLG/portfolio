uniform vec3 uColor;

varying vec2 vUv;

void main()
{
    // Outside fade
    float outerFade = (1.0 - vUv.y) * 0.5;

    // Inside edge fade
    float innerFade = 1.0 - pow(abs(vUv.x - 0.5) * 3.0, 2.0);

    float alpha = outerFade * innerFade;

    gl_FragColor = vec4(uColor, alpha);
}
