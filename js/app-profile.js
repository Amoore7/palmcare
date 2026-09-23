(function(){
  const $=id=>document.getElementById(String(id).replace(/^#/,''));
  const {h,el}=window.Util;
  const {toast}=window.FlowUtil;

  let farmMap=null;
  let areaMap=null;

  // distinct color per farm (area map: boundaries/labels/legend) 
  const FARM_COLORS=['#228b54','#0b6bcb','#c0392b','#c07a10','#8e44ad','#1abc9c','#e74c3c','#6c8f3b'];
  function hexToRgba(hex,a){ const n=parseInt(hex.slice(1),16); return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')'; }

  // ================= FARM PROFILE =================
  // ================= FARM TRAIL (per-farm GPS breadcrumb) =================
  const FarmTrail={
    _farmId: null,
    _running: false,
    _wid: null,
    _points: [],
    _handler: null,
    _farmMap: null,
    _startTime: null,

    init(farmId, farmMap){
      this._farmId=farmId;
      this._farmMap=farmMap;
      this._load();
    },

    async _load(){
      const farm=await DB.farm(this._farmId);
      if(farm && farm.trail && farm.trail.points && farm.trail.points.length){
        this._points=farm.trail.points;
        this._drawTrail();
      }
    },

    _drawTrail(){
      if(!this._farmMap || this._points.length<2) return;
      this._farmMap.setItems({
        polygons: this._farmMap.items.polygons||[],
        points: this._farmMap.items.points||[],
        lines: [...(this._farmMap.items.lines||[]), {points:this._points, color:'#0ea5e9', width:3, dash:[]}]
      });
    },

    _save(){
      return DB.farm(this._farmId).then(farm=>{
        if(!farm) return;
        farm.trail={points:this._points, updatedAt:Date.now()};
        return DB.saveFarm(farm);
      });
    },

    setHandler(fn){ this._handler=fn; },

    start(){
      if(this._running) return;
      const gl=navigator.geolocation;
      if(!gl){ toast(I18N.t('gpsFail')); return; }
      this._running=true;
      this._points=[];
      this._startTime=Date.now();
      this._wid=gl.watchPosition(this._onFix.bind(this), this._onErr.bind(this), {enableHighAccuracy:true, timeout:10000, maximumAge:2000});
      this._updateUI();
    },

    _onFix(p){
      if(!this._running) return;
      const c=p.coords;
      const lat=c.latitude, lng=c.longitude, acc=Math.max(Math.round(c.accuracy||0),0);
      if(acc>150) return;
      const last=this._points[this._points.length-1];
      if(last){
        const moved=Geo.distM(last,{lat,lng});
        if(moved<4) return;
      }
      this._points.push({lat,lng,acc,ts:Date.now()});
      if(this._points.length>2000) this._points.shift();
      this._drawTrail();
      this._save();
      if(this._handler) this._handler({lat,lng,accuracy:acc, pointsCount:this._points.length});
    },

    _onErr(){ /* keep watching */ },

    stop(){
      if(!this._running) return;
      this._running=false;
      if(this._wid){ navigator.geolocation.clearWatch(this._wid); this._wid=null; }
      this._save();
      this._updateUI();
    },

    clear(){
      this._points=[];
      this._save();
      this._drawTrail();
      this._updateUI();
    },

    get running(){ return this._running; },
    get points(){ return this._points; },

    _updateUI(){
      const startBtn=$('#btn-farm-trail-start');
      const stopBtn=$('#btn-farm-trail-stop');
      const clearBtn=$('#btn-farm-trail-clear');
      const bar=$('#farm-trail-bar');
      if(!startBtn) return;
      if(this._running){
        startBtn.hidden=true; stopBtn.hidden=false;
      }else{
        startBtn.hidden=false; stopBtn.hidden=true;
      }
      clearBtn.hidden=this._points.length===0;
      if(bar) bar.hidden=false;
    }
  };

  // ================= FARM PROFILE =================
  const Profile={
    async render(farmId){
      const farm=await DB.farm(farmId);
      if(!farm) return;
      $('#farm-title').textContent=farm.name||'—';
      const info=$('#farm-info');
      info.innerHTML='';
      info.appendChild(el('h4',{},[farm.name||'—']));
      if(farm.archived){
        const w=el('div',{class:'warnbox'},['📦 '+I18N.t('archived')+(farm.archiveNote?(': '+farm.archiveNote):'')]);
        w.appendChild(el('button',{class:'linkbtn',onclick:async()=>{ farm.archived=false; farm.archiveNote=null; await DB.saveFarm(farm); toast(I18N.t('farmSaved')); window.App.refreshAll(); }},['↩ '+I18N.t('unarchive')]));
        info.insertBefore(w,info.firstChild);
      }
      const palms=await DB.palmsForFarm(farm.id);
      let fd=null;
      palms.forEach(p=>{ if(p.nextInspectionDate&&!p.result&&(fd==null||p.nextInspectionDate<fd)) fd=p.nextInspectionDate; });
      if(fd){
        const cls=Geo.dueClass(fd);
        const days=Math.ceil((fd-Date.now())/86400000);
        const label=days<=0?I18N.t('followUpToday'):I18N.t('daysLeft',{n:String(days)});
        const binfo=el('div',{class:'warnbox followbanner '+(cls==='red'?'red':cls==='yellow'?'yellow':'green'),onclick:()=>{ window.App.goto('home'); }},[
          '🔔 '+I18N.t('followUpReminder')+': '+Geo.fmtDate(fd)+' ('+label+')'
        ]);
        info.insertBefore(binfo,info.firstChild);
      }
      const kv=(a,b)=>el('div',{class:'kv'},[el('b',{},[a]),el('span',{},[b])]);
      info.appendChild(kv(I18N.t('nationalId'),farm.nationalId||'—'));
      info.appendChild(kv(I18N.t('phone'),farm.phone||'—'));
      const span=el('span',{},[farm.lat!=null?(farm.lat.toFixed(6)+' , '+farm.lng.toFixed(6)):I18N.t('coordsMissing')]);
      span.appendChild(el('button',{class:'linkbtn',onclick:()=>window.App.openExternalMaps(farm)},[' 🗺 '+I18N.t('openInMaps')]));
      info.appendChild(kv(I18N.t('lat')+' / '+I18N.t('lng'),span));
      info.appendChild(kv(I18N.t('registeredCount'),String(farm.registeredCount||0)));
      info.appendChild(kv(I18N.t('areaNotCalculated'), farm.boundary? Geo.fmtArea(Geo.polygonAreaHa(farm.boundary.points))+' '+I18N.t('ha') : '—'));
const editBtn=el('button',{class:'btn btn-outline',onclick:()=>editFarm(farm)},['✏️ '+I18N.t('editFarm')]);
       info.appendChild(editBtn);

       const map=await renderMap(farm);
       FarmTrail.init(farm.id, map);
       FarmTrail._updateUI();
       // bind farm trail buttons (now that DOM elements exist)
       $('#btn-track-route').onclick=()=>{ $('#farm-trail-bar').hidden=false; FarmTrail._updateUI(); };
       $('#btn-farm-trail-start').onclick=()=>{ FarmTrail.start(); };
       $('#btn-farm-trail-stop').onclick=()=>{ FarmTrail.stop(); };
       $('#btn-farm-trail-clear').onclick=()=>{ FarmTrail.clear(); };
       renderPalms(farm);
       renderVisits(farm);
       $('#btn-del-boundary').hidden=!farm.boundary;
       $('#btn-boundary').innerHTML = farm.boundary ? '✏️ <span data-i18n="editBoundary"></span>' : '<span data-i18n="drawBoundary"></span>';
       window.App.applyI18n();
     }
   };

  async function editFarm(farm){
    const ov=el('div',{class:'overlay'});
    const sheet=el('div',{class:'sheet scroll'},[
      el('div',{class:'sheet-head'},[el('h3',{},[I18N.t('editFarm')]),el('button',{class:'iconbtn close',onclick:()=>ov.remove()},['✕'])]),
      el('div',{class:'form'},[
        el('input',{value:farm.name||'',placeholder:I18N.t('farm')}),
        el('input',{value:farm.nationalId||'',placeholder:I18N.t('nationalId')}),
        el('input',{value:farm.phone||'',placeholder:I18N.t('phone')}),
        el('input',{type:'number',step:'0.000001',value:farm.lat!=null?farm.lat:'',placeholder:I18N.t('lat')}),
        el('input',{type:'number',step:'0.000001',value:farm.lng!=null?farm.lng:'',placeholder:I18N.t('lng')}),
        el('input',{type:'number',min:'0',value:farm.registeredCount||0,placeholder:I18N.t('registeredCount')}),
        el('button',{class:'btn btn-primary',onclick:async()=>{
          const inp=sheet.querySelectorAll('input');
          farm.name=inp[0].value.trim(); farm.nationalId=inp[1].value.trim(); farm.phone=inp[2].value.trim();
          const la=parseFloat(inp[3].value), lo=parseFloat(inp[4].value);
          if(Geo.isValidCoord(la,lo)){ farm.lat=la; farm.lng=lo; }
          farm.registeredCount=parseInt(inp[5].value,10)||0;
          await DB.saveFarm(farm);
          ov.remove();
          toast(I18N.t('farmSaved'));
          window.App.refreshAll();
        }},[I18N.t('save')])
      ])
    ]);
    ov.appendChild(sheet);
    ov.addEventListener('click',e=>{ if(e.target===ov) ov.remove(); });
    document.body.appendChild(ov);
  }

  // ---------- farm map ----------
  async function renderMap(farm){
    const canvas=$('farm-map');
    if(farmMap){ farmMap.dispose(); farmMap=null; }
    const center=(farm.boundary&&farm.boundary.points.length)?farm.boundary.points[0]:(farm.lat!=null?{lat:farm.lat,lng:farm.lng}:null);
    farmMap=new GeoMap(canvas,{center:center||{lat:24.7,lng:46.7},zoom:16,tiles:true});
    const last=await DB.getSetting('lastKnownLocation',null);
    farmMap.setLocation(last,false);
    updateFarmMap(farm);
    $('#farm-map-badge').innerHTML='';
    if(farm.boundary){ $('#farm-map-badge').textContent=I18N.t('areaIs',{a:Geo.fmtArea(Geo.polygonAreaHa(farm.boundary.points))}); }
    else $('#farm-map-badge').textContent=I18N.t('areaNotCalculated');
    return farmMap;
  }
  async function updateFarmMap(farm){
    const palms=await DB.palmsForFarm(farm.id);
    const points=palms.map(p=>({
      lat:p.lat!=null?p.lat:(farm.lat!=null?farm.lat:undefined),
      lng:p.lng!=null?p.lng:(farm.lng!=null?farm.lng:undefined),
      label:p.code,
      color: p.result==='recovered'?'#228b54': p.result==='dead'?'#444': p.nextInspectionDate&&Geo.dueClass(p.nextInspectionDate)==='red'?'#d64541':'#e8a33d',
      size:8
    })).filter(p=>p.lat!=null);
    const polys=[];
    if(farm.boundary&&farm.boundary.points&&farm.boundary.points.length) polys.push({points:farm.boundary.points,fill:'rgba(34,139,84,.12)',stroke:'#228b54',label:farm.name||''});
    (farm.obstacleZones||[]).forEach(o=>{
      if(o.points&&o.points.length) polys.push({points:o.points,fill:'rgba(232,163,61,.25)',stroke:'#e8a33d',label:o.label||'',dash:[6,4]});
    });
const lines=[];
     if(farm.boundary&&Array.isArray(farm.boundary.path)&&farm.boundary.path.length>=2){
       lines.push({points:farm.boundary.path,color:'#3b82f6',width:2,dash:[4,3]});
     }
     // farm trail
     if(FarmTrail.points && FarmTrail.points.length>=2){
       lines.push({points:FarmTrail.points, color:'#0ea5e9', width:3, dash:[]});
     }
     farmMap.setItems({polygons:polys,points,lines});
     if(!farmMap._fitDone){ farmMap.fit(); farmMap._fitDone=true; }
   }

  // ---------- palms list ----------
  async function renderPalms(farm){
    const palms=await DB.palmsForFarm(farm.id);
    const w=$('#farm-palms');
    w.innerHTML='';
    if(!palms.length){ w.appendChild(el('p',{class:'empty-msg muted'},[I18N.t('noPalms')])); return; }
    palms.forEach(p=>{
      const row=el('div',{class:'palm-row',onclick:()=>Flow.Palm.open(farm.id,p,null,{title:I18N.t('followUpTitle')})},[
        el('span',{class:'dot',style:'background:'+FlowUtil.severityColor(p.severity)}),
        el('b',{},[p.code]),
        el('span',{class:'muted small'},[(p.severity||'')+(p.pesticide?(' · '+p.pesticide):'')]),
        p.result
          ? el('b',{style:'color:'+(p.result==='recovered'?'#228b54':p.result==='dead'?'#d64541':'#e8a33d')},[p.result])
          : el('span',{class:'due '+(p.nextInspectionDate?Geo.dueClass(p.nextInspectionDate):'green')},[p.nextInspectionDate?Geo.fmtDate(p.nextInspectionDate):'—'])
      ]);
      w.appendChild(row);
    });
  }

  // ---------- visits ----------
  async function renderVisits(farm){
    const visits=await DB.visitsForFarm(farm.id);
    const w=$('#farm-visits');
    w.innerHTML='';
    if(!visits.length){ w.appendChild(el('p',{class:'empty-msg muted'},[I18N.t('noVisits')])); return; }
    const tl=el('div',{class:'timeline'});
    visits.forEach(v=>{
      const item=el('div',{class:'tl-item'},[
        el('div',{class:'tl-date'},[geoFull(v.date)]),
        el('div',{class:'small'},[
          I18N.t('registeredCount')+': <b>'+(v.registeredCount||0)+'</b>',
          ' · '+I18N.t('actualCount')+': <b>'+(v.actualCount!=null?v.actualCount:'—')+'</b>'
        ])
      ]);
      if(v.entryTime||v.exitTime) item.appendChild(el('div',{class:'muted small'},['⏱ '+I18N.t('entry')+': '+(v.entryTime||'—')+' · '+I18N.t('exit')+': '+(v.exitTime||'—')]));
      if(v.exitGPS&&v.exitGPS.lat!=null) item.appendChild(el('div',{class:'muted small'},['🏁 '+I18N.t('exitGps')+': '+v.exitGPS.lat.toFixed(5)+','+v.exitGPS.lng.toFixed(5)]));
      if(v.discrepancyNote) item.appendChild(el('div',{class:'warnbox small'},[v.discrepancyNote]));
      if(v.fTreatment && (v.fTreatment.treatedPalms||v.fTreatment.fibrolPalms)) item.appendChild(el('div',{class:'muted small'},['💊 '+I18N.t('phosphideTotal')+': <b>'+String(v.fTreatment.treatedPalms*(v.fTreatment.phosphidePerPalm||0))+'</b>'+(v.fTreatment.fibrolPalms?(' · '+I18N.t('fibrol')+': '+String(v.fTreatment.fibrolPalms)+' 🌴 · '+String(v.fTreatment.fibrolMl||0)+' ml'):'')]));
      if(v.obstacles&&v.obstacles.length){ const tags=el('div',{},[v.obstacles.map(t=>el('span',{class:'tag'},[t]))]); item.appendChild(tags); }
      if(v.note) item.appendChild(el('div',{class:'muted small'},['📝 '+v.note]));
      if(v.gps&&v.gps.lat!=null){ const d=farm.lat!=null?Geo.fmtDist(Geo.distM(v.gps,farm)):''; item.appendChild(el('div',{class:'muted small'},['📍 '+v.gps.lat.toFixed(5)+','+v.gps.lng.toFixed(5)+(d?' · '+d:'')])); }
      if(v.palmIds&&v.palmIds.length) item.appendChild(el('div',{class:'muted small'},['🌴 '+v.palmIds.length]));
      tl.appendChild(item);
    });
    w.appendChild(tl);
  }
  function geoFull(ts){ const d=new Date(ts); return d.toLocaleDateString(I18N.get()==='ar'?'ar-SA':'en-GB',{year:'numeric',month:'short',day:'numeric'})+' '+d.toLocaleTimeString(I18N.get()==='ar'?'ar-SA':'en-GB',{hour:'2-digit',minute:'2-digit'}); }

  // ================= AREA MAP =================
  const AreaMap={
     selectedRouteFarm: null,
     _navigating: false,
     _navTarget: null,
     _deviceHeading: 0,
     _navUpdateTimer: null,
     _compassCanvas: null,
     _compassCtx: null,
     _arrivedNotified: false,
     _turnNavigating: false,
     _turnRoute: null,
     _turnTarget: null,
     _turnUpdateTimer: null,

     async render(){
      const vv=$('view-map');
      if(vv&&vv.hidden){ if(typeof TrailUI!=='undefined'&&TrailUI) TrailUI.update(); return; }
      const canvas=$('area-map');
      if(areaMap){ try{ areaMap.resize(); }catch(e){} }   // ensure non-zero size once visible
      if(!areaMap){
        areaMap=new GeoMap(canvas,{center:{lat:24.7,lng:46.7},zoom:11,tiles:true});
        AreaMap.instance=areaMap;
        areaMap.onTap=async (ll,pt)=>{
          const all=await DB.farms();
          const farms=all.filter(f=>!f.archived);
          let best=null,bd=1e9;
          farms.forEach(f=>{
            if(f.lat==null) return;
            const s=areaMap.projectToScreen(f.lat,f.lng);
            const d=Math.hypot(s.x-pt.x,s.y-pt.y);
            if(d<bd){ bd=d; best=f; }
          });
          if(best&&bd<=32){ window.App.goto('farm',best.id); }
        };
      }
      const farms=await DB.farms();
      const active=farms.filter(f=>!f.archived);
      const last=await DB.getSetting('lastKnownLocation',null);
      if(last) areaMap.setLocation(last,false);
      const colorOf=new Map(active.map((f,i)=>[f.id, FARM_COLORS[i%FARM_COLORS.length]]));
      const polys=[]; const traceLines=[];
      active.forEach(f=>{
        const col=colorOf.get(f.id);
        if(f.boundary&&f.boundary.points&&f.boundary.points.length){
          polys.push({points:f.boundary.points,fill:hexToRgba(col,.12),stroke:col,label:f.name||''});
          if(Array.isArray(f.boundary.path)&&f.boundary.path.length>=2) traceLines.push({points:f.boundary.path,color:col,width:1.5,dash:[4,3]});
        }
        (f.obstacleZones||[]).forEach(o=>{
          if(o.points&&o.points.length) polys.push({points:o.points,fill:'rgba(232,163,61,.22)',stroke:'#e8a33d',label:(f.name?f.name+': ':'')+(o.label||''),dash:[6,4]});
        });
      });
      const points=active.filter(f=>f.lat!=null).map(f=>({lat:f.lat,lng:f.lng,label:f.name||'·',color:colorOf.get(f.id),size:8}));
      // nearest pending line
      const line=[]; let routeText='';
      const pending=await DB.palmsPendingInspection();
      if(last){
        let nearest=null,nd=Infinity;
        for(const p of pending){
          const f=active.find(x=>x.id===p.farmId);
          if(!f||f.lat==null) continue;
          const d=Geo.distM(last,f);
          if(d<nd){ nd=d; nearest=f; }
        }
        if(nearest){
          const bear=Geo.bearingDeg(last,{lat:nearest.lat,lng:nearest.lng});
          line.push({points:[last,{lat:nearest.lat,lng:nearest.lng}],color:'#e8a33d',width:2,dash:[6,4]});
          routeText='<b>'+I18N.t('nearestPending')+':</b> '+nearest.name+' — '+Geo.fmtDist(nd)+' — '+I18N.t('bearing')+': '+I18N.t('directions')[Geo.dirLabel(bear)];
        } else {
          routeText=I18N.t('noPending');
        }
        if($('map-route-inline')) $('map-route-inline').innerHTML=routeText;
        if(nearest){
          const rp=$('map-route-inline');
          if(rp){
            const gotoBtn=el('button',{class:'btn btn-outline small',id:'btn-route-maps',onclick:()=>window.App.openExternalMaps(nearest)},['🗺 '+I18N.t('routeDir')]);
            rp.appendChild(gotoBtn);
          }
        }
      }
// current trip trail (persisted breadcrumb of where we actually drove)
       const tr=window.Trail&&Trail.session;
       if(tr && tr.points && tr.points.length>=2){
         line.push({points:tr.points.map(p=>({lat:p.lat,lng:p.lng})),color:'#0ea5e9',width:3,dash:[]});
       }
       // selected farm route line
       if(AreaMap.selectedRouteFarm && last && AreaMap.selectedRouteFarm.lat!=null){
         const f=AreaMap.selectedRouteFarm;
         const d=Geo.distM(last,f);
         const bear=Geo.bearingDeg(last,{lat:f.lat,lng:f.lng});
         line.push({points:[last,{lat:f.lat,lng:f.lng}],color:'#0ea5e9',width:3,dash:[6,4]});
         if($('map-route-inline')){
           $('map-route-inline').innerHTML='<b>'+I18N.t('routeTo',{name:f.name})+':</b> '+f.name+' — '+Geo.fmtDist(d)+' — '+I18N.t('bearing')+': '+I18N.t('directions')[Geo.dirLabel(bear)];
           const clearBtn=el('button',{class:'btn btn-outline small',onclick:()=>{ AreaMap.selectedRouteFarm=null; AreaMap.render(); }},['✕ '+I18N.t('clear')]);
           $('map-route-inline').appendChild(clearBtn);
         }
         // enable follow mode and center on route
         if(window.Trail && !Trail.follow){
           Trail.follow=true;
           const b=$('btn-map-follow'); if(b)b.classList.add('on');
         }
         if(areaMap){
           const midLat=(last.lat+f.lat)/2;
           const midLng=(last.lng+f.lng)/2;
           areaMap.setCenter({lat:midLat,lng:midLng});
           areaMap.setZoom(14);
         }
       }
       // legend: which farm owns which boundary
       const bounded=active.filter(f=>f.boundary&&f.boundary.points&&f.boundary.points.length);
       const leg=$('map-legend');
       if(leg){
         leg.innerHTML='';
         leg.appendChild(el('h3',{class:'section-title'},[I18N.t('boundaries')+' ('+bounded.length+')']));
         if(!bounded.length){
           leg.appendChild(el('p',{class:'muted small'},[I18N.t('noBoundaries')]));
         } else {
bounded.forEach(f=>{
              const col=colorOf.get(f.id);
              const btn=el('button',{class:'legend-row'},[
                el('span',{class:'dot',style:'background:'+col}),
                el('span',{},[f.name||'—']),
                el('b',{},[Geo.fmtArea(Geo.polygonAreaHa(f.boundary.points))+' '+I18N.t('ha')])
              ]);
              // Tap: show guidance line + start button
              btn.addEventListener('click',()=>{ AreaMap.selectRouteFarm(f); });
              // Long press: navigate to farm profile
              btn.addEventListener('contextmenu',e=>{ e.preventDefault(); window.App.goto('farm',f.id); });
              // Touch long press for mobile
              let pressTimer=null;
              btn.addEventListener('touchstart',()=>{ pressTimer=setTimeout(()=>{ window.App.goto('farm',f.id); },600); },{passive:true});
              btn.addEventListener('touchend',()=>{ if(pressTimer) clearTimeout(pressTimer); });
              btn.addEventListener('touchmove',()=>{ if(pressTimer) clearTimeout(pressTimer); });
              leg.appendChild(btn);
            });
         }
}
      areaMap.setItems({polygons:polys,points,lines:line.concat(traceLines)});
       if(!areaMap._fitDone){ areaMap.fit(); areaMap._fitDone=true; }
       $('#area-map-badge').textContent=I18N.t('allFarms')+': '+active.length+' · '+I18N.t('boundaries')+': '+bounded.length;
       TrailUI.update();
     },
selectRouteFarm(farm){
        AreaMap.selectedRouteFarm=farm;
        AreaMap.startNavigation(farm);
        AreaMap.render().catch(()=>{});
      },
      startNavigation(farm){
        this._navigating=true;
        this._navTarget=farm;
        this._arrivedNotified=false;
        this._showNavPanel();
        this._startNavUpdates();
        this._initCompass();
        this._listenDeviceOrientation();
      },
      stopNavigation(){
        this._navigating=false;
        this._navTarget=null;
        this._hideNavPanel();
        this._stopNavUpdates();
        this._stopDeviceOrientation();
        if(this._turnNavigating) this.stopTurnByTurn();
      },
      stopTurnByTurn(){
        this._turnNavigating=false;
        this._turnTarget=null;
        this._turnRoute=null;
        this._hideTurnPanel();
        this._stopTurnUpdates();
      },
      async startTurnByTurn(farm){
        if(!window.Routing) return;
        const last=AreaMap._lastLocation;
        if(!last) return;
        
        this._turnNavigating=true;
        this._turnTarget=farm;
        this._showTurnPanel();
        
        try{
          const route=await window.Routing.getRoute(farm.id, last, {lat:farm.lat, lng:farm.lng});
          if(route){
            this._turnRoute=route;
            this._renderTurnRoute();
            this._startTurnUpdates();
          }
        }catch(e){
          console.error('Turn-by-turn failed:', e);
        }
      },
      _showTurnPanel(){
        const panel=$('#map-turn-panel');
        const navPanel=$('#map-nav-panel');
        if(panel){ panel.hidden=false; }
        if(navPanel){ navPanel.hidden=true; }
        const inline=$('#map-route-inline');
        if(inline){ inline.hidden=true; }
        this._updateTurnPanel();
      },
      _hideTurnPanel(){
        const panel=$('#map-turn-panel');
        if(panel){ panel.hidden=true; }
      },
      _renderTurnRoute(){
        if(!this._turnRoute || !areaMap) return;
        const routeLine={
          points: this._turnRoute.geometry,
          color: '#0ea5e9',
          width: 4,
          dash: []
        };
        const currentItems=areaMap.items||{polygons:[],points:[],lines:[]};
        areaMap.setItems({
          polygons: currentItems.polygons||[],
          points: currentItems.points||[],
          lines: [...(currentItems.lines||[]), routeLine]
        });
      },
      _updateTurnPanel(){
        if(!this._turnNavigating || !this._turnRoute || !this._turnTarget) return;
        const last=AreaMap._lastLocation;
        if(!last) return;
        
        const nextInfo=window.Routing.getNextInstruction(
          this._turnRoute.instructions, this._turnRoute.geometry, last
        );
        
        if(!nextInfo) return;
        
        const turnIcon=$('#turn-icon');
        const turnText=$('#turn-text');
        const turnDistance=$('#turn-distance');
        const turnNext=$('#turn-next');
        const turnProgressBar=$('#turn-progress-bar');
        
        const step=nextInfo.current;
        const lang=I18N.get();
        const formatted=window.Routing.formatInstruction(step, lang);
        
        // Set turn icon based on instruction type
        if(turnIcon) turnIcon.textContent=window.Routing.getTurnIcon(step.type);
        if(turnText) turnText.textContent=formatted;
        if(turnDistance) turnDistance.textContent=step.distance < 1 ? I18N.t('metersAway',{dist:Math.round(step.distance*1000)}) : I18N.t('kmAway',{dist:step.distance.toFixed(1)});
        if(turnNext && nextInfo.next){
          turnNext.textContent=I18N.t('nextTurn',{instruction: window.Routing.formatInstruction(nextInfo.next, lang)});
        }
        if(turnProgressBar){
          turnProgressBar.style.width=(nextInfo.progress*100)+'%';
        }
        
        // Check arrived
        const f=this._turnTarget;
        const d=Geo.distM(last,f);
        if(d<=50){
          this._showTurnArrived();
        }
      },
      _showTurnArrived(){
        const turnIcon=$('#turn-icon');
        const turnText=$('#turn-text');
        if(turnIcon) turnIcon.textContent='🎯';
        if(turnText) turnText.textContent=I18N.t('arrive');
        toast(I18N.t('navigateArrived'));
        setTimeout(()=>this.stopTurnByTurn(),3000);
      },
      _startTurnUpdates(){
        if(this._turnUpdateTimer) clearInterval(this._turnUpdateTimer);
        this._turnUpdateTimer=setInterval(()=>this._updateTurnPanel(),2000);
      },
      _stopTurnUpdates(){
        if(this._turnUpdateTimer) clearInterval(this._turnUpdateTimer);
        this._turnUpdateTimer=null;
      },
      _hideTurnPanel(){
        const panel=$('#map-turn-panel');
        if(panel){ panel.hidden=true; }
        const navPanel=$('#map-nav-panel');
        if(navPanel){ navPanel.hidden=false; }
        const inline=$('#map-route-inline');
        if(inline){ inline.hidden=false; }
        const startBtn=$('#btn-nav-start');
        if(startBtn){ startBtn.hidden=false; }
      },
      _showNavPanel(){
        const panel=$('#map-nav-panel');
        const inline=$('#map-route-inline');
        const startBtn=$('#btn-nav-start');
        if(panel){ panel.hidden=false; }
        if(inline){ inline.hidden=true; }
        if(startBtn){ startBtn.hidden=this._turnNavigating; }
        this._updateNavPanel();
      },
      _hideNavPanel(){
        const panel=$('#map-nav-panel');
        const inline=$('#map-route-inline');
        if(panel){ panel.hidden=true; }
        if(inline){ inline.hidden=false; }
      },
      _updateNavPanel(){
        if(!this._navigating || !this._navTarget) return;
        const last=AreaMap._lastLocation;
        if(!last) return;
        const f=this._navTarget;
        const d=Geo.distM(last,f);
        const bear=Geo.bearingDeg(last,{lat:f.lat,lng:f.lng});
        const dirLabel=I18N.t('directions')[Geo.dirLabel(bear)];
        // update farm name
        const nameEl=$('#nav-farm-name');
        if(nameEl) nameEl.textContent=f.name||'—';
        // update distance
        const distEl=$('#nav-distance');
        if(distEl) distEl.textContent=I18N.t('navigateDistance',{dist:Geo.fmtDist(d)});
        // update bearing
        const bearingEl=$('#nav-bearing');
        if(bearingEl) bearingEl.textContent=I18N.t('navigateBearing',{bearing:dirLabel});
        // check arrived
        if(d<=50 && !this._arrivedNotified){
          this._arrivedNotified=true;
          this._showArrived();
        }
        // draw compass
        this._drawCompass();
      },
      _showArrived(){
        const arrived=$('#nav-arrived');
        if(arrived){
          arrived.hidden=false;
          toast(I18N.t('navigateArrived'));
          setTimeout(()=>{ arrived.hidden=true; },3000);
        }
      },
      _startNavUpdates(){
        if(this._navUpdateTimer) clearInterval(this._navUpdateTimer);
        this._navUpdateTimer=setInterval(()=>this._updateNavPanel(),1000);
      },
      _stopNavUpdates(){
        if(this._navUpdateTimer) clearInterval(this._navUpdateTimer);
        this._navUpdateTimer=null;
      },
      _initCompass(){
        const canvas=$('#nav-compass');
        if(canvas && !this._compassCtx){
          this._compassCanvas=canvas;
          this._compassCtx=canvas.getContext('2d');
        }
      },
      _drawCompass(){
        if(!this._compassCtx || !this._compassCanvas) return;
        const ctx=this._compassCtx;
        const canvas=this._compassCanvas;
        const size=120;
        const center=size/2;
        const radius=54;
        const heading=this._deviceHeading || 0;
        const targetBearing=this._navTarget && AreaMap._lastLocation ? Geo.bearingDeg(AreaMap._lastLocation,{lat:this._navTarget.lat,lng:this._navTarget.lng}) : 0;
        const relativeBearing=targetBearing - heading;
        ctx.clearRect(0,0,size,size);
        // outer circle
        ctx.beginPath();
        ctx.arc(center,center,radius,0,Math.PI*2);
        ctx.strokeStyle='#e3e8ee';
        ctx.lineWidth=2;
        ctx.stroke();
        // cardinal directions
        ctx.font='11px sans-serif';
        ctx.fillStyle='#6b7684';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ['N','NE','E','SE','S','SW','W','NW'].forEach((d,i)=>{
          const angle=(i*45-90)*Math.PI/180;
          const x=center+Math.cos(angle)*(radius+14);
          const y=center+Math.sin(angle)*(radius+14);
          ctx.fillText(d,x,y);
        });
        // arrow pointing to target
        const arrowAngle=(relativeBearing-90)*Math.PI/180;
        ctx.save();
        ctx.translate(center,center);
        ctx.rotate(arrowAngle);
        ctx.beginPath();
        ctx.moveTo(0,-radius+6);
        ctx.lineTo(-10,-radius+26);
        ctx.lineTo(0,-radius+14);
        ctx.lineTo(10,-radius+26);
        ctx.closePath();
        ctx.fillStyle='#0ea5e9';
        ctx.fill();
        ctx.strokeStyle='#fff';
        ctx.lineWidth=2;
        ctx.stroke();
        ctx.restore();
        // center dot
        ctx.beginPath();
        ctx.arc(center,center,6,0,Math.PI*2);
        ctx.fillStyle='#0ea5e9';
        ctx.fill();
      },
      _listenDeviceOrientation(){
        if(this._deviceOrientationHandler) return;
        this._deviceOrientationHandler=(e)=>{
          // webkitCompassHeading for iOS, alpha for Android
          let heading=e.webkitCompassHeading;
          if(heading==null && e.alpha!=null){
            heading=360-e.alpha;
          }
          if(heading!=null){
            this._deviceHeading=heading;
            this._drawCompass();
          }
        };
        window.addEventListener('deviceorientation',this._deviceOrientationHandler,true);
        // request permission for iOS 13+
        if(DeviceOrientationEvent && DeviceOrientationEvent.requestPermission){
          DeviceOrientationEvent.requestPermission().catch(()=>{});
        }
      },
      _stopDeviceOrientation(){
        if(this._deviceOrientationHandler){
          window.removeEventListener('deviceorientation',this._deviceOrientationHandler,true);
          this._deviceOrientationHandler=null;
        }
      }
    };
  $('#btn-map-locate').addEventListener('click',async()=>{
    const btn=$('btn-map-locate');
    btn.disabled=true;
    try{
      const loc=await Geo.capturePosition(15000);
      await DB.setSetting('lastKnownLocation',{lat:loc.lat,lng:loc.lng,accuracy:loc.accuracy,at:Date.now()});
      if(!areaMap) areaMap=new GeoMap($('area-map'),{center:{lat:loc.lat,lng:loc.lng},zoom:15,tiles:true});
      areaMap.setLocation(loc,true);
      AreaMap.render();
    }catch(e){ toast(I18N.t('gpsFail')); }
    btn.disabled=false;
  });
const TrailUI={
     _render:0,
     update(){
       const startBtn=$('btn-trail-start'), stopBtn=$('btn-trail-stop'), clearBtn=$('btn-trail-clear');
       if(!startBtn) return;
       const run=!!(window.Trail&&Trail.running);
       if(run){ startBtn.disabled=true; stopBtn.hidden=false; }
       else{ startBtn.disabled=false; stopBtn.hidden=true; }
       const fb=$('btn-map-follow'); if(fb) fb.classList.toggle('on',!!(window.Trail&&Trail.follow));
     }
   };
  if(window.Trail){
     Trail.setHandler(loc=>{
       if(loc&&areaMap) areaMap.setLocation(loc,Trail.follow);
       if(loc) AreaMap._lastLocation={lat:loc.lat,lng:loc.lng};
       if(AreaMap._navigating) AreaMap._updateNavPanel();
       const now=Date.now();
       if(now-TrailUI._render>1100){ TrailUI._render=now; TrailUI.update(); AreaMap.render().catch(()=>{}); }
       else TrailUI.update();
     });
$('btn-trail-start').addEventListener('click',()=>{ Trail.start(); Trail.follow=true; const b=$('btn-map-follow'); if(b)b.classList.add('on'); AreaMap.render().catch(()=>{}); });
      $('btn-trail-stop').addEventListener('click',()=>{ Trail.stop(); AreaMap.render().catch(()=>{}); });
      $('btn-trail-clear').addEventListener('click',()=>{ Trail.clear(); AreaMap.render().catch(()=>{}); });
      $('#btn-nav-stop').addEventListener('click',()=>{ AreaMap.stopNavigation(); });
      $('#btn-nav-start').addEventListener('click',()=>{ AreaMap.startTurnByTurn(AreaMap._navTarget); });
      $('#btn-turn-stop').addEventListener('click',()=>{ AreaMap.stopTurnByTurn(); });
    }
   $('#btn-map-follow').addEventListener('click',()=>{
    if(window.Trail){
      Trail.follow=!Trail.follow;
      $('btn-map-follow').classList.toggle('on',Trail.follow);
    }
    if(areaMap&&areaMap.loc) areaMap.setLocation(areaMap.loc,true);
  });
  $('#area-map').addEventListener('dblclick',()=>{ if(areaMap) areaMap.fit(); });

  // ================= STATS =================
  const Stats={
    async render(){
      const s=await Reports.computeStats();
      $('#stats-cards').innerHTML=
        '<div class="chip"><b>'+s.farms+'</b><span>'+I18N.t('farmsTotal')+'</span></div>'+
        '<div class="chip"><b>'+s.visited+'</b><span>'+I18N.t('farmVisits')+'</span></div>'+
        '<div class="chip"><b>'+s.treated+'</b><span>'+I18N.t('palmsTreated')+'</span></div>'+
        '<div class="chip chip-green"><b>'+s.rate+'%</b><span>'+I18N.t('recovery')+'</span></div>'+
        '<div class="chip chip-red"><b>'+s.overdue+'</b><span>'+I18N.t('overdueCount')+'</span></div>'+
        '<div class="chip chip-yellow"><b>'+s.dueSoon+'</b><span>'+I18N.t('dueSoon')+'</span></div>';
      const detail=$('#stats-detail');
      detail.innerHTML='';
      detail.appendChild(el('h4',{},[I18N.t('statsWeekly')]));
      if(!s.weeklyArr.length){ detail.appendChild(el('p',{class:'muted small'},[I18N.t('noPalms')])); }
      else{
        const max=Math.max(...s.weeklyArr.map(x=>x.count));
        s.weeklyArr.slice().reverse().forEach(x=>{
          const pct=Math.round(x.count/max*100);
          detail.appendChild(el('div',{class:'kv'},[el('span',{},[I18N.t('batch',{week:shortWeek(x.week)})]),el('b',{},[x.count])]));
          detail.appendChild(el('div',{class:'bar',style:'height:10px;background:#e7f4ec;border-radius:5px;margin-bottom:8px'},[el('div',{class:'barfill',style:'width:'+pct+'%;height:100%;background:#228b54;border-radius:5px'})]));
        });
      }
      detail.appendChild(el('div',{class:'statgrid'},[
        el('div',{class:'chip chip-yellow'},[el('b',{},[s.discFarms]),el('span',{},[I18N.t('discrepancyNote')])]),
        el('div',{class:'chip chip-yellow'},[el('b',{},[s.obstacleFarms]),el('span',{},[I18N.t('obstacles')])])
      ]));
      detail.appendChild(el('h4',{},[I18N.t('weeklyTitle')]));
      const dl=[['btn-primary',()=>Reports.downloadWeekly(),I18N.t('exportWeekly')],
        ['',()=>Reports.downloadTreatments(),I18N.t('exportTreatments')],
        ['',()=>Reports.downloadArchived(),I18N.t('exportArchived')],
        ['',()=>Reports.downloadFarmsCsv(),I18N.t('exportFarms')],
        ['',()=>Reports.downloadVisitsCsv(),I18N.t('exportVisits')],
        ['',()=>Reports.downloadPalmsCsv(),I18N.t('exportPalms')]];
      detail.appendChild(el('div',{class:'btn-grid'},dl.map(b=>el('button',{class:'btn '+b[0],onClick:b[1]},[b[2]]))));
    }
  };
  function shortWeek(ts){ const d=new Date(ts); return d.toLocaleDateString(I18N.get()==='ar'?'ar-SA':'en-GB',{day:'numeric',month:'short'}); }

  // ================= SETTINGS =================
  const TILE_PRESETS={
    voyager:'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    positron:'https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png',
    dark:'https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png',
    osm:'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  };
  function presetKeyOf(url){
    url=(url||'').trim();
    for(const k in TILE_PRESETS){ if(url===TILE_PRESETS[k]) return k; }
    return null;
  }
  const Settings={
    async loadValues(){
      const s=await DB.getSettingsMap();
      $('#set-lang').value=I18N.get();
      $('#set-cloud').value=s.cloudEndpoint||'';
      const cur=s.tileTemplate||'';
      const k=presetKeyOf(cur);
      if(k){
        $('#set-tiles').value=k; $('#set-tiles-custom').hidden=true;
        GeoMap.setTileTemplate(TILE_PRESETS[k]);
      } else if(cur){
        // show what is stored, but never silently apply a keyed/custom source
        $('#set-tiles').value='custom'; $('#set-tiles-custom').hidden=false; $('#set-tiles-custom').value=cur;
        GeoMap.setTileTemplate('');            // stays on the default no-key source until user re-saves
      } else {
        $('#set-tiles').value='voyager'; $('#set-tiles-custom').hidden=true;
        GeoMap.setTileTemplate(TILE_PRESETS.voyager);
      }
      $('#set-mismatch').value=s.mismatchM||'500';
      $('#set-walkm').value=s.walkM||'8';
      $('#set-notify').checked=s.notifications!==false;
      $('#set-formid').value=s.googleFormId||'';
      $('#set-formentries').value=s.googleFormEntryMap||'';
    },
    open(){
      Settings.loadValues();
      $('#ov-settings').hidden=false;
    }
  };
  $('#set-lang').addEventListener('change',e=>{
    localStorage.setItem('palmcare.lang',e.target.value);
    window.App.applyI18n();
    window.App.refreshAll();
  });
  $('#set-cloud').addEventListener('change',e=>DB.setSetting('cloudEndpoint',e.target.value.trim()));
  $('#set-tiles').addEventListener('change',()=>{
    const sel=$('#set-tiles').value;
    const custom=$('#set-tiles-custom');
    if(sel==='custom'){
      custom.hidden=false;
      const t=custom.value.trim();
      DB.setSetting('tileTemplate',t);
      GeoMap.setTileTemplate(t);
    } else {
      custom.hidden=true;
      const t=TILE_PRESETS[sel]||'';
      DB.setSetting('tileTemplate',t);
      GeoMap.setTileTemplate(t);
    }
    toast(I18N.t('tileSourceSaved'));
  });
  $('#set-tiles-custom').addEventListener('change',()=>{
    const t=$('#set-tiles-custom').value.trim();
    DB.setSetting('tileTemplate',t);
    GeoMap.setTileTemplate(t);
    toast(I18N.t('tileSourceSaved'));
  });
  $('#set-mismatch').addEventListener('change',e=>DB.setSetting('mismatchM',e.target.value));
  $('#set-walkm').addEventListener('change',e=>DB.setSetting('walkM',e.target.value));
  $('#set-notify').addEventListener('change',e=>DB.setSetting('notifications',e.target.checked));
  function lon2z(lon,z){ return Math.floor((lon+180)/360*Math.pow(2,z)); }
  function lat2z(lat,z){ return Math.floor((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2*Math.pow(2,z)); }
  async function prepareOfflineTiles(){
    const farms=await DB.farms();
    let n=null,s=null,e=null,w=null;
    farms.forEach(f=>{
      const add=ll=>{ if(!ll||ll.lat==null) return; if(n===null||ll.lat<n) n=ll.lat; if(s===null||ll.lat>s) s=ll.lat; if(w===null||ll.lng<w) w=ll.lng; if(e===null||ll.lng>e) e=ll.lng; };
      add(f);
      (f.boundary&&f.boundary.points||[]).forEach(add);
    });
    if(n===null){ toast(I18N.t('offlineNoFarms')); return; }
    const pad=(s-n)*0.15+0.01;
    n-=pad; s+=pad; w-=pad; e+=pad;
    const status=$('tiles-status');
    const setSt=async txt=>{ status.textContent=txt; status.hidden=false; };
    await setSt(I18N.t('tilesPart',{n:0}));
    const minZ=10, maxZ=17, urls=[];
    for(let z=minZ;z<=maxZ;z++){
      const x0=lon2z(w,z), x1=lon2z(e,z), y0=lat2z(n,z), y1=lat2z(s,z);
      for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) urls.push('./tiles/'+z+'/'+x+'/'+y+'.png');
    }
    let ok=0,cnt=0;
    for(const u of urls){
      try{
        const r=await fetch(u,{cache:'reload'});
        if(r&&r.ok) ok++;
      }catch(err){}
      cnt++;
      if(cnt%40===0) await setSt(I18N.t('tilesPart',{n:cnt}));
      await new Promise(r=>setTimeout(r,cnt%10===0?8:0));
    }
    await setSt(I18N.t('tilesDone',{n:ok}));
    toast(I18N.t('tilesDone',{n:ok}));
  }
  $('#btn-tiles-prep').addEventListener('click',prepareOfflineTiles);
  $('#set-formid').addEventListener('change',e=>{
    DB.setSetting('googleFormId',e.target.value.trim());
    window.Sync.setFormConfig(e.target.value.trim(), parseEntries($('#set-formentries').value));
    toast(e.target.value.trim()?I18N.t('formSubmitted'):'');
  });
  $('#set-formentries').addEventListener('change',e=>{
    const ent=parseEntries(e.target.value);
    window.Sync.setFormConfig($('#set-formid').value.trim(), ent);
  });
  function parseEntries(str){
    const s=String(str||'').trim();
    if(!s) return null;
    try{
      const o=JSON.parse(s);
      if(o&&typeof o==='object') return o;
    }catch(err){}
    return null;
  }

  window.App.Profile=Profile;
  window.App.AreaMap=AreaMap;
  window.App.Stats=Stats;
  window.App.Settings=Settings;
})();