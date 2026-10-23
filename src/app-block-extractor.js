(()=>{'use strict';
 const make=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  function extract(source,w,h,settings){
  const detected=ContentRegions.detect(source,w,h,settings),labels=new Int32Array(w*h),bounds=detected.regions.map(()=>({left:w,top:h,right:-1,bottom:-1}));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const id=detected.owner[Math.min(detected.height-1,Math.floor(y/h*detected.height))*detected.width+Math.min(detected.width-1,Math.floor(x/w*detected.width))];
   labels[y*w+x]=id;const b=bounds[id-1];b.left=Math.min(b.left,x);b.top=Math.min(b.top,y);b.right=Math.max(b.right,x);b.bottom=Math.max(b.bottom,y);
  }
  const original=source.getContext('2d',{willReadFrequently:true}),elements=[];
  for(let i=0;i<bounds.length;i++){
   const b=bounds[i];if(b.right<0)continue;const x=b.left,y=b.top,width=b.right-x+1,height=b.bottom-y+1,id=i+1;
   const image=make(width*2,height*2),pixels=original.getImageData(x*2,y*2,width*2,height*2);
   for(let yy=0;yy<height*2;yy++)for(let xx=0;xx<width*2;xx++)if(labels[(y+(yy>>1))*w+x+(xx>>1)]!==id)pixels.data[(yy*width*2+xx)*4+3]=0;
   image.getContext('2d').putImageData(pixels,0,0);elements.push({x,y,width,height,image,kind:detected.regions[i].kind,key:'region-'+id,id:'region-'+id,radius:detected.regions[i].radius/detected.width*w});
  }
  return {elements,detected,labels};
 }

 function build(screenshot,w,h,input={}){
  const settings={size:100,variation:60,edge:75,...input};
    const raster=make(screenshot.naturalWidth||screenshot.width,screenshot.naturalHeight||screenshot.height);raster.getContext('2d').drawImage(screenshot,0,0);
  const source=make(w*2,h*2),sg=source.getContext('2d'),fit=input.fit||'contain';sg.fillStyle='#050506';sg.fillRect(0,0,w*2,h*2);
  const scale=(fit==='cover'?Math.max:Math.min)(w*2/raster.width,h*2/raster.height);
  if(fit==='stretch')sg.drawImage(raster,0,0,w*2,h*2);else sg.drawImage(raster,(w*2-raster.width*scale)/2,(h*2-raster.height*scale)/2,raster.width*scale,raster.height*scale);
  const result=extract(source,w,h,settings),content=make(w*2,h*2),background=make(w*2,h*2),preview=make(w*2,h*2);
  const backgroundColor=result.detected.background.map(v=>Math.round(v)),bg=background.getContext('2d');
  bg.fillStyle='rgb('+backgroundColor.join(',')+')';bg.fillRect(0,0,background.width,background.height);
  const g=content.getContext('2d'),p=preview.getContext('2d');p.drawImage(source,0,0);p.scale(2,2);p.lineWidth=1.5;
  const blocks=result.elements.filter(e=>e.kind!=='app-background');
  for(const e of result.elements){if(e.kind==='app-background'){bg.drawImage(e.image,e.x*2,e.y*2);continue;}
   g.drawImage(e.image,e.x*2,e.y*2);p.strokeStyle=e.kind==='content-text'?'#ffd071':'#74e4ff';p.strokeRect(e.x,e.y,e.width,e.height);}
  return {w,h,source,content,background,backgroundColor,blocks,preview,settings,labels:result.labels};
 }
 window.AppBlockExtractor={build};
})();

