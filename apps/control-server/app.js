let csrf=null;
const sdIsAiide=()=>document.getElementById('sd-provider')?.value==='aiide';
const sdLiveBase=()=>sdIsAiide()?'/api/aiide-video':'/api/live';const $=id=>document.getElementById(id);
const stages={idle:'Belum dimulai',awaiting_approval:'Menunggu persetujuan',awaiting_take_review:'Rencana disetujui',ready_to_export:'Hasil ditinjau',ready_to_render:'Siap diproses',ready_to_publish_dry_run:'Video contoh tersedia',completed_dry_run:'Simulasi selesai'};
const notify=(s)=>{$('status').textContent=s;if(!$('auth').hidden)$('auth-message').textContent=s;};
async function api(path,{method='GET',body=null}={}){
  const headers={};if(body!==null)headers['content-type']='application/json';if(csrf&&method!=='GET')headers['x-dramasaku-csrf']=csrf;
  const r=await fetch(path,{method,headers,body:body===null?null:JSON.stringify(body),credentials:'same-origin',cache:'no-store'});
  const data=await r.json();if(!r.ok)throw Error(data.error||`HTTP_${r.status}`);return data;
}
async function refresh(){const session=await api('/api/session');csrf=session.csrf;document.body.classList.toggle('signed-out',!session.authenticated);
  $('authbadge').textContent=session.authenticated?'● Siap digunakan':'● Belum masuk';
  $('auth').hidden=session.authenticated;document.querySelectorAll('[data-run]').forEach(b=>b.disabled=!session.authenticated);
  $('savekey').querySelector('button').disabled=!session.authenticated;
  for(const id of ['pool-save','pool-policy-save','pool-check','pool-reload'])$(id).disabled=!session.authenticated;
  if(session.authenticated){await Promise.all([refreshDemo(),refreshSlots(),sdLoad(),keyPoolsLoad(),ttsLoad()]);}
}
async function refreshDemo(){const d=await api('/api/demo/state');$('stage').textContent=stages[d.step]||d.step;$('shots').textContent=String(d.plan?.shots?.length??'—');
  $('stagedetail').textContent=d.events?.length?'Proses terbaru berhasil disimpan.':'Belum ada proses';$('manifest').textContent=JSON.stringify({planHash:d.plan?.planHash,scenes:d.plan?.story?.scenes,shotList:d.plan?.shots,manifest:d.manifest,publish:d.publishing},null,2);
  $('videolink').hidden=!d.render;$('player').hidden=!d.render;if(d.render&&!$('player').getAttribute('src')){$('player').src='/api/demo/final.mp4';}
  if(!d.render){$('player').pause();$('player').removeAttribute('src');$('player').load();}
}
async function refreshSlots(){const d=await api('/api/keys');const target=$('slotlist');target.textContent='';
  for(const [k,v] of Object.entries(d.slots)){const row=document.createElement('div');row.className='slot';const title=document.createElement('strong');title.textContent=k.replace(/_/g,' ').toUpperCase();const status=document.createElement('span');status.textContent=v.configured?'● Configured · encrypted':'○ Not configured';row.append(title,status);target.append(row);}
}
$('login').addEventListener('submit',async(e)=>{e.preventDefault();const secret=$('adminpass').value;try{const d=await api('/api/login',{method:'POST',body:{token:secret}});csrf=d.csrf;$('adminpass').value='';await refresh();notify('Berhasil masuk. Kamu bisa mulai menyiapkan karya.');}catch(err){$('adminpass').value='';notify(`Login failed: ${err.message}`);}});
$('savekey').addEventListener('submit',async(e)=>{e.preventDefault();const secret=$('apikey').value;$('apikey').value='';try{const slot=$('slot').value;await api('/api/keys',{method:'POST',body:{slot,secret}});$('keystatus').textContent=`${slot} saved encrypted; API is NOT tested or activated.`;await refreshSlots();}catch(err){$('keystatus').textContent=`Save failed: ${err.message}`;}});
document.querySelectorAll('[data-run]').forEach(b=>b.addEventListener('click',async()=>{const step=b.dataset.run;try{b.disabled=true;await api(`/api/demo/${step}`,{method:'POST',body:{}});await refreshDemo();notify('Langkah selesai. Lanjutkan ke tahap berikutnya.');}catch(err){notify(`Step ${step}: ${err.message}`);}finally{b.disabled=false;}}));
window.addEventListener('DOMContentLoaded',()=>refresh().catch(e=>notify(`Studio belum dimuat: ${e.message}`)));

