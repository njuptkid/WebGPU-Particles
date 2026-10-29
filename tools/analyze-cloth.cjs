'use strict';
// Diagnostic shader ablations only; does not modify the production shaders.
module.exports=async function analyzeCloth(page,url,root){
 const fs=require('node:fs'),path=require('node:path');
 await page.goto(url+'/demo/compare.html');await page.evaluate(()=>window.ParticleComparison.setup);
 const report=await page.evaluate(()=>{
  const model=window.ParticleComparison.flows[0],S=ParticleShaders.legacy,original=S.appVertex,base=S.baseFragment;
  const grainHash='float diagnosticGrainHash(vec2 p) { vec3 v=fract(vec3(p.xyx)*.1031); v+=dot(v,v.yzx+33.33); return fract((v.x+v.y)*v.z); }\n';
  const replaceGrain=s=>s.replace('float hash(vec2 p)',grainHash+'float hash(vec2 p)').replace('hash(floor(p*.65))*.20','diagnosticGrainHash(floor(p*.65))*.20');
  const cases=[
   ['original','原始算法',s=>s],
   ['noRibbon','关闭带状正弦扰动',s=>s.replace('pos.y+=gust*(roll+ribbon);','pos.y+=gust*roll;')],
   ['noRoll','关闭双涡区扰动',s=>s.replace('pos.y+=gust*(roll+ribbon);','pos.y+=gust*ribbon;')],
   ['noBend','关闭应用域扭曲',s=>s.replace('pos.y+=bend*','pos.y+=0.*bend*')],
   ['noCoherentY','关闭全部连续纵向场',s=>s.replace('pos.y+=gust*(roll+ribbon);','pos.y+=0.;').replace('pos.y+=bend*','pos.y+=0.*bend*')],
   ['noFrontNoise','关闭释放前沿低频噪声',s=>s.replace('noise(p*.009)*.18','0.')],
   ['noFineBirthHash','关闭释放阈值细粒度 hash',s=>s.replace('hash(floor(p*.65))*.20','0.')],
   ['alternativeGrain','仅替换释放阈值细粒度 hash',replaceGrain],
   ['alternativeGrainBase','仅原图层＋替换细粒度 hash',replaceGrain],
   ['jitter','采样点加微小固定抖动',s=>s],
   ['smallPoints','粒子直径缩至 40%',s=>s.replace('gl_PointSize=diameter*2.*','gl_PointSize=diameter*.8*')],
   ['baseOnly','仅原始内容消散',s=>s],
   ['baseOnly2x','原图层原生 2× 输出',s=>s],
   ['particlesOnly','仅粒子层',s=>s]
  ];
  const frames=[],pose=FoldClock.pose(150,'inner',true);
  for(const [id,label,transform] of cases){
   let fx;
   try{
    S.appVertex=transform(original);S.baseFragment=id==='noFrontNoise'?base.replace('noise(p*.009)*.18','0.'):id==='noFineBirthHash'?base.replace('hash(floor(p*.65))*.20','0.'):id.startsWith('alternativeGrain')?replaceGrain(base):base;
    fx=new ParticleRenderer({...model,sampleStep:1.5,precomputeNoise:false,shaderVariant:'original',legacyRelease:true});
    if(id==='jitter'){
     let state=1234567;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
     for(let i=0;i<fx.samples.length;i+=3){fx.samples[i]+=(random()-.5)*1.2;fx.samples[i+1]+=(random()-.5)*1.2;}
     fx.gl.bindBuffer(fx.gl.ARRAY_BUFFER,fx.points);fx.gl.bufferData(fx.gl.ARRAY_BUFFER,fx.samples,fx.gl.STATIC_DRAW);
    }
    const scale=id==='baseOnly2x'?2:1;
    const c=Object.assign(document.createElement('canvas'),{width:model.w*scale,height:model.h*scale});
    if(id.startsWith('baseOnly')||id==='particlesOnly'||id==='alternativeGrainBase'){
     const g=fx.gl,draw=g.drawArrays;
     g.drawArrays=function(mode,...args){if((id!=='particlesOnly')===(mode===g.TRIANGLES))draw.call(g,mode,...args);};
    }
    fx.draw(c.getContext('2d'),c.width,c.height,{...pose,fieldTime:1});
    if(fx.gl.getError()!==fx.gl.NO_ERROR)throw Error('GL error: '+id);
    frames.push({id,label,particles:fx.count,png:c.toDataURL('image/png')});
   }finally{S.appVertex=original;S.baseFragment=base;if(fx)fx.dispose();}
  }
  return {angle:150,fieldTime:1,sampleStep:1.5,scene:'app',screen:'inner',frames};
 });
 const folder=path.join(root,'tests/cloth-analysis','angle-'+report.angle);fs.mkdirSync(folder,{recursive:true});
 for(const frame of report.frames)fs.writeFileSync(path.join(folder,frame.id+'.png'),Buffer.from(frame.png.split(',')[1],'base64'));
 await page.setViewportSize({width:1800,height:1600});
 await page.setContent('<meta charset="utf-8"><style>body{margin:0;padding:16px;background:#111820;color:white;font:18px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0;background:#19191b}figcaption{padding:8px;background:#253044}img{width:100%;display:block}</style><main>'+report.frames.map(f=>'<figure><figcaption>'+f.label+'</figcaption><img src="'+f.png+'"></figure>').join('')+'</main>');
 await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
 await page.screenshot({path:path.join(folder,'contact-sheet.png'),fullPage:true});
 fs.writeFileSync(path.join(folder,'report.json'),JSON.stringify({...report,frames:report.frames.map(({png,...f})=>f)},null,2)+'\n');
 console.log('Cloth diagnostics: '+report.frames.length+' ablations saved');
};
