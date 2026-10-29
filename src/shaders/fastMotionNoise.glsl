// Visual hash candidate: different random mapping, used only by dynamic bend.
float motionHash(vec2 p) {
 vec3 v=fract(vec3(p.xyx)*.1031);
 v+=dot(v,v.yzx+33.33);
 return fract((v.x+v.y)*v.z);
}
float motionNoise(vec2 p) {
 vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(motionHash(i),motionHash(i+vec2(1.,0.)),f.x),
            mix(motionHash(i+vec2(0.,1.)),motionHash(i+vec2(1.)),f.x),f.y);
}
