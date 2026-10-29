window.NoiseTestPromise=(async()=>{
 'use strict';
 const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const load=url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(url));i.src=url;});
 const report={date:new Date().toISOString(),checks:[],comparisons:[],benchmarks:[],environment:{userAgent:navigator.userAgent}};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail));};
 const difference=(a,b)=>{
  let sum=0,max=0,changed=0;
  for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(d>8)changed++;}
  return {mean:sum/a.length,max,fractionOver8:changed/a.length};
 };
 const pixels=(fx,time,direction,fieldTime,pass='both')=>{
  const g=fx.gl,draw=g.drawArrays.bind(g);
  if(pass!=='both')g.drawArrays=(mode,...args)=>{if((pass==='base')===(mode===g.TRIANGLES))draw(mode,...args);};
  try{fx.renderRaw(time,direction,fieldTime);}finally{g.drawArrays=draw;}
  const data=new Uint8Array(fx.canvas.width*fx.canvas.height*4);
  g.readPixels(0,0,fx.canvas.width,fx.canvas.height,g.RGBA,g.UNSIGNED_BYTE,data);return data;
 };
 const gpuTime=async(fx,pass)=>{
  const g=fx.gl,e=g.getExtension('EXT_disjoint_timer_query');
  if(!e)return {available:false,reason:'EXT_disjoint_timer_query unavailable'};
  const draw=g.drawArrays.bind(g),samples=[];
  if(pass!=='both')g.drawArrays=(mode,...args)=>{if((pass==='base')===(mode===g.TRIANGLES))draw(mode,...args);};
  try{
   for(let i=0;i<8;i++)fx.renderRaw(.73,-1,1);
   for(let i=0;i<11;i++){
    const q=e.createQueryEXT();
    try{
     e.beginQueryEXT(e.TIME_ELAPSED_EXT,q);fx.renderRaw(.73,-1,1);e.endQueryEXT(e.TIME_ELAPSED_EXT);
     const deadline=performance.now()+5000;
     while(!e.getQueryObjectEXT(q,e.QUERY_RESULT_AVAILABLE_EXT)){
      if(performance.now()>deadline)return {available:false,reason:'GPU query timeout'};
      await new Promise(resolve=>setTimeout(resolve,10));
     }
     if(g.getParameter(e.GPU_DISJOINT_EXT))return {available:false,reason:'GPU clock disjoint'};
     samples.push(e.getQueryObjectEXT(q,e.QUERY_RESULT_EXT)/1e6);
    }finally{e.deleteQueryEXT(q);}
   }
   samples.sort((a,b)=>a-b);
   return {available:true,medianMs:samples[5],minMs:samples[0],maxMs:samples[10],samples:11};
  }finally{g.drawArrays=draw;}
 };
 // Use the same context/resources for A/B to reduce context and residency bias.
 const referenceBindings=fx=>{
  const g=fx.gl,S=ParticleShaders;
  const compile=(type,text)=>{const s=g.createShader(type);g.shaderSource(s,text);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error(g.getShaderInfoLog(s));return s;};
  return [[S.baseVertex,S.baseFragment],[S[fx.scene+'Vertex'],S.pointFragment]].map(([v,f])=>{
   const p=g.createProgram(),vs=compile(g.VERTEX_SHADER,v),fs=compile(g.FRAGMENT_SHADER,f);
   g.attachShader(p,vs);g.attachShader(p,fs);g.linkProgram(p);g.deleteShader(vs);g.deleteShader(fs);
   if(!g.getProgramParameter(p,g.LINK_STATUS))throw Error(g.getProgramInfoLog(p));
   return {p,position:g.getAttribLocation(p,'p'),fixedParticleNoise:-1,
    u:Object.fromEntries(['resolution','time','direction','fieldTime','tex','fixedNoise','noiseSize'].map(n=>[n,g.getUniformLocation(p,n)]))};
  });
 };
 const benchmark=async(fx,pass)=>{
  const cachedBindings=fx.bindings,cache=fx.noiseCache,reference=referenceBindings(fx),results={original:[],optimized:[]};
  try{
   // Alternate block order; retain per-block spread instead of implying stability.
   for(let round=0;round<3;round++)for(const mode of round%2?['optimized','original']:['original','optimized']){
    fx.bindings=mode==='original'?reference:cachedBindings;fx.noiseCache=mode==='original'?null:cache;
    const result=await gpuTime(fx,pass);results[mode].push(result);
    if(!result.available)return {original:result,optimized:result,speedup:null};
   }
   const summarize=blocks=>{const medians=blocks.map(x=>x.medianMs).sort((a,b)=>a-b);return {available:true,medianMs:medians[1],blockMedianMinMs:medians[0],blockMedianMaxMs:medians[2],samples:33};};
   const original=summarize(results.original),optimized=summarize(results.optimized);
   return {original,optimized,speedup:original.medianMs/optimized.medianMs,method:'same-context, 3 alternating blocks x 11 samples'};
  }finally{fx.bindings=cachedBindings;fx.noiseCache=cache;for(const {p} of reference)fx.gl.deleteProgram(p);}
 };
 for(const scene of ['desktop','app'])for(const which of ['outer','inner']){
  const w=which==='inner'?1292:632,h=which==='inner'?914:924;
  let model;
  if(scene==='app'){
   const m=AppBlockExtractor.build(await load('../demo/assets/app-'+which+'.jpg'),w,h);
   model={...m,fullSource:m.source,source:m.content,scene};
  }else{
   const img=await load('../demo/assets/desktop-'+which+'-content.png'),source=make(w*2,h*2);
   source.getContext('2d').drawImage(img,0,0,source.width,source.height);
   model={w,h,source,background:await load('../demo/assets/desktop-'+which+'-wallpaper.png'),scene};
  }
  const raw=new ParticleRenderer({...model,precomputeNoise:false}),cached=new ParticleRenderer({...model,precomputeNoise:'particles'});
  const label=scene+'-'+which;
  try{
   check(label+' cache enabled',cached.noiseCacheStatus.enabled,cached.noiseCacheStatus);
   check(label+' sample count unchanged',raw.count===cached.count,{count:raw.count});
   // Early release, transition front, and tail; both direction configurations.
   for(const direction of [-1,1])for(const time of [.08,.4,.73,1.2,1.64]){
    for(const pass of ['base','both']){
     const d=difference(pixels(raw,time,direction,1,pass),pixels(cached,time,direction,1,pass));
     report.comparisons.push({scene,which,time,direction,pass,...d});
     check(label+' visual '+pass+' '+time+' '+direction,d.mean<(pass==='base'?.15:1)&&d.fractionOver8<(pass==='base'?.005:.02),d);
    }
   }
   const a=pixels(cached,.73,-1,1),b=pixels(cached,.73,-1,2),c=pixels(cached,.73,-1,1);
   check(label+' fixed inputs reproduce',difference(a,c).max===0);
   check(label+' dynamic field still evolves',difference(a,b).mean>0);
   const all=new ParticleRenderer({...model,precomputeNoise:'all'});
   try{
    check(label+' experimental release cache enabled',!!all.noiseCache?.release);
    for(const direction of [-1,1])for(const pass of ['base','both']){
     const d=difference(pixels(raw,.73,direction,1,pass),pixels(all,.73,direction,1,pass));
     check(label+' experimental release visual '+pass+' '+direction,d.mean<(pass==='base'?.15:1)&&d.fractionOver8<(pass==='base'?.005:.02),d);
    }
    check(label+' experimental no GL errors',all.gl.getError()===all.gl.NO_ERROR);
    if(new URLSearchParams(location.search).has('benchmark')){
     report.benchmarks.push({scene,which,mode:'all',pass:'base',time:.73,fieldTime:1,direction:-1,...await benchmark(all,'base')});
    }
   }finally{all.dispose();}
   check(label+' no GL errors',cached.gl.getError()===cached.gl.NO_ERROR&&raw.gl.getError()===raw.gl.NO_ERROR);
   report.comparisons.push({scene,which,mode:'particles',cacheBytes:cached.noiseCache.bytes,prepareMs:cached.noiseCacheStatus.prepareMs});
   if(!report.environment.renderer){const g=cached.gl,e=g.getExtension('WEBGL_debug_renderer_info');report.environment.renderer=e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);}
   if(new URLSearchParams(location.search).has('benchmark')){
    for(const pass of ['base','particles','both']){
     report.benchmarks.push({scene,which,mode:'particles',pass,time:.73,fieldTime:1,direction:-1,...await benchmark(cached,pass)});
    }
   }
  }finally{raw.dispose();cached.dispose();}
 }
 // Capability failure must keep a working original renderer.
 const source=make(16,16);source.getContext('2d').fillRect(0,0,16,16);
 const prepare=ParticleRenderer.prototype.prepareNoise;
 ParticleRenderer.prototype.prepareNoise=function(){throw Error('simulated unsupported cache');};
 let fallback;
 try{fallback=new ParticleRenderer({w:8,h:8,source,background:source,precomputeNoise:'particles'});}
 finally{ParticleRenderer.prototype.prepareNoise=prepare;}
 try{fallback.renderRaw(.4,-1,1);check('unsupported cache falls back',!fallback.noiseCacheStatus.enabled&&fallback.gl.getError()===fallback.gl.NO_ERROR);}finally{fallback.dispose();}
 document.getElementById('status').textContent=JSON.stringify(report,null,2);return report;
})().catch(e=>{document.getElementById('status').textContent=e.stack;throw e;});
