(function(){
  // ---------- tiny DOM helpers ----------
  function h(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; }
  function el(tag,props,children){
    const n=document.createElement(tag);
    if(props) for(const k in props){
      if(k==='class') n.className=props[k];
      else if(k==='style') n.style.cssText=props[k];
      else if(k.startsWith('on')) n.addEventListener(k.slice(2),props[k]);
      else if(k==='checked') n.checked=props[k];
      else if(k==='value') n.value=props[k];
      else n.setAttribute(k,props[k]);
    }
    const kids=(children==null)?[]:(Array.isArray(children)?children:[children]);
    kids.forEach(c=>{ if(c!=null) n.appendChild(typeof c==='string'||typeof c==='number'?document.createTextNode(String(c)):c); });
    return n;
  }
  window.Util={h,el};

  const PRESETS={
    pesticides:[
      'Imidacloprid (إيميداكلوبريد)',
      'Abamectin (أبامكتين)',
      'Chlorpyrifos (كلوربيريفوس)',
      'Thiamethoxam (ثياميثوكسام)',
      'Lambda-cyhalothrin',
      'أخرى'
    ],
    dosages:['50 مل/نخلة','60 مل/نخلة','75 مل/نخلة','100 مل/نخلة','200 مل/نخلة','حسب التعليمات']
  };

  function severityColor(sev){
    if(sev==='شديدة'||sev==='Severe') return '#d64541';
    if(sev==='متوسطة'||sev==='Moderate') return '#e8a33d';
    return '#228b54';
  }

  function toast(msg){
    const t=document.getElementById('toast');
    t.textContent=msg; t.hidden=false;
    clearTimeout(t._tm);
    t._tm=setTimeout(()=>{ t.hidden=true; },2600);
  }

  // ---------- voice recorder ----------
  async function voiceRecorder(onSave){
    let mediaRecorder=null, chunks=[], blobStore=null;
    const recBtn=el('button',{class:'btn btn-outline'},[I18N.t('rec')]);
    const playBtn=el('button',{class:'btn btn-outline',style:'display:none'},['▶']);
    const box=el('div',{class:'btn-row'},[recBtn,playBtn]);
    async function toggleRec(){
      if(mediaRecorder && mediaRecorder.state==='recording'){
        mediaRecorder.stop();
        recBtn.textContent=I18N.t('rec');
        return;
      }
      try{
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        mediaRecorder=new MediaRecorder(stream);
        chunks=[];
        mediaRecorder.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
        mediaRecorder.onstop=()=>{
          blobStore=new Blob(chunks,{type:'audio/webm'});
          onSave(blobStore);
          playBtn.style.display='';
          stream.getTracks().forEach(t=>t.stop());
        };
        mediaRecorder.start();
        recBtn.textContent=I18N.t('recStop');
      }catch(e){ toast(I18N.t('micFail')); }
    }
    recBtn.onclick=toggleRec;
    playBtn.onclick=()=>{
      if(blobStore){
        const u=URL.createObjectURL(blobStore);
        const a=new Audio(u); a.play();
      }
    };
    return {box, blob:()=>blobStore};
  }

  // ---------- photo capture ----------
  function photoPicker(onPhotos){
    const input=el('input',{type:'file',accept:'image/*',multiple:'',capture:'environment',class:'fileinput'});
    input.addEventListener('change',async()=>{
      const arr=[];
      for(const f of input.files){
        arr.push({id:Geo.uid('ph'),name:f.name,blob:f,ts:Date.now(),type:'capture'});
      }
      onPhotos(arr);
      input.value='';
    });
    return input;
  }

  function photoRow(photos, onDelete){
    const box=el('div',{class:'thumbs'});
    if(photos){
      photos.forEach(p=>{
        if(!p.url && p.blob) p.url=URL.createObjectURL(p.blob);
        const im=el('img',{class:'thumb'});
        if(p.url){ im.src=p.url; } else { im.style.display='none'; }
        im.style.cursor='pointer';
        if(onDelete) im.onclick=()=>onDelete(p);
        box.appendChild(im);
      });
    }
    return box;
  }

  function fileToB64(file){
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=()=>res(r.result.split(',')[1]);
      r.onerror=rej;
      r.readAsDataURL(file);
    });
  }

  // ---------- in-app confirm (works on iOS standalone/installed PWA where window.confirm is unreliable) ----------
  function confirm(msg, okLabel, cancelLabel){
    return new Promise(resolve=>{
      let box=document.getElementById('jk-confirm');
      if(!box){
        box=el('div',{id:'jk-confirm',class:'confirm-wrap'});
        document.body.appendChild(box);
      }
      const ok=el('button',{class:'btn btn-primary'},[okLabel||I18N.t('yes')]);
      const cancel=el('button',{class:'btn btn-outline'},[cancelLabel||I18N.t('no')]);
      box.innerHTML='';
      box.appendChild(el('div',{class:'confirm-box'},[
        el('div',{class:'confirm-msg'},[msg]),
        el('div',{class:'btn-row'},[cancel,ok])
      ]));
      box.classList.add('show');
      const done=v=>{ box.classList.remove('show'); ok.onclick=null; cancel.onclick=null; resolve(v); };
      ok.onclick=()=>done(true);
      cancel.onclick=()=>done(false);
    });
  }

  window.FlowUtil={h,el,PRESETS,severityColor,toast,voiceRecorder,photoPicker,photoRow,fileToB64,confirm};
})();