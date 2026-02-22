export const surfaceVertex = 
/*glsl*/`
    #include <ocean>

    varying vec2 _worldPos;
    varying vec2 _uv;
    varying float _elevation;

    void main()
    {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        
        float elevation = 0.0;
        
        _worldPos = worldPos.xz;
        _uv = _worldPos * _NormalMapScale;
        _elevation = elevation;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const surfaceFragment = 
/*glsl*/`
    #include <ocean>

    uniform vec2 _OceanHalfSize;
    uniform float _EdgeFadeDistance;
    
    uniform vec2 _FoamIslandCenter;
    uniform float _FoamIslandRadius;
    uniform float _FoamWidth;
    uniform float _FoamIntensity;

    // Foam irregularity
    uniform float _FoamEdgeNoiseAmt;
    uniform float _FoamEdgeNoiseFreq;
    uniform float _FoamAnimSpeed;
    
    uniform float _Ripples[15];  // MAX_RIPPLES * 3 (x, z, time)
    uniform int _RippleCount;
    uniform float _RippleSpeed;
    uniform float _RippleLifetime;
    uniform float _RippleAmplitude;
    uniform float _RippleWidth;

    varying vec2 _worldPos;
    varying vec2 _uv;
    varying float _elevation;

    float calcEdgeFade(vec2 pos) {
        float distFromNearEdge = -pos.y;
        
        return smoothstep(0.0, _EdgeFadeDistance, distFromNearEdge);
    }
    
    // --- Hash-based noise (no texture) for foam ---
    float foamHash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float foamNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // smoothstep
        float a = foamHash(i);
        float b = foamHash(i + vec2(1.0, 0.0));
        float c = foamHash(i + vec2(0.0, 1.0));
        float d = foamHash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    // 3-octave FBM
    float foamFbm(vec2 p) {
        float v = 0.0;
        v += 0.50 * foamNoise(p); p *= 2.01;
        v += 0.30 * foamNoise(p); p *= 2.03;
        v += 0.20 * foamNoise(p);
        return v;
    }

    float calcFoam(vec2 pos) {
        vec2 delta = pos - _FoamIslandCenter;
        float dist = length(delta);

        float t = _Time * _FoamAnimSpeed;

        // ---- Irregular wavy edge ----
        // Use normalised direction (continuous around the circle, no atan seam)
        vec2 dir = delta / max(dist, 0.0001);
        float cx = dir.x;  // cos(angle)
        float sy = dir.y;  // sin(angle)

        // Multi-frequency wobble using seamless sin/cos pairs
        float angNoise = sin(cx * _FoamEdgeNoiseFreq + sy * _FoamEdgeNoiseFreq * 0.7 + t * 1.3) * 0.4
                       + sin(sy * _FoamEdgeNoiseFreq * 2.3 - cx * _FoamEdgeNoiseFreq * 1.1 - t * 0.9) * 0.3
                       + sin(cx * _FoamEdgeNoiseFreq * 4.7 + sy * _FoamEdgeNoiseFreq * 3.2 + t * 1.7) * 0.2;
        // Add spatial noise for extra organic feel
        angNoise += (foamFbm(pos * 5.0 + t * 0.3) - 0.5) * 1.0;
        float edgeDisplace = angNoise * _FoamEdgeNoiseAmt;

        float innerEdge = _FoamIslandRadius + edgeDisplace;
        float outerEdge = innerEdge + _FoamWidth;

        // Main ring band
        float foam = smoothstep(innerEdge - 0.1, innerEdge, dist)
                   * smoothstep(outerEdge + 0.1, outerEdge, dist);

        // Subtle brightness variation along the ring (seamless)
        float brightVar = 0.85 + 0.15 * sin(cx * 3.0 + sy * 2.0 + t * 0.7);
        foam *= brightVar;

        return foam * _FoamIntensity;
    }
    
    // Calculate ripple normal perturbation and subtle foam
    vec3 calcRippleNormal(vec2 worldPos, out float rippleFoam) {
        vec3 normalOffset = vec3(0.0);
        rippleFoam = 0.0;
        
        for (int i = 0; i < 3; i++) {  // MAX_RIPPLES - reduced for mobile performance
            if (i >= _RippleCount) break;
            
            float rippleX = _Ripples[i * 3 + 0];
            float rippleZ = _Ripples[i * 3 + 1];
            float rippleTime = _Ripples[i * 3 + 2];
            
            if (rippleTime < 0.0) continue;  // Inactive ripple
            
            vec2 rippleCenter = vec2(rippleX, rippleZ);
            vec2 toCenter = worldPos - rippleCenter;
            float dist = length(toCenter);
            float radius = rippleTime * _RippleSpeed;
            
            // Wave pattern - circular rings
            float wave = abs(dist - radius);
            float mask = smoothstep(_RippleWidth, 0.0, wave);
            float fade = 1.0 - (rippleTime / _RippleLifetime);
            fade = fade * fade;
            
            // Create radial normal distortion (like circular water ripple)
            vec2 direction = normalize(toCenter);
            float angle = (dist - radius) * 15.0;  // Wave frequency
            float waveHeight = sin(angle) * mask * fade;
            
            // Stronger normal perturbation for visibility
            normalOffset.x += direction.x * waveHeight * 5.0;
            normalOffset.z += direction.y * waveHeight * 5.0;
            
            // Very subtle foam on wave crests (not pure white)
            float crest = smoothstep(-0.3, 0.3, sin(angle)) * mask * fade;
            rippleFoam += crest * 0.15;  // Very subtle, just 15% foam
        }
        
        rippleFoam = clamp(rippleFoam, 0.0, 1.0);
        return normalOffset;
    }

    void main()
    {
        float edgeFade = calcEdgeFade(_worldPos);
        if (edgeFade <= 0.0) discard;
        
        float foam = calcFoam(_worldPos);
        
        // Add ripple normal perturbation with subtle foam
        float rippleFoam = 0.0;
        vec3 rippleNormalOffset = calcRippleNormal(_worldPos, rippleFoam);
        foam = clamp(foam + rippleFoam, 0.0, 1.0);

        vec3 viewVec = vec3(_worldPos.x, _elevation, _worldPos.y) - cameraPosition;
        float viewLen = length(viewVec);
        vec3 viewDir = viewVec / viewLen;

        vec3 normal = texture2D(_NormalMap1, _uv + _WaveVelocity1 * _Time).xyz * 2.0 - 1.0;
        normal += texture2D(_NormalMap2, _uv + _WaveVelocity2 * _Time).xyz * 2.0 - 1.0;
        normal *= _NormalMapStrength;
        normal += vec3(0.0, 0.0, 1.0);
        normal += rippleNormalOffset;  // Add ripple normal perturbation
        normal = normalize(normal).xzy;

        sampleDither(gl_FragCoord.xy);

        if (cameraPosition.y > _elevation)
        {
            float reflectivity = pow2(1.0 - max(0.0, dot(-viewDir, normal)));

            vec3 reflection = sampleSkybox(reflect(viewDir, normal));
            vec3 surface = reflectivity * reflection;

            float fog = clamp(viewLen / FOG_DISTANCE + dither, 0.0, 1.0);
            surface = mix(surface, sampleFog(viewDir), fog);
            
            vec3 foamColor = vec3(1.0, 1.0, 1.0);
            surface = mix(surface, foamColor, foam);

            gl_FragColor = vec4(surface, max(max(reflectivity, fog), foam) * edgeFade);
            return;
        }

        float originY = cameraPosition.y;
        viewLen = min(viewLen, MAX_VIEW_DEPTH);
        float sampleY = originY + viewDir.y * viewLen;
        vec3 light = exp((sampleY - MAX_VIEW_DEPTH_DENSITY) * _Absorption);
        light *= _Light;

        float reflectivity = pow2(1.0 - max(0.0, dot(viewDir, normal)));
        float t = clamp(max(reflectivity, viewLen / MAX_VIEW_DEPTH) + dither, 0.0, 1.0);

        if (dot(viewDir, normal) < CRITICAL_ANGLE)
        {
            vec3 r = reflect(viewDir, -normal);
            sampleY = r.y * (MAX_VIEW_DEPTH - viewLen);
            vec3 rColor = exp((sampleY - MAX_VIEW_DEPTH_DENSITY) * _Absorption);
            rColor *= _Light;
            
            vec3 foamColor = vec3(1.0, 1.0, 1.0);
            vec3 finalColor = mix(mix(rColor, light, t), foamColor, foam);

            gl_FragColor = vec4(finalColor, max(edgeFade, foam));
            return;
        }
        
        vec3 foamColor = vec3(1.0, 1.0, 1.0);
        vec3 finalColor = mix(light, foamColor, foam);

        gl_FragColor = vec4(finalColor, max(t * edgeFade, foam));
    }
