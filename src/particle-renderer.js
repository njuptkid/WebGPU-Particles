(()=>{'use strict';
 const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 function program(gl,v,f){const p=gl.createProgram(),vs=shader(gl,gl.VERTEX_SHADER,v),fs=shader(gl,gl.FRAGMENT_SHADER,f);gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
 class ParticleRenderer{
  // source/background must use the same logical coordinate system (w,h).
  // Source alpha selects particles; app models MUST supply recognized blocks.
  constructor({w,h,source,fullSource=null,background,backgroundColor,blocks=null,scene='desktop',sampleStep=1.5}){
   if(!(w>0&&h>0&&sampleStep>=1))throw Error('Invalid dimensions / sampleStep');
   if(scene==='app'&&!blocks)throw Error('App scene requires detected block masks');
   Object.assign(this,{w,h,source,fullSource,background,backgroundColor,blocks,scene,sampleStep});this.canvas=canvas(w*2,h*2);
   const gl=this.canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true});
   if(!gl)throw Error('WebGL unavailable');this.gl=gl;
   const S=ParticleShaders;this.base=program(gl,S.baseVertex,S.baseFragment);this.dust=program(gl,scene==='app'?S.appVertex:S.desktopVertex,S.pointFragment);
   this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
   const points=[],blockIds=[];let seed=scene==='app'?9187:7381;
   const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
   if(scene==='app'){
    for(let id=0;id<blocks.length;id++){
     const e=blocks[id],pixels=e.image.getContext('2d').getImageData(0,0,e.image.width,e.image.height).data;
     for(let y=1;y<e.height;y+=sampleStep)for(let x=1;x<e.width;x+=sampleStep){
      if(pixels[(Math.floor(y*2)*e.image.width+Math.floor(x*2))*4+3]<32)continue;
      points.push(e.x+x,e.y+y,random());blockIds.push(id);
     }
    }
   }else{
    const pixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    for(let y=1;y<h-1;y+=sampleStep)for(let x=1;x<w-1;x+=sampleStep){const px=x+(random()-.5)*1.35,py=y+(random()-.5)*1.35;
     const ix=Math.floor(px/w*source.width),iy=Math.floor(py/h*source.height);
     if(pixels[(iy*source.width+ix)*4+3]>16)points.push(px,py,random());
    }
   }
   this.count=points.length/3;this.blockIds=new Uint32Array(blockIds);this.samples=new Float32Array(points);
   this.points=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.points);gl.bufferData(gl.ARRAY_BUFFER,this.samples,gl.STATIC_DRAW);
   this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
   gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(0,0,0,0);
   this.bindings=[this.base,this.dust].map(p=>({p,position:gl.getAttribLocation(p,'p'),u:Object.fromEntries(['resolution','time','direction','fieldTime','tex'].map(n=>[n,gl.getUniformLocation(p,n)]))}));
  }
  renderRaw(time,direction,fieldTime=0){
   const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
   this.bindings.forEach(({p,position,u},i)=>{
    gl.useProgram(p);gl.uniform2f(u.resolution,this.w,this.h);gl.uniform1f(u.time,time);gl.uniform1f(u.direction,direction);gl.uniform1f(u.fieldTime,fieldTime);gl.uniform1i(u.tex,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,i?this.points:this.quad);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,i?3:2,gl.FLOAT,false,0,0);gl.drawArrays(i?gl.POINTS:gl.TRIANGLES,0,i?this.count:6);gl.disableVertexAttribArray(position);
   });return this.canvas;
  }
  draw(ctx,width,height,{dissolve,direction,fieldTime=0}){
   dissolve=FoldClock.clamp(dissolve);const time=1.65*Math.pow(dissolve,.78);
   ctx.save();ctx.clearRect(0,0,width,height);
   if(this.scene==='app'){
    ctx.fillStyle='rgb('+this.backgroundColor.join(',')+')';ctx.fillRect(0,0,width,height);
    // Unrecognized fine details fade in place; the solid underlay never fades.
    ctx.save();ctx.globalAlpha*=1-FoldClock.smooth(0,.38,time);ctx.drawImage(this.background,0,0,width,height);ctx.restore();
   }else ctx.drawImage(this.background,0,0,width,height);
   if(dissolve===0)ctx.drawImage(this.fullSource||this.source,0,0,width,height);
   else if(dissolve<1){ctx.save();ctx.globalAlpha*=1-FoldClock.smooth(this.scene==='app'?.997:.97,1,dissolve);ctx.drawImage(this.renderRaw(time,direction,fieldTime),0,0,width,height);ctx.restore();}
   ctx.restore();
  }
  dispose(){const g=this.gl;g.deleteProgram(this.base);g.deleteProgram(this.dust);g.deleteTexture(this.texture);g.deleteBuffer(this.quad);g.deleteBuffer(this.points);g.getExtension('WEBGL_lose_context')?.loseContext();}
 }
 window.ParticleRenderer=ParticleRenderer;
})();
