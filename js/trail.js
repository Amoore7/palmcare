/* Trail — continuous GPS trip tracker ("سير الرحلة") with persistence.
   Goal: match Google-Maps-quality breadcrumb behavior inside the app:
   - jitter filtering (min displacement, accuracy envelope)
   - stray/almanac guard (implausible jumps need corroboration)
   - auto speed/distance/duration + live location, heading-aware marker
   - survives app tab switches & restarts via settings['trailSession']
   - works fully offline (local GPS only, no network)
*/
(function(){
  const KEY='trailSession';
  const MIN_MOVE=4;            // meters: ignore sub-4m jitter
  const ACC_MAX=150;           // meters: worse accuracy fixes are skipped for the trail
  const PEND_MOVE=400;         // meters: candidate farther than this from last fix
  const PEND_SPEED=35;         // m/s (~126 km/h): speed above this triggers the guard
  const PEND_ACCEPT=150;       // meters: pending accepted if a following fix is within this

  let running=false;
  let wid=null;
  let per=null;                 // pending candidate awaiting corroboration
  let _cb=null;
  let _saveT=null;
  let session=null;
  let follow=false;

  function load(){
    return DB.getSetting(KEY,null).then(s=>{
      if(s && s.points && Array.isArray(s.points) && s.status==='recording'){ running=true; }
      session=s && s.points && Array.isArray(s.points) ? s : {status:'idle',start:null,last:null,points:[],distance:0,durationMs:0,lat:null,lng:null,acc:null,heading:null};
      if(running) refollowWatch();
      return session;
    });
  }
  function refollowWatch(){
    clearWatch();
    const gl=window.Trail&&Trail._geo || (navigator.geolocation||null);
    if(!gl) return;
    wid=gl.watchPosition(onFix,onErr,{enableHighAccuracy:true,timeout:10000,maximumAge:2000});
  }

  function clearWatch(){
    if(wid!=null){ try{ (window.Trail&&Trail._geo||navigator.geolocation).clearWatch(wid); }catch(e){} wid=null; }
  }
  function onFix(p){
    if(!running) return;
    const c=p.coords;
    const lat=c.latitude, lng=c.longitude, acc=Math.max(Math.round(c.accuracy||0),0);
    const now=Date.now();
    const speedMs=(c.speed!=null&&c.speed>=0)?c.speed:0;
    const heading=(c.heading!=null&&c.heading>=0)?c.heading:null;
    if(acc>ACC_MAX) return;
    const last=session.lat!=null?{lat:session.lat,lng:session.lng}:null;
    const moved=last?Geo.distM(last,{lat,lng}):Infinity;
    const dt=session.last?now-session.last:0;
    if(!session.start) session.start=now;
    // stagnation filter: don't record until we actually moved enough
    if(last && moved < MIN_MOVE && dt < 8000) return;
    // stray guard: implausibly fast teleport needs corroboration from a following fix
    if(last && moved>PEND_MOVE && speedMs>PEND_SPEED){
      if(per){
        const corroborated=Geo.distM(per,{lat,lng})<=PEND_ACCEPT;
        per=null;
        if(!corroborated) return;   // still implausible — keep waiting
      } else {
        per={lat,lng,acc,ts:now,speedMs,heading};
        return;                     // hold candidate, await the next fix
      }
    }
    if(per){ per=null; }
    push({lat,lng,acc,ts:now,speedMs,heading});
    shared(speedMs,heading,now,acc,moved,dt);
  }
  function onErr(){ /* keep watching; fixes may still arrive */ }

  function shared(speedMs,heading,now,acc,moved,dt){
    session.last=now;
    if(moved!=null && moved<Infinity && moved>=MIN_MOVE){ session.distance+=(moved/1000); }
    session.speed=(speedMs*3.6);            // km/h
    session.heading=heading;
    session.acc=acc;
    session.durationMs=session.last-(session.start||session.last);
    persist();
    if(_cb) _cb({lat:session.lat,lng:session.lng,accuracy:acc,heading:heading,speed:session.speed});
  }

  function push(pt){
    session.lat=pt.lat; session.lng=pt.lng;
    session.points.push(pt);
    if(session.points.length>4000) session.points.shift();   // hard memory cap (~all-day trips)
    // keep lastKnownLocation fresh so the route line + map marker advance with us
    DB.setSetting('lastKnownLocation',{lat:pt.lat,lng:pt.lng,accuracy:pt.acc,at:pt.ts}).catch(()=>{});
  }

  function persist(){
    if(_saveT) clearTimeout(_saveT);
    _saveT=setTimeout(()=>{ _saveT=null; DB.setSetting(KEY,session).catch(()=>{}); },2500);
  }
  function saveNow(){
    if(_saveT){ clearTimeout(_saveT); _saveT=null; }
    if(session) DB.setSetting(KEY,session).catch(()=>{});
  }

  window.Trail={
    get running(){ return running; },
    get session(){ return session; },
    get follow(){ return follow; },
    set follow(v){ follow=!!v; if(_cb) _cb(null); },
    setHandler(fn){ _cb=fn; },
    async init(){ await load(); return session; },
    start(){
      if(running) return;
      const gl=window.Trail&&Trail._geo || (navigator.geolocation||null);
      if(!gl){ if(window.FlowUtil&&window.FlowUtil.toast) window.FlowUtil.toast(I18N.t?I18N.t('gpsFail'):'gps fail'); return; }
      running=true;
      if(!session||session.status!=='recording') session={status:'recording',start:session&&session.start||null,last:null,points:session&&session.points||[],distance:session&&session.distance||0,durationMs:0,lat:null,lng:null,acc:null,heading:null};
      session.status='recording';
      refollowWatch();
      if(_cb) _cb(null);
    },
    pause(){
      if(!running) return;
      running=false;
      if(session){ session.paused=true; }
      clearWatch();
      saveNow();
      if(_cb) _cb(null);
    },
    resume(){ start(); },
    stop(){
      running=false;
      if(session){ session.status='done'; session.durationMs=Date.now()-(session.start||Date.now()); }
      clearWatch();
      saveNow();
      if(_cb) _cb(null);
    },
    clear(){
      session={status:'idle',start:null,last:null,points:[],distance:0,durationMs:0,lat:null,lng:null,acc:null,heading:null};
      if(_saveT){ clearTimeout(_saveT); _saveT=null; }
      DB.setSetting(KEY,session).catch(()=>{});
      if(_cb) _cb(null);
    }
  };
})();