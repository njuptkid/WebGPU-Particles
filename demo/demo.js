(()=>{'use strict';
 const $=id=>document.getElementById(id),make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const models={},flows={};let shown=false,playing=false,start=0,ready=false;
 const image=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error(src));i.src=src;});
 async function setup(){
  for(const which of ['inner','outer']){
   const w=which==='inner'?1292:632,h=which==='inner'?914:924;
   const [source,bg,app]=await Promise.all([image('assets/desktop-'+which+'-content.png'),image('assets/desktop-'+which+'-wallpaper.png'),image('assets/app-'+which+'.jpg')]);
   const content=make(w*2,h*2);content.getContext('2d').drawImage(source,0,0,content.width,content.height);
   models['desktop-'+which]={w,h,source:content,background:bg,scene:'desktop'};
   const m=AppBlockExtractor.build(app,w,h);models['app-'+which]={...m,fullSource:m.source,source:m.content,scene:'app'};
  }ready=true;rebuild();
 }
 function rebuild(){if(!ready)return;
  for(const which of ['inner','outer']){flows[which]?.dispose();const m=models[$('scene').value+'-'+which];flows[which]=new ParticleRenderer({...m,sampleStep:Number($('quality').value),precomputeNoise:$('precompute').checked?($('releaseCache').checked?'all':'particles'):false});const fx=flows[which];$(which+'Info').textContent=fx.count.toLocaleString()+' 粒子'+(m.blocks?' / '+m.blocks.length+' 个完整内容单元':' / 仅采样壁纸上层')+(fx.noiseCache?' / '+(fx.noiseCache.release?'粒子＋原图':'粒子')+'噪声缓存 '+(fx.noiseCache.bytes/1048576).toFixed(1)+' MiB':fx.noiseCacheStatus.requested?' / 缓存回退：'+fx.noiseCacheStatus.reason:' / 原算法');}
  $('status').textContent='已就绪 · '+($('scene').value==='app'?'背景底色常驻，大卡片不再切分，内容块原位碎化':'壁纸独立，上层元素逐渐碎化');draw(0);
 }
 function draw(fieldTime){if(!ready)return;
  const angle=Number($('angle').value);$('angleValue').textContent=angle.toFixed(1)+'°';
  for(const which of ['inner','outer']){
   const c=$(which),m=models[$('scene').value+'-'+which];
   if(shown&&m.preview){c.getContext('2d').drawImage(m.preview,0,0,c.width,c.height);continue;}
   const pose=FoldClock.pose(angle,which,$('reverse').checked);flows[which].draw(c.getContext('2d'),c.width,c.height,{...pose,fieldTime});
  }
 }
 const ease=x=>x*x*x*(x*(x*6-15)+10);
 function tick(now){if(playing){let t=Math.min(1,(now-start)/4000);$('angle').value=t<=.5?180*ease(t*2):180*(1-ease((t-.5)*2));if(t===1){playing=false;$('play').textContent='播放闭合 → 展开 → 闭合';}}draw(now/1000);requestAnimationFrame(tick);}
 $('play').onclick=()=>{shown=false;playing=!playing;start=performance.now();$('play').textContent=playing?'停止播放':'播放闭合 → 展开 → 闭合';};
 $('angle').oninput=()=>{playing=false;$('play').textContent='播放闭合 → 展开 → 闭合';};
 $('scene').onchange=()=>{shown=false;rebuild();};$('quality').onchange=rebuild;$('precompute').onchange=rebuild;$('releaseCache').onchange=rebuild;$('preview').onclick=()=>{shown=!shown;};
 window.HandoffDemo={models,flows,draw,rebuild,get ready(){return ready;}};
 setup().then(()=>requestAnimationFrame(tick)).catch(e=>{$('status').textContent=e.message;});
})();
