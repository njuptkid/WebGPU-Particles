attribute vec3 p;
attribute vec2 noiseUV;
varying vec4 packedNoise;
void main() {
 float disturbance=noise(p.xy*.009)*.18+grainHash(floor(p.xy*.65))*.20;
 packedNoise=vec4(packNoise16(disturbance/.38),packNoise16(noise(p.xy*.016)));
 gl_Position=vec4(noiseUV*2.-1.,0.,1.);
 gl_PointSize=1.;
}
