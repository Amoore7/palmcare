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

  function showMapping(map){
    $('#ov-mapping').hidden=false;
    const wrap=$('#mapping-fields');
    wrap.innerHTML='';
    const fields=[
      ['name',I18N.t('farm')],['nationalId',I18N.t('nationalId')],['phone',I18N.t('phone')],
      ['lat',I18N.t('lat')],['lng',I18N.t('lng')],['registeredCount',I18N.t('registeredCount')]
    ];
    const selMap={};
    fields.forEach(([key,label])=>{
      const sel=el('select',{});
      sel.appendChild(el('option',{value:''},['— '+I18N.t('no')+' —']));
      pending.headers.forEach((hh,i)=>sel.appendChild(el('option',{value:String(i)},['#'+(i+1)+' · '+String(hh)])));
      sel.value=map[key]!=null?String(map[key]):'';
      selMap[key]=sel;
      wrap.appendChild(el('label',{class:'field'},[el('span',{},[label]),sel]));
    });
    $('#btn-map-save').onclick=()=>{
      for(const k in selMap){
        const v=selMap[k].value;
        map[k]=v===''?'':parseInt(v,10);
      }
      if(!ExcelUtil.mappingComplete(map)){ toast(I18N.t('columnMapping')+'?'); return; }
      $('#ov-mapping').hidden=true;
      prepare(map);
    };
  }

  async function onFile(file){
    if(!file) return;
    $('#import-progress').hidden=false;
    $('#import-progress').textContent=I18N.t('capturing')+'…';
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
    if(!ExcelUtil.mappingComplete(map)){ showMapping(map); return; }
    prepare(map);
  }

  function prepare(map){
    const warn=$('#import-warnings');
    warn.hidden=false; warn.classList.remove('red'); warn.innerHTML='';
    const flags=[];
    pending.data.forEach((row,i)=>{
      const f=ExcelUtil.buildFarmFromRow(row,map);
      if(f.flags.length) flags.push({row:i+2,name:f.name,nationalId:f.nationalId,phone:f.phone,flags:f.flags});
    });
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
      warn.appendChild(el('div',{class:'warnbox green'},[I18N.t('importedRows',{n:String(pending.data.length)})]));
    }
    $('#import-progress').textContent=I18N.t('importedRows',{n:String(pending.data.length)});
    const btn=$('#btn-import-confirm');
    btn.hidden=false;
    btn.onclick=async()=>{
      btn.disabled=true;
      btn.textContent=I18N.t('capturing')+'…';
      const out=await ExcelUtil.runImport(pending.file, map);
      btn.disabled=false;
      $('#ov-import').hidden=true;
      const wk=ExcelUtil.weekId();
      toast(I18N.t('importedRows',{n:String(out.farms.length)})+': +'+out.added+' ✓ / '+out.updated+' '+I18N.t('merged'));
      try{ Notifier.audit(); }catch(e){}
      window.App.refreshAll();
    };
  }

  $('#import-file').addEventListener('change',e=>onFile(e.target.files[0]));
  $('#btn-import-confirm').addEventListener('click',()=>{});
  $('#btn-map-save').addEventListener('click',()=>{});
  document.querySelector('#ov-mapping .close').addEventListener('click',()=>{ $('ov-mapping').hidden=true; });

  window.App.Import={openPicker};
})();