// Seedance generation composer. Browser never sees API secrets; all validation is server-side.
let sdCatalog=null,sdAssets=[],sdChosen=[],sdLiveConfiguration=null;
function sdText(id,text){$(id).textContent=text;}
function sdOptions(id,items,value){const el=$(id);const prev=value??el.value;el.replaceChildren();items.forEach(item=>{const o=document.createElement('option');o.value=typeof item==='string'?item:item.id;o.textContent=typeof item==='string'?item:item.label;if(typeof item==='object'){o.disabled=Boolean(item.disabled);if(item.title)o.title=item.title;}el.append(o);});const choices=[...el.options].filter(o=>!o.disabled);if(choices.some(o=>o.value===prev))el.value=prev;else if(choices.length)el.value=choices[0].value;}
function sdCurrent(){const model=sdCatalog?.models.find(m=>m.id===$('sd-model').value);return model;}
function sdMode(){return $('sd-mode').value;}
function sdRevise(){const model=sdCurrent();if(!model)return;
 sdOptions('sd-mode',sdCatalog.modes.map(m=>({...m,disabled:!model.modes.includes(m.id)})),sdMode());
 const mode=sdMode();
 sdChosen=sdChosen.filter(ref=>{const asset=sdAssets.find(a=>a.id===ref.assetId);return asset&&mode!=='text_to_video'&&model[{image:'maxImages',video:'maxVideos',audio:'maxAudios'}[asset.kind]]&&(!['image_to_video','first_last'].includes(mode)||asset.kind==='image');});
 if(mode==='image_to_video')sdChosen=sdChosen.slice(0,1).map(ref=>({...ref,role:'first_frame'}));
 else if(mode==='first_last'){const frames=sdChosen.slice(0,2),first=frames[0]?.role==='last_frame'?'last_frame':'first_frame';sdChosen=frames.map((ref,i)=>({...ref,role:i===0?first:first==='first_frame'?'last_frame':'first_frame'}));}
 else sdChosen=sdChosen.map(ref=>({...ref,role:'reference_'+sdAssets.find(a=>a.id===ref.assetId).kind}));
 sdOptions('sd-ratio',model.ratioOptions,$('sd-ratio').value);
 sdText('sd-ratio-hint','Pilihan rasio mengikuti kontrak model AIIDE.');
 const slider=$('sd-duration'),sourceDuration=model.minDuration===-1;
 slider.min=sourceDuration?-1:Math.max(4,model.minDuration);slider.max=sourceDuration?-1:Math.min(30,model.maxDuration);slider.step=model.durationStep||1;
 slider.value=sourceDuration?-1:Math.max(Number(slider.min),Math.min(Number(slider.max),Number(slider.value)||5));
 slider.disabled=slider.min===slider.max;
 sdText('sd-duration-value',sourceDuration?'Ikuti video sumber':slider.value+' detik');
 sdText('sd-duration-hint',sourceDuration?'Durasi mengikuti sumber.':`Model ini: ${slider.min}–${slider.max} detik. Rentang studio 4–30 detik dibatasi profil provider terverifikasi.`);
 sdOptions('sd-resolution',model.resolutions.map(id=>({id,label:id==='provider_default'?'Mengikuti provider':id})),$('sd-resolution').value);
 $('sd-draft').disabled=true;$('sd-draft').checked=false;$('sd-seed').disabled=true;$('sd-seed').value='';
 $('sd-audio').disabled=!model.supportsAudio;if(!model.supportsAudio)$('sd-audio').checked=false;
 $('sd-watermark').disabled=!model.supportsWatermark;if(!model.supportsWatermark)$('sd-watermark').checked=false;
 sdText('sd-modelhint',`${model.label} · ${model.note||'Profil request dari dokumentasi AIIDE.'} Generate baru memerlukan key valid dan persetujuan biaya.`);
 $('sd-reference-section').hidden=mode==='text_to_video';
 sdRenderAssets();$('sd-live').disabled=!sdCanGenerate(sdLiveConfiguration);
}
const sdReferenceEdits=new Map(),sdReferenceWrites=new Map();
const sdRoles={image:[['first_frame','First frame'],['last_frame','Last frame'],['reference_image','Reference image']],video:[['reference_video','Reference video']],audio:[['reference_audio','Reference audio']]};
function sdTags(){const counts={image:0,audio:0,video:0};return new Map(sdChosen.map(r=>{const a=sdAssets.find(x=>x.id===r.assetId);return [r.assetId,a?'@'+a.kind+(++counts[a.kind]):''];}));}
function sdRemapPromptTags(before){
 const after=sdTags();
 const mapping=new Map([...before].map(([id,tag])=>[tag,after.get(id)||'']));
 $('sd-prompt').value=$('sd-prompt').value.replace(/@(image|audio|video)\d+\b/g,tag=>mapping.has(tag)?mapping.get(tag):tag);
}
function sdRemoveAttachment(id){
 const before=sdTags();
 sdChosen=sdChosen.filter(ref=>ref.assetId!==id);
 sdRemapPromptTags(before);
 sdRenderAssets();sdInvalidate();
}
function sdAttachmentCheck(items){
 const model=sdCurrent(),counts={image:0,video:0,audio:0},seconds={audio:0,video:0};
 for(const a of items){counts[a.kind]++;
  if(a.kind!=='image'){
   if(a.bytes>5*1024*1024)throw Error('Audio/video maksimal 5 MB per file.');
   if(a.kind==='audio'&&a.mime!=='audio/mpeg')throw Error('Audio referensi harus MP3.');
   if(!a.inspected||!Number.isFinite(a.durationSeconds)||a.durationSeconds<=0)throw Error('Durasi belum terbaca. Periksa FFprobe.');
   seconds[a.kind]+=a.durationSeconds;
  }
 }
 if(counts.image>Math.min(10,model.maxImages)||counts.video>model.maxVideos||counts.audio>model.maxAudios)throw Error('Jumlah lampiran melebihi batas model terpilih.');
 if(items.filter(a=>a.kind==='audio').reduce((sum,a)=>sum+a.bytes,0)>5*1024*1024)throw Error('Total ukuran audio maksimal 5 MB.');
 if(seconds.audio>30.001||seconds.video>30.001)throw Error('Total audio atau video maksimal 30 detik.');
 if(['seedance','sora'].includes(model.family)&&seconds.video>15.01)throw Error('Profil model ini membatasi total video referensi hingga 15 detik.');
 if(sdMode()==='image_to_video'&&items.length>1)throw Error('Mode gambar awal hanya menerima satu gambar.');
 if(sdMode()==='first_last'&&items.length>2)throw Error('Mode awal/akhir hanya menerima dua gambar.');
}
function sdAcceptsAsset(asset){
 const model=sdCurrent(),mode=sdMode();
 if(!model||!asset||mode==='text_to_video')return false;
 if(['first_last','image_to_video'].includes(mode)&&asset.kind!=='image')return false;
 if(asset.kind==='audio'&&asset.mime!=='audio/mpeg')return false;
 return model[{image:'maxImages',audio:'maxAudios',video:'maxVideos'}[asset.kind]]>0;
}
function sdAttachAsset(asset){
 if(!sdAcceptsAsset(asset))throw Error('Pilih mode yang mendukung jenis media ini.');
 if(sdChosen.some(ref=>ref.assetId===asset.id))throw Error('Media sudah dilampirkan.');
 sdAttachmentCheck([...sdChosen.map(ref=>sdAssets.find(a=>a.id===ref.assetId)),asset]);
 let role='reference_'+asset.kind;
 if(sdMode()==='image_to_video')role='first_frame';
 if(sdMode()==='first_last')role=sdChosen.some(ref=>ref.role==='first_frame')?'last_frame':'first_frame';
 sdChosen.push({assetId:asset.id,role});
 sdRenderAssets();
 sdInvalidate();
}
function sdRenderLibrary(){
 const term=$('sd-library-search').value.trim().toLowerCase();
 const available=sdAssets.filter(asset=>sdAcceptsAsset(asset)&&asset.name.toLowerCase().includes(term)&&!sdChosen.some(ref=>ref.assetId===asset.id));
 const choices=available.map(asset=>({id:asset.id,label:asset.name+' · '+asset.kind}));
 if(!choices.length)choices.push({id:'',label:term?'Tidak ada media yang cocok':'Belum ada media yang dapat dipilih'});
 sdOptions('sd-library-asset',choices);
 $('sd-library-add').disabled=!available.length||sdUploading;
}
$('sd-library-search').addEventListener('input',sdRenderLibrary);
$('sd-library-add').addEventListener('click',async()=>{
 const id=$('sd-library-asset').value,asset=sdAssets.find(item=>item.id===id);
 if(!asset||sdUploading)return;
 $('sd-library-add').disabled=true;
 try{
  if(!asset.inspected)Object.assign(asset,(await api('/api/seedance/assets/'+id+'/inspect',{method:'POST',body:{}})).asset);
  if(sdAssets.some(item=>item.id===id))sdAttachAsset(asset);
 }catch(e){sdText('sd-upload-status',studioError(e));}
 finally{sdRenderLibrary();}
});
function sdRenderAssets(){
 sdRenderLibrary();
 const target=$('sd-assets'),videoTarget=$('sd-video-assets');target.replaceChildren();videoTarget.replaceChildren();
 const model=sdCurrent(),mode=sdMode(),tags=sdTags(),chosen=sdChosen.map(r=>sdAssets.find(a=>a.id===r.assetId)).filter(Boolean);
 const total=kind=>chosen.filter(a=>a.kind===kind).reduce((sum,a)=>sum+(a.durationSeconds||0),0).toFixed(1);
 sdText('sd-attachment-summary',`${chosen.filter(a=>a.kind==='image').length}/${Math.min(10,model?.maxImages||0)} gambar · Audio ${total('audio')}/30 detik · MP3 total maks. 5 MB · Batas audio model: ${model?.maxAudios||0} file`);
 const frames=['image_to_video','first_last'].includes(mode);
 if(frames)sdText('sd-attachment-summary',chosen.length+' / '+(mode==='first_last'?2:1)+' gambar');
 $('sd-upload').accept=frames||!model?.maxAudios?'image/png,image/jpeg,image/webp':'image/png,image/jpeg,image/webp,audio/mpeg,.mp3';
 document.querySelector('label[for="sd-upload"]').textContent=frames||!model?.maxAudios?'Gambar referensi':'Gambar & audio MP3';
 const videoAllowed=!frames&&!!model?.maxVideos;
 for(const el of [document.querySelector('label[for="sd-video-upload"]'),$('sd-video-upload'),$('sd-video-summary')])el.hidden=!videoAllowed;
 sdText('sd-video-summary',`Video ${total('video')}/${['seedance','sora'].includes(model?.family)?15:30} detik · Maks. 5 MB/file · Batas model: ${model?.maxVideos||0} file`);
 for(const a of chosen){
  const row=document.createElement('article');row.className='reference-row attachment-card';
  const visual=document.createElement('div');visual.className='asset-preview';
  if(a.kind==='image'){const img=document.createElement('img');img.src=`/api/seedance/assets/${a.id}/media`;img.alt=a.name;visual.append(img);}else visual.textContent=a.kind==='video'?'▶':'♫';
  const title=document.createElement('div');title.className='asset-title';const strong=document.createElement('strong');strong.textContent=a.name;const small=document.createElement('small');small.textContent=`${Math.ceil(a.bytes/1024)} KB`+(a.durationSeconds?` · ${a.durationSeconds.toFixed(1)} detik`:'');title.append(strong,small);
  const tag=document.createElement('button');tag.type='button';tag.className='ghost';tag.textContent=tags.get(a.id);tag.onclick=()=>{const prompt=$('sd-prompt');prompt.setRangeText(tag.textContent+' ',prompt.selectionStart,prompt.selectionEnd,'end');prompt.focus();sdInvalidate();};
  const remove=document.createElement('button');remove.type='button';remove.className='ghost';remove.textContent='×';remove.setAttribute('aria-label','Hapus '+tags.get(a.id));remove.onclick=()=>sdRemoveAttachment(a.id);
  row.append(visual,title,tag,remove);
  if(mode==='first_last'){const sel=document.createElement('select');for(const [value,label] of sdRoles.image.slice(0,2)){const op=document.createElement('option');op.value=value;op.textContent=label;sel.append(op);}sel.value=sdChosen.find(r=>r.assetId===a.id).role;sel.onchange=()=>{for(const ref of sdChosen)ref.role=ref.assetId===a.id?sel.value:sel.value==='first_frame'?'last_frame':'first_frame';sdRenderAssets();sdInvalidate();};row.append(sel);}
  const link=document.createElement('div');link.className='attachment-link';const label=document.createElement('label');label.textContent='URL publik aset ini';const field=document.createElement('input');field.type='url';field.value=a.providerReference||'';field.maxLength=2048;field.placeholder='https://...';field.setAttribute('aria-label','URL '+tags.get(a.id));
  const message=document.createElement('small');message.textContent=a.providerReference?'URL tersimpan':'Diperlukan untuk generate live; tes lokal tetap tersedia.';
  const edit=sdReferenceEdits.get(a.id);
  if(edit){field.value=edit.value;message.textContent=edit.message;}
  field.oninput=()=>{
   if(!sdReferenceWrites.has(a.id)&&field.value.trim()===(a.providerReference||'')){
    sdReferenceEdits.delete(a.id);
    message.textContent=a.providerReference?'URL tersimpan':'Diperlukan untuk generate live.';
    return;
   }
   sdReferenceEdits.set(a.id,{value:field.value,message:'Simpan perubahan URL dengan meninggalkan kolom.'});
  };
  field.onchange=async()=>{
   const value=field.value.trim();
   const previous=sdReferenceWrites.get(a.id)||Promise.resolve();
   const entry={value,message:'Menyimpan URL…'};
   sdReferenceEdits.set(a.id,entry);
   message.textContent=entry.message;
   const write=previous.then(async()=>{
    try{
     const result=await api('/api/seedance/assets/'+a.id+'/reference',{method:'POST',body:{reference:value}});
     const cached=sdAssets.find(asset=>asset.id===a.id);
     if(cached)Object.assign(cached,result.asset);
     if(sdReferenceEdits.get(a.id)===entry){
      sdReferenceEdits.delete(a.id);
      message.textContent=value?'URL tersimpan':'URL dilepas';
      sdInvalidate();
     }
    }catch(e){
     entry.message=studioError(e);
     if(sdReferenceEdits.get(a.id)===entry)message.textContent=entry.message;
    }
   });
   sdReferenceWrites.set(a.id,write);
   await write;
   if(sdReferenceWrites.get(a.id)===write)sdReferenceWrites.delete(a.id);
  };
  label.append(field);link.append(label,message);row.append(link);(a.kind==='video'?videoTarget:target).append(row);
 }
}
function sdCanGenerate(live){return !!(live?.enabled&&(live.capabilityVerified||live.credentialVerified)&&live.configured&&live.usedToday<live.maxDaily&&(!live.autoActivation||live.availableModels.includes($('sd-model').value)));}
function videoLiveHelp(live){
 if(live?.activationState==='catalog_not_supported')return 'Key terhubung, tetapi model akun belum memiliki profil request yang didukung engine. Generate tetap terkunci; lihat daftar model melalui Periksa Koneksi.';
 if(!live?.enabled)return live?.autoActivation?'Engine belum siap ('+live.activationState+'). Tambahkan key Video / AIIDE yang valid dan memiliki model video. Uji Mode Lokal tetap tersedia.':'Mode offline: generate berbayar OFF.';
 if(!live?.configured)return 'Akun AIIDE belum terhubung. Periksa Kunci API sebelum membuat video.';
 if(!live.enabled)return 'Video baru belum diaktifkan. Video lama tetap bisa diambil tanpa membuat ulang.';
 if(!(live.capabilityVerified||live.credentialVerified))return 'Izin uji model belum diaktifkan. Konfirmasi model dan biaya pada akun AIIDE dahulu.';
 if(live.usedToday>=live.maxDaily)return 'Batas 1 generate per hari tercapai. Buka hasil yang sudah ada, jangan mengulang.';
 if(live.autoActivation&&!live.availableModels.includes($('sd-model').value))return 'Model ini tidak tersedia pada katalog key terpilih. Pilih model yang tersedia.';
 return 'Key dan katalog siap. Saldo serta keberhasilan generate belum diverifikasi. Konfirmasi biaya diperlukan sebelum mengirim.';
}
async function sdLiveStatus(){return api(sdLiveBase()+'/status');}
let sdPollTimer=null,sdPollBusy=false,sdPollCount=0,sdPollFailures=0;
const sdPollable=new Set(['submitted','queued','running','succeeded','download_pending']);
function sdStopPolling(){if(sdPollTimer!==null)clearTimeout(sdPollTimer);sdPollTimer=null;}
function sdQueuePoll(data){
 sdStopPolling();
 const current=data?.jobs?.find(j=>sdPollable.has(j.status)&&!j.errorCode);
 if(!current||!sdPollable.has(current.status)||current.errorCode||sdPollCount>=150)return;
 // Polling GET on provider through local authenticated /check. NEVER submit another paid task.
 sdPollTimer=setTimeout(async()=>{
  if(sdPollBusy){sdQueuePoll(data);return;}
  if(location.hash!=='#video-studio'){sdPollTimer=setTimeout(()=>sdRenderLiveJobs().catch(()=>{}),9000);return;}
  sdPollBusy=true;
  try{
    sdPollCount++;
    const result=await api(`${sdLiveBase()}/jobs/${current.id}/check`,{method:'POST',body:{}});
    sdPollFailures=0;
    await sdRenderLiveJobs();
    if(result.job.status==='ready')sdText('sd-live-status','Video selesai! Hasil sudah muncul di sebelah kanan.');
  }catch(e){
    sdPollFailures++;
    sdText('sd-live-status',`Menunggu hasil AIIDE: ${e.message}. ${sdPollFailures>=3?'Gunakan Muat ulang jika koneksi sudah normal.':'Mencoba kembali tanpa membuat video baru.'}`);
    if(sdPollFailures<3)sdPollTimer=setTimeout(()=>sdRenderLiveJobs().catch(()=>{}),9000);
  }finally{sdPollBusy=false;}
 },7500);
}
function sdLiveError(error){
 const codes={AIIDE_NO_ACTIVE_KEY:'Tidak ada kunci AIIDE yang aktif.',AIIDE_VIDEO_DISABLED:'Aktifkan izin AIIDE Live di PowerShell.',AIIDE_MODEL_PROFILE_UNVERIFIED:'Model AIIDE belum dikonfirmasi.',AIIDE_ONE_JOB_PER_DAY:'Batas 1 generate hari ini sudah digunakan.',AIIDE_POLL_UNAVAILABLE:'Status AIIDE tidak dapat dibaca. Cek Task ID dan akses akun; jangan generate ulang.',AIIDE_RESULT_HOST_NOT_APPROVED:'Hasil AIIDE tersedia, tetapi alamat unduhan belum disetujui.'};
 return codes[error]||error;
}
async function sdLoad(){
 sdCatalog=await api('/api/aiide-video/catalog');
 $('sd-live').disabled=true;
 sdOptions('sd-model',sdCatalog.models,sdCatalog.models[0].id);
 sdOptions('sd-mode',sdCatalog.modes,'text_to_video');
 $('sd-model').disabled=false;$('sd-mode').disabled=false;
 // Mode availability comes from AIIDE's per-model contract registry.
 ['sd-upload-btn','sd-preview','sd-generate','sd-refresh'].forEach(id=>$(id).disabled=false);
 sdRevise();await sdRefresh();await sdRenderLiveJobs({selectAvailableModel:true});
 if(sdLiveConfiguration?.autoActivation&&sdLiveConfiguration.availableModels.length&&!sdLiveConfiguration.availableModels.includes($('sd-model').value)){$('sd-model').value=sdLiveConfiguration.availableModels[0];sdRevise();sdText('sd-live-status',videoLiveHelp(sdLiveConfiguration));}
}
async function sdRefresh(){
 const [a,j]=await Promise.all([api('/api/seedance/assets'),api('/api/aiide-video/drafts')]);
 historyDrafts=j.jobs;internalPaintHistory();
 const before=sdTags();
 sdAssets=a.assets;
 sdChosen=sdChosen.filter(ref=>sdAssets.some(asset=>asset.id===ref.assetId));
 sdRemapPromptTags(before);
 updatePromptCount('sd-prompt');
 sdRenderAssets();const list=$('sd-jobs');list.replaceChildren();
 for(const item of j.jobs){const line=document.createElement('div');line.className='activity-item';const text=document.createElement('span');text.textContent=`${sdCatalog?.models.find(m=>m.id===item.model)?.label||item.model} · ${item.mode}`;
 const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Buka Draf';button.onclick=()=>sdOpenDraft(item.id);line.append(text,button);list.append(line);}
 if(!j.jobs.length)list.textContent='Belum ada draf video.';
 for(const item of j.legacyJobs||[]){const line=document.createElement('div');line.className='activity-item';const text=document.createElement('span');text.textContent=`Draf versi lama · ${item.model} · ${item.mode}`;const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Unduh Draf Lama';button.onclick=async()=>{try{const data=await api('/api/seedance/jobs/'+item.id),url=URL.createObjectURL(new Blob([JSON.stringify(data.job,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='studio-legacy-draft-'+item.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){sdText('sd-plan-status',studioError(e));}};line.append(text,button);list.append(line);}
 if(typeof internalPaintMedia==='function')internalPaintMedia();
}
async function sdOpenDraft(id){try{
 if($('sd-prompt').value.trim()&&!confirm('Muat draf video? Isian video yang belum disimpan akan diganti.'))return;
 const {job}=await api('/api/aiide-video/drafts/'+id),input=job.request;
 $('sd-model').value=input.model;sdChosen=[];sdRevise();$('sd-mode').value=input.mode;sdChosen=input.assets.map(x=>({...x}));sdRevise();
 for(const [field,value] of Object.entries({'sd-prompt':input.prompt,'sd-prompt-language':input.promptLanguage,'sd-ratio':input.ratio,'sd-resolution':input.resolution,'sd-duration':input.duration}))$(field).value=String(value);
 $('sd-audio').checked=input.generateAudio;$('sd-watermark').checked=input.watermark;sdRevise();openView('video-studio');const missing=input.assets.length-sdChosen.length;
 if(missing){
  const counts={image:0,audio:0,video:0},original=new Map();
  for(const ref of input.assets){
   const kind=ref.role==='reference_audio'?'audio':ref.role==='reference_video'?'video':'image';
   original.set(ref.assetId,'@'+kind+(++counts[kind]));
  }
  sdRemapPromptTags(original);updatePromptCount('sd-prompt');
 }
 sdText('sd-plan-status',missing?missing+' lampiran telah dihapus. Pilih pengganti dan simpan draf baru.':'Draf dipulihkan lengkap. Periksa referensi sebelum melanjutkan.');
 }catch(e){sdText('sd-plan-status',studioError(e));}}
function sdInput(){const seed=$('sd-seed').value.trim();return {model:$('sd-model').value,mode:sdMode(),prompt:$('sd-prompt').value,promptLanguage:$('sd-prompt-language').value,ratio:$('sd-ratio').value,resolution:$('sd-resolution').value,duration:Number($('sd-duration').value),generateAudio:$('sd-audio').checked,watermark:$('sd-watermark').checked,draft:$('sd-draft').checked,...(seed===''?{}:{seed:Number(seed)}),assets:sdChosen.map(x=>({...x}))};}
$('sd-provider').addEventListener('change',async()=>{sdStopPolling();sdPollCount=0;await sdRenderLiveJobs().catch(e=>sdText('sd-live-status',e.message));});
function sdInvalidate(){updatePromptCount('sd-prompt');sdText('sd-plan-status','Pengaturan berubah. Jalankan Uji Mode Lokal atau simpan draf terbaru.');$('sd-request').textContent='';sdText('sd-upload-status',`${sdChosen.length} referensi dipilih.`);}
for(const control of ['sd-model','sd-mode']){
 $(control).addEventListener('change',()=>{
  const before=sdTags();
  sdRevise();
  sdRemapPromptTags(before);
  sdInvalidate();
  sdText('sd-live-status',videoLiveHelp(sdLiveConfiguration));
 });
}
for(const id of ['sd-prompt','sd-prompt-language','sd-duration','sd-resolution','sd-ratio','sd-audio','sd-watermark'])$(id).addEventListener('input',sdInvalidate);
$('sd-draft').addEventListener('change',sdRevise);
$('sd-refresh').addEventListener('click',()=>sdRefresh().catch(e=>sdText('sd-live-status',e.message)));
$('sd-live-refresh').addEventListener('click',async()=>{
 sdPollCount=0;sdPollFailures=0;
 try{const snapshot=await sdLiveStatus();const retry=snapshot.jobs?.find(j=>j.status==='download_pending');
   if(retry){await api(`${sdLiveBase()}/jobs/${retry.id}/check`,{method:'POST',body:{}});}
   await sdRenderLiveJobs();
 }catch(e){sdText('sd-live-status',`Hasil belum tersedia: ${sdLiveError(e.message)}`);}
});
let sdUploading=false;
async function sdUploadAttachments(input){
 if(sdUploading)return;const files=[...input.files];if(!files.length)return;sdUploading=true;
 $('sd-upload').disabled=true;$('sd-video-upload').disabled=true;$('sd-live').disabled=true;
 try{for(const file of files){
  const kind=/\.mp3$/i.test(file.name)?'audio':/\.mp4$/i.test(file.name)?'video':/\.(png|jpe?g|webp)$/i.test(file.name)?'image':null;
  if(!kind||(input.id==='sd-video-upload'?kind!=='video':kind==='video'))throw Error('Pilih gambar/MP3 atau MP4 pada kolom yang sesuai.');
  if(!sdAcceptsAsset({kind,mime:kind==='audio'?'audio/mpeg':file.type}))throw Error('Pilih mode yang mendukung jenis media ini.');
  if(kind!=='image'&&file.size>5*1024*1024)throw Error('Audio/video maksimal 5 MB per file.');
  const response=await fetch('/api/seedance/assets',{method:'POST',headers:{'content-type':'application/octet-stream','x-dramasaku-csrf':csrf,'x-asset-name':encodeURIComponent(file.name)},credentials:'same-origin',body:file});const data=await response.json();if(!response.ok)throw Error(data.error||'Upload gagal');
  const {asset}=await api(`/api/seedance/assets/${data.asset.id}/inspect`,{method:'POST',body:{}});
  sdAssets.unshift(asset);
  sdAttachAsset(asset);
 }sdText('sd-upload-status','Lampiran siap. Tag otomatis tersedia; isi URL publik aset untuk live.');
 }catch(e){sdText('sd-upload-status',studioError(e));}
 finally{input.value='';sdUploading=false;sdRenderLibrary();$('sd-upload').disabled=false;$('sd-video-upload').disabled=false;$('sd-live').disabled=!sdCanGenerate(sdLiveConfiguration);}
}
$('sd-upload').addEventListener('change',()=>sdUploadAttachments($('sd-upload')));
$('sd-video-upload').addEventListener('change',()=>sdUploadAttachments($('sd-video-upload')));
$('sd-upload-btn').addEventListener('click',()=>sdUploadAttachments($('sd-upload')));
$('sd-duration').addEventListener('input',()=>sdText('sd-duration-value',$('sd-duration').value+' detik'));
$('sd-preview').addEventListener('click',async()=>{try{await api('/api/aiide-video/preview',{method:'POST',body:sdInput()});sdText('sd-plan-status','Pengaturan sesuai untuk draf lokal. Tidak ada request provider.');}catch(e){sdText('sd-plan-status',e.message);}});
$('sd-generate').addEventListener('click',async()=>{try{await api('/api/aiide-video/drafts',{method:'POST',body:sdInput()});await sdRefresh();sdText('sd-plan-status','Draf video tersimpan lengkap.');if(typeof internalReload==='function')await internalReload();}catch(e){sdText('sd-plan-status',studioError(e));}});
$('sd-live').addEventListener('click',async()=>{
 const button=$('sd-live');button.disabled=true;let submitError=null;
 try{
  if(sdUploading){submitError='Tunggu lampiran selesai diperiksa.';return;}
  await Promise.all(sdChosen.map(ref=>sdReferenceWrites.get(ref.assetId)));
  if(sdChosen.some(ref=>sdReferenceEdits.has(ref.assetId))){
   submitError='Periksa dan simpan URL publik yang diubah sebelum generate.';return;
  }
  sdAttachmentCheck(sdChosen.map(r=>sdAssets.find(a=>a.id===r.assetId)));
  const live=await sdLiveStatus();sdLiveConfiguration=live;
  if(!sdCanGenerate(live)){sdText('sd-live-status',videoLiveHelp(live));return;}
  const input=sdInput();
  const plan=await api('/api/aiide-video/preview',{method:'POST',body:input});
  if(plan.missingReferences.length){submitError='Pasangkan setiap lampiran dengan URL publik aset yang sama sebelum generate.';return;}
  if(!confirm('Kirim SATU permintaan video berbayar melalui AIIDE? Biaya mengikuti penyedia. Jika status tidak pasti, jangan mengirim ulang.'))return;
  const res=await api(sdLiveBase()+'/submit',{method:'POST',body:{input,expectedRequestHash:plan.requestHash,consent:'I_ACCEPT_PROVIDER_CHARGES'}});
  sdPollCount=0;sdPollFailures=0;
  sdText('sd-live-status',res.job.status==='submission_unknown'?'Pengiriman belum pasti. Cek Task Logs AIIDE sebelum mengulang.':'Video sedang dibuat. Hasil akan muncul otomatis di kanan.');
  await sdRenderLiveJobs();
 }catch(e){submitError=`Belum dapat membuat video: ${sdLiveError(e.message)}`;}
 finally{await sdRenderLiveJobs().catch(()=>{button.disabled=true;});if(submitError)sdText('sd-live-status',submitError);}
});
$('sd-import-button').addEventListener('click',async()=>{
 const button=$('sd-import-button'),providerTaskId=$('sd-import-task').value.trim(),keyId=$('sd-import-account').value;
 if(!providerTaskId){sdText('sd-import-status','Isi Task ID AIIDE.');return;}
 button.disabled=true;
 try{
  const res=await api('/api/aiide-video/import',{method:'POST',body:{providerTaskId,keyId}});
  sdPollCount=0;sdPollFailures=0;
  sdText('sd-import-status',res.job.status==='ready'?'Video berhasil diambil.':res.job.status==='download_pending'?'Video tersedia, tetapi unduhannya perlu diperiksa.':'Video ditemukan. Menunggu hasil...');
  await sdRenderLiveJobs();
 }catch(e){sdText('sd-import-status',`Gagal mengambil video: ${sdLiveError(e.message)}`);}
 finally{button.disabled=false;}
});
function sdShowPlayer(job){
 const player=$('sd-live-player'),download=$('sd-video-download');
 if(job){const url=`${sdLiveBase()}/jobs/${job.id}/media`;
   if(player.getAttribute('src')!==url){player.src=url;player.load();}
   player.hidden=false;$('sd-viewer-icon').hidden=true;
   download.href=url;download.hidden=false;
   sdText('sd-viewer-note','Video siap diputar dan diunduh.');sdText('sd-viewer-tag','Selesai');
 }else{player.pause();player.hidden=true;player.removeAttribute('src');player.load();download.hidden=true;$('sd-viewer-icon').hidden=false;}
}
async function sdRenderLiveJobs({selectAvailableModel=false}={}){
 const data=await sdLiveStatus();sdLiveConfiguration=data;
 if(selectAvailableModel&&data.autoActivation&&data.availableModels?.length&&!data.availableModels.includes($('sd-model').value)){
  const model=data.availableModels.find(id=>Array.from($('sd-model').options).some(o=>o.value===id));
  if(model){$('sd-model').value=model;sdRevise();}
 }
 $('sd-live').disabled=!sdCanGenerate(data);
 const recovery=$('sd-aiide-recovery');recovery.hidden=!sdIsAiide();
 const account=$('sd-import-account'),selected=account.value;account.replaceChildren();
 const options=data.availableAccounts||[];
 for(const item of options){const op=document.createElement('option');op.value=item.id;op.textContent=item.label;account.append(op);}
 if(options.some(o=>o.id===selected))account.value=selected;
 $('sd-import-button').disabled=!data.readOnlyEnabled||!options.length;
 sdText('sd-import-status',!options.length?'Tidak ada akun AIIDE aktif. Cek Pengaturan Kunci API.':!data.readOnlyEnabled?'Pengambilan video lama belum diaktifkan oleh pengelola Studio.':'Masukkan Task ID dari AIIDE jika videonya sudah pernah dibuat.');
 sdText('sd-live-status',videoLiveHelp(data));
 if(typeof internalPaintHistory==='function')internalPaintHistory();
 const list=$('sd-live-jobs');list.replaceChildren();
 const jobs=data.jobs||[];
 const ready=jobs.find(j=>j.status==='ready');sdShowPlayer(ready);
 const current=jobs.find(j=>sdPollable.has(j.status)&&!j.errorCode);
 if(current){sdText('sd-viewer-tag',current.status==='download_pending'?'Mengunduh hasil...':'Membuat video...');if(!ready)sdText('sd-viewer-note','Sedang diproses. Hasil muncul otomatis.');}
 if(!jobs.length){const p=document.createElement('p');p.className='hint';p.textContent='Belum ada hasil video.';list.append(p);}
 for(const j of jobs.slice(0,6)){
  const row=document.createElement('div');row.className='simple-job-row';const text=document.createElement('span');
  text.textContent=j.status==='ready'?'✓ Video selesai':j.status==='submission_unknown'?'⚠ Cek tugas di AIIDE':j.status==='download_pending'?'Unduhan belum tersedia':j.status==='running'?'Sedang membuat video':j.status==='submitted'||j.status==='queued'?'Dalam antrean':j.status;
  row.append(text);
  if(j.status==='ready'){const btn=document.createElement('button');btn.type='button';btn.className='ghost';btn.textContent='Lihat hasil';btn.onclick=()=>sdShowPlayer(j);row.append(btn);const attach=document.createElement('button');attach.type='button';attach.className='ghost';attach.textContent='Tambahkan ke Proyek';attach.onclick=async()=>{attach.disabled=true;try{await api(`/api/aiide-video/jobs/${j.id}/attach`,{method:'POST',body:{}});await sdRefresh();await internalReload();sdText('sd-live-status','Video tersimpan di proyek. Tinjau pada Persetujuan sebelum render.');}catch(e){sdText('sd-live-status',studioError(e));}finally{attach.disabled=false;}};row.append(attach);}
  else if(j.status==='download_pending'&&j.errorCode){const desc=document.createElement('small');desc.textContent=j.errorCode==='AIIDE_RESULT_HOST_NOT_APPROVED'?`Alamat hasil ${j.resultHost||''} belum diizinkan; verifikasi domain CDN sebelum mengaktifkan unduhan.`:sdLiveError(j.errorCode);row.append(desc);}
  else if(j.status==='submission_unknown'){const desc=document.createElement('small');desc.textContent='Cek Task Logs di AIIDE; jangan klik Generate lagi.';row.append(desc);}
  list.append(row);
 }
 sdQueuePoll(data);
}

// CP-011: unified single-UI navigation. No second preview app or server needed.
const pageMeta={
 'overview':['Beranda','Buat cerita, gambar, video, dan kelola karya dalam satu tempat.'],
 'projects':['Proyek & Cerita','Tulis ide dan siapkan cerita berikutnya.'],
 'storyboard':['Storyboard & Karakter','Susun karakter, adegan, dan arahan visual.'],
 'image-studio':['Studio Gambar','Siapkan ide dan referensi visual.'],
 'video-studio':['Buat Video AI','Pilih model dan siapkan video.'],
 'motion-studio':['Studio Gerak','Beri gerakan pada gambar dan cuplikan.'],
 'voice-studio':['Studio Suara','Rencanakan dialog dan narasi.'],
 'film-studio':['Studio Film','Tinjau dan lihat hasil video.'],
 'workflow':['Alur Produksi','Ikuti tahap pembuatan karya.'],
 'approvals':['Persetujuan Karya','Tinjau hasil sebelum melanjutkan.'],
 'history':['Riwayat Karya','Lihat aktivitas dan draf terbaru.'],
 'credentials':['Pengaturan Kunci API','Kelola layanan AI untuk tim.'],
 'audit':['Status Studio','Lihat fitur yang siap digunakan.'],
 'assets':['Aset','Kelola media lokal untuk produksi.'],
 'team-password':['Ganti Password','Kelola password tim pada perangkat ini.'],
 'help':['Panduan & Ketentuan','Pelajari cara menggunakan Dramasaku.']
};
function navigate(view){
 if(!pageMeta[view])view='overview';
 for(const el of document.querySelectorAll('.view-section'))el.classList.toggle('is-active',el.id===view);
 for(const link of document.querySelectorAll('.sidebar nav [data-view]')){
   const chosen=link.dataset.view===view;link.classList.toggle('selected',chosen);
   if(chosen)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
 }
 $('page-title').textContent=pageMeta[view][0];$('page-subtitle').textContent=pageMeta[view][1];
 document.title=`${pageMeta[view][0]} | Dramasaku Studio`;
 if(view==='video-studio')updatePromptCount('sd-prompt');
 if(view==='image-studio')updatePromptCount('image-prompt');
 window.scrollTo?.({top:0,behavior:'auto'});
}
function openView(view){location.hash=view;if(location.hash==='#'+view)navigate(view);}
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>openView(b.dataset.go)));
navigate(location.hash.slice(1));

