(() => {
 'use strict';
 const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 function components(mask,w,h){
  const seen=new Uint8Array(mask.length),queue=new Int32Array(mask.length),out=[];
  for(let start=0;start<mask.length;start++)if(mask[start]&&!seen[start]){
   let head=0,tail=1,x1=w,y1=h,x2=0,y2=0;queue[0]=start;seen[start]=1;
   while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;x1=Math.min(x1,x);y1=Math.min(y1,y);x2=Math.max(x2,x);y2=Math.max(y2,y);
    for(const j of [x?i-1:-1,x<w-1?i+1:-1,y?i-w:-1,y<h-1?i+w:-1])if(j>=0&&mask[j]&&!seen[j]){seen[j]=1;queue[tail++]=j;}
   }
   out.push({x:x1,y:y1,width:x2-x1+1,height:y2-y1+1,area:tail});
  }return out;
 }
 function morph(input,w,h,r,dilate){
  const out=new Uint8Array(input.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   let result=dilate?0:1;
   search:for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++)if(Boolean(input[yy*w+xx])===dilate){result=dilate?1:0;break search;}
   out[y*w+x]=result;
  }return out;
 }
 const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 function detect(source,logicalW,logicalH,settings){
  const scale=320/Math.min(logicalW,logicalH),w=Math.round(logicalW*scale),h=Math.round(logicalH*scale),canvas=make(w,h),g=canvas.getContext('2d');
  g.drawImage(source,0,0,w,h);const data=g.getImageData(0,0,w,h).data,n=w*h,short=Math.min(w,h),sensitivity=settings.edge/100;
  const bins=new Uint32Array(4096);for(let i=0;i<data.length;i+=4){const r=data[i],green=data[i+1],b=data[i+2];if(Math.max(r,green,b)-Math.min(r,green,b)<30)bins[(r>>4)*256+(green>>4)*16+(b>>4)]++;}
  let bin=0;for(let i=1;i<bins.length;i++)if(bins[i]>bins[bin])bin=i;
  const background=[(bin>>8)*16+8,((bin>>4)&15)*16+8,(bin&15)*16+8],sum=[0,0,0];let count=0;
  for(let i=0;i<data.length;i+=4)if((data[i]>>4)*256+(data[i+1]>>4)*16+(data[i+2]>>4)===bin){for(let k=0;k<3;k++)sum[k]+=data[i+k];count++;}
  if(count)for(let k=0;k<3;k++)background[k]=sum[k]/count;
  const foreground=new Uint8Array(n),threshold=18-8*sensitivity;
  for(let i=0;i<n;i++)foreground[i]=(Math.abs(data[i*4]-background[0])+Math.abs(data[i*4+1]-background[1])+Math.abs(data[i*4+2]-background[2]))/3>threshold?1:0;
  const closed=morph(morph(foreground,w,h,1,true),w,h,1,false),raw=components(closed,w,h),candidates=[];
  const minArea=short*short*.0014*Math.pow(settings.size/100,1.25)*(1.6-settings.variation/100),minWidth=short*.045;
  function add(box,type,score=1,radius=0){
   const x=Math.max(0,Math.floor(box.x)),y=Math.max(0,Math.floor(box.y)),right=Math.min(w,Math.ceil(box.x+box.width)),bottom=Math.min(h,Math.ceil(box.y+box.height));
   if(right-x<minWidth||bottom-y<short*.022||(right-x)*(bottom-y)<minArea)return;
   candidates.push({x,y,width:right-x,height:bottom-y,type,score,radius});
  }
  // Color-connected closed regions provide whole banners, pills and cards.
  // If an overlay connects a row of covers at its bottom, separate their
  // upper silhouettes by persistent vertical gutters before extracting them.
  for(const c of raw){
   if(c.area<minArea||c.width<minWidth||c.height<short*.022)continue;
   const profile=[];const topEnd=Math.min(c.y+c.height,c.y+Math.max(3,Math.floor(c.height*.42)));
   for(let x=c.x;x<c.x+c.width;x++){let total=0;for(let y=c.y;y<topEnd;y++)total+=closed[y*w+x];profile.push(total/(topEnd-c.y));}
   const spans=[];let start=-1;
   for(let x=0;x<=profile.length;x++){
    if(x<profile.length&&profile[x]>.24){if(start<0)start=x;}
    else if(start>=0){if(x-start>minWidth)spans.push([c.x+start,c.x+x]);start=-1;}
   }
   if(c.width>short*.7&&c.height>short*.13&&spans.length>=2&&spans.length<=12){
    for(const [left,right] of spans)add({x:left,y:c.y,width:right-left,height:c.height},'card',1.05,Math.min(5,c.height*.06));
   }else if(c.area/(c.width*c.height)>.38)add(c,c.height>short*.12?'card':'control',1,Math.min(c.height/2,c.width/2,c.height<short*.09?100:5));
  }
  const pixel=(x,y,k)=>data[(Math.min(h-1,Math.max(0,Math.round(y)))*w+Math.min(w-1,Math.max(0,Math.round(x))))*4+k];
  function contrast(x,y,nx,ny){let total=0;for(let k=0;k<3;k++)total+=Math.abs(pixel(x+nx*1.5,y+ny*1.5,k)-pixel(x-nx*1.5,y-ny*1.5,k));return total/3;}
  function closure(box,radius){
   const {x,y,width:ww,height:hh}=box,r=Math.min(radius,ww/2,hh/2),scores=[];
   for(let side=0;side<4;side++){
    let good=0,total=0;const length=side%2===0?ww:hh;
    for(let j=0;j<=Math.max(5,Math.round(length/5));j++){
     const t=j/Math.max(5,Math.round(length/5));let px,py,nx,ny;
     if(side===0||side===2){px=x+ww*t;py=y+(side===0?0:hh);nx=0;ny=side===0?-1:1;
      if(r>0&&(px<x+r||px>x+ww-r)){const center=px<x+r?x+r:x+ww-r,dx=px-center,dy=Math.sqrt(Math.max(0,r*r-dx*dx));py=side===0?y+r-dy:y+hh-r+dy;nx=dx/r;ny=(side===0?-1:1)*dy/r;}
     }else{py=y+hh*t;px=x+(side===1?ww:0);nx=side===1?1:-1;ny=0;
      if(r>0&&(py<y+r||py>y+hh-r)){const center=py<y+r?y+r:y+hh-r,dy=py-center,dx=Math.sqrt(Math.max(0,r*r-dy*dy));px=side===1?x+ww-r+dx:x+r-dx;ny=dy/r;nx=(side===1?1:-1)*dx/r;}
     }
     let best=0;for(const shift of [-1,0,1])best=Math.max(best,contrast(px+nx*shift,py+ny*shift,nx,ny));if(best>10-3*sensitivity)good++;total++;
    }scores.push(good/total);
   }
   return {score:scores.reduce((a,b)=>a+b,0)/4,min:Math.min(...scores)};
  }
  // Pair long horizontal edges and verify all four sides, including rounded
  // caps. This can find floating navigation bars over textured image covers.
  const runs=[];const edgeThreshold=11-5*sensitivity;
  for(let y=2;y<h-2;y++){
   let start=-1,gap=0;
   for(let x=0;x<=w;x++){
    let e=0;if(x<w)for(let k=0;k<3;k++)e+=Math.abs(pixel(x,y+1,k)-pixel(x,y-1,k))/3;
    if(x<w&&e>edgeThreshold){if(start<0)start=x;gap=0;}
    else if(start>=0){gap++;if(gap>3||x===w){const end=x-gap+1;if(end-start>short*.14)runs.push({x:start,right:end,y});start=-1;gap=0;}}
   }
  }
  const allLines=[];for(const run of runs){const previous=allLines.find(v=>Math.abs(v.y-run.y)<3&&Math.abs(v.x-run.x)<6&&Math.abs(v.right-run.right)<6);if(!previous)allLines.push(run);}
  const lines=allLines.sort((a,b)=>(b.right-b.x)-(a.right-a.x)).slice(0,90).sort((a,b)=>a.y-b.y);
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
   const top=lines[i],bottom=lines[j],height=bottom.y-top.y;
   if(height<short*.025||height>short*.19)continue;
   const common=Math.min(top.right,bottom.right)-Math.max(top.x,bottom.x),span=Math.max(top.right-top.x,bottom.right-bottom.x);
   if(common/span<.78||span<short*.35||span/height<2.8)continue;
   let best=null;
   for(const padding of [0,3,6])for(const round of [.5]){
    const box={x:Math.min(top.x,bottom.x)-padding,y:top.y,width:Math.max(top.right,bottom.right)-Math.min(top.x,bottom.x)+padding*2,height},radius=Math.min(box.width,height)*round;
    if(box.width/height>11||height/box.width>4)continue;
    const verified=closure(box,radius);
    if(verified.score>.67&&verified.min>.36&&(!best||verified.score>best.score))best={box,radius,score:verified.score};
   }
   if(best)add(best.box,best.radius>best.box.height*.35?'control':'card',1.1+best.score,best.radius);
  }
  // Prefer closed boxes over large color components. Keep a capsule overlay
  // as a separate mask, but do not split a detected photo into its textures.
  const priority=c=>c.score+(c.type==='card'&&c.width*c.height>w*h*.08?3:0);
  candidates.sort((a,b)=>priority(b)-priority(a)||b.width*b.height-a.width*a.height);
  const accepted=[];
  for(const c of candidates){
   if(accepted.some(a=>overlap(a,c)/Math.min(a.width*a.height,c.width*c.height)>.82&&!(c.type==='control'&&a.type==='card'&&c.width/c.height>3&&c.width*c.height>short*short*.035)))continue;
   if(c.width*c.height>w*h*.88)continue;accepted.push(c);
  }
  accepted.sort((a,b)=>b.width*b.height-a.width*a.height);
  const owner=new Int32Array(n),regions=[];
  function create(box,kind,radius=0){const id=regions.length+1;regions.push({...box,id,kind,radius});return id;}
  for(const c of accepted){
   const id=create(c,c.type==='control'?'content-control':'content-card',c.radius),r=Math.min(c.radius,c.width/2,c.height/2);
   for(let y=c.y;y<c.y+c.height;y++)for(let x=c.x;x<c.x+c.width;x++){
    if(x<0||y<0||x>=w||y>=h)continue;
    const dx=Math.max(c.x+r-x,0,x-(c.x+c.width-r-1)),dy=Math.max(c.y+r-y,0,y-(c.y+c.height-r-1));
    if(dx*dx+dy*dy<=r*r||!r||closed[y*w+x])owner[y*w+x]=id;
   }
  }
  // Reattach antialiased borders and small broken contour fragments to their
  // nearby block. Do this from a frozen map, so ownership cannot flood into
  // unrelated neighboring content as the scan advances.
  const frozen=owner.slice();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!frozen[y*w+x]&&foreground[y*w+x]){
   let best=0,distance=99;
   for(let yy=Math.max(0,y-2);yy<=Math.min(h-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(w-1,x+2);xx++){
    const id=frozen[yy*w+xx],d=(xx-x)**2+(yy-y)**2;if(id&&d<distance){best=id;distance=d;}
   }if(best)owner[y*w+x]=best;
  }
  const remaining=new Uint8Array(n);for(let i=0;i<n;i++)remaining[i]=!owner[i]&&foreground[i]?1:0;
  const minTextArea=8+160*(1-settings.variation/100);
  let texts=components(morph(remaining,w,h,1,true),w,h).filter(c=>c.area>=minTextArea&&c.width>short*.018&&c.height>short*.01&&c.height<short*.11&&c.width>c.height*.65);
  texts.sort((a,b)=>a.y-b.y||a.x-b.x);
  for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
   const a=texts[i],b=texts[j],gap=Math.max(a.x,b.x)-Math.min(a.x+a.width,b.x+b.width),sameRow=Math.abs(a.y+a.height/2-b.y-b.height/2)<Math.max(a.height,b.height)*.4;
   if(sameRow&&gap<Math.max(a.height,b.height)*1.25){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);texts[i]={x,y,width:Math.max(a.x+a.width,b.x+b.width)-x,height:Math.max(a.y+a.height,b.y+b.height)-y,area:a.area+b.area};texts.splice(j,1);j=i;}
  }
  const expanded=morph(foreground,w,h,1,true);
  for(const c of texts){const id=create(c,'content-text');for(let y=c.y;y<c.y+c.height;y++)for(let x=c.x;x<c.x+c.width;x++)if(!owner[y*w+x]&&expanded[y*w+x])owner[y*w+x]=id;}
  const base=short/4*settings.size/100,step=Math.max(22,Math.round(base*(1.25-settings.variation/100*.35)));
  for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){let id=0;for(let yy=y;yy<Math.min(h,y+step);yy++)for(let xx=x;xx<Math.min(w,x+step);xx++)if(!owner[yy*w+xx]){if(!id)id=create({x,y,width:Math.min(step,w-x),height:Math.min(step,h-y)},'app-background');owner[yy*w+xx]=id;}}
  return {width:w,height:h,owner,regions,background,candidates:accepted.length};
 }
 window.ContentRegions={detect};
})();
