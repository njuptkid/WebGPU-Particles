window.HandoffTestPromise=(async()=>{
 const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const load=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(src));i.src=src;});
 const checks=[],metrics=[],frames=[];const check=(name,ok,detail)=>{checks.push({name,ok,detail});if(!ok)throw Error(name+' '+JSON.stringify(detail));};
 const hash=c=>{let n=2166136261;for(const v of c.getContext('2d').getImageData(0,0,c.width,c.height).data)n=Math.imul(n^v,16777619);return n>>>0;};
 const stats=a=>({min:Math.min(...a),median:[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],max:Math.max(...a)});
 for(const which of ['inner','outer']){
  const w=which==='inner'?1292:632,h=which==='inner'?914:924,img=await load('../demo/assets/app-'+which+'.jpg'),times=[];let m;
  for(let n=0;n<3;n++){let t=performance.now();m=AppBlockExtractor.build(img,w,h);times.push(performance.now()-t);}
  check(which+' exact content unit count',m.blocks.length===(which==='inner'?26:12),m.blocks.length);
  const cards=m.blocks.filter(e=>e.kind==='content-card');
  check(which+' large cards not subdivided',cards.some(e=>e.width*e.height>320*320)&&m.blocks.every(e=>!e.parentId));
  check(which+' banners / covers retained',which==='inner'?cards.length===8:cards.length===4,cards.length);
  const rebuilt=make(w*2,h*2),g=rebuilt.getContext('2d');g.drawImage(m.background,0,0);g.drawImage(m.content,0,0);
  check(which+' masks reconstruct original screenshot',hash(rebuilt)===hash(m.source));
  let t=performance.now();const fx=new ParticleRenderer({...m,fullSource:m.source,source:m.content,scene:'app',precomputeNoise:'particles'});const prepareMs=performance.now()-t;
  check(which+' every particle has a valid block',fx.count===fx.blockIds.length&&fx.blockIds.every(id=>id<m.blocks.length));
  check(which+' all blocks sampled',new Set(fx.blockIds).size===m.blocks.length);
  check(which+' background excluded',fx.count<w*h/2.25*.94,{count:fx.count});
  const c=make(w,h),ctx=c.getContext('2d'),state=(q,d=-1,time=1)=>({dissolve:q,direction:d,fieldTime:time});
  fx.draw(ctx,w,h,state(0));const reference=make(w,h);reference.getContext('2d').drawImage(m.source,0,0,w,h);check(which+' complete endpoint',hash(c)===hash(reference));
  fx.draw(ctx,w,h,state(1));const bg=ctx.getImageData(0,0,w,h).data;check(which+' fixed opaque background',bg.every((v,i)=>v===(i%4===3?255:m.backgroundColor[i%4])));
  fx.draw(ctx,w,h,state(.4,-1,1));const first=hash(c),firstPixels=ctx.getImageData(0,0,w,h).data.slice();fx.draw(ctx,w,h,state(.4,-1,2));check(which+' field evolves',hash(c)!==first);fx.draw(ctx,w,h,state(.4,-1,1));const repeated=ctx.getImageData(0,0,w,h).data;let maxRepeatDifference=0;for(let i=0;i<repeated.length;i++)maxRepeatDifference=Math.max(maxRepeatDifference,Math.abs(repeated[i]-firstPixels[i]));check(which+' fixed inputs reproduce',maxRepeatDifference<=2,{maxRepeatDifference});
  for(const d of [-1,1]){
   // Isolate the static content pass to measure a continuous horizontal front.
   const original=fx.gl.drawArrays.bind(fx.gl);fx.gl.drawArrays=(mode,...args)=>{if(mode!==fx.gl.POINTS)original(mode,...args);};
   const raw=fx.renderRaw(.73,d,1),read=make(raw.width,raw.height);read.getContext('2d').drawImage(raw,0,0);fx.gl.drawArrays=original;
   const a=read.getContext('2d').getImageData(0,0,read.width,read.height).data,b=m.content.getContext('2d').getImageData(0,0,read.width,read.height).data,sum=[0,0],count=[0,0];
   let spill=0;for(let y=0;y<read.height;y++)for(let x=0;x<read.width;x++){const i=(y*read.width+x)*4,side=x<read.width/3?0:x>read.width*2/3?1:-1;if(side>=0&&b[i+3]>200){sum[side]+=a[i+3]/255;count[side]++;}if(a[i+3]>10&&b[i+3]===0)spill++;}
   const left=sum[0]/count[0],right=sum[1]/count[1];check(which+' direction '+d,d<0?left-right>.2:right-left>.2,{left,right});check(which+' intact content stays in place '+d,spill===0,spill);
  }
  const render=[];for(let n=0;n<5;n++){t=performance.now();fx.renderRaw(.8,-1,n*.1);fx.gl.finish();render.push(performance.now()-t);}check(which+' GPU error-free',fx.gl.getError()===fx.gl.NO_ERROR);
  metrics.push({scene:'app',which,blocks:m.blocks.length,particles:fx.count,buildMs:stats(times),sampleAndUploadMs:prepareMs,cpuSubmitAndFinishCallMs:stats(render),note:'desktop Chrome; JS submission/finish-call wall time only; zero does NOT indicate GPU execution time; NOT phone frame pacing / capture latency'});
  for(const angle of [30,70,110,150]){const pose=FoldClock.pose(angle,which,true);fx.draw(ctx,w,h,{...pose,fieldTime:1});const small=make(Math.round(w*.6),Math.round(h*.6));small.getContext('2d').drawImage(c,0,0,small.width,small.height);frames.push({scene:'app',which,angle,data:small.toDataURL('image/jpeg',.90).split(',')[1]});}
  fx.dispose();
  const srcImage=await load('../demo/assets/desktop-'+which+'-content.png'),wallpaper=await load('../demo/assets/desktop-'+which+'-wallpaper.png'),source=make(w*2,h*2);source.getContext('2d').drawImage(srcImage,0,0);
  const desktop=new ParticleRenderer({w,h,source,background:wallpaper,precomputeNoise:'particles'});check(which+' desktop source is transparent',source.getContext('2d').getImageData(0,0,source.width,source.height).data.some((v,i)=>i%4===3&&v===0));
  desktop.draw(ctx,w,h,state(1));reference.getContext('2d').clearRect(0,0,w,h);reference.getContext('2d').drawImage(wallpaper,0,0,w,h);check(which+' desktop preserves wallpaper',hash(c)===hash(reference));
  metrics.push({scene:'desktop',which,particles:desktop.count});
  for(const angle of [30,70,110,150]){desktop.draw(ctx,w,h,{...FoldClock.pose(angle,which,true),fieldTime:1});const small=make(Math.round(w*.6),Math.round(h*.6));small.getContext('2d').drawImage(c,0,0,small.width,small.height);frames.push({scene:'desktop',which,angle,data:small.toDataURL('image/jpeg',.90).split(',')[1]});}
  desktop.dispose();
 }
 const report={date:new Date().toISOString(),environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency},checks,metrics};
 document.getElementById('status').textContent=JSON.stringify(report,null,2);window.HandoffTestFrames=frames;return report;
})().catch(e=>{document.getElementById('status').textContent=e.stack;throw e;});


