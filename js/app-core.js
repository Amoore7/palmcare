(function(){
  const $=id=>document.getElementById(String(id).replace(/^#/,''));
  const {h,el}=window.Util;
  const {toast}=window.FlowUtil;

  let current='home';
  let currentFarmId=null;
  let lastFarmOrigin='farms';

  // ---------- router ----------
  function goto(view, farmId, origin){
    const prev=current;
    current=view;
    currentFarmId=farmId||null;
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    $('#view-'+view).classList.add('active');
    document.querySelectorAll('.navitem').forEach(n=>{
      n.classList.toggle('active', n.dataset.nav===view);
    });
    $('#view-'+view).scrollTop=0;
    if(view==='farm'){
      const from=origin||(prev==='map'?'map':(prev==='home'?'home':'farms'));
      lastFarmOrigin=from;
      const page=$('view-farm');
      if(page){ const bb=page.querySelector('.back'); if(bb) bb.dataset.back=from; }
    }
    if(view==='home') App.Home.render();
    else if(view==='farms') App.Farms.render();
    else if(view==='map') App.AreaMap.render();
    else if(view==='stats') App.Stats.render();
    else if(view==='farm') App.Profile.render(farmId);
  }

  function refreshAll(){
    if(current==='home') App.Home.render();
    else if(current==='farms') App.Farms.render();
    else if(current==='map') App.AreaMap.render();
    else if(current==='stats') App.Stats.render();
    else if(current==='farm') App.Profile.render(currentFarmId);
  }

  function applyI18n(){
    I18N.set(lang());
    document.querySelectorAll('[data-i18n]').forEach(n=>{
      const k=n.getAttribute('data-i18n');
      n.textContent=I18N.t(k);
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(n=>{
      n.setAttribute('placeholder',I18N.t(n.getAttribute('data-i18n-ph')));
    });
  }
  function lang(){ return localStorage.getItem('palmcare.lang')||'ar'; }

  // ---------- HOME ----------
  const Home={
    async render(){
      const palms=await DB.palms();
      const pending=palms.filter(p=>p.nextInspectionDate && !p.result && p.nextInspectionDate < Date.now()+4*86400000);
      const cls=pending.reduce((a,p)=>{ const c=Geo.dueClass(p.nextInspectionDate); a[c]=(a[c]||0)+1; return a; },{});
      const farms=await DB.farms();
      const fm=new Map(farms.map(f=>[f.id,f]));
      $('#home-summary').innerHTML=
        '<div class="chip chip-red"><b>'+(cls.red||0)+'</b><span>'+I18N.t('overdueCount')+'</span></div>'+
        '<div class="chip chip-yellow"><b>'+(cls.yellow||0)+'</b><span>'+I18N.t('dueSoon')+'</span></div>'+
        '<div class="chip chip-green"><b>'+(cls.green||0)+'</b><span>'+I18N.t('upcoming')+'</span></div>'+
        '<div class="chip"><b>'+farms.length+'</b><span>'+I18N.t('farmsTotal')+'</span></div>'+
        $('#net-status').outerHTML;

      const list=$('#today-list');
      list.innerHTML='';
      if(!pending.length){ $('#today-empty').hidden=false; }
      else{
        $('#today-empty').hidden=true;
        const byCls={red:I18N.t('urgent'),yellow:I18N.t('dueToday'),green:I18N.t('dueSoonLabel')};
        ['red','yellow','green'].forEach(c=>{
          const arr=pending.filter(p=>Geo.dueClass(p.nextInspectionDate)===c).sort((a,b)=>a.nextInspectionDate-b.nextInspectionDate);
          if(!arr.length) return;
          list.appendChild(el('h4',{class:'section-title'},[byCls[c]+' ('+arr.length+')']));
          arr.slice(0,12).forEach(p=>{
            const f=fm.get(p.farmId)||{name:'—'};
            const dIso=new Date(p.nextInspectionDate).toISOString().slice(0,10);
            const card=el('div',{class:'farm-card',style:'border-right-color:'+(c==='red'?'#d64541':c==='yellow'?'#e8a33d':'#228b54')},[
              el('div',{class:'info'},[
                el('h4',{},[f.name+' · '+p.code]),
                el('div',{class:'sub'},[I18N.t('nextInspection')+': '+Geo.fmtDate(p.nextInspectionDate)+(Geo.dayStart(p.nextInspectionDate)<Geo.todayStart()?(' ('+Math.round((Geo.todayStart()-Geo.dayStart(p.nextInspectionDate))/86400000)+'d) '):'')])
              ]),
              el('span',{class:'due '+c},[dIso]),
              el('button',{class:'btn btn-primary',style:'min-height:44px;padding:10px 14px',onclick:()=>Flow.Palm.open(p.farmId,p,null,{title:I18N.t('followUpTitle')})},[I18N.t('inspection')+' ✅'])
            ]);
            list.appendChild(card);
          });
        });
      }
    }
  };

  // ---------- FARMS LIST ----------
  const Farms={
    filter(){ return localStorage.getItem('palmcare.farmfilter')||'all'; },
    async render(){
      const farms=await DB.farms();
      const filter=Farms.filter();
      Array.from(document.querySelectorAll('#farms-filter .pill')).forEach(b=>b.classList.toggle('on',b.dataset.f===filter));
      const shown=farms.filter(f=>filter==='all'||(filter==='active'?!f.archived:f.archived));
      const q=($('#farm-search').value||'').toLowerCase();
      const list=$('#farms-list');
      list.innerHTML='';
      const last=await DB.getSetting('lastKnownLocation',null);
      const overdue=new Set();
      const pending=await DB.palmsPendingInspection();
      pending.forEach(p=>{ if(Geo.dueClass(p.nextInspectionDate)==='red') overdue.add(p.farmId); });
      const minByFarm=new Map();
      pending.forEach(p=>{ if(!minByFarm.has(p.farmId)||p.nextInspectionDate<minByFarm.get(p.farmId)) minByFarm.set(p.farmId,p.nextInspectionDate); });
      shown.filter(f=>!q||(f.name||'').toLowerCase().includes(q)||String(f.nationalId||'').includes(q)||String(f.phone||'').replace(/\s/g,'').includes(q.replace(/\s/g,'')))
        .forEach(f=>{
          const pendingC=pending.filter(p=>p.farmId===f.id && !p.result).length;
          const idFarms=pending.filter(p=>p.farmId===f.id && !p.result);
          const badgeColor=overdue.has(f.id)?'red':pendingC?'yellow':'green';
          const badgeTxt=overdue.has(f.id)?I18N.t('badgeOverdue'):pendingC?I18N.t('badgePending'):I18N.t('badgeClear');
          let d='';
          if(last && f.lat!=null){
            const dm=Geo.distM(last,f);
            if(dm!=null) d=Geo.fmtDist(dm);
          }
          const bar=el('div',{class:'farm-progress'},[]);
          const fd=minByFarm.get(f.id);
          if(fd){
            const dur=5*86400000;
            const pct=Math.max(0,Math.min(100,Math.round((Date.now()-(fd-dur))/dur*100)));
            const cls=Geo.dueClass(fd);
            bar.appendChild(el('span',{style:'width:'+pct+'%;background:'+(cls==='red'?'#d64541':cls==='yellow'?'#e8a33d':'#228b54')}));
          } else {
            bar.appendChild(el('span',{style:'width:0%'}));
          }
          const actions=el('div',{class:'card-actions'},[]);
          const ph=String(f.phone||'').replace(/[^0-9+]/g,'');
          if(ph){
            actions.appendChild(el('button',{class:'btn btn-outline',title:I18N.t('call'),onclick:ev=>{ev.stopPropagation();window.open('tel:'+ph,'_self');}},['📞']));
            let w=ph.startsWith('+')?ph.slice(1):ph;
            if(w.startsWith('0')) w='966'+w.slice(1);
            actions.appendChild(el('button',{class:'btn btn-outline',title:'WhatsApp',onclick:ev=>{ev.stopPropagation();window.open('https://wa.me/'+w,'_blank');}},['💬']));
          }
          actions.appendChild(el('button',{class:'btn btn-outline',title:I18N.t('openInMaps'),onclick:ev=>{ev.stopPropagation();window.App.showFarmOnMap(f);}},['🗺']));
          const card=el('div',{class:'farm-card',onclick:()=>goto('farm',f.id)},[
            el('div',{class:'info'},[
              el('h4',{},[f.name||'—'+(f.archived?' 📦':'')]),
              el('div',{class:'sub'},[
                ((f.nationalId)?('ID:'+f.nationalId+' · '):'')+((f.registeredCount)?('🌴 '+f.registeredCount+' · '):'')+
                ((d)?('📍'+d+' · '):'')+((f.archived)?('📦 '+I18N.t('archived')+' · '):'')+
                ((Array.isArray(f.flags)&&f.flags.length)?('⚠️ '+f.flags.join(',')):'')
              ]),
              bar,
              actions
            ]),
            el('span',{class:'due '+badgeColor},[badgeTxt+(pendingC?(' '+pendingC):'')])
          ]);
          list.appendChild(card);
        });
      $('#farms-empty').hidden=shown.length>0;
    }
  };

  // show a farm on the area map (from farm cards / follow-ups)
  async function showFarmOnMap(farm){
    if(!farm) return;
    await App.goto('map');
    await new Promise(r=>setTimeout(r,350));
    const m=window.App.AreaMap&&window.App.AreaMap.instance;
    if(m){
      let c=null;
      if(farm.lat!=null) c={lat:farm.lat,lng:farm.lng};
      else if(farm.boundary&&farm.boundary.points&&farm.boundary.points.length){
        const pts=farm.boundary.points; let la=0,lo=0;
        pts.forEach(p=>{ la+=p.lat; lo+=p.lng; });
        c={lat:la/pts.length,lng:lo/pts.length};
      }
      if(c){ m.setZoom(16,c); window.App.AreaMap.render(); }
    }
  }

  // ---------- NEW VISIT chooser ----------
  const NewVisit={
    async open(){
      const ov=$('ov-newvisit'); ov.hidden=false;
      const q=$('newvisit-search'), list=$('newvisit-list'), empty=$('newvisit-empty');
      const manual=$('newvisit-manual'), manBtn=$('btn-newvisit-manual');
      q.value=''; manual.hidden=true; manBtn.hidden=false;
      const farms=await DB.farms();
      function render(query){
        list.innerHTML='';
        const qq=(query||'').toLowerCase();
        const qd=qq.replace(/[^0-9+]/g,'');
        farms.filter(f=>!f.archived).filter(f=>!qq||(f.name||'').toLowerCase().includes(qq)
          || String(f.nationalId||'').toLowerCase().includes(qq)
          || (qd!==''&&String(f.phone||'').replace(/[^0-9+]/g,'').includes(qd))).forEach(f=>{
          const c=el('div',{class:'farm-card',style:'border-right-color:#228b54',onclick:()=>{
            ov.hidden=true; Flow.openVisit(f.id);
          }},[
            el('div',{class:'info'},[
              el('h4',{},[f.name||'—']),
              el('div',{class:'sub'},[((f.nationalId)?('ID: '+f.nationalId+' · '):'')+((f.phone)?('📞 '+f.phone):'')+(f.registeredCount?(' — 🌴'+f.registeredCount):'')])
            ])
          ]);
          list.appendChild(c);
        });
        empty.hidden=farms.length!==0;
        manBtn.hidden=false;
      }
      q.oninput=()=>render(q.value);
      render('');
      manBtn.onclick=()=>{ manual.hidden=false; manBtn.hidden=true; };
      $('btn-nv-save').onclick=async()=>{
        const name=$('nv-name').value.trim();
        if(!name){ toast(I18N.t('farmNameRequired')); return; }
        let lat=null,lng=null;
        const la=$('nv-lat').value.trim(), lo=$('nv-lng').value.trim();
        if(la!==''||lo!==''){
          lat=parseFloat(la); lng=parseFloat(lo);
          if(isNaN(lat)||isNaN(lng)||!Geo.isValidCoord(lat,lng)){ toast(I18N.t('gpsFail')); return; }
        }
        const f={ id:Geo.uid('farm'), name, nationalId:$('nv-nid').value.trim(), phone:$('nv-phone').value.trim(),
          lat, lng, registeredCount:parseInt($('nv-count').value,10)||0, createdAt:Date.now(), boundary:null, obstacleZones:[] };
        await DB.saveFarm(f);
        ov.hidden=true;
        toast(I18N.t('farmSaved'));
        Flow.openVisit(f.id);
        try{ Notifier.audit(); }catch(e){}
      };
    }
  };

  // ---------- init ----------
  async function init(){
    applyI18n();
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>reg.update().catch(()=>{})).catch(()=>{});
    }

    // bind nav
    document.querySelectorAll('.navitem').forEach(n=>n.addEventListener('click',()=>goto(n.dataset.nav)));
    document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.back)));
    document.querySelectorAll('#farms-filter .pill').forEach(b=>b.addEventListener('click',()=>{
      localStorage.setItem('palmcare.farmfilter',b.dataset.f);
      App.refreshAll();
    }));
    $('btn-new-visit').addEventListener('click',()=>NewVisit.open());
    $('btn-import').addEventListener('click',()=>App.Import.openPicker());

    // farm profile buttons
    $('btn-farm-visit').addEventListener('click',()=>{ if(currentFarmId) Flow.openVisit(currentFarmId); });
    $('btn-boundary').addEventListener('click',()=>{ if(currentFarmId) Flow.Boundary.open(currentFarmId,'boundary'); });
    $('btn-del-boundary').addEventListener('click',async()=>{
      const f=await DB.farm(currentFarmId);
      if(!f||!f.boundary) return;
      const ok=await window.FlowUtil.confirm(I18N.t('delBoundaryConfirm'));
      if(!ok) return;
      f.boundary=null;
      await DB.saveFarm(f);
      toast(I18N.t('delBoundaryDone'));
      refreshAll();
    });
    $('btn-obstacle').addEventListener('click',()=>{ if(currentFarmId) Flow.Boundary.open(currentFarmId,'obstacle'); });

    // external maps (Google / Apple) for a farm
    let mapsTarget=null;
    window.App.openExternalMaps=(farm)=>{
      if(!farm) return;
      let la=null, lo=null;
      if(farm.lat!=null) { la=farm.lat; lo=farm.lng; }
      else if(farm.boundary&&farm.boundary.points&&farm.boundary.points.length){ la=farm.boundary.points[0].lat; lo=farm.boundary.points[0].lng; }
      if(la==null){ toast(I18N.t('farmNeedsCoords')); return; }
      mapsTarget={name:farm.name||'', lat:la, lng:lo};
      $('#openmaps-title').textContent=(farm.name||'')+' — '+la.toFixed(6)+' , '+lo.toFixed(6);
      $('#ov-openmaps').hidden=false;
    };
    $('btn-map-open') && $('btn-map-open').addEventListener('click',async()=>{
      if(!currentFarmId) return;
      window.App.openExternalMaps(await DB.farm(currentFarmId));
    });
    $('btn-maps-google').addEventListener('click',()=>{
      $('ov-openmaps').hidden=true;
      if(mapsTarget) window.open('https://www.google.com/maps/dir/?api=1&destination='+mapsTarget.lat+','+mapsTarget.lng,'_blank');
    });
    $('btn-maps-apple').addEventListener('click',()=>{
      $('ov-openmaps').hidden=true;
      if(mapsTarget) window.open('http://maps.apple.com/?daddr='+mapsTarget.lat+','+mapsTarget.lng,'_blank');
    });
    $('btn-report-pdf').addEventListener('click',()=>{ if(currentFarmId) Reports.renderPrint(currentFarmId); });
    $('btn-report-xlsx').addEventListener('click',()=>{ if(currentFarmId) Reports.exportFarmExcel(currentFarmId); });
    $('btn-whatsapp').addEventListener('click',()=>{ if(currentFarmId) Reports.shareWhatsApp(currentFarmId); });

    // settings
    $('btn-settings').addEventListener('click',()=>App.Settings.open());
    document.querySelectorAll('.overlay .close,[data-close]').forEach(b=>{
      b.addEventListener('click',()=>{ const ov=b.closest('.overlay'); if(ov) ov.hidden=true; });
    });

    // install prompt
    let deferredPrompt=null;
    window.addEventListener('beforeinstallprompt',e=>{
      e.preventDefault();
      deferredPrompt=e;
      const b=$('btn-install-app'); if(b) b.hidden=false;
      const hint=$('install-hint'); if(hint) hint.hidden=false;
    });
    const instBtn=$('btn-install-app');
    if(instBtn) instBtn.addEventListener('click',async()=>{
      if(!deferredPrompt){ toast(I18N.t('installHint')); return; }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt=null;
      instBtn.hidden=true;
      $('install-hint').hidden=true;
    });

    for(const el of document.querySelectorAll('.overlay')){
      el.addEventListener('click',e=>{ if(e.target===el && !el.classList.contains('full')) el.hidden=true; });
    }

    // search
    $('#farm-search').addEventListener('input',()=>Farms.render());

    // online/offline status bar
    window.addEventListener('online',()=>setNet());
    window.addEventListener('offline',()=>setNet());

    $('#btn-sync-now').addEventListener('click',async()=>{
      toast(I18N.t('syncNow')+'…');
      const r=await Sync.syncNow();
      toast(r==='ok'?I18N.t('synced'):(r==='offline'?I18N.t('networkOff'):r==='no-endpoint'?'no-endpoint':I18N.t('syncFail')));
    });

    // backup
    $('#btn-export-backup').addEventListener('click',async()=>{
      await Sync.exportBackupFile();
      toast(I18N.t('backupExportDone'));
    });
    const bf=$('#backup-file');
    bf.addEventListener('change',async()=>{
      try{
        await Sync.importBackupFile(bf.files[0]);
        toast(I18N.t('backupImportDone'));
        refreshAll();
      }catch(e){ toast(I18N.t('syncFail')); }
      bf.value='';
    });
    $('#btn-import-backup').addEventListener('click',()=>bf.click());

    try{
      await DB.init();
      await App.Settings.loadValues();
      refreshAll();
    }catch(e){
      toast(I18N.t('dbError'));
    }
    if($('app-version')) $('app-version').textContent='PalmCare v'+App.VERSION;
    setNet();
    try{ Notifier.audit(); }catch(e){}
  }

  function setNet(){
    const n=navigator.onLine;
    const bar=$('net-status');
    bar.textContent=n?I18N.t('networkOn'):I18N.t('networkOff');
    bar.className='chip '+(n?'chip-green':'chip-yellow');
    bar.style.gridColumn='1 / -1';
  }

  window.App={init,goto,refreshAll,Home,Farms,lang,applyI18n,NewVisit,showFarmOnMap,VERSION:'0.3'};
  document.addEventListener('DOMContentLoaded',init);
})();