#version 100
precision mediump float;

/*
 * Learning version: turn each GL_POINTS square into a soft circular particle.
 * Pair with particle.vert.glsl; no textures, includes or additional shaders required.
 *
 * Host blend state:
 *   gl.enable(gl.BLEND);
 *   gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
 * Clear transparent targets to (0,0,0,0); the host may draw a background first.
 * v_color.rgb is straight RGB; this shader outputs premultiplied alpha exactly once.
 */
varying mediump vec4 v_color;

void main() {
    // gl_PointCoord spans [0,1]^2 inside each point; move its center to (0,0).
    vec2 local = gl_PointCoord - vec2(0.5);
    float radius = length(local);
    float coverage = 1.0 - smoothstep(0.13, 0.5, radius);

    // Combine lifetime alpha with circular coverage; premultiply RGB once on output.
    float alpha = v_color.a * coverage;
    gl_FragColor = vec4(v_color.rgb * alpha, alpha);
}
