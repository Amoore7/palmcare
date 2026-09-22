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
    timer=setInterval(()=>{ syncNow().catch(()=>{}); }, intervalMs||120000);
  }

  function start(){
    window.addEventListener('online',()=>{ syncNow().catch(()=>{}); });
    window.addEventListener('offline',()=>{});
    schedule(120000);
  }

  window.Sync={syncNow,exportBackupFile,importBackupFile,start,schedule};
})();