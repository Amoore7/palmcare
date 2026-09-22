(function(){
  const $=id=>document.getElementById(String(id).replace(/^#/,''));
  const {el}=window.Util;
  const {toast}=window.FlowUtil;

  let pending=null;

  function openPicker(){
    pending=null;
    $('#ov-import').hidden=false;
    $('#import-warnings').hidden=true;
    $('#import-warnings').innerHTML='';
    $('#btn-import-confirm').hidden=true;
    $('#import-progress').hidden=true;
  }

  function onFile(file){
    if(!file) return;
    $('#import-progress').hidden=false;
    $('#import-progress').textContent=I18N.t('capturing')+'…';
    // Fully automatic: no manual column mapping screen.
    parseAndPrepare(file);
  }

  async function parseAndPrepare(file){
    try{
      pending=await ExcelUtil.parseFile(file);
    }catch(e){
      $('#import-progress').textContent='';
      toast(I18N.t('fileErr'));
      return;
    }
    $('#import-progress').hidden=true;
    // reuse previous mapping if headers identical
    const saved=await DB.getSetting('columnMapping',null);
    const savedHdr=await DB.getSetting('columnMappingHeader',null);
    let map=null;
    if(saved){
      const same = savedHdr && Array.isArray(savedHdr) && pending.headers.length===savedHdr.length &&
        pending.headers.every((x,i)=>String(x)===String(savedHdr[i]));
      if(same) map=saved;
    }
    if(!map) map=ExcelUtil.autodetect(pending.headers);
    prepare(map);
  }

  function prepare(map){
    const warn=$('#import-warnings');
    warn.hidden=false; warn.classList.remove('red'); warn.innerHTML='';
    const flags=[]; const skipped=[];
    pending.data.forEach((row,i)=>{
      const f=ExcelUtil.buildFarmFromRow(row,map);
      if(!f.name){ skipped.push({row:i+2,name:f.name,nationalId:f.nationalId,phone:f.phone}); return; }
      if(f.flags.length) flags.push({row:i+2,name:f.name,nationalId:f.nationalId,phone:f.phone,flags:f.flags});
    });
    const imported=pending.data.length-skipped.length;
    if(flags.length){
      warn.classList.add('red');
      const ul=el('div',{});
      ul.appendChild(el('b',{},[I18N.t('importWarnings')]));
      flags.forEach(fl=>{
        const msg=fl.flags.map(x=>x==='noCoords'?I18N.t('warnNoCoords'):x==='badCoords'?I18N.t('warnBadCoords'):x==='noName'?I18N.t('farm')+'?':x).join(', ');
        ul.appendChild(el('div',{class:'small'},['#Row '+fl.row+' — '+(fl.name||'')+' '+((fl.nationalId)?('| '+fl.nationalId):'')+' ← '+msg]));
      });
      warn.appendChild(ul);
    } else {
      warn.appendChild(el('div',{class:'warnbox green'},[I18N.t('importedRows',{n:String(imported)})]));
    }
    if(skipped.length){
      const ul=el('div',{});
      ul.appendChild(el('b',{},[I18N.t('importSkipped')+' ('+skipped.length+')']));
      skipped.forEach(sk=>{
        ul.appendChild(el('div',{class:'small'},['#Row '+sk.row+' — '+(sk.nationalId?('| '+sk.nationalId):'')+((sk.phone)?(' | 📞'+sk.phone):'')]));
      });
      warn.appendChild(ul);
    }
    $('#import-progress').textContent=I18N.t('importedRows',{n:String(imported)})+ (skipped.length?(' · '+I18N.t('importSkipped')+': '+skipped.length):'');
    const btn=$('#btn-import-confirm');
    btn.hidden=imported===0;
    btn.onclick=async()=>{
      btn.disabled=true;
      btn.textContent=I18N.t('capturing')+'…';
      const out=await ExcelUtil.runImport(pending.file, map);
      btn.disabled=false;
      $('#ov-import').hidden=true;
      const wk=ExcelUtil.weekId();
      toast(I18N.t('importedRows',{n:String(out.farms.length)})+': +'+out.added+' ✓ / '+out.updated+' '+I18N.t('merged')+(out.skipped?(' · '+I18N.t('importSkipped')+': '+out.skipped):''));
      try{ Notifier.audit(); }catch(e){}
      window.App.refreshAll();
    };
  }

  $('#import-file').addEventListener('change',e=>onFile(e.target.files[0]));
  $('#btn-import-confirm').addEventListener('click',()=>{});

  window.App.Import={openPicker};
})();