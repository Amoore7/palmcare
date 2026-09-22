(function(){
  const $=id=>document.getElementById(id);

  async function collect(farmId){
    const farm=await DB.farm(farmId);
    const visits=await DB.visitsForFarm(farmId);
    const palms=await DB.palmsForFarm(farmId);
    return {farm, visits, palms};
  }

  // ---------- stats ----------
  async function computeStats(){
    const farms=await DB.farms();
    const visits=await DB.recentVisits();
    const palms=await DB.palms();
    const visitedFarmIds=new Set(visits.map(v=>v.farmId));
    const treated=palms.length;
    const resolved=palms.filter(p=>p.result);
    const recovered=resolved.filter(p=>p.result==='recovered').length;
    const dead=resolved.filter(p=>p.result==='dead').length;
    const rate=resolved.length?Math.round(recovered/resolved.length*100):0;
    const pendingPalms=await DB.palmsPendingInspection();
    const overdue=pendingPalms.filter(p=>Geo.dueClass(p.nextInspectionDate)==='red').length;
    const dueSoon=pendingPalms.filter(p=>Geo.dueClass(p.nextInspectionDate)==='yellow').length;
    const discFarms=farms.filter(f=>{
      const v=visits.filter(vv=>vv.farmId===f.id && vv.discrepancyNote);
      return v.length;
    }).length;
    const obstacleFarms=farms.filter(f=>{
      const v=visits.filter(vv=>vv.farmId===f.id && vv.obstacles && vv.obstacles.length);
      return v.length;
    }).length;
    // weekly treated
    const weekly={};
    palms.forEach(p=>{
      if(!p.treatmentDate) return;
      const k=Geo.dayStart(p.treatmentDate);
      weekly[k]=(weekly[k]||0)+1;
    });
    const weeklyArr=Object.keys(weekly).map(k=>({week:parseInt(k,10),count:weekly[k]})).sort((a,b)=>a.week-b.week).slice(-8);
    return {
      farms:farms.length,
      visited:visitedFarmIds.size,
      treated, recovered, dead, rate,
      overdue, dueSoon,
      discFarms, obstacleFarms,
      weeklyArr,
      pending:farms.filter(f=>f.lat!=null||(f.boundary&&f.boundary.points&&f.boundary.points.length)).length
    };
  }

  // ---------- WhatsApp text ----------
  function whatsappText(farm, visits, palms, boundary){
    const L=[];
    L.push('🧾 '+I18N.t('reportPdf'));
    L.push('================');
    L.push(I18N.t('farmer')+': '+farm.name);
    if(farm.nationalId) L.push(I18N.t('nationalId')+': '+farm.nationalId);
    if(farm.phone) L.push(I18N.t('phone')+': '+farm.phone);
    if(farm.lat!=null) L.push('📍 '+farm.lat.toFixed(6)+', '+farm.lng.toFixed(6));
    if(boundary) L.push('📐 '+I18N.t('areaIs',{a:Geo.fmtArea(Geo.polygonAreaHa(boundary.points))}));
    L.push(I18N.t('registeredCount')+': '+(farm.registeredCount||0));
    visits.forEach((v,i)=>{
      L.push('----------------');
      L.push('🗓 '+Geo.fmtDate(v.date));
      if(v.actualCount!=null) L.push(I18N.t('actualCount')+': '+v.actualCount);
      if(v.discrepancyNote) L.push('⚠️ '+v.discrepancyNote);
      if(v.obstacles.length) L.push('🧱 '+v.obstacles.join(' / '));
      if(v.note) L.push('📝 '+v.note);
    });
    if(palms.length){
      L.push('----------------');
      palms.forEach(p=>{
        L.push('🌴 '+p.code+' ['+(p.severity||'')+'] '+(p.pesticide||'')+' '+Geo.fmtDate(p.treatmentDate)+(p.result?(' → '+(p.result==='recovered'?'✅':p.result==='dead'?'❌':'🔄')):''));
      });
    }
    return L.join('\n');
  }

  async function shareWhatsApp(farmId){
    const {farm, visits, palms}=await collect(farmId);
    const txt=encodeURIComponent(whatsappText(farm, visits, palms, farm.boundary));
    const url='https://wa.me/?text='+txt;
    try{ window.open(url,'_blank'); }catch(e){ location.href=url; }
  }

  // ---------- share file ----------
  async function shareFile(blob, name){
    const nav=navigator;
    if(nav.share && nav.canShare && nav.canShare({files:[new File([blob],name,{type:blob.type})]})){
      try{
        await nav.share({files:[new File([blob],name,{type:blob.type})]});
        return true;
      }catch(e){ if(e.name==='AbortError') return true; }
    }
    ExcelUtil.downloadBlob(blob,name);
    toast(I18N.t('shareUnavailable'));
    return false;
  }

  async function exportFarmExcel(farmId){
    const {farm, visits, palms}=await collect(farmId);
    const data=ExcelUtil.farmToExcel(farm, visits, palms, farm.boundary);
    const blob=new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    await shareFile(blob, 'palmcare-'+Date.now()+'.xlsx');
  }

  async function exportAllVisitsExcel(){
    const visits=await DB.recentVisits();
    const farms=await DB.farms();
    const map=new Map(farms.map(f=>[f.id,f]));
    const data=ExcelUtil.visitsToExcel(visits,map);
    const blob=new Blob([data],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    await shareFile(blob,'palmcare-visits-'+Date.now()+'.xlsx');
  }

  // ---------- Print (PDF) report ----------
  async function renderPrint(farmId){
    const {farm, visits, palms}=await collect(farmId);
    const esc=s=>String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const rows=[];
    visits.forEach(v=>{
      const disc=v.discrepancyNote?'<div class="W">⚠️ '+esc(v.discrepancyNote)+'</div>':'';
      const obs=(v.obstacles&&v.obstacles.length)?('<div class="tag">'+v.obstacles.map(esc).join(' · ')+'</div>'):'<span>'+esc(I18N.t('noObstacles'))+'</span>';
      rows.push(
        '<div class="TL"><b>🗓 '+Geo.fmtDate(v.date)+'</b><br>'+
        I18N.t('registeredCount')+': '+(v.registeredCount||0)+' · '+I18N.t('actualCount')+': '+(v.actualCount!=null?v.actualCount:'—')+'<br>'+
        I18N.t('obstacles')+': '+obs+(v.note?('<br>📝 '+esc(v.note)):'')+disc+'</div>'
      );
    });
    const palmRows=palms.map(p=>{
      const ph=(p.photos&&p.photos.length)?'<img class="P" src="'+URL.createObjectURL(p.photos[0].blob)+'">':'';
      const fu=(p.followUpPhotos&&p.followUpPhotos.length)?'<img class="P" src="'+URL.createObjectURL(p.followUpPhotos[p.followUpPhotos.length-1].blob)+'">':'';
      return '<tr><td>'+esc(p.code)+'</td><td>'+esc(p.severity||'')+'</td><td>'+esc(p.pesticide||'')+'</td><td>'+esc(p.dosage||'')+'</td><td>'+Geo.fmtDate(p.treatmentDate)+'</td><td>'+Geo.fmtDate(p.nextInspectionDate)+'</td><td>'+esc(p.result||'')+'</td><td>'+ph+'</td><td>'+fu+'</td></tr>';
    }).join('');

    // farm map snapshot
    const mapCanvas=document.getElementById('farm-map');
    let mapImg='';
    try{
      const c=document.createElement('canvas');
      c.width=Math.max(100,Math.min(1200,(mapCanvas.width||400)));
      c.height=Math.max(80,Math.min(600,(mapCanvas.height||300)));
      const cx=c.getContext('2d');
      const dpr=window.devicePixelRatio||1;
      cx.drawImage(mapCanvas,0,0,c.width/dpr,c.height/dpr);
      mapImg='<img class="M" src="'+c.toDataURL('image/jpeg',0.8)+'">';
    }catch(e){}

    const html='<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>'+esc(farm.name)+'</title>'+
      '<style>body{font-family:-apple-system,"Segoe UI",sans-serif;color:#1f2933;margin:24px}h1{color:#1a6b40;margin-bottom:4px}.TL{margin:14px 0;padding:10px;border:1px solid #e3e8ee;border-radius:8px;font-size:14px}.W{margin-top:6px;padding:8px;background:#fdf3e2;border-radius:6px;font-size:13px}.tag{display:inline-block;background:#e7f4ec;color:#1a6b40;border-radius:6px;padding:2px 8px;margin:2px;font-size:12px}.M{max-width:100%;border-radius:8px;max-height:420px;margin:8px 0}.P{width:56px;height:56px;object-fit:cover;border-radius:6px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}th,td{border:1px solid #d7dee6;padding:6px}</style>'+
      '</head><body><h1>'+esc(farm.name)+'</h1>'+
      '<p><b>'+esc(farm.nationalId||'')+'</b> · <b>'+esc(farm.phone||'')+'</b></p>'+
      (farm.lat!=null?('<p>📍 '+farm.lat.toFixed(6)+', '+farm.lng.toFixed(6)+'</p>'):'')+
      (farm.boundary?('<p>📐 '+I18N.t('areaIs',{a:Geo.fmtArea(Geo.polygonAreaHa(farm.boundary.points))})+'</p>'):'')+
      mapImg+
      (rows.length?rows.join(''):'<p>'+I18N.t('noVisits')+'</p>')+
      '<table border="1" cellpadding="4" style="border-collapse:collapse;width:100%;font-size:12px"><tr>'+
      '<th>'+I18N.t('palmCode')+'</th><th>'+I18N.t('severity')+'</th><th>'+I18N.t('pesticide')+'</th><th>'+I18N.t('dosage')+'</th><th>'+I18N.t('treatment')+'</th><th>'+I18N.t('nextInspection')+'</th><th>'+I18N.t('followUpResult')+'</th><th>📷</th><th>🔁</th></tr>'
      +(palmRows||('<tr><td colspan="9">'+I18N.t('noPalms')+'</td></tr>'))+
      '</table></body></html>';
    const win=window.open('','_blank');
    win.document.write(html);
    win.document.close();
    const fin=()=>{ win.focus(); win.print(); };
    if(win.document.readyState==='complete') setTimeout(fin,300); else win.onload=()=>setTimeout(fin,300);
  }

  function downloadTextFile(text, name){
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
    ExcelUtil.downloadBlob(blob,name);
  }

  window.Reports={collect,computeStats,whatsappText,shareWhatsApp,exportFarmExcel,exportAllVisitsExcel,renderPrint,downloadTextFile};
})();