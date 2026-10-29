varying vec2 uv;
void main() {
 vec2 origin=uv*resolution;
 float disturbance=noise(origin*.009)*.18+grainHash(floor(origin*.65))*.20;
 gl_FragColor=vec4(packNoise16(disturbance/.38),0.,1.);
}