let activeWorkspace=null,savedWorkspaceHash=null;
function workspaceInput(){
 const characters=$('project-characters').value.trim().split(/\r?\n/).filter(Boolean).map(row=>{
   const parts=row.split('|').map(x=>x.trim());if(parts.length!==3||parts.some(x=>!x))throw Error('Each character must be: NAME | appearance | wardrobe');
   return {name:parts[0],appearance:parts[1],wardrobe:parts[2]};
 });
 return {projectName:$('project-name').value,screenplay:$('project-story').value,visualStyle:$('project-style').value,characters,shotsPerScene:Number($('project-shots').value),durationSec:Number($('project-duration').value)};
}
function workspaceSummary(metric,label){const div=document.createElement('div');div.className='metric-mini';const strong=document.createElement('strong');strong.textContent=String(metric);const small=document.createElement('small');small.textContent=label;div.append(strong,small);return div;}
function updatePromptCount(id){
 $(id+'-count').textContent=$(id).value.length+' / '+$(id).maxLength;
}
for(const button of document.querySelectorAll('[data-expand-prompt]')){
 const id=button.dataset.expandPrompt;
 $(id).addEventListener('input',()=>updatePromptCount(id));
 button.addEventListener('click',()=>{
  const expanded=$(id).classList.toggle('prompt-expanded');
  button.setAttribute('aria-expanded',String(expanded));
  button.textContent=expanded?'Ringkas tampilan':'Perluas prompt';
  $(id).focus();
 });
}
function transferVideoPrompt(prompt,statusId){
 const max=sdCatalog?.promptMaxChars??4000;
 if(!prompt.trim()||prompt.length>max){sdText(statusId,`Prompt video perlu 1–${max} karakter. Ringkas prompt sebelum melanjutkan.`);return false;}
 $('sd-prompt').value=prompt;openView('video-studio');sdText('sd-plan-status','Prompt shot sudah dimuat. Naskah proyek tetap tersimpan.');return true;
}
function createStoryboardPromptEditor(prompt,shotId){
 const max=sdCatalog?.promptMaxChars??4000;
 const container=document.createElement('div');
 const label=document.createElement('label');label.textContent=`Prompt shot · ${shotId}`;
 const editor=document.createElement('textarea');editor.className='full-textarea';editor.rows=6;editor.value=prompt;editor.setAttribute('aria-label',`Prompt video ${shotId}`);
 const counter=document.createElement('p');counter.className='hint';counter.setAttribute('role','status');
 const button=document.createElement('button');button.type='button';button.className='ghost';button.textContent='Gunakan untuk Video →';
 const update=()=>{
  const valid=editor.value.trim().length>0&&editor.value.length<=max;
  button.disabled=!valid;imageButton.disabled=!valid;
  counter.textContent=`${editor.value.length}/${max} karakter. `+(editor.value.length>max?'Ringkas prompt shot ini sebelum melanjutkan. Pertahankan dialog dan identitas karakter.':'Periksa prompt sebelum melanjutkan.');
  editor.setAttribute('aria-invalid',String(!valid));
 };
 editor.addEventListener('input',update);
 button.addEventListener('click',()=>{
  update();if(button.disabled)return;
  transferVideoPrompt(editor.value,'project-status');
 });
 const imageButton=document.createElement('button');imageButton.type='button';imageButton.className='ghost';imageButton.textContent='Gunakan untuk Gambar';
 imageButton.addEventListener('click',()=>{
  if(imageButton.disabled)return;
  const field=$('image-prompt');
  if(field.value.trim()&&field.value!==editor.value&&!confirm('Ganti deskripsi gambar yang sedang terbuka dengan prompt shot ini?'))return;
  field.value=editor.value;$('image-shot').value=shotId;openView('image-studio');
  sdText('image-status','Deskripsi dari '+shotId+' siap disunting.');
 });
 const note=document.createElement('small');note.textContent='Simpan draf di studio tujuan untuk memakai prompt ini kembali.';
 label.append(editor);container.append(label,counter,button,imageButton,note);update();
 return container;
}
function renderWorkspace(w){
 activeWorkspace=w;
 if(w)$('shots').textContent=String(w.plan.shots.length);
 const sm=$('storyboard-summary'),shots=$('storyboard-shots');sm.replaceChildren();shots.replaceChildren();
 if(!w){const p=document.createElement('p');p.className='hint';p.textContent='Belum ada storyboard. Siapkan cerita dahulu.';sm.append(p);return;}
 sm.append(workspaceSummary(w.story.scenes.length,'Adegan'),workspaceSummary(w.plan.shots.length,'Shot'),workspaceSummary(w.dna.characters.length,'Karakter'));
 const canon=$('storyboard-canon');canon.replaceChildren();
 const title=document.createElement('summary');title.textContent='Karakter dan gaya visual';canon.append(title);
 const style=document.createElement('p');style.textContent=w.input.visualStyle;canon.append(style);
 for(const character of w.input.characters){
  const line=document.createElement('p');line.textContent=[character.name,character.appearance,character.wardrobe].join(' · ');canon.append(line);
 }
 canon.hidden=false;
 const result=w.plan.shots;
 for(const shot of result){
  const card=document.createElement('article');card.className='shot-card';const meta=document.createElement('div');meta.className='meta';meta.textContent=`${shot.sceneId} · Shot ${shot.sequence} · ${shot.durationSec}s · ${shot.framing}`;
  const heading=document.createElement('h3');heading.textContent=shot.id;
  const desc=document.createElement('p');desc.textContent=shot.description;
  const editor=createStoryboardPromptEditor(w.prompts.find(p=>p.shotId===shot.id)?.prompt||'',shot.id);
  card.append(meta,heading,desc,editor);shots.append(card);
 }
 $('workspace-json').textContent=JSON.stringify({project:w.input.projectName,dna:w.dna,story:w.story,plan:{hash:w.plan.planHash,shots:w.plan.shots,nodes:w.plan.nodes,edges:w.plan.edges}},null,2);
}
async function loadWorkspace(){const data=await api('/api/workspace');savedWorkspaceHash=data.currentInputHash??null;if(!data.saved?.workspace){$('project-status').textContent='Belum ada cerita tersimpan. Lengkapi isian lalu simpan proyek.';return;}
 const w=data.saved.workspace,i=w.input;
 $('project-name').value=i.projectName;$('project-story').value=i.screenplay;$('project-style').value=i.visualStyle;
 $('project-characters').value=i.characters.map(c=>`${c.name} | ${c.appearance} | ${c.wardrobe}`).join('\n');$('project-shots').value=String(i.shotsPerScene);$('project-duration').value=String(i.durationSec);
 renderWorkspace(w);$('project-status').textContent='Cerita tersimpan di perangkat ini.';
}
async function workAction(save){try{
 const data=await api(save?'/api/workspace/save':'/api/workspace/preview',{method:'POST',body:save?{...workspaceInput(),expectedCurrentInputHash:savedWorkspaceHash}:workspaceInput()});
 if(save){savedWorkspaceHash=data.currentInputHash;$('project-reload').hidden=true;}
 const w=save?data.workspace:data;renderWorkspace(w);
 if(save)await sdRefresh();if(typeof internalReload==='function')await internalReload();
 $('project-status').textContent=`${save?'Cerita tersimpan':'Cerita siap'} · ${w.story.scenes.length} adegan, ${w.plan.shots.length} shot.`;
 openView('storyboard');
 }catch(e){
  if(e.message==='PROJECT_CHANGED_RELOAD'){$('project-status').textContent='Cerita sudah berubah di tab lain. Salin perubahanmu sebelum memuat versi terbaru.';$('project-reload').hidden=false;}
  else $('project-status').textContent='Cerita belum bisa diproses. Periksa nama karakter, dialog, dan isian wajib.';
 }
}
$('project-reload').addEventListener('click',async()=>{
 if(!confirm('Muat cerita terbaru? Isian yang belum disimpan akan diganti. Salin perubahanmu terlebih dahulu.'))return;
 try{await loadWorkspace();$('project-reload').hidden=true;}catch(e){$('project-status').textContent='Cerita terbaru belum dapat dimuat. Isianmu tetap tersedia.';}
});
$('project-preview').addEventListener('click',()=>workAction(false));
$('storyboard-generate').addEventListener('click',()=>workAction(false));
$('workspace-form').addEventListener('submit',e=>{e.preventDefault();workAction(true);});
// Project portability: creative plan only. Never exports keys, job history or media.
$('project-export').addEventListener('click',async()=>{
 try{
  const r=await fetch('/api/workspace/export',{credentials:'same-origin',cache:'no-store'});
  if(!r.ok)throw Error('PROJECT_EXPORT_UNAVAILABLE');
  const blob=await r.blob(),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download='dramasaku-proyek.json';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  $('project-status').textContent='Cerita berhasil disiapkan untuk dipindahkan. File ini belum menyertakan video atau audio.';
 }catch(e){$('project-status').textContent='Simpan cerita dahulu, lalu coba ekspor lagi.';}
});
$('project-import').addEventListener('click',()=>$('project-import-file').click());
$('project-import-file').addEventListener('change',async()=>{
 const file=$('project-import-file').files?.[0];if(!file)return;
 try{
  if(file.size>85_000)throw Error('FILE_TOO_LARGE');
  const project=JSON.parse(await file.text());
  const latest=await api('/api/workspace');
  const current=latest.currentInputHash??null;
  if(current&&!confirm('Impor cerita akan menggantikan cerita aktif di perangkat ini. Lanjutkan?'))return;
  await api('/api/workspace/import',{method:'POST',body:{project,replace:!!current,expectedCurrentInputHash:current}});
  await loadWorkspace();sdChosen=[];await sdRefresh();if(typeof internalReload==='function')await internalReload();$('project-status').textContent='Cerita berhasil diimpor. Periksa sebelum melanjutkan.';
 }catch(e){$('project-status').textContent='File cerita tidak sesuai atau sudah berubah. Tidak ada data yang diganti.';}
 finally{$('project-import-file').value='';}
});
// Enable project actions once a real local operator session exists (not before authentication).
const originalRefresh=refresh;
refresh=async function(){await originalRefresh();const s=await api('/api/session');if(s.authenticated){$('project-preview').disabled=false;$('project-save').disabled=false;$('project-export').disabled=false;$('project-import').disabled=false;$('image-generate').disabled=false;$('motion-generate').disabled=false;$('storyboard-generate').disabled=false;await loadWorkspace();}};
$('image-from-plan').addEventListener('click',()=>{
 const p=activeWorkspace?.prompts?.find(p=>p.shotId===$('image-shot').value)||activeWorkspace?.prompts?.[0];if(!p){$('image-status').textContent='Prepare a project in Projects & Story first.';return;}
 $('image-prompt').value=p.prompt;$('image-shot').value=p.shotId;updatePromptCount('image-prompt');$('image-status').textContent='Deskripsi dari '+p.shotId+' siap disunting.';
});
$('image-to-video').addEventListener('click',()=>{transferVideoPrompt($('image-prompt').value,'image-status');});
// CP-012: Two independent encrypted key groups, with provider-aware dry-run routing.
let keyPoolData=null;
async function keyPoolsLoad(){
 keyPoolData=await api('/api/key-pools');
 const target=$('pool-list');target.replaceChildren();
 const entries=keyPoolData.pools.flatMap(p=>p.keys);
 if(!entries.length){const p=document.createElement('p');p.className='hint';p.textContent='Belum ada kunci. Tambahkan kunci untuk mulai mengatur layanan.';target.append(p);}
 for(const key of entries){
  const card=document.createElement('article');card.className='key-item';
  const info=document.createElement('div');
  const title=document.createElement('strong');title.textContent=key.label;
  const sub=document.createElement('small');sub.textContent=`${key.group==='creative'?'Teks & Gambar':'Video'} · ${key.provider.toUpperCase()} · Sisa lokal: ${key.remaining}/${key.dailyLimit} permintaan`;
  info.append(title,sub);
  const actions=document.createElement('div');actions.className='key-item-actions';
  const pill=document.createElement('span');pill.className='pill subtle';pill.textContent=key.enabled?'Aktif':'Nonaktif';
  const toggle=document.createElement('button');toggle.className='ghost';toggle.type='button';toggle.textContent=key.enabled?'Matikan':'Aktifkan';
  toggle.addEventListener('click',async()=>{try{await api('/api/key-pools/update',{method:'POST',body:{id:key.id,enabled:!key.enabled}});await keyPoolsLoad();await sdRenderLiveJobs();}catch(e){$('pool-message').textContent=e.message;}});
  const remove=document.createElement('button');remove.className='ghost danger';remove.type='button';remove.textContent='Hapus';
  remove.addEventListener('click',async()=>{if(!confirm(`Hapus kunci "${key.label}"?`))return;try{await api(`/api/key-pools/${key.id}`,{method:'DELETE'});await keyPoolsLoad();await sdRenderLiveJobs();}catch(e){$('pool-message').textContent=e.message;}});
  if(['aiide','google','openai'].includes(key.provider)){
   if(key.provider==='aiide'&&key.group==='creative'){const move=document.createElement('button');move.type='button';move.className='ghost';move.textContent='Pindahkan ke Video';move.onclick=async()=>{move.disabled=true;try{await api('/api/key-pools/move-to-video',{method:'POST',body:{keyId:key.id}});await keyPoolsLoad();await sdRenderLiveJobs();$('pool-message').textContent=videoLiveHelp(sdLiveConfiguration);}catch(e){$('pool-message').textContent=e.message;move.disabled=false;}};actions.append(move);}
   const check=document.createElement('button');check.className='ghost';check.type='button';check.textContent='Periksa Koneksi';check.disabled=!key.enabled;
   check.addEventListener('click',async()=>{
    check.disabled=true;$('pool-message').textContent='Memeriksa katalog provider...';
    try{const result=await api('/api/key-pools/test',{method:'POST',body:{keyId:key.id}});
     $('pool-message').textContent=result.state==='connected'&&key.provider!=='aiide'?key.provider+' terhubung. Model terbaca: '+result.modelCount:result.state==='connected'?`Koneksi AIIDE terbaca. ${result.modelCount} model tersedia; ${result.matchingVideoModels.length} cocok dengan katalog video engine. Model akun: ${(result.modelIds||[]).join(', ')}. ${key.group==='creative'?'Key ini berada di Teks & Gambar; gunakan Pindahkan ke Video untuk routing video.':''} ${result.matchingVideoModels.length?'Profil video cocok; kesiapan mengikuti kelompok dan kuota.':'Profil video belum cocok; generate tetap terkunci.'} Saldo dan keberhasilan generate belum diverifikasi.`:result.state==='rejected'?'Key ditolak atau tidak memiliki izin membaca katalog. Generate tetap nonaktif.':'Penyedia membatasi request. Tunggu sebelum memeriksa lagi; tidak ada generate baru.';
    }catch(e){const message={KEY_CHECK_COOLDOWN:'Tunggu 30 detik sebelum memeriksa key yang sama.',KEY_CHECK_UNAVAILABLE:'Koneksi provider belum dapat diperiksa. Key tidak dinyatakan valid atau gagal.',KEY_CHECK_REDIRECT_REFUSED:'Penyedia mengalihkan alamat. Pemeriksaan dihentikan agar key tidak dikirim ke host lain.'};$('pool-message').textContent=message[e.message]||'Pemeriksaan belum berhasil. Tidak ada generate yang dijalankan.';}
    finally{check.disabled=!key.enabled;await sdRenderLiveJobs();}
   });actions.append(check);
  }
  actions.append(pill,toggle,remove);card.append(info,actions);target.append(card);
 }
 const group=$('pool-preview-group').value,policy=keyPoolData.pools.find(p=>p.id===group);
 if(policy)$('pool-strategy').value=policy.strategy;
 window.DramasakuLang?.apply();
}
$('keypool-form').addEventListener('submit',async(event)=>{
 event.preventDefault();const submitButton=event.currentTarget.querySelector('button[type=submit]');if(submitButton.disabled)return;submitButton.disabled=true;$('pool-message').textContent='Menyimpan dan memeriksa key...';const secret=$('pool-secret').value.trim();
 const body=$('pool-advanced').open?{group:$('pool-group').value,provider:$('pool-provider').value,
   label:$('pool-label').value.trim()||$('pool-provider').value.toUpperCase()+' '+($('pool-group').value==='video'?'Video':'Creative'),secret,dailyLimit:Number($('pool-limit').value),priority:Number($('pool-priority').value),enabled:true}:{secret,...($('quick-provider').value?{provider:$('quick-provider').value}:{})};
 let saved=false;
 try{const result=await api('/api/key-pools',{method:'POST',body});saved=true;$('pool-secret').value='';$('quick-provider').value='';$('quick-choice').hidden=true;
  $('pool-label').value='';await keyPoolsLoad();await sdRenderLiveJobs({selectAvailableModel:true});
  const connection=result.connection;
  const diagnosis=!connection?'Penyedia ini belum memiliki pemeriksaan otomatis.':connection.state==='connected'&&result.key.provider!=='aiide'?result.key.provider+' terhubung. Model terbaca: '+connection.modelCount+'.':connection.state==='connected'?`Koneksi AIIDE terbaca: ${connection.matchingVideoModels.length} model video didukung.`:connection.state==='rejected'?'Key ditolak penyedia. Periksa atau ganti key.':connection.state==='rate_limited'?'Penyedia membatasi pemeriksaan. Coba Periksa Koneksi nanti.':'Koneksi belum dapat diverifikasi. Coba Periksa Koneksi nanti.';
  $('pool-message').textContent='Key tersimpan. '+diagnosis+' '+(result.key.group==='video'&&result.key.provider==='aiide'?videoLiveHelp(sdLiveConfiguration):'Belum ada generate yang dikirim.');
 }catch(e){if(e.message==='KEY_PROVIDER_REQUIRED'){
   $('quick-choice').hidden=false;$('quick-provider').focus();$('pool-message').textContent='Pilih penerbit key lalu klik Tambahkan Kunci. Key masih di perangkat ini.';return;
  }$('pool-message').textContent=saved?'Key sudah tersimpan; status belum dapat dimuat. Klik Muat ulang.':`Gagal menyimpan: ${e.message}`;}finally{submitButton.disabled=false;}
});
$('pool-group').addEventListener('change',()=>{$('pool-provider').value='aiide';});
$('pool-preview-group').addEventListener('change',()=>{
 $('pool-preview-provider').value='aiide';
 const policy=keyPoolData?.pools.find(p=>p.id===$('pool-preview-group').value);
 if(policy)$('pool-strategy').value=policy.strategy;
});
$('pool-policy-save').addEventListener('click',async()=>{
 try{await api('/api/key-pools/policy',{method:'POST',body:{group:$('pool-preview-group').value,strategy:$('pool-strategy').value}});
 $('pool-preview-result').textContent='Aturan pemilihan kunci berhasil disimpan.';await keyPoolsLoad();
 }catch(e){$('pool-preview-result').textContent=e.message;}
});
$('pool-check').addEventListener('click',async()=>{
 try{const data=await api('/api/key-pools/preview',{method:'POST',body:{group:$('pool-preview-group').value,provider:$('pool-preview-provider').value}});
 $('pool-preview-result').textContent=data.selected?`Pilihan: ${data.selected.label} (${data.selected.remaining} permintaan lokal tersisa). Ini hanya simulasi.`:'Belum ada kunci aktif dengan kuota lokal untuk penyedia tersebut.';
 }catch(e){$('pool-preview-result').textContent=e.message;}
});
$('pool-reload').addEventListener('click',()=>keyPoolsLoad().catch(e=>{$('pool-message').textContent=e.message;}));

