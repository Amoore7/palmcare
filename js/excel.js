(function(){
  const REQUIRED=['name','nationalId','phone','lat','lng','registeredCount'];

  const KEYWORDS = {
    name:['اسم','الاسم','اسم المزرعة','اسم المزرعه','اسم المزارع','اسم المزراع','الاسم الكامل','المزرعة','المزرعه','مزرعة','مزرعه','المزارع','المزارعه','المستفيد','اسم المستفيد','اسم رب الاسره','الفلاح','أسم','أسم المزرعه','أسم المزرعة','farm','farmer','farname','name'],
    nationalId:['هوية','رقم الهوية','رقم الهويه','سجل مدني','سجل','الرقم الوطني','رقم السجل','بطاقة','الوطني','national','nationalid','id'],
    phone:['جوال','رقم الجوال','رقم الهاتف','هاتف','موبايل','رقم الموبايل','mobile','phone','telefon','tel'],
    lat:['خط العرض','احداثيات','احداثيه','احداثية','احداثي','احداثية','احداثيات','coordinates','coords','coord','latitude','lat','lat1','x'],
    lng:['خط الطول','احداثيات','احداثيه','احداثية','احداثي','احداثية','احداثيات','coordinates','coords','coord','longitude','long','lon','lng','lng1','y'],
    registeredCount:['عدد النخيل','عدد','النخيل','العدد','count','num','nr']
  };

  function norm(s){ return String(s||'').trim().replace(/^\uFEFF/,'').replace(/\s+/g,' ').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه'); }

  // SheetJS reads plain-text cells passed as bytes; UTF-8 CSV without BOM can
  // come back as one Latin-1 char per byte (mojibake). Re-decode such strings.
  function unmangle(s){
    const str=String(s||''); if(!str) return str;
    let hasHi=false, hasLo=false;
    for(let i=0;i<str.length;i++){ const c=str.charCodeAt(i); if(c>255) hasHi=true; else hasLo=true; }
    if(hasHi){ return str; } // proper Unicode cell (e.g. from real .xlsx)
    if(!hasLo) return str;   // empty
    const bytes=new Uint8Array(str.length);
    for(let i=0;i<str.length;i++) bytes[i]=str.charCodeAt(i)&0xff;
    try{
      const t=new TextDecoder('utf-8').decode(bytes);
      return t.indexOf('\uFFFD')>-1 ? str : t;
    }catch(e){ return str; }
  }

  function autodetect(headers){
    const map={};
    const lower=headers.map(norm);
    // phase 1: explicit y/x sub-header tags from "إحداثيات المزرعة (y)/(x)"
    const tagged={};
    lower.forEach((h,i)=>{ const m=h&&h.match(/\(([yx])\)/); if(m) tagged[i]=m[1]; });
    // phase 2: keyword matching; a column tagged (y) feeds only lng, (x) only lat.
    for(const field of REQUIRED){
      let found=null, score=0;
      lower.forEach((h,i)=>{
        if(!h) return;
        if(tagged[i]){
          const isLng=tagged[i]==='y';
          if(field==='lat' && !isLng){ if(100>score){ score=100; found=i; } return; }
          if(field==='lng' && isLng){ if(100>score){ score=100; found=i; } return; }
          return; // tagged coordinate columns never serve other fields
        }
        for(const kw of KEYWORDS[field]){
          const k=norm(kw);
          if(h===k){ if(100>score){ score=100; found=i; } }
          else if(h.includes(k) && score<50){ score=50; found=i; }
        }
      });
      if(found!=null) map[field]=found;
    }
    return map;
  }

  // --- "خطة سير المندوب" vendor layout helpers ---
  // Rows: [0]=title (merged, ignored), [1]=main headers, [2]=sub headers y/x under
  // إحداثيات المزرعة, then farm rows; blue separator rows are fully empty.
  function headerScore(row){
    const hs=(row||[]).map(norm);
    let n=0;
    for(const field of REQUIRED){
      let hit=false;
      hs.forEach((h,i)=>{
        if(!h) return;
        for(const kw of KEYWORDS[field]){
          const k=norm(kw);
          if(h===k || h.includes(k)){ hit=true; }
        }
      });
      if(hit) n++;
    }
    return n;
  }
  function detectHeaderRow(rows){
    for(let i=0;i<Math.min(4,rows.length);i++){
      if(headerScore(rows[i])>=3) return i;
    }
    return 0;
  }
  function isSubHeaderRow(row){
    let y=0,x=0;
    (row||[]).forEach(c=>{ const n=norm(c); if(n==='y')y++; else if(n==='x')x++; });
    return y>=1 && x>=1;
  }
  function tagSubHeader(rows, hi, merges){
    const main=rows[hi], sub=rows[hi+1];
    const tags={};
    const coordsCols=new Set();
    (merges||[]).forEach(m=>{
      if(m.s.r===hi){
        const anchor=norm(main[m.s.c]||'');
        if(anchor.indexOf('احداثي')>-1) for(let c=m.s.c;c<=m.e.c;c++) coordsCols.add(c);
      }
    });
    if(!coordsCols.size){
      for(let c=0;c<main.length;c++) if(norm(main[c]||'').indexOf('احداثي')>-1) coordsCols.add(c);
    }
    coordsCols.forEach(c=>{
      const n=norm(sub[c]||'');
      if(n==='y'||n==='x') tags[c]=n;
    });
    return tags;
  }
  function fillMergedRows(rows, merges){
    (merges||[]).forEach(m=>{
      if(m.s.c!==m.e.c || m.s.r===m.e.r) return;           // vertical single-column spans only
      const anchor=String(rows[m.s.r]&&rows[m.s.r][m.s.c]||'');
      if(!anchor) return;
      for(let r=m.s.r+1;r<=m.e.r;r++){
        if(rows[r] && !String(rows[r][m.s.c]).trim()) rows[r][m.s.c]=anchor;
      }
    });
  }

  function mappingComplete(map){
    return REQUIRED.every(f=>{ const idx=map[f]; return typeof idx==='number' && idx>=0; });
  }

  function buildFarmFromRow(row, map){
    const cell=(col)=>{ const idx=map[col]; return (idx!=null && row!=null)?row[idx]:''; }
    const name=String(cell('name')||'').trim();
    const nationalId=String(cell('nationalId')||'').trim();
    const phone=String(cell('phone')||'').trim();
    // a single combined "coordinates" column (e.g. '24.71,46.67' or '24.71 46.67')
    // mapped to BOTH lat & lng: split the two numbers regardless of how parseCoord reads it.
    if(map.lat!=null && map.lat===map.lng && row[map.lat]!=null){
      const nums=String(row[map.lat]).trim().match(/-?\d+(?:\.\d+)?/g);
      if(nums && nums.length>=2){ map.splitCoords=true; }
    }
    let lat=Geo.parseCoord(cell('lat'));
    let lng=Geo.parseCoord(cell('lng'));
    if(map.splitCoords){
      const raw=String(row[map.lat]!=null?row[map.lat]:'').trim();
      const nums=raw.match(/-?\d+(?:\.\d+)?/g);
      if(nums){
        if(nums[0]!=null) lat=parseFloat(nums[0]);
        if(nums[1]!=null) lng=parseFloat(nums[1]);
      }
    }
    const registeredCount=parseInt(String(cell('registeredCount')||'').replace(/[^0-9]/g,''),10)||0;
    const flags=[];
    if(!lat || !lng) flags.push('noCoords');
    else if(!Geo.isValidCoord(lat,lng) || !Geo.isReasonableSaudi(lat,lng)) flags.push('badCoords');
    if(!name) flags.push('noName');
    return {name, nationalId, phone, lat, lng, registeredCount, flags};
  }

  async function parseFile(file){
    const buf=await readFileBuffer(file);
    const u8=new Uint8Array(buf);
    const isCsv=/\.csv$/i.test(file.name||'');
    let ws=null, rows;
    if(isCsv){
      // Excel often exports CSVs as UTF-16 or UTF-8 variants; SheetJS cannot read these
      // reliably from bytes, so decode to a JS string first and let SheetJS re-parse it.
      let text;
      if(u8.length>=2 && ((u8[0]===0xFF&&u8[1]===0xFE)||(u8[0]===0xFE&&u8[1]===0xFF))){
        const le=!(u8[0]===0xFE&&u8[1]===0xFF);           // UTF-16 BOM
        text=new TextDecoder(le?'utf-16le':'utf-16be').decode(u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength));
      } else {
        text=new TextDecoder('utf-8').decode(u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength));
      }
      const wb=XLSX.read(text,{type:'string', cellDates:false});
      ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    } else {
      const wb=XLSX.read(u8,{type:'array', cellDates:false});
      ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
    }
    if(!rows || !rows.length) throw new Error('empty');
    const all=rows.map(function(r){ return (r||[]).map(function(c){ return unmangle(String(c)); }); });
    fillMergedRows(all, ws['!merges']||[]);          // day/date/governorate groups
    const hi=detectHeaderRow(all);                    // main header row (skips title)
    let tags={}, dataStart=hi+1;
    if(isSubHeaderRow(all[hi+1])){ tags=tagSubHeader(all,hi,ws['!merges']||[]); dataStart=hi+2; }
    const headers=all[hi].map(function(base,c){ return tags[c]?('احداثيات ('+tags[c]+')'):base; });
    const data=all.slice(dataStart).filter(function(r){ return r.some(function(c){ return String(c).trim()!==''; }); });
    return {file, headers, data};
  }

  function readFileBuffer(file){
    if(typeof file.arrayBuffer==='function'){
      // Safari < 14 may reject in some WebViews; fall back below if it fails.
      return file.arrayBuffer().catch(()=>fileReaderArrayBuffer(file));
    }
    return fileReaderArrayBuffer(file);
  }
  function fileReaderArrayBuffer(file){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result);
      r.onerror=()=>rej(r.error||new Error('fileread'));
      r.readAsArrayBuffer(file);
    });
  }

  function weekId(){
    const d=new Date(); d.setHours(12,0,0,0);
    const day=(d.getDay()+6)%7; // week starts Monday
    d.setDate(d.getDate()-day);
    d.setHours(12,0,0,0);
    return d.getTime();
  }

  async function runImport(file, map){
    const parsed=await parseFile(file);
    const out={added:0, updated:0, skipped:0, flags:[], farms:[], map};
    parsed.data.forEach(function(row,i){
      const f=buildFarmFromRow(row,map);
      if(f.flags.length){
        out.flags.push({row:i+2, name:f.name||'-', nationalId:f.nationalId, phone:f.phone, flags:f.flags});
      }
      if(!f.name){ out.skipped++; return; } // no farm name → cannot import
      out.farms.push(f);
    });
    const wk=weekId();
    for(const f of out.farms){
      const existing=await DB.matchFarm(f);
      let rec;
      if(existing){
        rec=existing;
        rec.flags=(rec.flags||[]).slice();
        if(f.name){ rec.name=f.name; rec.flags=rec.flags.filter(x=>x!=='noName'); }
        if(f.nationalId) rec.nationalId=f.nationalId;
        if(f.phone) rec.phone=f.phone;
        if(f.registeredCount) rec.registeredCount=f.registeredCount;
        if(f.lat!=null && f.lng!=null){ rec.lat=f.lat; rec.lng=f.lng; rec.flags=rec.flags.filter(x=>x!=='noCoords'&&x!=='badCoords'); }
        out.updated++;
      } else {
        rec={
          id:Geo.uid('farm'), name:f.name, nationalId:f.nationalId, phone:f.phone,
          lat:f.lat, lng:f.lng, registeredCount:f.registeredCount,
          flags:(f.flags&&f.flags.length)?f.flags.slice():undefined,
          createdAt:Date.now(), boundary:null, obstacleZones:[]
        };
        out.added++;
      }
      rec.batchIds=rec.batchIds||[];
      if(rec.batchIds.indexOf(wk)<0) rec.batchIds.push(wk);
      rec.lastBatchId=wk;
      if(rec.id==null) rec.id=Geo.uid('farm');
      await DB.saveFarm(rec);
    }
    const batch={
      id:Geo.uid('batch'), weekDate:wk, importedAt:Date.now(),
      fileName:file.name, count:out.farms.length, added:out.added, updated:out.updated,
      map:Object.assign({},map), flags:out.flags
    };
    await DB.saveBatch(batch);
    await DB.setSetting('columnMapping', Object.assign({},map));
    await DB.setSetting('columnMappingHeader', parsed.headers);
    return out;
  }

  function makeWorkbook(aoa, sheetName){
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=aoa[0].map(function(){ return {wch:22}; });
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb,{type:'array', bookType:'xlsx'});
  }

  function farmToExcel(farm, visits, palms, boundary){
    const aoa=[];
    aoa.push([I18N.t('reportExcel'), '']);
    aoa.push([I18N.t('farmer'), farm.name||'']);
    aoa.push([I18N.t('nationalId'), farm.nationalId||'']);
    aoa.push([I18N.t('phone'), farm.phone||'']);
    aoa.push([I18N.t('lat'), farm.lat!=null?farm.lat:'']);
    aoa.push([I18N.t('lng'), farm.lng!=null?farm.lng:'']);
    aoa.push([I18N.t('registeredCount'), farm.registeredCount||0]);
    aoa.push(['Area (ha)', boundary? Geo.fmtArea(Geo.polygonAreaHa(boundary.points)) : I18N.t('areaNotCalculated')]);
    aoa.push([]);
    visits.forEach(function(v,idx){
      if(v.actualCount!=null && v.registeredCount && v.actualCount!==v.registeredCount){
        aoa.push([I18N.t('discrepancyNote')+' '+(idx+1), I18N.t('countDiscrepancy',{registered:v.registeredCount,actual:v.actualCount})]);
      }
      if(v.obstacles && v.obstacles.length){
        aoa.push([I18N.t('obstaclesTask')+' '+(idx+1), v.obstacles.join(' / ')]);
      }
      if(v.note) aoa.push([I18N.t('freeNote')+' '+(idx+1), v.note]);
    });
    aoa.push([]);
    aoa.push([I18N.t('palmCode'), I18N.t('severity'), I18N.t('pesticide'), I18N.t('dosage'),
              I18N.t('treatment'), I18N.t('nextInspection'), I18N.t('followUpResult'),
              I18N.t('lat'), I18N.t('lng')]);
    palms.forEach(function(p){
      aoa.push([p.code||'', p.severity||'', p.pesticide||'', p.dosage||'',
                p.treatmentDate?Geo.fmtDate(p.treatmentDate):'',
                p.nextInspectionDate?Geo.fmtDate(p.nextInspectionDate):'',
                p.result||'', p.lat!=null?p.lat:'', p.lng!=null?p.lng:'']);
    });
    return makeWorkbook(aoa,'Report');
  }

  function visitsToExcel(visits, farmById){
    const aoa=[[I18N.t('farmer'),I18N.t('nationalId'),I18N.t('phone'),
                I18N.t('date'),I18N.t('registeredCount'),I18N.t('actualCount'),
                I18N.t('obstacles'),I18N.t('freeNote'),I18N.t('lat'),I18N.t('lng')]];
    visits.forEach(function(v){
      const f=farmById.get(v.farmId)||{};
      aoa.push([f.name||'', f.nationalId||'', f.phone||'',
                v.date?Geo.fmtDate(v.date):'', v.registeredCount!=null?v.registeredCount:'',
                v.actualCount!=null?v.actualCount:'',
                (v.obstacles||[]).join(' / '), v.note||'',
                v.gps?v.gps.lat:'', v.gps?v.gps.lng:'']);
    });
    return makeWorkbook(aoa,'Visits');
  }

  function downloadBlob(blob, filename){
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); },800);
  }

  window.ExcelUtil={
    parseFile, autodetect, mappingComplete, buildFarmFromRow, runImport,
    farmToExcel, visitsToExcel, downloadBlob, weekId, REQUIRED
  };
})();