(()=>{'use strict';
 const uniforms=['resolution','time','direction','fieldTime','tex','fixedNoise','noiseSize','flowRadius','flowAmplitudes','flowOffsets'];
 function compile(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(message);}return s;}
 function candidateBinding(fx,variant){
  const gl=fx.gl,S=ParticleShaders,V=S.experiments[variant];
  const vs=compile(gl,gl.VERTEX_SHADER,V[fx.scene+'Vertex']);let fs,p;
  try{
   fs=compile(gl,gl.FRAGMENT_SHADER,V.pointFragment);p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
   if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));
   return {p,position:gl.getAttribLocation(p,'p'),fixedParticleNoise:-1,u:Object.fromEntries(uniforms.map(n=>[n,gl.getUniformLocation(p,n)]))};
  }catch(e){if(p)gl.deleteProgram(p);throw e;}finally{gl.deleteShader(vs);if(fs)gl.deleteShader(fs);}
 }
 function stats(samples){const s=[...samples].sort((a,b)=>a-b);return {p50Ms:s[Math.floor(s.length/2)],p10Ms:s[Math.floor((s.length-1)*.1)],p90Ms:s[Math.ceil((s.length-1)*.9)],minMs:s[0],maxMs:s[s.length-1],samples};}
 async function compare(fx,variant,{time=.73,direction=-1,fieldTime=1,pass='both',samples=9,batch=4}={}){
  if(fx.noiseCache||fx.legacyRelease||fx.shaderVariant!=='original')throw Error('GPU comparison requires a fixed-release original renderer without precomputation');
  if(variant!=='original'&&!ParticleShaders.experiments[variant])throw Error('Unknown experiment');
  const gl=fx.gl,ext=gl.getExtension('EXT_disjoint_timer_query');
  if(!ext)return {available:false,reason:'当前浏览器未提供 GPU 时间查询，不能用 CPU 提交时间替代。'};
  const original=fx.bindings,candidate=variant==='original'?null:candidateBinding(fx,variant),drawArrays=gl.drawArrays;
  const values={original:[],candidate:[]};
  const bind=mode=>{fx.bindings=mode==='original'?original:[original[0],candidate||original[1]];fx.shaderVariant=mode==='original'?'original':variant;};
  if(pass!=='both')gl.drawArrays=function(mode,...args){if((pass==='base')===(mode===gl.TRIANGLES))drawArrays.call(gl,mode,...args);};
  try{
   if(gl.getParameter(ext.GPU_DISJOINT_EXT))return {available:false,reason:'GPU 时钟发生 disjoint，本轮计时无效。'};
   for(const mode of ['original','candidate']){bind(mode);for(let i=0;i<8;i++)fx.renderRaw(time,direction,fieldTime);}
   gl.finish(); // Preparation/JIT barrier only; this wall time is not a result.
   for(let i=0;i<samples;i++)for(const mode of i%2?['candidate','original']:['original','candidate']){
    bind(mode);const q=ext.createQueryEXT();
    try{
     ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,q);
     for(let j=0;j<batch;j++)fx.renderRaw(time,direction,fieldTime);
     ext.endQueryEXT(ext.TIME_ELAPSED_EXT);gl.flush();
     const deadline=performance.now()+5000;
     while(!ext.getQueryObjectEXT(q,ext.QUERY_RESULT_AVAILABLE_EXT)){
      if(performance.now()>deadline)return {available:false,reason:'GPU 时间查询超时。'};
      await new Promise(resolve=>setTimeout(resolve,1));
     }
     if(gl.getParameter(ext.GPU_DISJOINT_EXT))return {available:false,reason:'GPU 时钟发生 disjoint，本轮计时无效。'};
     values[mode].push(ext.getQueryObjectEXT(q,ext.QUERY_RESULT_EXT)/1e6/batch);
    }finally{ext.deleteQueryEXT(q);}
   }
   if(gl.getError()!==gl.NO_ERROR)throw Error('GPU benchmark produced a GL error');
   const a=stats(values.original),b=stats(values.candidate);
   if(a.p50Ms<=0||b.p50Ms<=0)return {available:false,reason:'GPU 计时分辨率不足。'};
   const unstable=(a.p90Ms-a.p10Ms)/a.p50Ms>.25||(b.p90Ms-b.p10Ms)/b.p50Ms>.25;
   return {available:true,variant,pass,time,direction,fieldTime,particles:fx.count,batch,original:a,candidate:b,
    gpuTimeChangePercent:100*(b.p50Ms/a.p50Ms-1),speedup:a.p50Ms/b.p50Ms,unstable,
    method:'same context, alternating A/B order, GPU query, four draws/query by default; excludes CPU preparation and Canvas2D'};
  }finally{fx.bindings=original;fx.shaderVariant='original';gl.drawArrays=drawArrays;if(candidate)gl.deleteProgram(candidate.p);}
 }
 window.ShaderBenchmark={compare};
})();
