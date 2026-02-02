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

    varying vec2 _worldPos;
    varying vec2 _uv;
    varying float _elevation;

    float calcEdgeFade(vec2 pos) {
        float distFromNearEdge = -pos.y;
        
        return smoothstep(0.0, _EdgeFadeDistance, distFromNearEdge);
    }
    
    float calcFoam(vec2 pos) {
        float dist = length(pos - _FoamIslandCenter);
        
        float innerEdge = _FoamIslandRadius;
        float outerEdge = _FoamIslandRadius + _FoamWidth;
        
        float foam = smoothstep(innerEdge - 0.1, innerEdge, dist) * 
                     smoothstep(outerEdge + 0.1, outerEdge, dist);
        
        float noiseOffset = sin(pos.x * 8.0 + _Time * 2.0) * 0.1 + 
                           cos(pos.y * 6.0 + _Time * 1.5) * 0.1;
        foam *= (0.8 + noiseOffset);
        
        return foam * _FoamIntensity;
    }

    void main()
    {
        float edgeFade = calcEdgeFade(_worldPos);
        if (edgeFade <= 0.0) discard;
        
        float foam = calcFoam(_worldPos);

        vec3 viewVec = vec3(_worldPos.x, _elevation, _worldPos.y) - cameraPosition;
        float viewLen = length(viewVec);
        vec3 viewDir = viewVec / viewLen;

        vec3 normal = texture2D(_NormalMap1, _uv + _WaveVelocity1 * _Time).xyz * 2.0 - 1.0;
        normal += texture2D(_NormalMap2, _uv + _WaveVelocity2 * _Time).xyz * 2.0 - 1.0;
        normal *= _NormalMapStrength;
        normal += vec3(0.0, 0.0, 1.0);
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
