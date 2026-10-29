// Two UNORM16 values in RGBA8. NEAREST filtering is required.
vec2 packNoise16(float v) {
 float n=floor(clamp(v,0.,1.)*65535.+.5);
 float hi=floor(n/256.);
 return vec2(hi,n-hi*256.)/255.;
}
float unpackNoise16(vec2 v) { return dot(v,vec2(65280.,255.))/65535.; }
