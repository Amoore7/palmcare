(function(){
  // Silent automatic cloud backup. When online, POST a full snapshot JSON to the
  // configured endpoint; on failure the snapshot stays queued and is retried later.
  let running=false, timer=null;

  const OUTBOX_KEY='outboxSnapshot';

  async function buildSnapshot(){
    return {
      app:'palmcare',
      ver:1,
      at:Date.now(),
      device: detectDevice(),
      farms: await DB.all('farms'),
      visits: await DB.all('visits'),
      palms: await DB.all('palms'),
      batches: await DB.all('batches'),
      settings: await DB.all('settings'),
    };
  }

  function detectDevice(){
    const ua=navigator.userAgent;
    let d='web';
    if(/iPhone|iPad|iPod/.test(ua)) d='ios';
    else if(/Android/.test(ua)) d='android';
    return d+(navigator.onLine?'/online':'/offline');
  }

  // save snapshot to local backup store
  async function persistSnapshot(snap){
    const d=await DB.init();
    await d.put('outbox',{id:'snapshot', at:Date.now(), blob: snap});
  }

  async function exportBackupFile(){
    const snap=await buildSnapshot();
    const blob=new Blob([JSON.stringify(snap)],{type:'application/json'});
    const fname='palmcare-backup-'+new Date().toISOString().slice(0,10)+'.palmcare';
    ExcelUtil.downloadBlob(blob, fname);
    return {blob,fname};
  }

  async function importBackupFile(file){
    const text=await file.text();
    const snap=JSON.parse(text);
    if(snap.app!=='palmcare' || !Array.isArray(snap.farms)) throw new Error('bad-backup');
    await DB.restore(snap);
  }

  function currentEndpoint(){
    return DB.getSetting('cloudEndpoint','').then(s=>String(s||'').trim());
  }

  async function syncNow(){
    if(running) return 'running';
    if(!navigator.onLine) return 'offline';
    const endpoint=await currentEndpoint();
    if(!endpoint) return 'no-endpoint';
    running=true;
    try{
      const snap=await buildSnapshot();
      // capture last stored snapshot id if we have pending
      const resp=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(snap),
      });
      if(!resp.ok) throw new Error('http-'+resp.status);
      const d=await DB.init();
      await d.delete('outbox','snapshot');
      await DB.setSetting('lastSyncAt', Date.now());
      return 'ok';
    }catch(e){
      const snap=await buildSnapshot().catch(()=>null);
      if(snap) await persistSnapshot(snap);
      return 'fail';
    }finally{
      running=false;
    }
  }

  function schedule(intervalMs){
    clearInterval(timer);
    timer=setInterval(()=>{ syncNow().catch(()=>{}); flushFormQueue().catch(()=>{}); }, intervalMs||120000);
  }

  function start(){
    window.addEventListener('online',()=>{ syncNow().catch(()=>{}); flushFormQueue().catch(()=>{}); });
    window.addEventListener('offline',()=>{});
    schedule(120000);
  }

  // ================= Google Forms submission (direct, no OAuth) =================
  // Fixed field order — matches docs/google-forms-template.md. The real entry.* ids
  // come from the form the user creates; paste them via setFormConfig(). Defaults below
  // follow that template (entry.0001 … entry.0015).
  const FORM_FIELDS=[
    {id:'entry.0001', get:v=>v.visitId||''},
    {id:'entry.0002', get:v=>v.farmName||''},
    {id:'entry.0003', get:v=>v.phone||''},
    {id:'entry.0004', get:v=>v.nationalId||''},
    {id:'entry.0005', get:v=>v.gps? (Number(v.gps.lat).toFixed(6)+', '+Number(v.gps.lng).toFixed(6)) : ''},
    {id:'entry.0006', get:v=>v.entryTime||''},
    {id:'entry.0007', get:v=>v.exitTime||''},
    {id:'entry.0008', get:v=>v.registeredCount!=null?String(v.registeredCount):''},
    {id:'entry.0009', get:v=>v.actualCount!=null?String(v.actualCount):''},
    {id:'entry.0010', get:v=>v.phosphideTablets!=null?String(v.phosphideTablets):''},
    {id:'entry.0011', get:v=>v.fibrolMl!=null?String(v.fibrolMl):''},
    {id:'entry.0012', get:v=>v.infested!=null?String(v.infested):''},
    {id:'entry.0013', get:v=>String(v.obstacles||'').trim()||'لا يوجد'},
    {id:'entry.0014', get:v=>v.note||''},
    {id:'entry.0015', get:v=>v.followUpResult||''}
  ];
  let formEntryMap=null;          // {<n>: 'entry.XXXX'} overrides per position (1-based)
  let FORM_ID=null;               // set from settings at runtime

  async function loadFormConfig(){
    if(FORM_ID===null){
      FORM_ID=String(await DB.getSetting('googleFormId','')||'').trim();
      try{ formEntryMap=JSON.parse(await DB.getSetting('googleFormEntryMap',''))||null; }catch(e){ formEntryMap=null; }
    }
    return FORM_ID;
  }

  // Override the default entry ids with the real ones extracted from the user's form.
  function setFormConfig(formId, entryMap){
    FORM_ID=String(formId||'').trim();
    formEntryMap=entryMap||null;
    DB.setSetting('googleFormId',FORM_ID);
    DB.setSetting('googleFormEntryMap',JSON.stringify(formEntryMap||{}));
  }

  // Build POST payload (ordered, deterministic) for the house report.
  function buildFormPayload(visit){
    const fmap=formEntryMap||{};
    const out=new URLSearchParams();
    FORM_FIELDS.forEach((f,i)=>{
      const key=fmap[String(i+1)]||f.id;
      const val=(f.get(visit)||'').toString();
      if(val) out.append(key,val);
    });
    out.append('fvv','1');
    return out;
  }

  async function persistFormQueue(item){
    const d=await DB.init();
    const rec=await d.get('outbox','forms').catch(()=>null);
    const arr=(rec&&Array.isArray(rec.blob))?rec.blob:[];
    arr.push(item);
    await d.put('outbox',{id:'forms',at:Date.now(),blob:arr});
  }

  async function queuedForms(){
    const d=await DB.init();
    const rec=await d.get('outbox','forms').catch(()=>null);
    return (rec&&Array.isArray(rec.blob))?rec.blob:[];
  }

  async function clearFormQueue(){
    const d=await DB.init();
    await d.delete('outbox','forms').catch(()=>{});
  }

  async function submitToGoogleForm(visit){
    const formId=await loadFormConfig();
    if(!formId) return 'no-form';            // not configured yet — silent (no spam for users)
    if(!navigator.onLine){ await persistFormQueue(visit); return 'queued'; }
    try{
      await postForm(formId,visit);
      return 'ok';
    }catch(e){
      await persistFormQueue(visit);
      return 'queued';
    }
  }

  async function flushFormQueue(){
    const q=await queuedForms();
    if(!q.length) return 'empty';
    if(!navigator.onLine) return 'offline';
    const formId=await loadFormConfig();
    if(!formId) return 'no-form';
    const remaining=[];
    for(const item of q){
      const ok=await postForm(formId,item).catch(()=>false);
      if(!ok) remaining.push(item);
    }
    if(remaining.length) await overwriteFormQueue(remaining);
    else await clearFormQueue();
    return remaining.length?'partial':'ok';
  }

  async function postForm(formId,visit){
    const resp=await fetch('https://docs.google.com/forms/d/e/'+encodeURIComponent(formId)+'/formResponse',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body:String(buildFormPayload(visit))
    });
    if(!resp.ok) throw new Error('http-'+resp.status);
    return true;
  }

  async function overwriteFormQueue(items){
    const d=await DB.init();
    await d.put('outbox',{id:'forms',at:Date.now(),blob:items});
  }

  // Helper: household info + defaults for the house report form.
  function formVisitPayload(vis, farm){
    const palms=vis.palmIds||[];
    const infested=palms.length;
    const d=new Date(vis.date);
    const hh=String(d.getHours()).padStart(2,'0'), mm=String(d.getMinutes()).padStart(2,'0');
    return {
      visitId: vis.id,
      farmName: farm?farm.name:'',
      phone: farm?farm.phone:'',
      nationalId: farm?farm.nationalId:'',
      gps: vis.gps,
      entryTime: hh+':'+mm,
      exitTime: vis.exitTime?vis.exitTime:vis.entryTime||hh+':'+mm,
      registeredCount: vis.registeredCount!=null?vis.registeredCount:(farm?farm.registeredCount:null),
      actualCount: vis.actualCount,
      // phosphide default: 5 tablets per infested palm; fibrol in ml (numeric inputs later)
      phosphideTablets: infested?infested*5:null,
      fibrolMl: null,
      infested,
      obstacles: (vis.obstacles||[]).join('، '),
      note: vis.note||'',
      followUpResult: palms.length?'—':''
    };
  }

  window.Sync={syncNow,exportBackupFile,importBackupFile,start,schedule,setFormConfig,submitToGoogleForm,flushFormQueue,formVisitPayload};
})();