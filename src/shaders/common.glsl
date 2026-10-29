precision highp float;
 uniform vec2 resolution;uniform float time;uniform float direction;uniform float fieldTime;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 // Fixed source-coordinate grain for release only; other random attributes stay unchanged.
 float grainHash(vec2 p){vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 // A wide screen-space release front crosses component boundaries; fine grain
 // breaks silhouettes instead of releasing each icon as a compact cloud.
 float birth(vec2 p){float u=p.x/resolution.x;return .045+mix(1.-u,u,step(0.,direction))*.50+noise(p*.009)*.18+grainHash(floor(p*.65))*.20;}
 
