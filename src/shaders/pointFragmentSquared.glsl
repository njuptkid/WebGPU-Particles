precision mediump float;
varying vec4 color;
void main() {
 vec2 d=gl_PointCoord-.5;
 float s=max(0.,1.-4.*dot(d,d));
 float a=color.a*s*s;
 gl_FragColor=vec4(color.rgb*a,a);
}
