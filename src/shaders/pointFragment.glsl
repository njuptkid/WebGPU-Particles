precision mediump float;varying vec4 color;void main(){float a=color.a*(1.-smoothstep(.13,.5,length(gl_PointCoord-.5)));gl_FragColor=vec4(color.rgb*a,a);}
