float fastWave(float x) {
 float tri=1.-4.*abs(fract(x*.159154943091895+.25)-.5);
 return tri*(1.5-.5*tri*tri);
}