function publicEventLabel(text){
 if(text.startsWith('Story +'))return 'Rencana karya disiapkan';
 if(text.startsWith('Demo plan'))return 'Rencana ditinjau';
 if(text.includes('takes selected'))return 'Hasil dipilih';
 if(text.startsWith('Approved asset'))return 'Paket karya disiapkan';
 if(text.startsWith('Rendered'))return 'Video contoh siap diputar';
 if(text.startsWith('Publishing'))return 'Simulasi publikasi selesai';
 return 'Aktivitas karya diperbarui';
}

// CP-014: TTS Studio — independent credential, backend validation and optional one-shot paid speech.
// AIIDE voice support is held until its speech endpoint is explicitly verified; never infer it from chat models.
let ttsLastReady=null;
function ttsInput(){return {provider:$('tts-provider').value,language:$('tts-language').value,voice:$('tts-voice').value,speed:Number($('tts-speed').value),text:$('tts-text').value};}
function ttsMessage(message){$('tts-message').textContent=message;}
async function ttsLoad(){
 const data=await api('/api/tts/status');const provider=$('tts-provider').value;
 const configuration=data.providers.find(p=>p.id===provider);
 $('tts-generate').hidden=false;
 $('tts-generate').disabled=false;
 $('tts-output-note').textContent=configuration?.liveAvailable&&configuration?.configured?'Hasil suara akan muncul setelah berhasil dibuat.':'Hasilkan Suara membutuhkan penyedia TTS aktif dan kunci yang sesuai.';
 $('tts-key-message').textContent=configuration?.configured?'Kunci TTS tersimpan. Tidak ditampilkan kembali.':'Belum ada kunci untuk penyedia suara ini.';
 const container=$('tts-history');container.replaceChildren();
 if(!data.jobs.length){const p=document.createElement('p');p.className='hint';p.textContent='Belum ada narasi tersimpan.';container.append(p);return;}
 for(const job of data.jobs){
   const card=document.createElement('div');card.className='sd-job';
   const label=document.createElement('strong');label.textContent=`${job.provider.toUpperCase()} · ${job.voice} · ${job.characters} karakter`;
   const meta=document.createElement('small');meta.textContent=`${job.createdAt} · ${job.status}`;
   card.append(label,meta);
   if(job.status==='draft'){
    if(job.draftAvailable){const btn=document.createElement('button');btn.className='ghost';btn.textContent='Buka Draf';btn.type='button';btn.addEventListener('click',()=>ttsOpenDraft(job.id).catch(()=>ttsMessage('Draf belum dapat dibuka. Isianmu tetap tersedia.')));card.append(btn);}
    else{const note=document.createElement('small');note.textContent='Draf versi lama tidak menyimpan teks narasi.';card.append(note);}
   }
   if(job.status==='ready'){
    const btn=document.createElement('button');btn.className='ghost';btn.textContent='Dengarkan';btn.type='button';
    btn.addEventListener('click',()=>ttsShowAudio(job.id));card.append(btn);
   }
   container.append(card);
 }
}
async function ttsOpenDraft(id){
 const {draft}=await api(`/api/tts/jobs/${id}/draft`);
 if($('tts-text').value.trim()&&$('tts-text').value!==draft.input.text&&!confirm('Buka draf ini? Narasi yang belum disimpan akan diganti.'))return;
 $('tts-provider').value=draft.input.provider;$('tts-language').value=draft.input.language;
 $('tts-voice').value=draft.input.voice;$('tts-speed').value=String(draft.input.speed);$('tts-text').value=draft.input.text;
 await ttsLoad();ttsMessage('Draf suara dimuat. Periksa narasi sebelum melanjutkan.');
}
function ttsShowAudio(id){
 ttsLastReady=id;const url=`/api/tts/jobs/${id}/audio`;
 const player=$('tts-player');player.src=url;player.hidden=false;player.load();
 $('tts-download').href=url;$('tts-download').hidden=false;$('tts-attach').hidden=false;
 $('tts-output-note').textContent='Audio tersedia. Dengarkan sebelum digunakan sebagai narasi.';
}
$('tts-provider').addEventListener('change',()=>ttsLoad().catch(e=>ttsMessage(e.message)));
$('tts-preview').addEventListener('click',async()=>{try{const info=await api('/api/tts/preview',{method:'POST',body:ttsInput()});ttsMessage(`Naskah valid · ${info.characters} karakter · ${info.voice} · Belum ada biaya.`);}catch(e){ttsMessage(`Periksa naskah: ${e.message}`);}});
$('tts-draft').addEventListener('click',async()=>{try{await api('/api/tts/draft',{method:'POST',body:ttsInput()});ttsMessage('Draf suara berhasil disimpan. Tidak ada permintaan berbayar.');await ttsLoad();}catch(e){ttsMessage(`Tidak dapat menyimpan: ${e.message}`);}});
$('tts-key-form').addEventListener('submit',async(event)=>{
 event.preventDefault();const slot=$('tts-provider').value==='aiide'?'voice_aiide':'voice';const secret=$('tts-key').value;
 $('tts-key').value='';
 try{await api('/api/keys',{method:'POST',body:{slot,secret}});await ttsLoad();$('tts-key-message').textContent='Kunci berhasil disimpan secara terenkripsi. Belum ada biaya.';}catch(e){$('tts-key-message').textContent=`Gagal menyimpan: ${e.message}`;}
});
$('tts-generate').addEventListener('click',async()=>{
 const status=await api('/api/tts/status').catch(()=>null);const p=status?.providers?.find(x=>x.id===$('tts-provider').value);
 if(!p?.configured){ttsMessage('Simpan kunci TTS untuk penyedia yang dipilih terlebih dahulu. Key Video AIIDE tidak berlaku otomatis untuk TTS.');return;}
 if(!p.liveAvailable){ttsMessage('TTS live belum aktif atau kemampuan penyedia belum diverifikasi. Draf dapat disimpan tanpa biaya.');return;}
 if(status.usedToday>=status.maxDaily){ttsMessage('Batas tes TTS lokal hari ini tercapai. Jangan mengulang permintaan yang statusnya belum pasti.');return;}
 try{await api('/api/tts/preview',{method:'POST',body:ttsInput()});}catch(e){ttsMessage(`Periksa naskah: ${e.message}`);return;}
 if(!confirm('Ini akan membuat SATU request TTS berbayar. Biaya mengikuti provider. Lanjutkan?'))return;
 $('tts-generate').disabled=true;
 try{const r=await api('/api/tts/generate',{method:'POST',body:{input:ttsInput(),consent:'I_ACCEPT_PROVIDER_CHARGES'}});
  if(r.job.status==='ready'){ttsShowAudio(r.job.id);ttsMessage('Narasi selesai dan siap diputar.');}
  else ttsMessage(`Status: ${r.job.status}. Jangan ulang request bila hasilnya belum pasti; cek dashboard provider.`);
  await ttsLoad();
 }catch(e){ttsMessage(`TTS ditolak: ${e.message}`);}finally{$('tts-generate').disabled=false;}
});
$('tts-attach').addEventListener('click',async()=>{
 if(!ttsLastReady)return;
 try{await api(`/api/tts/jobs/${ttsLastReady}/attach`,{method:'POST',body:{}});ttsMessage('Audio ditambahkan ke Pustaka Video. Pilih sebagai referensi di Buat Video.');await sdRefresh();openView('video-studio');}
 catch(e){ttsMessage(`Gagal menambahkan audio: ${e.message}`);}
});

