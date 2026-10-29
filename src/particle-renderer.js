(()=>{'use strict';
 const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 function shader(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 function program(gl,v,f){const p=gl.createProgram(),vs=shader(gl,gl.VERTEX_SHADER,v),fs=shader(gl,gl.FRAGMENT_SHADER,f);gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
 class ParticleRenderer{
  // source/background must use the same logical coordinate system (w,h).
  // Source alpha selects particles; app models MUST supply recognized blocks.
  constructor({w,h,source,fullSource=null,background,backgroundColor,blocks=null,scene='desktop',sampleStep=1.5,precomputeNoise=false,shaderVariant='original',legacyRelease=false}){
   if(!(w>0&&h>0&&sampleStep>=1))throw Error('Invalid dimensions / sampleStep');
   if(scene==='app'&&!blocks)throw Error('App scene requires detected block masks');
   if(shaderVariant!=='original'&&!ParticleShaders.experiments[shaderVariant])throw Error('Unknown shader variant: '+shaderVariant);
   if(precomputeNoise&&shaderVariant!=='original')throw Error('Compare approximations independently of noise precomputation');
   if(legacyRelease&&(precomputeNoise||shaderVariant!=='original'))throw Error('Historical release is only supported without approximations or precomputation');
   Object.assign(this,{w,h,source,fullSource,background,backgroundColor,blocks,scene,sampleStep,shaderVariant,legacyRelease});this.canvas=canvas(w*2,h*2);
   const gl=this.canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true});
   if(!gl)throw Error('WebGL unavailable');this.gl=gl;
   const S=ParticleShaders,V=shaderVariant==='original'?S:S.experiments[shaderVariant];this.base=program(gl,S.baseVertex,legacyRelease?S.legacy.baseFragment:S.baseFragment);this.dust=program(gl,legacyRelease?S.legacy[scene+'Vertex']:V[scene+'Vertex'],V.pointFragment);
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
   this.noiseCache=null;this.noiseCacheStatus={requested:precomputeNoise,enabled:false};
   if(precomputeNoise){
    const started=performance.now();
    try{this.prepareNoise(precomputeNoise===true||precomputeNoise==='all');this.noiseCacheStatus.enabled=true;}
    catch(e){this.noiseCacheStatus.reason=e.message;}
    this.noiseCacheStatus.prepareMs=performance.now()-started;
   }
   this.bindings=[this.base,this.dust].map(p=>({p,position:gl.getAttribLocation(p,'p'),fixedParticleNoise:gl.getAttribLocation(p,'fixedParticleNoise'),u:Object.fromEntries(['resolution','time','direction','fieldTime','tex','fixedNoise','noiseSize','flowRadius','flowAmplitudes','flowOffsets'].map(n=>[n,gl.getUniformLocation(p,n)]))}));
  }
  prepareNoise(includeRelease){
   const gl=this.gl,S=ParticleShaders,max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
   const width=Math.min(1024,max),height=Math.max(1,Math.ceil(this.count/width));
   if(Math.max(this.canvas.width,this.canvas.height,height)>max)throw Error('Noise cache exceeds texture size limit');
   const textures=[],programs=[],buffers=[];let framebuffer;
   const wasDither=gl.isEnabled(gl.DITHER),wasBlend=gl.isEnabled(gl.BLEND);
   try{
    const base=includeRelease?program(gl,S.baseVertex,S.baseFragmentCached):null;if(base)programs.push(base);
    const dust=program(gl,S[this.scene+'VertexCached'],S.pointFragment);programs.push(dust);
    const bakeBase=includeRelease?program(gl,S.baseVertex,S.noiseBakeFragment):null;if(bakeBase)programs.push(bakeBase);
    const bakePoints=program(gl,S.particleNoiseBakeVertex,S.particleNoiseBakeFragment);programs.push(bakePoints);
    const coords=new Float32Array(this.count*2);
    for(let i=0;i<this.count;i++){coords[i*2]=(i%width+.5)/width;coords[i*2+1]=(Math.floor(i/width)+.5)/height;}
    const uvBuffer=gl.createBuffer();buffers.push(uvBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,uvBuffer);gl.bufferData(gl.ARRAY_BUFFER,coords,gl.STATIC_DRAW);
    framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.disable(gl.BLEND);gl.disable(gl.DITHER);
    const bake=(p,w,h,points)=>{
     const texture=gl.createTexture();textures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
     gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
     gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
     if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Noise framebuffer incomplete');
     gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(p);
     gl.uniform2f(gl.getUniformLocation(p,'resolution'),this.w,this.h);
     const pos=gl.getAttribLocation(p,'p');gl.bindBuffer(gl.ARRAY_BUFFER,points?this.points:this.quad);gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,points?3:2,gl.FLOAT,false,0,0);
     const uv=gl.getAttribLocation(p,'noiseUV');
     if(uv>=0){gl.bindBuffer(gl.ARRAY_BUFFER,uvBuffer);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,0,0);}
     gl.drawArrays(points?gl.POINTS:gl.TRIANGLES,0,points?this.count:6);
     gl.disableVertexAttribArray(pos);if(uv>=0)gl.disableVertexAttribArray(uv);
     return texture;
    };
    const release=includeRelease?bake(bakeBase,this.canvas.width,this.canvas.height,false):null;
    const particles=bake(bakePoints,width,height,true);
    // WebGL1 has no transform feedback. Read back once during preparation,
    // then use vertex attributes instead of a texture fetch on every frame.
    const packed=new Uint8Array(width*height*4),values=new Float32Array(this.count*2);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,packed);
    for(let i=0;i<this.count;i++){
     values[i*2]=(packed[i*4]*256+packed[i*4+1])/65535*.38;
     values[i*2+1]=(packed[i*4+2]*256+packed[i*4+3])/65535;
    }
    const noiseBuffer=gl.createBuffer();buffers.push(noiseBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,noiseBuffer);gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);
    if(gl.getError()!==gl.NO_ERROR)throw Error('Noise cache GPU initialization failed');
    this.noiseCache={release,noiseBuffer,bytes:(release?4*this.canvas.width*this.canvas.height:0)+values.byteLength};
    if(base){gl.deleteProgram(this.base);this.base=base;}gl.deleteProgram(this.dust);this.dust=dust;
    // The point atlas and its UV buffer are temporary preparation resources.
    programs.splice(0,includeRelease?2:1);
    if(release)textures.splice(textures.indexOf(release),1);
    buffers.splice(buffers.indexOf(noiseBuffer),1);
   }finally{
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);if(framebuffer)gl.deleteFramebuffer(framebuffer);
    for(const p of programs)gl.deleteProgram(p);for(const t of textures)gl.deleteTexture(t);for(const b of buffers)gl.deleteBuffer(b);
    if(wasBlend)gl.enable(gl.BLEND);if(wasDither)gl.enable(gl.DITHER);
   }
  }
  renderRaw(time,direction,fieldTime=0){
   const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);
   this.bindings.forEach(({p,position,fixedParticleNoise,u},i)=>{
    gl.useProgram(p);gl.uniform2f(u.resolution,this.w,this.h);gl.uniform1f(u.time,time);gl.uniform1f(u.direction,direction);gl.uniform1f(u.fieldTime,fieldTime);gl.uniform1i(u.tex,0);
    if(i&&ParticleShaders.experiments[this.shaderVariant]?.usesFlowUniforms){
     const phase=fieldTime*1.2;
     gl.uniform1f(u.flowRadius,Math.min(this.w,this.h)*(.30+.035*Math.sin(phase*.81)));
     gl.uniform3f(u.flowAmplitudes,119+32*Math.sin(phase*.91),94+26*Math.cos(phase*.77),90+25*Math.sin(phase*.69));
     gl.uniform4f(u.flowOffsets,.42*Math.sin(phase),.36*Math.cos(phase*.89),.48*Math.sin(phase*.83),.38*Math.cos(phase*.71));
    }
    if(this.noiseCache){
     if(!i&&this.noiseCache.release){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.noiseCache.release);gl.uniform1i(u.fixedNoise,1);}
     gl.uniform2f(u.noiseSize,this.canvas.width,this.canvas.height);gl.activeTexture(gl.TEXTURE0);
     if(fixedParticleNoise>=0){gl.bindBuffer(gl.ARRAY_BUFFER,this.noiseCache.noiseBuffer);gl.enableVertexAttribArray(fixedParticleNoise);gl.vertexAttribPointer(fixedParticleNoise,2,gl.FLOAT,false,0,0);}
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,i?this.points:this.quad);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,i?3:2,gl.FLOAT,false,0,0);gl.drawArrays(i?gl.POINTS:gl.TRIANGLES,0,i?this.count:6);gl.disableVertexAttribArray(position);if(fixedParticleNoise>=0)gl.disableVertexAttribArray(fixedParticleNoise);
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
  dispose(){const g=this.gl;g.deleteProgram(this.base);g.deleteProgram(this.dust);g.deleteTexture(this.texture);g.deleteBuffer(this.quad);g.deleteBuffer(this.points);if(this.noiseCache){if(this.noiseCache.release)g.deleteTexture(this.noiseCache.release);g.deleteBuffer(this.noiseCache.noiseBuffer);}g.getExtension('WEBGL_lose_context')?.loseContext();}
 }
 window.ParticleRenderer=ParticleRenderer;
})();
