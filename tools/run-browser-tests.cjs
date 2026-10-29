'use strict';
// Optional development dependency: playwright, with a local Chrome installation.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=spawn(process.execPath,[path.join(__dirname,'serve.cjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser;
 try{
  const url=await new Promise((resolve,reject)=>{
   let output='';const timeout=setTimeout(()=>reject(Error('Server startup timed out')),10000);
   server.once('error',reject);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});
  });
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  if(process.argv.includes('--release-fix')){
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url+'/tests/release-fix.html');const report=await page.evaluate(()=>window.ReleaseFixTestPromise);
   await page.setViewportSize({width:1560,height:1200});await page.goto(url+'/demo/compare.html');await page.evaluate(()=>window.ParticleComparison.setup);
   const valid=await page.evaluate(()=>document.getElementById('mode').value==='releasefix'&&window.ParticleComparison.flows[0].legacyRelease&&!window.ParticleComparison.flows[1].legacyRelease);
   if(!valid||errors.length)throw Error('Fix UI failed: '+errors.join('\n'));
   report.checks.push({name:'default comparison is before/after release fix',ok:true});
   await page.screenshot({path:path.join(root,'tests/release-fix-preview.png'),fullPage:true});
   await page.selectOption('#layer','base');
   await page.screenshot({path:path.join(root,'tests/release-fix-base-preview.png'),fullPage:true});
   fs.writeFileSync(path.join(root,'tests/release-fix-report.json'),JSON.stringify(report,null,2)+'\n');
   console.log('release fix: PASS '+report.checks.length+' checks');return;
  }
  if(process.argv.includes('--cloth')){await require('./analyze-cloth.cjs')(page,url,root);return;}
  if(process.argv.includes('--experiments')||process.argv.includes('--combined')){
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   const query=new URLSearchParams();if(process.argv.includes('--benchmark'))query.set('benchmark','1');if(process.argv.includes('--combined'))query.set('combined','1');
   await page.goto(url+'/tests/experiments.html?'+query);
   const report=await page.evaluate(()=>window.ExperimentTestPromise);
   await page.setViewportSize({width:1560,height:1200});
   await page.goto(url+'/demo/compare.html');await page.evaluate(()=>window.ParticleComparison.setup);
   const smoke=await page.evaluate(()=>{
    const ui=window.ParticleComparison,$=id=>document.getElementById(id),checks=[];
    for(const variant of Object.keys(ParticleShaders.experiments)){
     $('mode').value=variant;$('quality').value='4';ui.rebuild();
     if(ui.flows[0].shaderVariant!=='original'||ui.flows[1].shaderVariant!==variant||ui.flows[1].noiseCache)throw Error('Wrong comparison pair: '+variant);
     checks.push({name:'comparison page '+variant,ok:true});
    }
    $('mode').value='original';ui.rebuild();if(ui.metrics.max!==0)throw Error('Original self comparison differs');
    checks.push({name:'original self comparison',ok:true});
    $('mode').value='combined';$('quality').value='1.5';$('angle').value='110';ui.rebuild();return checks;
   });
   report.checks.push(...smoke);
   if(process.argv.includes('--combined')){
    await page.click('#benchmark');
    await page.waitForFunction(()=>window.ParticleComparison.lastBenchmark&&!document.getElementById('benchmark').disabled);
    report.uiBenchmark=await page.evaluate(()=>window.ParticleComparison.lastBenchmark);
    report.checks.push({name:'combined GPU button restores controls and original shader',ok:await page.evaluate(()=>!document.getElementById('mode').disabled&&window.ParticleComparison.flows[0].shaderVariant==='original')});
    if(!report.checks.at(-1).ok)throw Error('Combined benchmark did not restore UI state');
   }
   if(errors.length)throw Error(errors.join('\n'));
   const prefix=process.argv.includes('--combined')?'combined':'experiments';
   await page.screenshot({path:path.join(root,'tests',prefix+'-preview.png'),fullPage:true});
   fs.writeFileSync(path.join(root,'tests',prefix+(process.argv.includes('--benchmark')?'-report.json':'-validation-report.json')),JSON.stringify(report,null,2)+'\n');
   console.log('experiments: PASS '+report.checks.length+' checks / '+report.benchmarks.length+' GPU comparisons');return;
  }
  if(process.argv.includes('--comparison-only')){
   await page.setViewportSize({width:1440,height:1100});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(url+'/demo/compare.html');await page.evaluate(()=>window.ParticleComparison.setup);
   const report=await page.evaluate(()=>{
    const ui=window.ParticleComparison,$=id=>document.getElementById(id),checks=[];
    const check=(name,ok,detail)=>{checks.push({name,ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail));};
    for(const scene of ['app','desktop'])for(const screen of ['inner','outer'])for(const mode of ['particles','all']){
     $('scene').value=scene;$('screen').value=screen;$('mode').value=mode;$('quality').value='4';ui.rebuild();
     check(scene+'-'+screen+'-'+mode+' valid pair',!ui.flows[0].noiseCache&&!!ui.flows[1].noiseCache&&ui.flows[0].count===ui.flows[1].count);
     for(const layer of ['full','particles','base'])for(const angle of [0,90,180]){
      $('layer').value=layer;$('angle').value=angle;ui.draw();const m={...ui.metrics};
      check(scene+'-'+screen+'-'+mode+'-'+layer+'-'+angle,m.mean<1&&m.pixelsOver8/m.pixels<.02,m);
      if(layer==='full'&&(angle===0||angle===180))check('complete endpoint '+scene+'-'+screen+'-'+mode+'-'+angle,m.max===0,m);
     }
    }
    $('scene').value='app';$('screen').value='inner';$('mode').value='particles';$('quality').value='1.5';$('layer').value='full';$('angle').value='110';$('fieldTime').value='1';ui.rebuild();
    return {date:new Date().toISOString(),checks,initialView:ui.metrics};
   });
   await page.click('#play');await page.waitForTimeout(200);await page.click('#play');
   const frozen=await page.evaluate(()=>document.getElementById('angle').value);await page.waitForTimeout(100);
   if(await page.evaluate(()=>document.getElementById('angle').value)!==frozen)throw Error('Paused comparison did not freeze');
   await page.evaluate(()=>{document.getElementById('angle').value='110';window.ParticleComparison.draw();});
   if(errors.length)throw Error(errors.join('\n'));
   report.checks.push({name:'synchronized playback pauses',ok:true});
   await page.screenshot({path:path.join(root,'tests/comparison-preview.png'),fullPage:true});
   fs.writeFileSync(path.join(root,'tests/comparison-report.json'),JSON.stringify(report,null,2)+'\n');
   console.log('comparison: PASS '+report.checks.length+' checks');return;
  }
  for(const [file,promise,output] of [['browser.html','HandoffTestPromise','browser-precomputed-report.json'],['noise.html','NoiseTestPromise','noise-report.json']]){
   await page.goto(url+'/tests/'+file+(process.argv.includes('--benchmark')?'?benchmark=1':''));
   const report=await page.evaluate(name=>window[name],promise);
   const reportName=output==='noise-report.json'&&!process.argv.includes('--benchmark')?'noise-validation-report.json':output;
   fs.writeFileSync(path.join(root,'tests',reportName),JSON.stringify(report,null,2)+'\n');
   console.log(file+': PASS '+report.checks.length+' checks');
  }
 }finally{if(browser)await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
