(function(){
  const D2R = Math.PI/180;
  const R = 6371000;

  const Geo = {
    distM(a,b){
      if(!a||!b||a.lat==null||a.lng==null||b.lat==null||b.lng==null) return null;
      const dLat=(b.lat-a.lat)*D2R, dLng=(b.lng-a.lng)*D2R;
      const la1=a.lat*D2R, la2=b.lat*D2R;
      const x=Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
      return 2*R*Math.asin(Math.sqrt(x));
    },
    bearingDeg(a,b){
      if(!a||!b) return null;
      const la1=a.lat*D2R, la2=b.lat*D2R, dLng=(b.lng-a.lng)*D2R;
      const y=Math.sin(dLng)*Math.cos(la2);
      const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLng);
      return (Math.atan2(y,x)*180/Math.PI+360)%360;
    },
    dirLabel(deg){
      const idx=Math.round(((deg||0)%360)/45)%8;
      return idx;
    },
    inPolygon(p, poly){
      if(!poly||poly.length<3) return false;
      let inside=false;
      for(let i=0,j=poly.length-1;i<poly.length;j=i++){
        const xi=poly[i].lng, yi=poly[i].lat, xj=poly[j].lng, yj=poly[j].lat;
        const intersects=((yi>p.lat)!==(yj>p.lat)) && (p.lng<(xj-xi)*(p.lat-yi)/(yj-yi)+xi);
        if(intersects) inside=!inside;
      }
      return inside;
    },
    polygonAreaHa(poly){
      if(!poly||poly.length<3) return 0;
      let area=0;
      for(let i=0;i<poly.length;i++){
        const p1=poly[i], p2=poly[(i+1)%poly.length];
        const mid=(p1.lat+p2.lat)/2*D2R;
        const mlng=Math.cos(mid);
        area += (p1.lng*mlng*p2.lat - p2.lng*mlng*p1.lat);
      }
      return Math.abs(area/2)* (111320*111320/10000); // deg^2 -> m^2 / 10000
    },
    fmtDist(m){
      if(m==null) return '—';
      return m<1000 ? Math.round(m)+' '+I18N.t('meters') : (m/1000).toFixed(1)+' '+I18N.t('km');
    },
    fmtDate(ts){
      if(!ts) return '—';
      const d=new Date(ts);
      return d.toLocaleDateString(langCurrent(), {year:'numeric',month:'short',day:'numeric'});
    },
    fmtDateFull(ts){
      const d=new Date(ts);
      return d.toLocaleDateString(langCurrent(), {year:'numeric',month:'long',day:'numeric'})+' '+d.toLocaleTimeString(langCurrent(),{hour:'2-digit',minute:'2-digit'});
    },
    fmtArea(ha){
      return ha.toLocaleString(langCurrent(),{maximumFractionDigits:1});
    },
    todayStart(){
      const d=new Date(); d.setHours(0,0,0,0); return d.getTime();
    },
    dayStart(ts){
      const d=new Date(ts); d.setHours(0,0,0,0); return d.getTime();
    },
    // Web Mercator projection for canvas rendering
    project(lat,lng,zoom){
      const s=256*Math.pow(2,zoom);
      const x=(lng+180)/360*s;
      const latR=lat*D2R;
      const y=(1-Math.log(Math.tan(latR)+1/Math.cos(latR))/Math.PI)/2*s;
      return {x,y,s};
    },
    unproject(x,y,zoom){
      const s=256*Math.pow(2,zoom);
      const lng=x/s*360-180;
      const n=Math.PI-2*Math.PI*y/s;
      const lat=180/Math.PI*Math.atan((Math.exp(n)-Math.exp(-n))/2);
      return {lat,lng};
    },
    // pick a zoom/center from a set of points and canvas size
    fitPoints(pts, w, h, pad){
      pad=pad||40;
      if(!pts||!pts.length) return null;
      let minLat=90,maxLat=-90,minLng=180,maxLng=-180;
      pts.forEach(p=>{ if(p.lat==null||p.lng==null)return; minLat=Math.min(minLat,p.lat);maxLat=Math.max(maxLat,p.lat);minLng=Math.min(minLng,p.lng);maxLng=Math.max(maxLng,p.lng); });
      if(minLat>maxLat) return null;
      const cLat=(minLat+maxLat)/2, cLng=(minLng+maxLng)/2;
      let zoom=15;
      for(;zoom>2;zoom--){
        const a=Geo.project(minLat,minLng,zoom), b=Geo.project(maxLat,maxLng,zoom);
        const pxW=Math.abs(b.x-a.x), pxH=Math.abs(b.y-a.y);
        if(pxW<=w-2*pad && pxH<=h-2*pad) break;
      }
      return {center:{lat:cLat,lng:cLng},zoom};
    },
    // capture a position, waiting until accuracy is good enough
    // (or returning the best fix we got before the deadline). iOS/Android GPS
    // usually starts coarse (~100-500m) and improves; never accept the first fix blindly.
    capturePosition(timeoutMs){
      return new Promise((resolve,reject)=>{
        if(!navigator.geolocation){ reject(new Error('no-geolocation')); return; }
        const ACCEPT_ACC=80;           // meters: good enough for field use
        let best=null, done=false, wid=null;
        const mk=(p)=>({lat:p.latitude,lng:p.longitude,accuracy:Math.max(Math.round(p.accuracy||0),0),ts:Date.now()});
        const cleanup=()=>{ if(wid!=null){ try{ navigator.geolocation.clearWatch(wid); }catch(e){} wid=null; } };
        const finish=(loc)=>{ if(done) return; done=true; cleanup(); resolve(loc&&loc.lat!=null?loc:best); };
        const startWatch=()=>{
          if(done||wid!=null) return;
          wid=navigator.geolocation.watchPosition(
            p=>{ const loc=mk(p.coords); if(!best||loc.accuracy<best.accuracy) best=loc; if(loc.accuracy<=ACCEPT_ACC) finish(loc); },
            ()=>{ if(best) finish(best); },
            {enableHighAccuracy:true,timeout:12000,maximumAge:1000}
          );
        };
        navigator.geolocation.getCurrentPosition(
          p=>{
            const loc=mk(p.coords);
            best=(!best||loc.accuracy<best.accuracy)?loc:best;
            if(loc.accuracy<=ACCEPT_ACC) finish(loc);
            else startWatch();          // keep refining until deadline
          },
          ()=>{ startWatch(); },        // first fix failed -> try watch
          {enableHighAccuracy:true,timeout:10000,maximumAge:5000}
        );
        setTimeout(()=>{
          if(done) return;
          if(best){ finish(best); }     // best-known fix on deadline
          else{ done=true; cleanup(); reject(new Error('timeout')); }
        }, timeoutMs||15000);
      });
    },
    isValidCoord(lat,lng){
      const okLat = lat!=null && isFinite(lat) && lat>=-90 && lat<=90;
      const okLng = lng!=null && isFinite(lng) && lng>=-180 && lng<=180;
      return okLat && okLng;
    },
    isReasonableSaudi(lat,lng){
      // Saudi bounding box (with margin)
      return lat>=14 && lat<=33 && lng>=34 && lng<=60;
    },
    // normalize a coordinate string that may be Arabic/other separators
    parseCoord(s){
      if(s==null) return null;
      if(typeof s==='number') return isFinite(s)?s:null;
      let str=String(s).trim();
      if(!str) return null;
      str=str.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
      str=str.replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
      str=str.replace(/٫/g,'.').replace(/،/g,'.').replace(/,/g,' ');
      str=str.replace(/°|º/g,' ');
      str=str.trim();
      return isFinite(parseFloat(str))?parseFloat(str):null;
    },
    uid(prefix){
      const r=crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&0x3|0x8)).toString(16);});
      return (prefix?prefix+'-':'')+r;
    },
    daysFromNow(days){
      const d=new Date(); d.setDate(d.getDate()+days); d.setHours(12,0,0,0); return d.getTime();
    },
    // compute due classification for a nextInspectionDate timestamp
    dueClass(nextMs, nowMs){
      nowMs = nowMs!=null?nowMs:Date.now();
      const nowStart=Geo.dayStart(nowMs), dueStart=Geo.dayStart(nextMs);
      if(dueStart < nowStart) return 'red';
      if(dueStart - nowStart <= 86400000) return 'yellow';
      return 'green';
    },
  };
  function langCurrent(){ return window.I18N ? I18N.get() : 'ar'; }
  window.Geo = Geo;
  if(typeof module!=='undefined') module.exports=Geo;
})();