(function(){
  const $=id=>document.getElementById(id);
  const {h,el}=window.Util;
  const {toast}=window.FlowUtil;

  let visit=null;
  const STEPS=6;

  async function farmName(id){ const f=await DB.farm(id); return f?f.name:'—'; }

  async function openVisit(farmId){
    $('ov-visit').hidden=false;
    visit={
      farmId: farmId||null,
      gps:null, actualCount:null, obstacles:[], note:'', voiceBlob:null, palms:[]
    };
    try{
      await renderStep(0);
    }catch(e){
      toast(I18N.t('errorGeneric'));
    }
  }

  async function renderStep(step){
    visit.step=step;
    $('visit-progress').style.width=((step+1)/STEPS*100)+'%';
    $('visit-title').textContent=I18N.t('addVisitTitle')+(visit.farmId?(' — '+(await farmName(visit.farmId))):'');
    $('visit-prev').hidden=step===0;
    const next=$('visit-next');
    next.textContent=I18N.t('next');
    next.hidden=step===STEPS-1;
    const body=$('visit-body');
    body.scrollTop=0;
    body.innerHTML='';
    let ok=false;
    if(step===0) ok=await stepFarm();
    else if(step===1) ok=await stepGps();
    else if(step===2) ok=await stepCount();
    else if(step===3) ok=await stepObstacles();
    else if(step===4) ok=await stepPalms();
    else if(step===5){ await stepSave(); ok=true; next.hidden=false; next.textContent=I18N.t('saveVisit'); }
    next.disabled=!ok;
  }

  async function stepFarm(){
    const body=$('visit-body');
    const farms=(await DB.farms()).filter(f=>f.lat!=null||(f.boundary&&f.boundary.points&&f.boundary.points.length));
    const q=el('input',{type:'search',placeholder:I18N.t('searchFarms'),class:'searchinput'});
    const wrap=el('div',{class:'searchbar'},[q]);
    const list=el('div',{class:'card-list'});
    function render(query){
      list.innerHTML='';
      const qq=(query||'');
      farms.filter(f=>!qq||(f.name||'').toLowerCase().includes(qq)||String(f.nationalId||'').includes(qq)||String(f.phone||'').replace(/[^0-9+]/g,'').includes(qq.replace(/[^0-9+]/g,'')))
        .forEach(f=>{
          const c=el('div',{class:'farm-card'+(visit.farmId===f.id?' sel':''),style:'border-right-color:#228b54',onclick:()=>{
            visit.farmId=f.id;
            Array.from(list.children).forEach(x=>x.classList.remove('sel'));
            c.classList.add('sel');
            $('visit-next').disabled=false;
          }});
          c.appendChild(el('div',{class:'info'},[
            el('h4',{},[f.name||'—']),
            el('div',{class:'sub'},[((f.nationalId)?('ID: '+f.nationalId+' · '):'')+((f.phone)?('📞 '+f.phone):'')+(f.registeredCount?(' — 🌴'+f.registeredCount):'')])
          ]));
          list.appendChild(c);
        });
      if(!list.children.length) list.appendChild(el('p',{class:'empty-msg muted'},[I18N.t('farmsEmpty')]));
    }
    q.addEventListener('input',e=>render(e.target.value.toLowerCase()));
    body.appendChild(wrap);
    body.appendChild(list);
    render('');
    $('visit-next').disabled=!visit.farmId;
    return !!visit.farmId;
  }

  async function stepGps(){
    const body=$('visit-body');
    const farm=visit.farmId?await DB.farm(visit.farmId):null;
    let loc=visit.gps||null;
    const mismatchM=parseInt(await DB.getSetting('mismatchM',500),10)||500;
    const st=el('div',{class:'form'});

    const btn=el('button',{class:'btn btn-primary',onclick:async()=>{
      btn.disabled=true; btn.textContent=I18N.t('capturing');
      try{
        loc=await Geo.capturePosition(15000);
        visit.gps=loc; paint(); toast(I18N.t('gpsOk'));
      }catch(e){ toast(I18N.t('gpsFail')); }
      btn.disabled=false; btn.textContent=I18N.t('captureGps');
    }},[I18N.t('captureGps')]);
    st.appendChild(btn);

    const info=el('div',{}); st.appendChild(info);

    const manualBox=el('div',{class:'field two'},[
      el('input',{type:'number',step:'0.000001',placeholder:I18N.t('lat'),value:loc?loc.lat:''}),
      el('input',{type:'number',step:'0.000001',placeholder:I18N.t('lng'),value:loc?loc.lng:''}),
      el('button',{class:'btn btn-primary',onclick:()=>{
        const v1=parseFloat(manualBox.children[0].value), v2=parseFloat(manualBox.children[1].value);
        if(Geo.isValidCoord(v1,v2)){
          loc={lat:v1,lng:v2,accuracy:0,manual:true}; visit.gps=loc; paint(); toast(I18N.t('gpsOk'));
        } else toast(I18N.t('gpsFail'));
      }},[I18N.t('save')])
    ]);
    const manBtn=el('button',{class:'btn btn-outline',onclick:()=>{ st.appendChild(manualBox); manBtn.remove(); }},[I18N.t('manualCoords')]);
    st.appendChild(manBtn);

    function paint(){
      info.innerHTML='';
      if(!loc) return;
      info.appendChild(el('div',{class:'kv'},[el('b',{},[I18N.t('gpsAccuracy')]),el('span',{},[Math.round(loc.accuracy||0)+' m'])]));
      info.appendChild(el('div',{class:'kv'},[el('b',{},[I18N.t('lat')]),el('span',{},[loc.lat.toFixed(6)])]));
      info.appendChild(el('div',{class:'kv'},[el('b',{},[I18N.t('lng')]),el('span',{},[loc.lng.toFixed(6)])]));
      if(farm && farm.lat!=null){
        const d=Geo.distM(loc,{lat:farm.lat,lng:farm.lng});
        if(d!=null){
          info.appendChild(el('div',{class:'kv'},[el('b',{},[I18N.t('distance')+' → المزرعة']),el('span',{},[Geo.fmtDist(d)])]));
          if(d>mismatchM) info.appendChild(el('div',{class:'warnbox red'},[I18N.t('gpsMismatch')+': '+Geo.fmtDist(d)+' — '+I18N.t('distance')+': '+Geo.fmtDist(d)]));
        }
      }
      $('visit-next').disabled=false;
    }
    paint();
    body.appendChild(st);
    return !!loc;
  }

  async function stepCount(){
    const body=$('visit-body');
    const farm=await DB.farm(visit.farmId);
    const registered=farm.registeredCount||0;
    const actual=visit.actualCount!=null?visit.actualCount:registered;
    const inp=el('input',{type:'number',min:'0',value:actual,style:'font-size:26px;font-weight:bold'});
    const disc=el('div',{});
    function upd(){
      const v=parseInt(inp.value,10);
      visit.actualCount=isFinite(v)?v:null;
      disc.innerHTML='';
      if(visit.actualCount!=null && registered && visit.actualCount!==registered && visit.actualCount>0){
        disc.appendChild(el('div',{class:'warnbox'},[I18N.t('countDiscrepancy',{registered,actual:visit.actualCount})]));
      }
    }
    inp.addEventListener('input',upd);
    const form=el('div',{class:'form'},[
      el('div',{class:'warnbox green'},[I18N.t('registeredCount')+': '+registered]),
      el('label',{class:'field'},[el('span',{},[I18N.t('actualCount')]),inp]),
      disc
    ]);
    body.appendChild(form);
    upd();
    return true;
  }

  async function stepObstacles(){
    const body=$('visit-body');
    const chosen={};
    (visit.obstacles||[]).forEach(t=>chosen[t]=true);
    const pills=el('div',{class:'pills'});
    I18N.t('obstacleTags').forEach(t=>{
      const p=el('button',{class:'pill'+(chosen[t]?' on':''),onclick:()=>{ p.classList.toggle('on'); chosen[t]=!chosen[t]; }},[t]);
      pills.appendChild(p);
    });
    const ta=el('textarea',{rows:3,placeholder:I18N.t('freeNote'),value:visit.note||''});
    const rec=await FlowUtil.voiceRecorder(b=>{ visit.voiceBlob=b; });
    const form=el('div',{class:'form'},[
      el('label',{class:'field'},[el('span',{},[I18N.t('obstacles')]),pills]),
      el('label',{class:'field'},[el('span',{},[I18N.t('freeNote')]),ta]),
      rec.box
    ]);
    body.appendChild(form);
    const apply=()=>{ visit.obstacles=Object.keys(chosen).filter(k=>chosen[k]); visit.note=ta.value; };
    ta.addEventListener('input',apply);
    return true;
  }

  async function stepPalms(){
    const body=$('visit-body');
    const list=el('div',{class:'card-list'});
    function renderList(){
      list.innerHTML='';
      visit.palms.forEach(p=>{
        const r=el('div',{class:'farm-card',style:'border-right-color:'+FlowUtil.severityColor(p.severity)},[
          el('div',{class:'info'},[
            el('h4',{},[p.code||'—']),
            el('div',{class:'sub'},[(p.severity||'')+' · '+(p.pesticide||'')+' · '+Geo.fmtDate(p.treatmentDate)+' → '+Geo.fmtDate(p.nextInspectionDate)])
          ]),
          el('button',{class:'iconbtn',onclick:async()=>{
            if(p.id){ await DB.delPalm(p.id); }
            visit.palms=visit.palms.filter(x=>x!==p);
            renderList();
          }},['🗑'])
        ]);
        list.appendChild(r);
      });
      if(!visit.palms.length) list.appendChild(el('p',{class:'empty-msg muted'},[I18N.t('noPalms')]));
    }
    const add=el('button',{class:'btn btn-primary',onclick:()=>Flow.Palm.open(visit.farmId,null,p=>{ visit.palms.push(p); renderList(); },{title:I18N.t('addPalm')})},['＋ '+I18N.t('addPalm')]);
    body.appendChild(add);
    body.appendChild(list);
    renderList();
    return true;
  }

  async function stepSave(){
    const body=$('visit-body');
    const farm=await DB.farm(visit.farmId);
    const card=el('div',{class:'card'},[
      el('div',{class:'kv'},[el('b',{},[I18N.t('farmer')]),el('span',{},[farm.name])]),
      el('div',{class:'kv'},[el('b',{},[I18N.t('registeredCount')]),el('span',{},[farm.registeredCount||0])]),
      el('div',{class:'kv'},[el('b',{},[I18N.t('actualCount')]),el('span',{},[visit.actualCount!=null?visit.actualCount:'—'])]),
      el('div',{class:'kv'},[el('b',{},[I18N.t('obstacles')]),el('span',{},[(visit.obstacles&&visit.obstacles.length)?visit.obstacles.join('، '):I18N.t('noObstacles')])]),
      el('div',{class:'kv'},[el('b',{},[I18N.t('addPalm')]),el('span',{},[String(visit.palms.length)])])
    ]);
    body.appendChild(card);
  }

  async function finalizeVisit(){
    if(!visit.farmId || !visit.gps) return;
    const farm=await DB.farm(visit.farmId);
    const disc=(visit.actualCount!=null && farm.registeredCount && visit.actualCount!==farm.registeredCount)
      ? I18N.t('countDiscrepancy',{registered:farm.registeredCount,actual:visit.actualCount})
      : null;
    const vid=Geo.uid('visit');
    const vis={
      id:vid, farmId:visit.farmId, date:Date.now(),
      gps:visit.gps,
      registeredCount:farm.registeredCount||0,
      actualCount:visit.actualCount,
      discrepancyNote:disc,
      obstacles:visit.obstacles||[],
      note:visit.note||'',
      voiceBlob:visit.voiceBlob||null,
      palmIds:visit.palms.map(p=>p.id),
      batchId:farm.lastBatchId||null
    };
    visit.palms.forEach(p=>{ p.visitId=vid; });
    for(const p of visit.palms){
      if(!p.nextInspectionDate && p.treatmentDate) p.nextInspectionDate=new Date(p.treatmentDate).getTime()+5*86400000;
      await DB.savePalm(p);
    }
    if(!visit.voiceBlob){ delete vis.voiceBlob; }
    await DB.saveVisit(vis);
    // house report → Google Form: fire-and-forget; never blocks the save.
    if(window.Sync && window.Sync.formVisitPayload){
      Sync.submitToGoogleForm(Sync.formVisitPayload(vis, farm)).then(r=>{
        if(r==='ok') toast(I18N.t('formSubmitted'));
        else if(r==='queued') toast(I18N.t('formQueued'));
      }).catch(()=>{});
    }
    if(disc) toast(disc);
    toast(I18N.t('visitSaved'));
    $('ov-visit').hidden=true;
    try{ Notifier.audit(); }catch(e){}
    window.App.refreshAll();
  }

  $('visit-next').addEventListener('click',async()=>{
    if(visit && visit.step===STEPS-1){ await finalizeVisit(); return; }
    await renderStep(visit.step+1);
  });

  $('visit-prev').addEventListener('click',async()=>{ if(visit) await renderStep(visit.step-1); });
  $('visit-back').addEventListener('click',()=>{ $('ov-visit').hidden=true; });

  window.Flow={openVisit, finalizeVisit, renderStep, get visit(){ return visit; }};
})();