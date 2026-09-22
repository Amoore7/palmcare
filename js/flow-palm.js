(function(){
  const $=id=>document.getElementById(id);
  const {h,el}=window.Util;
  const {toast}=window.FlowUtil;

  let ctx=null; // {farmId, visitId, palm(existing), onSaved, title, mode}

  async function open(farmId, existingPalm, onSaved, opts){
    opts=opts||{};
    ctx={farmId, palm:existingPalm||null, onSaved, mode:existingPalm?'followup':'add', title:opts.title||null};
    $('ov-palm').hidden=false;
    await render();
  }

  async function render(){
    $('palm-title').textContent=ctx.title||(ctx.mode==='add'?I18N.t('addPalm'):I18N.t('followUpTitle'));
    const body=$('palm-body');
    body.innerHTML='';
    body.scrollTop=0;

    if(ctx.mode==='followup'){ await renderFollowup(body); return; }
    await renderAdd(body);
  }

  // ---------------- ADD MODE ----------------
  async function renderAdd(body){
    const farm=ctx.farmId?await DB.farm(ctx.farmId):null;
    const lastLoc=await DB.getSetting('lastKnownLocation',null);
    let palm={ code:'', severity:'', pesticide:'', dosage:'', photos:[], lat:null, lng:null };

    const codeInp=el('input',{type:'text',placeholder:'P-001',value:''});
    const sevPills=el('div',{class:'pills'});
    const sevChoice={};
    I18N.t('severities').forEach(s=>{
      const p=el('button',{class:'pill',onclick:()=>{
        Object.keys(sevChoice).forEach(k=>sevChoice[k]=false);
        sevChoice[s]=true;
        sevPills.querySelectorAll('.pill').forEach(x=>x.classList.remove('on'));
        p.classList.add('on');
        palm.severity=s;
      }},[s]);
      sevPills.appendChild(p);
    });
    const pestSel=el('select',{});
    FlowUtil.PRESETS.pesticides.forEach(p=>pestSel.appendChild(el('option',{value:p},[p])));
    const dosSel=el('select',{});
    FlowUtil.PRESETS.dosages.forEach(d=>dosSel.appendChild(el('option',{value:d},[d])));
    const dateInp=el('input',{type:'date',value:todayISO()});
    const nextTxt=el('div',{class:'warnbox green'},[I18N.t('autoCalc')]);
    dateInp.addEventListener('change',()=>updateNext());

    let photos=[];

    const gpsBox=el('div',{class:'form',style:'gap:8px'});
    const gpsInfo=el('div',{class:'muted small'});
    const capBtn=el('button',{class:'btn btn-primary',onclick:async()=>{
      capBtn.disabled=true; capBtn.textContent=I18N.t('capturing');
      try{
        const loc=await Geo.capturePosition(15000);
        palm.lat=loc.lat; palm.lng=loc.lng;
        await DB.setSetting('lastKnownLocation',{lat:loc.lat,lng:loc.lng,at:Date.now()});
        applyLoc(loc);
      }catch(e){ toast(I18N.t('gpsFail')); }
      capBtn.disabled=false; capBtn.textContent=I18N.t('captureGps');
    }},[I18N.t('captureGps')]);
    const palCoordsHolder=el('div',{});
    function applyLoc(loc){
      gpsInfo.textContent=I18N.t('lat')+': '+loc.lat.toFixed(6)+' · '+I18N.t('lng')+': '+loc.lng.toFixed(6)+(loc.accuracy?' · '+Math.round(loc.accuracy)+'m':'');
      palCoordsHolder.innerHTML='';
      if(farm && farm.lat!=null){
        const d=Geo.distM({lat:loc.lat,lng:loc.lng},{lat:farm.lat,lng:farm.lng});
        if(d!=null) palCoordsHolder.appendChild(el('div',{class:'muted small'},[I18N.t('distance')+': '+Geo.fmtDist(d)]));
      }
    }
    if(!palm.lat && farm && farm.lat!=null){ palm.lat=farm.lat; palm.lng=farm.lng; applyLoc(farm); }
    if(!palm.lat && lastLoc){ palm.lat=lastLoc.lat; palm.lng=lastLoc.lng; applyLoc(lastLoc); }
    gpsBox.appendChild(capBtn);
    gpsBox.appendChild(gpsInfo);
    gpsBox.appendChild(palCoordsHolder);

    const phBox=el('div',{class:'thumbs'});
    const phBtn=el('button',{class:'btn btn-outline'},['📷 '+I18N.t('addPhoto')]);
    const phInput=FlowUtil.photoPicker(arr=>{ photos=photos.concat(arr); paintPhotos(); });
    phBtn.onclick=()=>phInput.click();
    function paintPhotos(){
      phBox.innerHTML='';
      photos.forEach(p=>{
        const url=p.blob?URL.createObjectURL(p.blob):'';
        const im=el('img',{class:'thumb',src:url,onclick:()=>{ photos=photos.filter(x=>x!==p); paintPhotos(); }});
        phBox.appendChild(im);
      });
    }

    function updateNext(){
      const t=new Date(dateInp.value+'T12:00:00');
      if(isNaN(t)) return;
      const ni=new Date(t.getTime()+5*86400000);
      nextTxt.textContent=I18N.t('nextInspection')+': '+Geo.fmtDate(ni.getTime())+' · '+I18N.t('autoCalc');
      palm.nextHint=ni.getTime();
    }
    updateNext();

    const form=el('div',{class:'form'},[
      el('label',{class:'field'},[el('span',{},[I18N.t('palmCode')]),codeInp]),
      el('label',{class:'field'},[el('span',{},[I18N.t('severity')]),sevPills]),
      el('div',{class:'field two'},[
        el('label',{class:'field'},[el('span',{},[I18N.t('pesticide')]),pestSel]),
        el('label',{class:'field'},[el('span',{},[I18N.t('dosage')]),dosSel])
      ]),
      el('label',{class:'field'},[el('span',{},[I18N.t('date')]),dateInp]),
      nextTxt,
      el('div',{class:'field'},[el('span',{},[I18N.t('photo')]),phBtn,phBox,phInput]),
      gpsBox
    ]);
    body.appendChild(form);

    $('palm-save').onclick=async()=>{
      palm.code=codeInp.value.trim()||('P-'+Math.floor(1000+Math.random()*9000));
      if(!palm.severity){ toast(I18N.t('severity')+'?'); return; }
      palm.pesticide=pestSel.value; palm.dosage=dosSel.value;
      const t=new Date(dateInp.value+'T12:00:00');
      palm.treatmentDate=t.getTime();
      palm.nextInspectionDate=palm.nextHint||(t.getTime()+5*86400000);
      palm.photos=photos;
      const rec={
        id:Geo.uid('palm'), farmId:ctx.farmId, visitId:ctx.visitId||null,
        code:palm.code, lat:palm.lat, lng:palm.lng,
        severity:palm.severity, pesticide:palm.pesticide, dosage:palm.dosage,
        treatmentDate:palm.treatmentDate, nextInspectionDate:palm.nextInspectionDate,
        photos:palm.photos, followUpPhotos:[], result:null, resultDate:null,
        events:[{type:'discovery',date:palm.treatmentDate,note:'',photos:palm.photos}],
        createdAt:Date.now()
      };
      await DB.savePalm(rec);
      toast(I18N.t('palmSaved'));
      $('ov-palm').hidden=true;
      if(ctx.onSaved) ctx.onSaved(rec);
      window.App.refreshAll();
    };
  }

  // ---------------- FOLLOW-UP MODE ----------------
  async function renderFollowup(body){
    const p=ctx.palm;
    const farm=await DB.farm(p.farmId);
    const hist=el('div',{class:'card'});
    const titleMap={discovery:I18N.t('discovery'),treatment:I18N.t('treatment'),inspection:I18N.t('inspection')};
    hist.appendChild(el('h4',{},[p.code+(farm?(' — '+farm.name):'')]));
    (p.events||[]).forEach(ev=>{
      const ph=(ev.photos&&ev.photos.length)?FlowUtil.photoRow(ev.photos):null;
      const div=el('div',{class:'tl-item'},[
        el('div',{class:'tl-date'},[(titleMap[ev.type]||ev.type)+' · '+Geo.fmtDateFull(ev.date||Date.now())+(ev.result?(' · '+ev.result):'')]),
        ph||null
      ]);
      hist.appendChild(div);
    });
    hist.appendChild(el('div',{},[
      el('div',{class:'kv'},[el('b',{},[I18N.t('nextInspection')]),el('span',{},[Geo.fmtDate(p.nextInspectionDate)])]),
      el('div',{class:'kv'},[el('b',{},[I18N.t('pesticide')]),el('span',{},[p.pesticide||'—'])]),
      el('div',{class:'kv'},[el('b',{},[I18N.t('dosage')]),el('span',{},[p.dosage||'—'])])
    ]));
    body.appendChild(hist);

    const resultPills=el('div',{class:'pills'});
    const choices=[];
    [['recovered',I18N.t('resultRecovered'),'#228b54'],['more',I18N.t('resultMore'),'#e8a33d'],['dead',I18N.t('resultDead'),'#d64541']].forEach(arr=>{
      const b=el('button',{class:'pill',onclick:()=>{
        resultPills.querySelectorAll('.pill').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        choices.length=0; choices.push(arr[0]);
      }},[arr[1]]);
      b.style.borderColor=arr[2];
      resultPills.appendChild(b);
    });

    let photos=[];
    const phBox=el('div',{class:'thumbs'});
    const phBtn=el('button',{class:'btn btn-outline'},['📷 '+I18N.t('addPhoto')]);
    const phInput=FlowUtil.photoPicker(arr=>{ photos=photos.concat(arr); paintPhotos(); });
    phBtn.onclick=()=>phInput.click();
    function paintPhotos(){
      phBox.innerHTML='';
      photos.forEach(ph=>{
        const url=ph.blob?URL.createObjectURL(ph.blob):'';
        phBox.appendChild(el('img',{class:'thumb x',src:url,onclick:()=>{ photos=photos.filter(x=>x!==ph); paintPhotos(); }}));
      });
    }

    const moreBox=el('div',{class:'form',style:'display:none'});
    const trtDate=el('input',{type:'date',value:todayISO()});
    moreBox.appendChild(el('label',{class:'field'},[el('span',{},[I18N.t('date')]),trtDate]));

    body.appendChild(el('div',{class:'form'},[
      el('label',{class:'field'},[el('span',{},[I18N.t('followUpResult')]),resultPills]),

      el('label',{class:'field'},[el('span',{},[I18N.t('photo')]),phBtn,phBox,phInput]),
      moreBox
    ]));

    resultPills.querySelectorAll('.pill').forEach(x=>x.addEventListener('click',()=>{
      moreBox.style.display=choices[0]==='more'?'':'none';
    }));

    $('palm-save').onclick=async()=>{
      if(!choices.length){ toast(I18N.t('followUpResult')+'?'); return; }
      const result=choices[0];
      const t=new Date(trtDate.value+'T12:00:00');
      p.followUpPhotos=(p.followUpPhotos||[]).concat(photos);
      p.events=p.events||[];
      if(result==='more'){
        p.treatmentDate=t.getTime();
        p.nextInspectionDate=t.getTime()+5*86400000;
        p.result=null; p.resultDate=null;
        p.events.push({type:'treatment',date:t.getTime(),note:'',photos:[]});
      } else {
        p.result=(result==='dead')?'dead':'recovered';
        p.resultDate=Date.now();
        p.nextInspectionDate=t.getTime()+5*86400000;
      }
      p.events.push({type:'inspection',date:Date.now(),result:p.result||result,photos:photos});
      p.followUpPhotos=(p.followUpPhotos||[]).concat(photos);
      await DB.savePalm(p);
      toast(I18N.t('palmSaved'));
      $('ov-palm').hidden=true;
      window.App.refreshAll();
    };
  }

  function todayISO(){
    const d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  window.Flow.Palm={open, render};
  FlowUtil.followUpOpen=(farmId,palm)=>Flow.Palm.open(farmId,palm,null,{});

  document.querySelectorAll('#ov-palm [data-close]').forEach(b=>{
    b.addEventListener('click',()=>{ $('ov-palm').hidden=true; });
  });
})();