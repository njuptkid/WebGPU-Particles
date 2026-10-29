window.ReleaseFixTestPromise=(async()=>{
 'use strict';
 const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const load=url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(url));i.src=url;});
 const report={date:new Date().toISOString(),checks:[],differences:[]};
 const check=(name,ok,detail)=>{report.checks.push({name,ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail));};
 const difference=(a,b)=>{let sum=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);}return {mean:sum/a.length,max};};
 for(const scene of ['app','desktop'])for(const screen of ['inner','outer']){
  const w=screen==='inner'?1292:632,h=screen==='inner'?914:924;let m;
  if(scene==='app'){
   const app=AppBlockExtractor.build(await load('../demo/assets/app-'+screen+'.jpg'),w,h);
   m={...app,fullSource:app.source,source:app.content,scene};
  }else{
   const img=await load('../demo/assets/desktop-'+screen+'-content.png'),source=make(w*2,h*2);source.getContext('2d').drawImage(img,0,0,source.width,source.height);
   m={w,h,source,background:await load('../demo/assets/desktop-'+screen+'-wallpaper.png'),scene};
  }
  const label=scene+'-'+screen,fx=new ParticleRenderer({...m,sampleStep:4}),old=new ParticleRenderer({...m,sampleStep:4,legacyRelease:true});
  const particles=new ParticleRenderer({...m,sampleStep:4,precomputeNoise:'particles'}),all=new ParticleRenderer({...m,sampleStep:4,precomputeNoise:'all'});
  const c=make(w,h),ctx=c.getContext('2d',{willReadFrequently:true});
  const draw=(f,q,d=-1,t=1)=>{f.draw(ctx,w,h,{dissolve:q,direction:d,fieldTime:t});return ctx.getImageData(0,0,w,h).data;};
  try{
   check(label+' precomputation enabled',particles.noiseCacheStatus.enabled&&all.noiseCacheStatus.enabled);
   check(label+' identical source samples',[old,particles,all].every(f=>f.count===fx.count&&f.samples.every((v,i)=>v===fx.samples[i])));
   for(const angle of [0,30,70,110,150,170,180])for(const direction of [-1,1]){
    const q=FoldClock.pose(angle,screen).dissolve,a=draw(fx,q,direction);
    for(const [name,f] of [['particles',particles],['all',all]]){
     const d=difference(a,draw(f,q,direction));
     check(label+' cache '+name+' '+angle+' '+direction,d.mean<1,d);
    }
    if(q===0||q===1){const d=difference(draw(old,q,direction),draw(fx,q,direction));check(label+' endpoint '+angle+' '+direction,d.max<=2&&d.mean<.02,d);}
   }
   const q=FoldClock.pose(150,screen).dissolve,a=draw(fx,q),b=draw(fx,q,-1,2),repeat=draw(fx,q),before=draw(old,q);
   check(label+' deterministic',difference(a,repeat).max===0);
   check(label+' field still evolves',difference(a,b).mean>0);
   report.differences.push({scene,screen,angle:150,...difference(before,a)});
   for(const f of [fx,old,particles,all])check(label+' GPU error-free '+f.legacyRelease+' '+!!f.noiseCache,f.gl.getError()===f.gl.NO_ERROR);
  }finally{for(const f of [fx,old,particles,all])f.dispose();}
 }
 document.getElementById('status').textContent=JSON.stringify(report,null,2);return report;
})().catch(e=>{document.getElementById('status').textContent=e.stack;throw e;});
