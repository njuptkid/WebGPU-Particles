precision highp float;
 uniform vec2 resolution;uniform float time;uniform float direction;uniform float fieldTime;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float grainHash(vec2 p){vec3 v=fract(vec3(p.xyx)*.1031);v+=dot(v,v.yzx+33.33);return fract((v.x+v.y)*v.z);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 // A wide screen-space release front crosses component boundaries; fine grain
 // breaks silhouettes instead of releasing each icon as a compact cloud.
 float birth(vec2 p){float u=p.x/resolution.x;return .045+mix(1.-u,u,step(0.,direction))*.50+noise(p*.009)*.18+grainHash(floor(p*.65))*.20;}
 vec2 transport(vec2 origin,float r,float age,float travelTime){float slow=1.-exp(-age*2.7);
    // Independent seeds prevent the size/speed/lifetime correlation that made
    // every original icon retain its own dense particle silhouette.
    float speed=hash(vec2(r*971.,17.));float sy=hash(vec2(r*631.,41.))+hash(vec2(r*139.,73.))-1.;
    float sx=hash(vec2(r*317.,29.));
    float spread=slow*(38.+155.*smoothstep(0.,1.1,age));
    // Longitudinal travel is strictly increasing with dissolution age.
    // The evolving field cannot alter x: incoming motion retraces x exactly,
    // so reversing the outer direction mirrors its whole flow consistently.
    float forward=(145.+speed*470.)*age*(.58+age*.28)
      +(.12+.88*sx)*spread;
    forward*=.90+.10*sin(origin.y*.007);
    vec2 pos=origin+vec2(direction*forward,sy*spread*1.7-age*22.);
    float gust=slow*smoothstep(0.,.65,age);
    // Roll open vortices into the downstream flow, rather than rotating points
    // in closed circles which inevitably drags part of a cloud upstream.
    // Center travel is driven by fold progress, so reversal also reverses it.
    float phase=fieldTime*1.20;
    float advect=direction*travelTime*200.;
    float radius=min(resolution.x,resolution.y)*(.30+.035*sin(phase*.81));
    vec2 center=resolution*vec2(.36,.37)+vec2(advect,0.);
    vec2 q=vec2(direction*(pos.x-center.x),pos.y-center.y)/radius;
    float envelope=exp(-q.y*q.y*.72-q.x*q.x*.24);
    float roll=(119.+32.*sin(phase*.91))*envelope
      *sin(q.x*2.1+.65*q.y+.42*sin(phase));
    center=resolution*vec2(.69,.71)+vec2(advect*.78,0.);
    q=vec2(direction*(pos.x-center.x),pos.y-center.y)/(radius*.82);
    envelope=exp(-q.y*q.y*.85-q.x*q.x*.27);
    roll-=(94.+26.*cos(phase*.77))*envelope
      *sin(q.x*2.0-.5*q.y+.36*cos(phase*.89));
    // Shape evolution is transverse to the transport direction. Compression
    // changes the density of the stream without opposing its forward motion.
    float along=direction*pos.x-travelTime*200.;
    float ribbon=(90.+25.*sin(phase*.69))*sin(pos.y*.014+along*.003+.48*sin(phase*.83))
      +39.*sin(pos.y*.006-along*.004+.38*cos(phase*.71));
    pos.y+=gust*(roll+ribbon);
return pos;
}attribute vec3 p;uniform sampler2D tex;varying vec4 color;
   void main(){vec2 origin=p.xy;float r=p.z;float b=birth(origin);float age=max(0.,time-b);float slow=1.-exp(-age*2.7);
    float life=1.60+hash(vec2(r*457.,91.))*.55;vec2 pos=transport(origin,r,age,time);
    vec4 c=texture2D(tex,origin/resolution);
    vec3 rgb=c.rgb/max(c.a,.001);
    float fade=(1.-smoothstep(life*.38,life,age))*smoothstep(0.,.14,age);
    color=vec4(mix(rgb,vec3(.86,.92,1.),.14+.20*smoothstep(.12,.85,age)),min(1.,c.a*1.25)*fade*.88);
    gl_Position=vec4(pos.x/resolution.x*2.-1.,1.-pos.y/resolution.y*2.,0,1);
    // Keep the old minimum (1.15); old maximum 2.40 becomes 6.00 (2.5x).
    // An independent, small-biased distribution mixes fine dust with clearly
    // larger grains without turning the whole cloud into equally large dots.
    float sizeRandom=hash(vec2(r*823.,53.));
    float diameter=mix(1.15,6.00,pow(sizeRandom,2.6));
    gl_PointSize=diameter*2.*(1.-.30*smoothstep(.4,life,age));
   }