`;

export const volumeVertex = 
/*glsl*/`
    varying vec3 _worldPos;

    void main()
    {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        _worldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const volumeFragment = 
/*glsl*/`
    #include <ocean>

    varying vec3 _worldPos;

    void main()
    {
        vec3 viewVec = _worldPos - cameraPosition;
        float viewLen = length(viewVec);
        vec3 viewDir = viewVec / viewLen;
        float originY = cameraPosition.y;

        if (cameraPosition.y > 0.0)
        {
            float distAbove = cameraPosition.y / -viewDir.y;
            viewLen -= distAbove;
            originY = 0.0;
        }
        viewLen = min(viewLen, MAX_VIEW_DEPTH);

        float sampleY = originY + viewDir.y * viewLen;
        vec3 light = exp((sampleY - viewLen * DENSITY) * _Absorption);
        light *= _Light;
        
        gl_FragColor = vec4(light, 1.0);
    }
`;

export const objectVertex =
/*glsl*/`
    varying vec3 _worldPos;
    varying vec3 _normal;
    varying vec2 _uv;
    
    void main()
    {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        _worldPos = worldPos.xyz;
        _normal = normal;
        _uv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const objectFragment =
/*glsl*/`
    #include <ocean>

    uniform vec3 _CameraForward;
    uniform sampler2D _MainTexture;
    uniform float _SpotLightSharpness;
    uniform float _SpotLightDistance;

    varying vec3 _worldPos;
    varying vec3 _normal;
    varying vec2 _uv;

    void main()
    {
        float dirLighting = max(0.333, dot(_normal, _DirToLight));
        vec3 texture = texture2D(_MainTexture, _uv).xyz * dirLighting;
        
        vec3 viewVec = _worldPos - cameraPosition;
        float viewLen = length(viewVec);
        vec3 viewDir = viewVec / viewLen;

        if (_worldPos.y > 0.0)
        {
            if (cameraPosition.y < 0.0)
            {
                viewLen -= cameraPosition.y / -viewDir.y;
            }

            sampleDither(gl_FragCoord.xy);
            vec3 fogColor = sampleFog(viewDir);
            float fog = clamp(viewLen / FOG_DISTANCE + dither, 0.0, 1.0);
            gl_FragColor = vec4(mix(texture, fogColor, fog), 1.0);
            return;
        }

        float originY = cameraPosition.y;

        if (cameraPosition.y > 0.0)
        {
            viewLen -= cameraPosition.y / -viewDir.y;
            originY = 0.0;
        }
        viewLen = min(viewLen, MAX_VIEW_DEPTH);

        float sampleY = originY + viewDir.y * viewLen;
        vec3 light = exp((sampleY - viewLen * DENSITY) * _Absorption) * _Light;

        float spotLight = 0.0;
        float spotLightDistance = 1.0;
        if (_SpotLightDistance > 0.0)
        {
            spotLightDistance =  min(distance(_worldPos, cameraPosition) / _SpotLightDistance, 1.0);
            spotLight = pow(max(dot(viewDir, _CameraForward), 0.0), _SpotLightSharpness) * (1.0 - spotLightDistance);
        }
        
        light = min(light + spotLight, vec3(1.0));

        gl_FragColor = vec4(mix(texture * light, light, min(viewLen / MAX_VIEW_DEPTH, 1.0 - spotLight)), 1.0);
    }
`;

export const triplanarVertex = 
/*glsl*/`
    varying vec3 _worldPos;
    varying vec3 _normal;
    
    void main()
    {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        _worldPos = worldPos.xyz;
        _normal = normal;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const triplanarFragment =
/*glsl*/`
    #include <ocean>

    uniform vec3 _CameraForward;
    uniform sampler2D _MainTexture;
    uniform float _BlendSharpness;
    uniform float _Scale;
    uniform float _SpotLightSharpness;
    uniform float _SpotLightDistance;

    varying vec3 _worldPos;
    varying vec3 _normal;

    const float CAUSTIC_DISTANCE = 15.0;

    // Hash for Voronoi cell caustics
    vec2 causticHash(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
    }

    // Voronoi-based caustic: finds distance to nearest cell edge
    // producing organic net-like patterns similar to real underwater caustics
    float voronoiCaustic(vec2 p) {
        vec2 ip = floor(p);
        vec2 fp = fract(p);

        float d1 = 8.0;  // nearest
        float d2 = 8.0;  // second nearest

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 point = causticHash(ip + neighbor);
                // Animate the cell centers
                point = 0.5 + 0.5 * sin(_Time * 0.8 + 6.2831 * point);
                vec2 diff = neighbor + point - fp;
                float dist = dot(diff, diff);
                if (dist < d1) {
                    d2 = d1;
                    d1 = dist;
                } else if (dist < d2) {
                    d2 = dist;
                }
            }
        }

        // Edge detection: bright where d2 ≈ d1 (cell boundaries)
        float edge = d2 - d1;
        return exp(-12.0 * edge);
    }

    float caustics(vec2 worldXZ) {
        // Speed multiplier = 1.0 so drift matches the ocean wave velocities exactly
        float speed = 1.0;

        // Layer 1: drifts with wave velocity 1
        vec2 uv1 = worldXZ * 2.5 + _WaveVelocity1 * _Time * speed;
        float c1 = voronoiCaustic(uv1 * 2.0);

        // Layer 2: drifts with wave velocity 2, slightly rotated
        vec2 uv2 = worldXZ * 2.5 + _WaveVelocity2 * _Time * speed;
        float angle = 0.45;
        float ca = cos(angle);
        float sa = sin(angle);
        uv2 = vec2(uv2.x * ca - uv2.y * sa, uv2.x * sa + uv2.y * ca);
        float c2 = voronoiCaustic(uv2 * 2.0);

        // Min blend: produces the classic intersecting caustic network
        return min(c1, c2) * 3.5;
    }

    void main()
    {
        float dirLighting = max(0.4, dot(_normal, _DirToLight));

        vec3 weights = abs(_normal);
        weights = vec3(pow(weights.x, _BlendSharpness), pow(weights.y, _BlendSharpness), pow(weights.z, _BlendSharpness));
        weights = weights / (weights.x + weights.y + weights.z);

        vec3 textureX = texture2D(_MainTexture, _worldPos.yz * _Scale).xyz * weights.x;
        vec3 textureY = texture2D(_MainTexture, _worldPos.xz * _Scale).xyz * weights.y;
        vec3 textureZ = texture2D(_MainTexture, _worldPos.xy * _Scale).xyz * weights.z;

        vec3 texture = (textureX + textureY + textureZ) * dirLighting;
        
        vec3 viewVec = _worldPos - cameraPosition;
        float viewLen = length(viewVec);
        vec3 viewDir = viewVec / viewLen;

        if (_worldPos.y > 0.0)
        {
            if (cameraPosition.y < 0.0)
            {
                viewLen -= cameraPosition.y / -viewDir.y;
            }

            sampleDither(gl_FragCoord.xy);
            vec3 fogColor = sampleFog(viewDir);
            float fog = clamp(viewLen / FOG_DISTANCE + dither, 0.0, 1.0);
            gl_FragColor = vec4(mix(texture, fogColor, fog), 1.0);
            return;
        }

        float originY = cameraPosition.y;

        if (cameraPosition.y > 0.0)
        {
            viewLen -= cameraPosition.y / -viewDir.y;
            originY = 0.0;
        }
        viewLen = min(viewLen, MAX_VIEW_DEPTH);

        float sampleY = originY + viewDir.y * viewLen;
        vec3 light = exp((sampleY - viewLen * DENSITY) * _Absorption) * _Light;

        // Caustic light on underwater surfaces
        float caustic = caustics(_worldPos.xz);
        // Depth attenuation: caustics fade on very deep surfaces
        float depthFade = clamp(1.0 + _worldPos.y * 0.08, 0.0, 1.0);
        // Distance fade: caustics only visible near the camera
        float distFade = 1.0 - clamp(viewLen / CAUSTIC_DISTANCE, 0.0, 1.0);
        distFade *= distFade; // quadratic falloff for smooth fade
        // Day: warm bright caustics | Night: cool moonlight caustics
        float dayIntensity = _SunVisibility * 0.9;
        float nightIntensity = (1.0 - _SunVisibility) * 0.6;
        vec3 causticColor = caustic * depthFade * distFade * (
            vec3(1.0, 0.95, 0.85) * dayIntensity +
            vec3(0.5, 0.65, 1.0) * nightIntensity
        );
        light += causticColor;

        float spotLight = 0.0;
        float spotLightDistance = 1.0;
        if (_SpotLightDistance > 0.0)
        {
            spotLightDistance =  min(distance(_worldPos, cameraPosition) / _SpotLightDistance, 1.0);
            spotLight = pow(max(dot(viewDir, _CameraForward), 0.0), _SpotLightSharpness) * (1.0 - spotLightDistance);
        }
        
        light = min(light + spotLight, vec3(1.0));

        gl_FragColor = vec4(mix(texture * light, light, min(viewLen / MAX_VIEW_DEPTH, 1.0 - spotLight)), 1.0);
    }
`;