$('sd-test').addEventListener('click',async()=>{const b=$('sd-test');b.disabled=true;try{const result=await api('/api/aiide-video/test',{method:'POST',body:sdInput()});$('sd-request').textContent=JSON.stringify({checks:result.checks,mode:result.plan.mode,model:result.plan.model,missingPublicReferences:result.plan.missingReferences.length,outboundRequests:0,paidCalls:0,liveVerified:false},null,2);sdText('sd-plan-status','LULUS TES LOKAL · 0 request provider · belum menghasilkan video AI.'+(result.plan.missingReferences.length?' Referensi dapat dipakai lokal; jalur live kelak membutuhkan alamat publik/aset AIIDE.':''));}catch(e){sdText('sd-plan-status',studioError(e));}finally{b.disabled=false;}});

$('change-password').addEventListener('submit',async event=>{
 event.preventDefault();
 const form=event.currentTarget,button=form.querySelector('button'),next=$('new-password').value;
 if(next!==$('repeat-password').value){sdText('password-status','Ulangan password berbeda.');return;}
 button.disabled=true;
 try{
  await api('/api/team/password',{method:'POST',body:{currentPassword:$('old-password').value,newPassword:next}});
  form.reset();location.hash='overview';location.reload();
 }catch(e){
  const hints={WRONG_PASSWORD:'Password saat ini salah.',PASSWORD_POLICY:'Gunakan minimal 6 karakter dengan huruf, angka, dan simbol.'};
  sdText('password-status',hints[e.message]||studioError(e));
 }finally{button.disabled=false;}
});

$('pool-secret').addEventListener('input',()=>{$('quick-provider').value='';$('quick-choice').hidden=true;});
