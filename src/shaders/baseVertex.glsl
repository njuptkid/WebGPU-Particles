attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p.x,-p.y,0,1);}
