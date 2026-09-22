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
  const Profile={
    async render(farmId){
      const farm=await DB.farm(farmId);
      if(!farm) return;
      $('#farm-title').textContent=farm.name||'—';
      const info=$('#farm-info');
      info.innerHTML='';
      info.appendChild(el('h4',{},[farm.name||'—']));
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

      renderMap(farm);
      renderPalms(farm);
      renderVisits(farm);
      $('#btn-del-boundary').hidden=!farm.boundary;
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
    async render(){
      const canvas=$('area-map');
      if(!areaMap){
        areaMap=new GeoMap(canvas,{center:{lat:24.7,lng:46.7},zoom:11,tiles:true});
        AreaMap.instance=areaMap;
        areaMap.onTap=async (ll,pt)=>{
          const farms=await DB.farms();
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
      const last=await DB.getSetting('lastKnownLocation',null);
      if(last) areaMap.setLocation(last,false);
      const colorOf=new Map(farms.map((f,i)=>[f.id, FARM_COLORS[i%FARM_COLORS.length]]));
      const polys=[]; const traceLines=[];
      farms.forEach(f=>{
        const col=colorOf.get(f.id);
        if(f.boundary&&f.boundary.points&&f.boundary.points.length){
          polys.push({points:f.boundary.points,fill:hexToRgba(col,.12),stroke:col,label:f.name||''});
          if(Array.isArray(f.boundary.path)&&f.boundary.path.length>=2) traceLines.push({points:f.boundary.path,color:col,width:1.5,dash:[4,3]});
        }
        (f.obstacleZones||[]).forEach(o=>{
          if(o.points&&o.points.length) polys.push({points:o.points,fill:'rgba(232,163,61,.22)',stroke:'#e8a33d',label:(f.name?f.name+': ':'')+(o.label||''),dash:[6,4]});
        });
      });
      const points=farms.filter(f=>f.lat!=null).map(f=>({lat:f.lat,lng:f.lng,label:f.name||'·',color:colorOf.get(f.id),size:8}));
      // nearest pending line
      const line=[]; let routeText='';
      const pending=await DB.palmsPendingInspection();
      if(last){
        let nearest=null,nd=Infinity;
        for(const p of pending){
          const f=farms.find(x=>x.id===p.farmId);
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
      // legend: which farm owns which boundary
      const bounded=farms.filter(f=>f.boundary&&f.boundary.points&&f.boundary.points.length);
      const leg=$('map-legend');
      if(leg){
        leg.innerHTML='';
        leg.appendChild(el('h3',{class:'section-title'},[I18N.t('boundaries')+' ('+bounded.length+')']));
        if(!bounded.length){
          leg.appendChild(el('p',{class:'muted small'},[I18N.t('noBoundaries')]));
        } else {
          bounded.forEach(f=>{
            const col=colorOf.get(f.id);
            leg.appendChild(el('button',{class:'legend-row',onclick:()=>window.App.goto('farm',f.id)},[
              el('span',{class:'dot',style:'background:'+col}),
              el('span',{},[f.name||'—']),
              el('b',{},[Geo.fmtArea(Geo.polygonAreaHa(f.boundary.points))+' '+I18N.t('ha')])
            ]));
          });
        }
      }
      areaMap.setItems({polygons:polys,points,lines:line.concat(traceLines)});
      if(!areaMap._fitDone){ areaMap.fit(); areaMap._fitDone=true; }
      $('#area-map-badge').textContent=I18N.t('allFarms')+': '+farms.length+' · '+I18N.t('boundaries')+': '+bounded.length;
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
  $('#btn-map-follow').addEventListener('click',()=>{ if(areaMap&&areaMap.loc) areaMap.setLocation(areaMap.loc,true); });
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