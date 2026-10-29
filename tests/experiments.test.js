window.ExperimentTestPromise=(async()=>{
 'use strict';
 const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const load=url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(url));i.src=url;});
 const report={date:new Date().toISOString(),checks:[],visuals:[],benchmarks:[],environment:{userAgent:navigator.userAgent},experiments:Object.fromEntries(Object.entries(ParticleShaders.experiments).map(([k,v])=>[k,{label:v.label,description:v.description,features:v.features}]))};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail));};
 const difference=(a,b)=>{let sum=0,max=0,energyA=0,energyB=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(i%4===3){energyA+=a[i];energyB+=b[i];}}return {mean:sum/a.length,max,alphaRatio:energyA?energyB/energyA:null};};
 async function model(scene,screen){
  const w=screen==='inner'?1292:632,h=screen==='inner'?914:924;
  if(scene==='app'){
   const m=AppBlockExtractor.build(await load('../demo/assets/app-'+screen+'.jpg'),w,h);
   return {...m,fullSource:m.source,source:m.content,scene};
  }
  const source=make(w*2,h*2),img=await load('../demo/assets/desktop-'+screen+'-content.png');source.getContext('2d').drawImage(img,0,0,source.width,source.height);
  return {w,h,source,scene,background:await load('../demo/assets/desktop-'+screen+'-wallpaper.png')};
 }
 for(const scene of ['app','desktop'])for(const screen of ['inner','outer']){
  const m=await model(scene,screen),raw=new ParticleRenderer({...m,sampleStep:4});
  const c=make(m.w,m.h),ctx=c.getContext('2d',{willReadFrequently:true});
  const capture=(fx,time,direction,fieldTime,pass='both')=>{
   const g=fx.gl,draw=g.drawArrays;
   if(pass!=='both')g.drawArrays=function(mode,...args){if((pass==='base')===(mode===g.TRIANGLES))draw.call(g,mode,...args);};
   try{ctx.clearRect(0,0,m.w,m.h);ctx.drawImage(fx.renderRaw(time,direction,fieldTime),0,0,m.w,m.h);}
   finally{g.drawArrays=draw;}
   return ctx.getImageData(0,0,m.w,m.h).data;
  };
  const endpoint=(fx,q)=>{fx.draw(ctx,m.w,m.h,{dissolve:q,direction:-1,fieldTime:1});return ctx.getImageData(0,0,m.w,m.h).data;};
  try{
   const reference={base:capture(raw,.73,-1,1,'base'),negative:capture(raw,.73,-1,1),positive:capture(raw,.73,1,1)};
   for(const variant of Object.keys(ParticleShaders.experiments)){
    const fx=new ParticleRenderer({...m,sampleStep:4,shaderVariant:variant}),label=scene+'-'+screen+'-'+variant;
    try{
     check(label+' same samples and no precomputation',fx.count===raw.count&&!fx.noiseCache);
     check(label+' original content pass unchanged',difference(reference.base,capture(fx,.73,-1,1,'base')).max===0);
     for(const direction of [-1,1]){
      const a=capture(fx,.73,direction,1),repeat=capture(fx,.73,direction,1),changed=capture(fx,.73,direction,2);
      const d=difference(direction<0?reference.negative:reference.positive,a);
      report.visuals.push({scene,screen,variant,time:.73,direction,fieldTime:1,...d});
      check(label+' deterministic '+direction,difference(a,repeat).max===0);
      check(label+' evolving field '+direction,difference(a,changed).mean>0);
      check(label+' nonempty coverage '+direction,d.alphaRatio>.1&&d.alphaRatio<10,d);
      if(scene==='desktop'&&ParticleShaders.experiments[variant].appOnly)check(label+' app-only experiment is unchanged '+direction,d.max===0,d);
     }
     // Compare both direct Canvas paths after the same source readback state.
     const complete=difference(endpoint(raw,0),endpoint(fx,0)),background=difference(endpoint(raw,1),endpoint(fx,1));
     check(label+' complete endpoint',complete.max<=2&&complete.mean<.02,complete);
     check(label+' background endpoint',background.max<=2&&background.mean<.02,background);
     check(label+' no GL errors',fx.gl.getError()===fx.gl.NO_ERROR);
    }finally{fx.dispose();}
   }
  }finally{raw.dispose();}
 }
 if(new URLSearchParams(location.search).has('benchmark')){
  const m=await model('app','inner'),fx=new ParticleRenderer({...m,sampleStep:1.5});
  try{
   const g=fx.gl,e=g.getExtension('WEBGL_debug_renderer_info');report.environment.renderer=e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);
   const combined=new URLSearchParams(location.search).has('combined');
   for(const variant of combined?['original','combined']:['original',...Object.keys(ParticleShaders.experiments)]){
    const states=combined&&variant==='combined'?[{time:.4,direction:-1},{time:.73,direction:-1},{time:1.2,direction:-1},{time:.73,direction:1}]:[{time:.73,direction:-1}];
    for(const state of states)for(const pass of ['particles','both']){
     const result=await ShaderBenchmark.compare(fx,variant,{...state,fieldTime:1,pass});
     report.benchmarks.push(result);document.getElementById('status').textContent='GPU benchmark '+variant+' / '+pass+' / '+state.time;
    }
   }
   check('benchmark restores original renderer',fx.shaderVariant==='original'&&fx.gl.getError()===fx.gl.NO_ERROR);
  }finally{fx.dispose();}
 }
 document.getElementById('status').textContent=JSON.stringify(report,null,2);return report;
})().catch(e=>{document.getElementById('status').textContent=e.stack;throw e;});
