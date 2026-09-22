(function(){
  const $=id=>document.getElementById(id);
  const {el}=window.Util;
  const {toast}=window.FlowUtil;

  let st=null; // state
  let map=null;

  async function open(farmId, type){
    st={farmId, type:type||'boundary', points:[], path:[], mode:'corners', watchId:null, running:false, labelIndex:0};
    $('ov-boundary').hidden=false;
    $('boundary-title').textContent=type==='obstacle'?I18N.t('addObstacle'):I18N.t('drawBoundary');
    $('boundary-points').textContent='';      // clear any leftover counters from the previous farm
    $('boundary-badge').textContent='';
    const area=$('boundary-area'); area.hidden=true; area.textContent='';
    await paint();
    renderControls();
  }
  function close(){ if(st && st.watchId!=null){ navigator.geolocation.clearWatch(st.watchId); } $('ov-boundary').hidden=true; }

  async function paint(){
    const canvas=$('boundary-map');
    const centerPt=st.points[st.points.length-1]||await farmCenter();
    canvas.__init=canvas.__init||{};
    if(!map){
      map=new GeoMap(canvas,{center:centerPt||{lat:24.7,lng:46.7},zoom:17,tiles:true});
      map.onTap=ll=>placePoint({lat:ll.lat,lng:ll.lng,accuracy:0,tapped:true});
    }
    renderItems();
  }
  function placePoint(loc){
    if(st.mode==='walk'||!loc||loc.lat==null) return;
    st.points.push({lat:loc.lat,lng:loc.lng,accuracy:loc.accuracy||0,tapped:loc.tapped});
    renderItems();
    map.fit();
    $('boundary-points').textContent=st.points.map((p,i)=>'#'+(i+1)).join('  ');
  }
  async function farmCenter(){
    const f=await DB.farm(st.farmId);
    if(f && f.lat!=null) return {lat:f.lat,lng:f.lng};
    const last=await DB.getSetting('lastKnownLocation',null);
    return last||null;
  }
  function renderItems(){
    if(!map) return;
    const poly=st.points.length>=2?[{points:st.points,fill:st.type==='obstacle'?'rgba(232,163,61,.2)':'rgba(34,139,84,.15)',stroke:st.type==='obstacle'?'#e8a33d':'#228b54'}]:[];
    const pts=st.points.map((p,i)=>({lat:p.lat,lng:p.lng,label:String(i+1),color:st.type==='obstacle'?'#e8a33d':'#228b54'}));
    const lines=(st.path&&st.path.length>=2)?[{points:st.path.slice(),color:'#3b82f6',width:2,dash:[4,3]}]:[];
    map.setItems({polygons:poly,points:pts,lines});
    const badge=$('boundary-badge');
    if(st.points.length) badge.textContent=I18N.t('pointOf',{n:String(st.points.length)})+(st.path&&st.path.length>=2?(' · '+I18N.t('walkTrace',{n:String(st.path.length)})):'');
    refreshArea();
  }
  function refreshArea(){
    const box=$('boundary-area');
    if(st.points.length>=3){
      const a=Geo.polygonAreaHa(st.points);
      box.hidden=false;
      box.textContent=I18N.t('areaIs',{a:Geo.fmtArea(a)});
    } else box.hidden=true;
    $('boundary-done').disabled=st.points.length<3;
  }

  function renderControls(){
    const wrap=$('boundary-mode');
    wrap.innerHTML='';
    if(st.type==='boundary'){
      const m1=el('button',{class:'btn '+(st.mode==='corners'?'btn-primary':'btn-outline'),onclick:()=>setMode('corners')},[I18N.t('cornersMode')]);
      const m2=el('button',{class:'btn '+(st.mode==='walk'?'btn-primary':'btn-outline'),onclick:()=>setMode('walk')},[I18N.t('walkMode')]);
      wrap.appendChild(m1); wrap.appendChild(m2);
    }
    const add=el('button',{class:'btn btn-primary',id:'boundary-add',onclick:()=>st.mode==='walk'?toggleWalk():capturePoint()},[I18N.t(st.mode==='walk'?'walkStop':(st.type==='obstacle'?I18N.t('obstacleZoneAdd'):'cornerTap'))]);
    wrap.appendChild(add);
    if(st.mode==='corners'||st.type==='obstacle'){
      wrap.appendChild(el('p',{class:'muted small',style:'margin:8px 0 0;text-align:center'},[I18N.t('tapOrGps')]));
    }
  }

  async function setMode(m){
    if(st.watchId!=null) stopWalk();
    st.mode=m;
    renderControls();
    if(m==='walk' && !st.points.length) toast(I18N.t('startWalk'));
  }

  async function capturePoint(){
    $('boundary-add').disabled=true;
    try{
      const loc=await Geo.capturePosition(14000);
      placePoint(loc);
      if(!loc.tapped){ map.setLocation({lat:loc.lat,lng:loc.lng},false); }
      $('boundary-points').textContent=st.points.map((p,i)=>'#'+(i+1)).join('  ');
    }catch(e){ toast(I18N.t('gpsFail')); }
    $('boundary-add').disabled=false;
  }

  function toggleWalk(){
    if(st.watchId!=null){ stopWalk(); return; }
    (async()=>{
      const threshold=parseInt(await DB.getSetting('walkM',8),10)||8;
      st.running=true;
      st.watchId=navigator.geolocation.watchPosition(
        pos=>{
          const loc={lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy};
          map.setLocation(loc,false);
          if(!st.last){
            st.last=loc; st.path=[loc]; return;
          }
          const d=Geo.distM(st.last,loc);
          if(d<3) return;                       // dedupe jittering fixes
          st.path.push(loc);
          st.last=loc;
          if(d>=threshold){
            st.points.push({lat:loc.lat,lng:loc.lng,accuracy:loc.accuracy});
            renderItems();
          } else {
            renderItems();                      // keep the walked trace visible live
          }
        },
        err=>{ toast(I18N.t('gpsFail')); stopWalk(); },
        {enableHighAccuracy:true,maximumAge:1000}
      );
      renderItems();
      renderControls();
      toast(I18N.t('walkRunning'));
    })();
  }
  function stopWalk(){
    if(st.watchId!=null){ navigator.geolocation.clearWatch(st.watchId); st.watchId=null; }
    st.running=false;
    st.last=null;
    renderItems();
    renderControls();
  }

  async function done(){
    if(st.points.length<3){ toast(I18N.t('needPoints')); return; }
    if(st.type==='obstacle'){
      const label=await pickLabel();
      if(label==null) return;
      const farm=await DB.farm(st.farmId);
      farm.obstacleZones=farm.obstacleZones||[];
      farm.obstacleZones.push({points:st.points.slice(),label:label,ts:Date.now()});
      await DB.saveFarm(farm);
      toast(I18N.t('obstacleSaved'));
      close();
      window.App.refreshAll();
      return;
    }
    const ok=await window.FlowUtil.confirm(I18N.t('confirmPolygon'));
    if(!ok) return;
    const farm=await DB.farm(st.farmId);
    const area=Geo.polygonAreaHa(st.points);
    farm.boundary={points:st.points.slice(), areaHa:area, method:st.mode==='walk'?'walk':'corners', ts:Date.now()};
    if(st.path&&st.path.length>=3) farm.boundary.path=st.path.slice();   // walked route trace
    await DB.saveFarm(farm);
    toast(I18N.t('boundarySaved')+(area?' · '+I18N.t('areaIs',{a:Geo.fmtArea(area)}):''));
    close();
    window.App.refreshAll();
  }

  function pickLabel(){
    return new Promise(resolve=>{
      const body=$('ov-boundary').querySelector('.visit-body');
      const old=body.querySelector('#obstacle-label-wrap');
      if(old) old.remove();
      const drugs=I18N.t('obstacleZoneTags');
      const wrap=el('div',{id:'obstacle-label-wrap'},[el('h4',{},[I18N.t('obstacleLabel')]),el('div',{class:'pills'},drugs.map((d,i)=>el('button',{class:'pill'+(i===st.labelIndex?' on':''),onclick:function(){ wrap.querySelectorAll('.pill').forEach(x=>x.classList.remove('on')); this.classList.add('on'); st.labelIndex=i; }},[d]))),el('div',{class:'btn-row'},[el('button',{class:'btn btn-outline',onclick:()=>{ wrap.remove(); resolve(null); }},[I18N.t('cancel')]),el('button',{class:'btn btn-primary',onclick:()=>{ wrap.remove(); resolve(drugs[st.labelIndex]||'other'); }},[I18N.t('done')])])]);
      body.appendChild(wrap);
    });
  }

  $('boundary-cancel').addEventListener('click',close);
  $('boundary-clear').addEventListener('click',()=>{ st.points=[]; renderItems(); });
  $('boundary-done').addEventListener('click',done);
  $('boundary-map').addEventListener('dblclick',()=>{ if(map) map.fit(); });

  window.Flow.Boundary={open, close};
})();