#version 100
precision highp float;

/*
 * Learning version: source point -> release age -> position -> color/size.
 * Link with particle.frag.glsl and draw using GL_POINTS / gl.drawArrays(gl.POINTS, ...).
 *
 * Host preparation: sample visible UI pixels and provide these attributes.
 * a_particle.xy: source position in logical pixels; top-left origin, y down.
 * a_particle.z : fixed random seed in [0,1); keep it unchanged between frames.
 * a_color      : source RGBA in [0,1], with straight (not premultiplied) RGB.
 *
 * Per-frame uniforms:
 * u_resolution : logical content size, e.g. vec2(1292,914); both components > 0.
 * u_progress   : dissolve progress in [0,1]; increase to scatter, decrease to gather.
 * u_direction  : scatter direction, either -1 (left) or +1 (right).
 * u_fieldTime  : continuous flow phase in seconds; do not reset on reversal.
 * u_renderScale: output pixels per logical pixel, e.g. 1 or 2; do not apply DPR twice.
 *
 * Particle pass only: no particles at progress 0/1; the host draws the UI/background.
 * This version uses one continuous noise field and one ribbon wave. It omits the
 * full demo's dual vortices, nested domain warp, precomputation and dual-screen control.
 * It is not intended to match the full demo pixel for pixel.
 */
attribute vec3 a_particle;
attribute vec4 a_color;

uniform vec2 u_resolution;
uniform float u_progress;
uniform float u_direction;
uniform float u_fieldTime;
uniform float u_renderScale;

// Pass straight RGB and particle alpha; premultiply once in the fragment shader.
varying mediump vec4 v_color;

// Deterministic pseudorandom value. Different salts reduce attribute correlation.
float hash12(vec2 p) {
    vec3 v = fract(vec3(p.xyx) * 0.1031);
    v += dot(v, v.yzx + 33.33);
    return fract((v.x + v.y) * v.z);
}

// Single-scale 2D value noise: four random corner values with smooth interpolation.
float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float top = mix(hash12(cell), hash12(cell + vec2(1.0, 0.0)), f.x);
    float bottom = mix(hash12(cell + vec2(0.0, 1.0)), hash12(cell + vec2(1.0)), f.x);
    return mix(top, bottom, f.y);
}

void main() {
    // Default to a clipped point; return early at endpoints or before release.
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    v_color = vec4(0.0);
    float progress = clamp(u_progress, 0.0, 1.0);
    if (progress <= 0.0 || progress >= 1.0 || a_color.a <= 0.0) return;

    vec2 origin = a_particle.xy;
    float seed = a_particle.z;

    // 1. Map progress to an effect clock; birth sets the local release threshold.
    // At direction=-1, release starts on the right and moves left; reversal gathers.
    float time = 1.65 * pow(progress, 0.78);
    float u = origin.x / u_resolution.x;
    float front = mix(1.0 - u, u, step(0.0, u_direction));
    float birth = 0.045 + front * 0.50
                + valueNoise(origin * 0.009) * 0.18
                + hash12(floor(origin * 0.65)) * 0.20;
    float age = max(0.0, time - birth);
    if (age <= 0.0) return;

    // 2. Fixed particle attributes, recomputed each frame here for readability.
    float speed = hash12(vec2(seed * 971.0, 17.0));
    float spreadX = hash12(vec2(seed * 317.0, 29.0));
    float spreadY = hash12(vec2(seed * 631.0, 41.0))
                  + hash12(vec2(seed * 139.0, 73.0)) - 1.0;
    float life = 1.60 + hash12(vec2(seed * 457.0, 91.0)) * 0.55;
    if (age >= life) return;

    // 3. Analytic trajectory: evaluate from origin, without integrating prior frames.
    // Scale travel against a 914-pixel short side; forward distance grows with age.
    float scale = min(u_resolution.x, u_resolution.y) / 914.0;
    float slow = 1.0 - exp(-age * 2.7);
    float spread = slow * (38.0 + 155.0 * smoothstep(0.0, 1.1, age));
    float forward = (145.0 + speed * 470.0) * age * (0.58 + age * 0.28)
                  + (0.12 + 0.88 * spreadX) * spread;
    vec2 pos = origin + scale * vec2(u_direction * forward,
                                    spreadY * spread * 1.7 - age * 22.0);

    // 4. A continuous screen-space field bends y while preserving horizontal travel.
    // Advancing u_fieldTime evolves the vertical shape even at fixed progress.
    vec2 fieldUV = vec2(pos.x / u_resolution.x * 4.0,
                        pos.y / u_resolution.y * 4.0);
    float bend = (valueNoise(fieldUV + vec2(-u_fieldTime * 0.18,
                                            u_fieldTime * 0.12)) - 0.5) * 140.0;
    float ribbon = 65.0 * sin(pos.y / u_resolution.y * 12.0
                              + u_direction * pos.x / u_resolution.x * 3.0
                              + u_fieldTime * 0.8);
    float gust = slow * smoothstep(0.0, 0.65, age);
    pos.y += scale * gust * (bend + ribbon);

    // 5. Fade in, fade over lifetime, then clear the tail; size and speed use different salts.
    float alpha = smoothstep(0.0, 0.14, age)
                * (1.0 - smoothstep(life * 0.38, life, age))
                * (1.0 - smoothstep(0.97, 1.0, progress));
    vec3 rgb = mix(a_color.rgb, vec3(0.86, 0.92, 1.0),
                   0.12 * smoothstep(0.15, 0.8, age));
    v_color = vec4(rgb, a_color.a * alpha);
    float sizeRandom = hash12(vec2(seed * 823.0, 53.0));
    float diameter = mix(1.15, 6.0, pow(sizeRandom, 2.6));
    gl_PointSize = diameter * u_renderScale
                 * (1.0 - 0.3 * smoothstep(0.4, life, age));

    // 6. Convert top-left logical coordinates to OpenGL clip space for a 2D effect.
    gl_Position = vec4(pos.x / u_resolution.x * 2.0 - 1.0,
                       1.0 - pos.y / u_resolution.y * 2.0, 0.0, 1.0);
}
