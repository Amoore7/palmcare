(function(){
  const DB_NAME='palmcare', VERSION=1;

  async function open(){
    return idb.openDB(DB_NAME, VERSION, {
      upgrade(db){
        if(!db.objectStoreNames.contains('farms')) db.createObjectStore('farms',{keyPath:'id'});
        if(!db.objectStoreNames.contains('visits')){
          const s=db.createObjectStore('visits',{keyPath:'id'});
          s.createIndex('farmId','farmId');
        }
        if(!db.objectStoreNames.contains('palms')){
          const s=db.createObjectStore('palms',{keyPath:'id'});
          s.createIndex('farmId','farmId');
          s.createIndex('nextInspectionDate','nextInspectionDate');
        }
        if(!db.objectStoreNames.contains('batches')) db.createObjectStore('batches',{keyPath:'id'});
        if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings',{keyPath:'key'});
        if(!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox',{keyPath:'id'});
      }
    });
  }

  const DB = {
    open, db:null,
    async init(){ if(!this.db) this.db=await open(); return this.db; },
    tx(store,mode){ return this.db.transaction(store,mode); },
    async get(store,key){
      if(key==null) return null;
      const d=await this.init(); return (await d.get(store,key))||null;
    },
    async all(store){ const d=await this.init(); return await d.getAll(store); },
    async put(store,val){ const d=await this.init(); return await d.put(store,val); },
    async del(store,key){
      if(key==null) return null;
      const d=await this.init(); return await d.delete(store,key);
    },
    async clear(store){ const d=await this.init(); return await d.clear(store); },

    // --- settings ---
    async getSetting(key,def){
      const v=await this.get('settings',key);
      return v? v.value : def;
    },
    async setSetting(key,value){
      const d=await this.init();
      await d.put('settings',{key,value,at:Date.now()});
    },
    async getSettingsMap(){
      const all=await this.all('settings');
      const m={};
      all.forEach(s=>m[s.key]=s.value);
      return m;
    },

    // --- farms ---
    async saveFarm(f){ const d=await this.init(); f.updatedAt=Date.now(); return d.put('farms',f); },
    async farms(){ return (await this.all('farms')).sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'ar')); },
    async farm(id){ return this.get('farms',id); },
    async delFarm(id){
      const d=await this.init();
      const tx=d.transaction(['farms','visits','palms'],'readwrite');
      await tx.objectStore('farms').delete(id);
      const vs=await tx.objectStore('visits').index('farmId').getAll(id);
      for(const v of vs){ await tx.objectStore('visits').delete(v.id); }
      const ps=await tx.objectStore('palms').index('farmId').getAll(id);
      for(const p of ps){ await tx.objectStore('palms').delete(p.id); }
      await tx.done;
    },
    // merge/import: match by nationalId OR phone (non-empty)
    async matchFarm(row){
      const farms=await this.farms();
      const nid=String(row.nationalId||'').trim();
      const ph=String(row.phone||'').trim();
      if(!nid && !ph) return null;
      return farms.find(f=>
        (nid && String(f.nationalId||'').trim()===nid) ||
        (ph && String(f.phone||'').trim().replace(/[^0-9+]/g,'')===ph.replace(/[^0-9+]/g,''))
      ) || null;
    },

    // --- visits ---
    async saveVisit(v){ const d=await this.init(); v.updatedAt=Date.now(); return d.put('visits',v); },
    async visitsForFarm(farmId){
      const d=await this.init();
      return (await d.getAllFromIndex('visits','farmId',farmId)).sort((a,b)=>b.date-a.date);
    },
    async recentVisits(){ return (await this.all('visits')).sort((a,b)=>b.date-a.date); },
    async visit(id){ return this.get('visits',id); },
    async delVisit(id){ const d=await this.init(); return d.delete('visits',id); },

    // --- palms ---
    async savePalm(p){ const d=await this.init(); p.updatedAt=Date.now(); return d.put('palms',p); },
    async palmsForFarm(farmId){
      const d=await this.init();
      const arr=await d.getAllFromIndex('palms','farmId',farmId);
      return arr.sort((a,b)=>(b.treatmentDate||0)-(a.treatmentDate||0));
    },
    async palms(){ return this.all('palms'); },
    async palm(id){ return this.get('palms',id); },
    async delPalm(id){ const d=await this.init(); return d.delete('palms',id); },
    async palmsPendingInspection(){
      const d=await this.init();
      const arr=await d.getAllFromIndex('palms','nextInspectionDate');
      return arr.filter(p=>p.nextInspectionDate && !p.result && p.nextInspectionDate < Date.now()+4*86400000)
        .sort((a,b)=>a.nextInspectionDate-b.nextInspectionDate);
    },

    // --- batches ---
    async saveBatch(b){ const d=await this.init(); b.updatedAt=Date.now(); return d.put('batches',b); },
    async batches(){ return (await this.all('batches')).sort((a,b)=>b.weekDate-a.weekDate); },

    // --- snapshot backup ---
    async snapshot(){
      return {
        app:'palmcare', ver:1, at:Date.now(),
        farms: await this.all('farms'),
        visits: await this.all('visits'),
        palms: await this.all('palms'),
        batches: await this.all('batches'),
        settings: await this.all('settings'),
      };
    },
    async restore(snap){
      if(!snap || !Array.isArray(snap.farms)) throw new Error('bad-backup');
      const d=await this.init();
      const tx=d.transaction(['farms','visits','palms','batches','settings'],'readwrite');
      for(const s of ['farms','visits','palms','batches','settings']){
        await tx.objectStore(s).clear();
        const items=snap[s]||[];
        for(const it of items) await tx.objectStore(s).put(it);
      }
      await tx.done;
    },
  };
  window.DB = DB;
})();