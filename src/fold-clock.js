(function(root){'use strict';
 const clamp=x=>Math.max(0,Math.min(1,x));
 function pose(angle,screen,outerLeftToRight=true){
  const normalized=clamp(angle/180);
  const dissolve=screen==='outer'?normalized:1-normalized;
  return {dissolve,time:1.65*Math.pow(dissolve,.78),direction:screen==='outer'?(outerLeftToRight?-1:1):-1};
 }
 function smooth(a,b,x){const t=clamp((x-a)/(b-a));return t*t*(3-2*t);}
 const api={pose,smooth,clamp};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.FoldClock=api;
})(typeof window==='object'?window:globalThis);
