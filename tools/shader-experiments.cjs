'use strict';
// Independent experiments and an explicit composition. Original GLSL stays intact.
module.exports=function buildExperiments(sources,read){
 const inject=(s,code)=>s.replace('vec2 transport(',code+'\nvec2 transport(');
 const change=(s,from,to)=>{if(!s.includes(from))throw Error('Experiment marker missing: '+from);return s.split(from).join(to);};
 const bend=(s,transform)=>{
  const a=s.indexOf(' vec2 warp='),b=s.indexOf(' pos.y+=bend',a);
  if(a<0||b<0)throw Error('Dynamic bend markers missing');
  return s.slice(0,a)+transform(s.slice(a,b))+s.slice(b);
 };
 const definitions={
  uniforms:{label:'公共流场参数移至 uniform',usesFlowUniforms:true,description:'每帧在 CPU 计算 8 个公共三角函数项，粒子空间波形保持原公式。'},
  noise2:{label:'动态噪声 4 次 → 2 次',appOnly:true,description:'移除嵌套 warp，保留两个尺度的值噪声；流场形状会改变。'},
  hashfast:{label:'动态噪声使用无 sin 的 hash',appOnly:true,description:'只更换动态 bend 内的随机映射，保持释放阈值、粒子属性和噪声层数。'},
  envelope:{label:'涡区 exp 改为多项式',description:'以 max(0,1-z/4) 的四次方替代指数包络，涡区衰减形状会改变。'},
  radial:{label:'圆点用距离平方塑形',description:'去掉圆点片元的 length，柔边和整体覆盖感会改变。'},
  wave:{label:'空间正弦改为近似波形',description:'仅替换 4 个空间波形，保留随机 hash 和全局相位中的三角函数。'},
  growth:{label:'饱和增长 exp 改为有理式',description:'替换 1-exp(-x)，含倒数运算，不保证更快。'}
 };
 const combinedFeatures=Object.keys(definitions);
 definitions.combined={label:'组合优化实验（7 项）',usesFlowUniforms:true,features:combinedFeatures,
  description:'同时启用公共 uniform、两层动态噪声、无 sin 的动态 hash、多项式涡区、距离平方圆点、近似空间波形和有理式增长；不叠加预计算，释放前沿保持原算法。'};
 const result={};
 for(const [name,meta] of Object.entries(definitions)){
  const features=new Set(meta.features||[name]);
  const experiment={...meta,features:[...features],pointFragment:sources.pointFragment};
  for(const scene of ['app','desktop']){
   let s=sources[scene+'Vertex'];
   if(features.has('uniforms')){
    s=inject(s,'uniform float flowRadius;\nuniform vec3 flowAmplitudes;\nuniform vec4 flowOffsets;');
    s=change(s,'min(resolution.x,resolution.y)*(.30+.035*sin(phase*.81))','flowRadius');
    for(const [from,to] of [
     ['(119.+32.*sin(phase*.91))','flowAmplitudes.x'],['.42*sin(phase)','flowOffsets.x'],
     ['(94.+26.*cos(phase*.77))','flowAmplitudes.y'],['.36*cos(phase*.89)','flowOffsets.y'],
     ['(90.+25.*sin(phase*.69))','flowAmplitudes.z'],['.48*sin(phase*.83)','flowOffsets.z'],
     ['.38*cos(phase*.71)','flowOffsets.w']])s=change(s,from,to);
   }
   if(features.has('noise2')&&scene==='app'){
    const noise=features.has('hashfast')?'motionNoise':'noise';
    s=bend(s,()=>
     ' float bend=('+noise+'(q+vec2(phase*.28,-phase*.17))-.5)*180.\n'+
     '  +('+noise+'(q*2.2+vec2(-phase*.25,phase*.31))-.5)*58.;\n');
   }
   if(features.has('hashfast')&&scene==='app'){
    if(!features.has('noise2'))s=bend(s,chunk=>chunk.replace(/\bnoise\(/g,'motionNoise('));
    s=inject(s,read('fastMotionNoise'));
   }
   if(features.has('envelope')){
    s=inject(s,read('compactEnvelope'));
    s=change(s,'exp(-q.y*q.y*.72-q.x*q.x*.24)','compactEnvelope(q.y*q.y*.72+q.x*q.x*.24)');
    s=change(s,'exp(-q.y*q.y*.85-q.x*q.x*.27)','compactEnvelope(q.y*q.y*.85+q.x*q.x*.27)');
   }
   if(features.has('wave')){
    s=inject(s,read('fastWave'));s=change(s,'sin(q.x*','fastWave(q.x*');s=change(s,'sin(pos.y*','fastWave(pos.y*');
   }
   if(features.has('growth')){
    s=inject(s,read('fastGrowth'));s=change(s,'1.-exp(-age*2.7)','fastGrowth(age*2.7)');
    if(scene==='app')s=change(s,'1.-exp(-localAge*4.)','fastGrowth(localAge*4.)');
   }
   experiment[scene+'Vertex']=s;
  }
  if(features.has('radial'))experiment.pointFragment=read('pointFragmentSquared');
  result[name]=experiment;
 }
 return result;
};
