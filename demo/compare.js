(()=>{'use strict';
 const $=id=>document.getElementById(id),make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const image=url=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(url));i.src=url;});
 const models={};let flows=[],ready=false,playing=false,start=0,last=0,raf=0,lastDiff=-Infinity,metrics=null;
 const fail=e=>{$('status').className='error';$('status').textContent=e.message;};
 function diff(){
  const a=$('original'),b=$('optimized'),c=$('difference'),ag=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bg=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
  const g=c.getContext('2d'),out=g.createImageData(c.width,c.height),gain=Number($('gain').value);let sum=0,max=0,changed=0,over8=0;
  for(let i=0;i<ag.length;i+=4){
   let peak=0;
   for(let k=0;k<4;k++){const d=Math.abs(ag[i+k]-bg[i+k]);sum+=d;max=Math.max(max,d);peak=Math.max(peak,d);}
   if(peak>0)changed++;if(peak>8)over8++;
   // Include alpha-only differences in the visible RGB diagnostic.
   for(let k=0;k<3;k++)out.data[i+k]=Math.min(255,Math.max(Math.abs(ag[i+k]-bg[i+k]),Math.abs(ag[i+3]-bg[i+3]))*gain);
   out.data[i+3]=255;
  }
  g.putImageData(out,0,0);metrics={mean:sum/ag.length,max,changedPixels:changed,pixels:a.width*a.height,pixelsOver8:over8};
  $('metrics').textContent='平均通道差 '+metrics.mean.toFixed(6)+'/255 · 最大通道差 '+max+'/255 · 有差异像素 '+(100*changed/metrics.pixels).toFixed(3)+'% · 差值超过 8 的像素 '+over8;
  $('gainValue').textContent=gain+'×';lastDiff=performance.now();return metrics;
 }
 function draw(forceDiff=true){
  if(!ready)return;
  const angle=Number($('angle').value),fieldTime=Number($('fieldTime').value)||0;
  const pose=FoldClock.pose(angle,$('screen').value,$('reverse').checked),layer=$('layer').value;
  $('angleValue').textContent=angle.toFixed(1)+'°';
  flows.forEach((fx,i)=>{
   const c=$(i?'optimized':'original'),ctx=c.getContext('2d');
   if(layer==='full')fx.draw(ctx,c.width,c.height,{...pose,fieldTime});
   else{
    const g=fx.gl,drawArrays=g.drawArrays.bind(g);
    g.drawArrays=(mode,...args)=>{if((layer==='base')===(mode===g.TRIANGLES))drawArrays(mode,...args);};
    try{ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(fx.renderRaw(pose.time,pose.direction,fieldTime),0,0,c.width,c.height);}
    finally{g.drawArrays=drawArrays;}
   }
  });
  if(forceDiff||performance.now()-lastDiff>150)diff();
 }
 function rebuild(){
  if(!ready)return;
  for(const fx of flows)fx.dispose();flows=[];
  const model=models[$('scene').value+'-'+$('screen').value],sampleStep=Number($('quality').value);
  try{
   const mode=$('mode').value,isCache=mode==='particles'||mode==='all';
   const releaseFix=mode==='releasefix';
   flows.push(new ParticleRenderer({...model,sampleStep,precomputeNoise:false,legacyRelease:releaseFix}));
   flows.push(new ParticleRenderer({...model,sampleStep,precomputeNoise:isCache?mode:false,shaderVariant:isCache||releaseFix?'original':mode}));
   for(const id of ['original','optimized','difference']){$(id).width=model.w;$(id).height=model.h;}
   if(isCache&&!flows[1].noiseCacheStatus.enabled)throw Error('预计算未启用，无法进行有效对照：'+flows[1].noiseCacheStatus.reason);
   $('status').className='';$('status').textContent='对照已就绪 · 两侧各 '+flows[0].count.toLocaleString()+' 粒子 · '+model.w+' × '+model.h;
   const experiment=ParticleShaders.experiments[mode];
   $('originalLabel').textContent=releaseFix?'修复前':'原算法（已修复细纹）';$('optimizedLabel').textContent=releaseFix?'修复后':'实验版本';
   $('optimizedInfo').textContent=releaseFix?'仅替换释放阈值细粒度 hash':isCache?(mode==='all'?'粒子＋内容消散':'粒子固定噪声')+' · '+(flows[1].noiseCache.bytes/1048576).toFixed(2)+' MiB':experiment?.label||'原算法自对照';
   $('experimentNote').textContent=releaseFix?'左侧保留旧释放纹理；右侧仅更换细粒度 hash。两侧不启用其他优化，可在 150° 附近观察蓝色卡片。':isCache?'两侧均已修复消散细纹；预计算实验存在量化误差。':mode==='original'?'两侧运行相同的已修复算法，用于检查对照和计时本身的波动。':'两侧均已修复消散细纹。'+experiment.description+(experiment.appOnly&&model.scene==='desktop'?' 此项仅影响应用内场景，当前桌面应与原版一致。':'');
   $('benchmark').disabled=isCache||releaseFix;$('benchmarkResult').textContent=releaseFix?'当前为修复前后视觉对照；切换算法实验可测 GPU 耗时。':isCache?'此计时入口用于算法实验；预计算结果见已有测试报告。':mode==='combined'?'尚未测量。当前组合同时启用七项算法，不包含预计算；收益需要实测。':'尚未测量。当前选择不会自动启用其他近似或预计算。';draw();
  }catch(e){fail(e);throw e;}
 }
 const ease=x=>x*x*x*(x*(x*6-15)+10);
 function tick(now){
  raf=0;
  if(playing){const t=((now-start)/6000)%1;$('angle').value=t<.5?180*ease(t*2):180*(1-ease((t-.5)*2));}
  if($('evolve').checked&&last)$('fieldTime').value=(Number($('fieldTime').value)+(now-last)/1000).toFixed(3);
  last=now;draw(false);
  if(playing||$('evolve').checked)raf=requestAnimationFrame(tick);
 }
 function run(){if(!raf&&(playing||$('evolve').checked)){last=performance.now();raf=requestAnimationFrame(tick);}}
 function pause(){playing=false;$('play').textContent='同步播放开合';}
 for(const id of ['scene','screen','mode','quality'])$(id).onchange=()=>{pause();rebuild();};
 $('angle').oninput=()=>{pause();draw();};$('reverse').onchange=()=>draw();$('layer').onchange=()=>draw();
 $('fieldTime').oninput=()=>{$('evolve').checked=false;draw();};$('gain').oninput=()=>{if(ready)diff();};
 $('evolve').onchange=()=>{run();draw();};
 $('play').onclick=()=>{playing=!playing;if(!playing)$('evolve').checked=false;start=performance.now();$('play').textContent=playing?'暂停并冻结对照':'同步播放开合';run();draw();};
 async function benchmark(){
  pause();$('evolve').checked=false;cancelAnimationFrame(raf);raf=0;draw();
  const controls=[...document.querySelectorAll('input,select,button')],disabled=controls.map(c=>c.disabled);
  controls.forEach(c=>{c.disabled=true;});$('benchmarkResult').textContent='正在交替测量原算法与当前实验，请稍候…';
  try{
   const pose=FoldClock.pose(Number($('angle').value),$('screen').value,$('reverse').checked);
   const result=await ShaderBenchmark.compare(flows[0],$('mode').value,{...pose,pass:$('layer').value==='full'?'both':$('layer').value,fieldTime:Number($('fieldTime').value)||0});
   window.ParticleComparison.lastBenchmark=result;
   $('benchmarkResult').textContent=result.available?
    'GPU 中位数：原版 '+result.original.p50Ms.toFixed(3)+' ms / 实验 '+result.candidate.p50Ms.toFixed(3)+' ms；耗时变化 '+(result.gpuTimeChangePercent>=0?'+':'')+result.gpuTimeChangePercent.toFixed(1)+'%。'+(result.unstable?' 样本波动较大，不能认定稳定收益。':' 这是当前固定状态的结果，仍需覆盖其他阶段。'):
    result.reason;
   return result;
  }catch(e){$('benchmarkResult').textContent=e.message;throw e;}
  finally{controls.forEach((c,i)=>{c.disabled=disabled[i];});draw();}
 }
 $('benchmark').onclick=()=>benchmark().catch(fail);
 const setup=(async()=>{
  for(const screen of ['inner','outer']){
   const w=screen==='inner'?1292:632,h=screen==='inner'?914:924;
   const [desktop,background,app]=await Promise.all([image('assets/desktop-'+screen+'-content.png'),image('assets/desktop-'+screen+'-wallpaper.png'),image('assets/app-'+screen+'.jpg')]);
   const source=make(w*2,h*2);source.getContext('2d').drawImage(desktop,0,0,source.width,source.height);
   models['desktop-'+screen]={w,h,source,background,scene:'desktop'};
   const m=AppBlockExtractor.build(app,w,h);models['app-'+screen]={...m,fullSource:m.source,source:m.content,scene:'app'};
  }
  ready=true;rebuild();return true;
 })();
 window.ParticleComparison={setup,draw,rebuild,pause,benchmark,get metrics(){return metrics;},get flows(){return flows;},get ready(){return ready;}};
 setup.catch(fail);window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);for(const fx of flows)fx.dispose();});
})();
