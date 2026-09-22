(function(){
  async function ensure(){
    try{
      if(!('Notification' in window)) return false;
      if(Notification.permission==='granted') return true;
      if(Notification.permission==='default'){
        const ok=await Notification.requestPermission();
        return ok==='granted';
      }
    }catch(e){}
    return false;
  }

  function show(title, body){
    try{
      if(!('Notification' in window) || Notification.permission!=='granted') return;
      const n=new Notification(title,{body:body,tag:'palmcare-due',icon:'icons/icon-192.png'});
      setTimeout(()=>{try{n.close();}catch(e){}},15000);
    }catch(e){}
  }

  // Called whenever the app is opened: fire local reminders for due/overdue palms.
  async function audit(){
    try{
      const enabled=await DB.getSetting('notifications', true);
      if(!enabled) return;
      const palms=await DB.palmsPendingInspection();
      const overdue=palms.filter(p=>Geo.dueClass(p.nextInspectionDate)==='red');
      if(!overdue.length) return;
      await ensure();
      const farmMap={};
      for(const p of overdue){
        if(!farmMap[p.farmId]){
          const f=await DB.farm(p.farmId);
          farmMap[p.farmId]=f?f.name:'';
        }
      }
      const msg=I18N.t('urgent')+': '+overdue.length+' '+(overdue.length===1?I18N.t('palmCode'):I18N.t('palmsTreated'));
      show(I18N.t('todayTitle'), msg);
    }catch(e){}
  }

  window.Notifier={ensure,show,audit};
})();