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
}
