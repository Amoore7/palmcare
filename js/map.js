(function(){
  const TILE_CACHE='palmcare-tiles-v2';
  // Free, no-API-key raster providers (CORS-enabled, OSM-policy compliant use).
  // The map tries them in order and self-heals if one is unreachable.
  const TILE_SOURCES=[
    'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png',
    'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'
  ];
  const DEFAULT_TILE_TEMPLATE=TILE_SOURCES[0];
  let tileTemplate=null;   // user override (set from Settings)
  let sourceIndex=0;
  let tileFails=0, fellBack=false, srcVersion=0;
  const MAPS=new Set();

  function getTemplate(){
    return tileTemplate||TILE_SOURCES[sourceIndex];
  }
  function onTileFail(){
    if(!navigator.onLine) return;            // offline: keep grid, no source churn
    tileFails++;
    if(tileFails<3) return;
    tileFails=0;
    if(tileTemplate){
      tileTemplate=null;                     // custom/preset failed -> drop to default chain
      srcVersion++; notifyFallback(); redrawAll();
      return;
    }
    if(sourceIndex<TILE_SOURCES.length-1){ sourceIndex++; srcVersion++; notifyFallback(); redrawAll(); }
  }
  function redrawAll(){ MAPS.forEach(m=>m.render()); }
  function onTileOk(){ tileFails=0; }
  function notifyFallback(){
    if(fellBack) return;
    fellBack=true;
    try{
      if(window.FlowUtil && window.FlowUtil.toast) window.FlowUtil.toast('جرّب المصدر التالي للبلاطات');
    }catch(e){}
  }

  async function getImage(url, usedTemplate){
    try{
      if(!('caches' in window)) return null;
      const cache=await caches.open(TILE_CACHE);
      let resp=await cache.match(url);
      if(!resp && navigator.onLine){
        try{
          resp=await fetch(url);
          if(resp && resp.ok) await cache.put(url, resp.clone());
        }catch(e){ resp=null; }
      }
      if(!resp || !resp.ok){
        if(usedTemplate===getTemplate()) onTileFail();
        return null;
      }
      if(navigator.onLine) onTileOk();
      const blob=await resp.blob();
      return URL.createObjectURL(blob);
    }catch(e){ return null; }
  }

  class GeoMap{
    constructor(canvas, opts){
      opts=opts||{};
      this.canvas=canvas;
      this.ctx=canvas.getContext('2d');
      this.tilesEnabled=opts.tiles!==false;
      this.center=opts.center||{lat:24.7,lng:46.7};
      this.zoom=opts.zoom||12;
      this.loc=null;
      this.items={polygons:[],points:[],obstacles:[],lines:[]};
      this.pad=24;
      this.hiddenItems=0;
      this._tileToks={};
      this._tilesOk=0;
      this._srcV=srcVersion;
      this._ro=new ResizeObserver(()=>this.resize());
      this._ro.observe(canvas);
      this._bind();
      this.resize();
      this.render();
      MAPS.add(this);
    }
    resize(){
      const r=this.canvas.parentElement.getBoundingClientRect();
      const dpr=window.devicePixelRatio||1;
      this.w=r.width; this.h=r.height;
      this.canvas.width=r.width*dpr; this.canvas.height=r.height*dpr;
      this.canvas.style.width=r.width+'px'; this.canvas.style.height=r.height+'px';
      this._dpr=dpr;
      this.render();
    }
    setItems(items){ this.items=Object.assign({polygons:[],points:[],obstacles:[],lines:[]},items); this.render(); }
    setLocation(loc, follow){
      this.loc=loc;
      if(follow!==false && loc) this.center={lat:loc.lat,lng:loc.lng};
      this.render();
    }
    fit(){
      const pts=[];
      (this.items.polygons||[]).forEach(p=>pts.push(...p.points));
      (this.items.points||[]).forEach(p=>pts.push(p));
      (this.items.obstacles||[]).forEach(o=>pts.push(...o.points));
      if(this.loc) pts.push(this.loc);
      if(!pts.length) return;
      const fit=Geo.fitPoints(pts, this.w||320, this.h||320, 30);
      if(fit){ this.center=fit.center; this.zoom=fit.zoom; this.render(); }
    }
    _bind(){
      let dragging=false, last=null, mode=null, dist=0, zo=0;
      let downPt=null, downT=0, moved=0, touchTap=false;
      const onDown=e=>{
        const p=(e.touches&&e.touches[0])?{x:e.touches[0].clientX,y:e.touches[0].clientY}:{x:e.clientX,y:e.clientY};
        e.preventDefault();
        dragging=true; last=p; downPt=p; downT=Date.now(); moved=0;
        touchTap=!!e.touches;
        if(e.touches&&e.touches.length===2){ mode='pinch'; dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); zo=this.zoom; }
      };
      const onMove=e=>{
        if(!dragging) return;
        if(e.touches&&e.touches.length===2){
          const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
          if(dist>0 && d!==0){ const nz=zo+Math.log2(d/dist); this.setZoom(Math.max(3,Math.min(19,nz))); }
          return;
        }
        const p={x:(e.touches?e.touches[0].clientX:e.clientX), y:(e.touches?e.touches[0].clientY:e.clientY)};
        if(downPt){ moved=Math.max(moved, Math.hypot(p.x-downPt.x, p.y-downPt.y)); if(moved>10) touchTap=false; }
        const dx=p.x-last.x, dy=p.y-last.y;
        last=p;
        const proj=Geo.project(this.center.lat, this.center.lng, this.zoom);
        const sp=256*Math.pow(2,this.zoom);
        const dLat=(dy)/sp*360;
        const dLng=(-dx)/sp*360/Math.cos(this.center.lat*Math.PI/180);
        this.setCenter({lat:this.center.lat+dLat, lng:this.center.lng+dLng});
      };
      const onUp=e=>{
        const wasPinch=(mode==='pinch');
        dragging=false; mode=null; dist=0;
        if(touchTap && !wasPinch && moved<=10){
          const t=e.changedTouches&&e.changedTouches[0];
          if(t) this._fireTap(t.clientX, t.clientY);
        }
        touchTap=false;
      };
      this.canvas.addEventListener('touchstart',onDown,{passive:false});
      this.canvas.addEventListener('touchmove',onMove,{passive:false});
      this.canvas.addEventListener('touchend',onUp);
      this.canvas.addEventListener('mousedown',onDown);
      window.addEventListener('mousemove',onMove);
      window.addEventListener('mouseup',onUp);
      this.canvas.addEventListener('dblclick',e=>{ const r=this.canvas.getBoundingClientRect(); const x=e.clientX-r.left, y=e.clientY-r.top; const ll=this.screenToLatLng(x,y); this.setZoom(this.zoom+1, ll); });
    }
    _fireTap(clientX,clientY){
      const r=this.canvas.getBoundingClientRect();
      const x=clientX-r.left, y=clientY-r.top;
      if(x<0||y<0||x>this.w||y>this.h) return;
      const ll=this.screenToLatLng(x,y);
      if(this.onTap) this.onTap(ll,{x,y});
    }
    setCenter(c){ this.center=c; this.render(); }
    setZoom(z,c){ this.zoom=z; if(c) this.center=c; this.render(); }
    screenToLatLng(x,y){
      const sp=256*Math.pow(2,this.zoom);
      const projC=Geo.project(this.center.lat,this.center.lng,this.zoom);
      const pxX=projC.x-(x-this.w/2);
      const pxY=projC.y-(y-this.h/2);
      const inv=Geo.unproject(pxX,pxY,this.zoom);
      return inv;
    }
    render(){
      const ctx=this.ctx; if(!ctx) return;
      const dpr=this._dpr||1;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,this.w,this.h);
      this.drawTiles();
      this.drawGrid();
      this.drawObstacles();
      this.drawPolygons();
      this.drawLines();
      this.drawPoints();
      this.drawLocation();
      this.drawScaleBar();
      this.drawCoordReadout();
      if(this._srcV!==srcVersion){ this._srcV=srcVersion; this.render(); }   // tiles source changed mid-draw -> redraw once
    }
    drawScaleBar(){
      const ctx=this.ctx; if(!ctx||!this.w) return;
      const lat=this.center.lat||0;
      const mpp=156543.03392*Math.cos(lat*Math.PI/180)/Math.pow(2,this.zoom);   // meters per screen px
      const m=mpp*Math.min(90,this.w*0.28);
      const nice=[25,50,100,200,250,500,1000,2000,5000];
      const v=nice.find(x=>x>=m)||m;
      const px=v/mpp;
      const bh=16, y=this.h-12;
      ctx.fillStyle='rgba(255,255,255,.8)';
      ctx.fillRect(8,y-bh/2,px+8,bh);
      ctx.strokeStyle='rgba(40,50,45,.7)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(8,y); ctx.lineTo(8+px,y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8,y-4); ctx.lineTo(8,y+4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8+px,y-4); ctx.lineTo(8+px,y+4); ctx.stroke();
      ctx.fillStyle='rgba(31,41,51,.9)'; ctx.font='10px sans-serif'; ctx.textAlign='right';
      ctx.fillText((v>=1000?(v/1000)+(I18N.t('km')):v+' '+I18N.t('meters')),8+px-2,y+4);
      ctx.textAlign='left';
    }
    drawCoordReadout(){
      const ctx=this.ctx; if(!ctx||!this.w) return;
      const c=this.center;
      ctx.fillStyle='rgba(255,255,255,.75)';
      const txt=c.lat.toFixed(5)+', '+c.lng.toFixed(5);
      ctx.font='9px monospace';
      const w=ctx.measureText(txt).width;
      ctx.fillRect(this.w-w-12,this.h-24,w+8,16);
      ctx.fillStyle='rgba(31,41,51,.75)';
      ctx.fillText(txt,this.w-w-8,this.h-13);
    }
    drawTiles(){
      if(!this.tilesEnabled) return;
      const z=Math.floor(this.zoom);
      const projC=Geo.project(this.center.lat,this.center.lng,z);
      const sp=256;
      const tiles=[];
      const x0=Math.floor((projC.x-this.w/2)/sp)-1, x1=Math.floor((projC.x+this.w/2)/sp)+1;
      const y0=Math.floor((projC.y-this.h/2)/sp)-1, y1=Math.floor((projC.y+this.h/2)/sp)+1;
      const src=getTemplate();
      for(let y=y0;y<=y1;y++){
        const maxY=Math.pow(2,z)-1;
        if(y<0||y>maxY) continue;
        for(let x=x0;x<=x1;x++){
          const wrap=Math.pow(2,z);
          const wx=((x%wrap)+wrap)%wrap;
          const url=src.replace('{z}',z).replace('{x}',wx).replace('{y}',y);
          const key=z+'/'+wx+'/'+y;
          const sx=wx*sp-projC.x+this.w/2;
          const sy=y*sp-projC.y+this.h/2;
          this._drawTile(url,key,sx,sy,src);
        }
      }
    }
    _drawTile(url,key,sx,sy,usedTemplate){
      const tok=this._tileToks[key];
      if(tok && tok.url===url && tok.sx===sx && tok.sy===sy){
        if(tok.img) ctxDraw(this, tok.img, sx, sy);
        return;
      }
      this._tileToks[key]={url,sx,sy,key};
      const self=this;
      getImage(url, usedTemplate).then(function(obj){
        if(!obj) return;
        const im=new Image();
        im.onload=function(){ self._tileToks[key].img=im; self._tilesOk++; self.render(); URL.revokeObjectURL(obj); };
        im.src=obj;
      }).catch(function(){});
    }
    drawGrid(){
      if(!this.w) return;
      const ctx=this.ctx;
      ctx.strokeStyle='rgba(90,120,100,.18)'; ctx.lineWidth=1; ctx.fillStyle='rgba(70,90,80,.55)'; ctx.font='10px sans-serif';
      const step=this.zoom>14?0.001:this.zoom>12?0.005:0.01;
      const topLeft=this.screenToLatLng(0,0), botRight=this.screenToLatLng(this.w,this.h);
      const sp=256*Math.pow(2,this.zoom);
      const pc=Geo.project(this.center.lat,this.center.lng,this.zoom);
      for(let lat=Math.floor(topLeft.lat/step)*step; lat<=botRight.lat+step; lat+=step){
        const p=Geo.project(lat,this.center.lng,this.zoom);
        const y=p.y-pc.y+this.h/2;
        if(y<-50||y>this.h+50) continue;
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.w,y); ctx.stroke();
        ctx.fillText(lat.toFixed(3),4,y-2);
      }
      for(let lng=Math.floor(topLeft.lng/step)*step; lng<=botRight.lng+step; lng+=step){
        const p=Geo.project(this.center.lat,lng,this.zoom);
        const x=p.x-pc.x+this.w/2;
        if(x<-60||x>this.w+60) continue;
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,this.h); ctx.stroke();
        ctx.fillText(lng.toFixed(3),x+3,12);
      }
    }
    projectToScreen(lat,lng){
      const p=Geo.project(lat,lng,this.zoom);
      const pc=Geo.project(this.center.lat,this.center.lng,this.zoom);
      return {x:p.x-pc.x+this.w/2, y:p.y-pc.y+this.h/2};
    }
    drawPolygons(){
      const ctx=this.ctx;
      (this.items.polygons||[]).forEach(p=>{
        if(!p.points||p.points.length<2) return;
        ctx.beginPath();
        p.points.forEach((pt,i)=>{
          const s=this.projectToScreen(pt.lat,pt.lng);
          i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);
        });
        ctx.closePath();
        ctx.fillStyle=p.fill||'rgba(34,139,84,.14)';
        ctx.fill();
        ctx.strokeStyle=p.stroke||'#228b54'; ctx.lineWidth=3;
        ctx.setLineDash(p.dash||[]);
        ctx.stroke(); ctx.setLineDash([]);
        if(p.label){
          const c=this.polygonCenter(p.points); const s=this.projectToScreen(c.lat,c.lng);
          ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font='bold 12px sans-serif';
          const w=ctx.measureText(p.label).width+10;
          ctx.fillRect(s.x-w/2,s.y-9,w,18);
          ctx.fillStyle='#1a6b40'; ctx.fillText(p.label,s.x-w/2+5,s.y+4);
        }
      });
    }
    polygonCenter(pts){
      let cx=0,cy=0; pts.forEach(p=>{cx+=p.lng;cy+=p.lat;});
      return {lat:cy/pts.length, lng:cx/pts.length};
    }
    drawObstacles(){
      const ctx=this.ctx;
      (this.items.obstacles||[]).forEach(o=>{
        if(!o.points||!o.points.length) return;
        ctx.beginPath();
        o.points.forEach((pt,i)=>{
          const s=this.projectToScreen(pt.lat,pt.lng);
          i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);
        });
        ctx.closePath();
        ctx.fillStyle='rgba(230,150,40,.28)';
        ctx.fill();
        ctx.strokeStyle='#e8a33d'; ctx.lineWidth=2;
        ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
        if(o.label){
          const c=this.polygonCenter(o.points); const s=this.projectToScreen(c.lat,c.lng);
          ctx.fillStyle='rgba(255,255,255,.9)'; ctx.font='bold 12px sans-serif';
          const w=ctx.measureText(o.label).width+10;
          ctx.fillRect(s.x-w/2,s.y-9,w,18);
          ctx.fillStyle='#c07a10'; ctx.fillText(o.label,s.x-w/2+5,s.y+4);
        }
      });
    }
    drawLines(){
      const ctx=this.ctx;
      (this.items.lines||[]).forEach(l=>{
        if(!l.points||l.points.length<2) return;
        ctx.beginPath();
        l.points.forEach((pt,i)=>{
          const s=this.projectToScreen(pt.lat,pt.lng);
          i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);
        });
        ctx.strokeStyle=l.color||'#1a6b40'; ctx.lineWidth=l.width||2; ctx.setLineDash(l.dash||[]);
        ctx.stroke(); ctx.setLineDash([]);
      });
    }
    drawPoints(){
      const ctx=this.ctx;
      (this.items.points||[]).forEach(p=>{
        if(p.lat==null) return;
        const s=this.projectToScreen(p.lat,p.lng);
        const r=p.size||7;
        if(s.x<-30||s.x>this.w+30||s.y<-30||s.y>this.h+30) return;
        ctx.beginPath(); ctx.arc(s.x,s.y,r,0,Math.PI*2);
        ctx.fillStyle=p.color||'#228b54'; ctx.fill();
        ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke();
        if(p.label){
          ctx.font='bold 11px sans-serif'; ctx.fillStyle='rgba(31,41,51,.85)';
          const w=ctx.measureText(p.label).width+8;
          ctx.fillStyle='rgba(255,255,255,.95)';
          ctx.fillRect(s.x+r+2,s.y-8,w,16);
          ctx.fillStyle='#1f2933'; ctx.fillText(p.label,s.x+r+6,s.y+4);
        }
      });
    }
    drawLocation(){
      const ctx=this.ctx;
      if(!this.loc || this.loc.lat==null) return;
      const s=this.projectToScreen(this.loc.lat,this.loc.lng);
      const acc=(this.loc.accuracy||30)/111320/Math.cos(this.loc.lat*Math.PI/180);
      const accPx=this.projectToScreen(this.loc.lat, this.loc.lng+acc);
      const aR=accPx.x-s.x;
      if(aR>4&&aR<300){ ctx.beginPath(); ctx.arc(s.x,s.y,aR,0,Math.PI*2); ctx.fillStyle='rgba(34,139,84,.12)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(s.x,s.y,9,0,Math.PI*2); ctx.fillStyle='#228b54'; ctx.fill();
      ctx.beginPath(); ctx.arc(s.x,s.y,14,0,Math.PI*2); ctx.strokeStyle='rgba(34,139,84,.5)'; ctx.lineWidth=2; ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x,s.y,4,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
    }
    dispose(){ MAPS.delete(this); this._ro.disconnect(); }
  }

  function ctxDraw(self,img,sx,sy){
    try{ self.ctx.drawImage(img,sx,sy,256,256); }catch(e){}
  }

  window.GeoMap=GeoMap;
  window.GeoMap.setTileTemplate=function(t){ tileTemplate=(t&&t.trim())?t.trim():null; };
})();