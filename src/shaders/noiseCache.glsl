uniform sampler2D fixedNoise;
uniform vec2 noiseSize;
#ifdef PARTICLE_NOISE
attribute vec2 fixedParticleNoise;
vec2 particleFixedNoise() {
 return fixedParticleNoise;
}
#endif
float cachedBirth(vec2 origin,float disturbance) {
 float u=origin.x/resolution.x;
 return .045+mix(1.-u,u,step(0.,direction))*.50+disturbance;
}
