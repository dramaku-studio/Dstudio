/** Shared local workflows for both brands. Never calls a provider directly. */
let internalState=null,internalTimeline=[],internalAudio=null,internalDirty=false,internalPoll=null,internalSystem=null;
function studioError(error){
 const code=typeof error==='string'?error:error.message;
 const messages={REFERENCE_FILE_MAX_5MB:'Audio/video maksimal 5 MB per file.',REFERENCE_AUDIO_MAX_5MB:'Total ukuran audio maksimal 5 MB.',REFERENCE_AUDIO_MP3_REQUIRED:'Audio referensi harus MP3.',REFERENCE_AUDIO_TOTAL_DURATION:'Total durasi semua audio maksimal 30 detik.',AUTH_REQUIRED:'Sesi berakhir. Masuk kembali; salin isian yang belum tersimpan.',PROJECT_NOT_SAVED:'Simpan proyek terlebih dahulu.',PROJECT_CHANGED_RELOAD:'Cerita berubah di tab lain. Muat cerita terbaru sebelum menyimpan.',PRODUCTION_CHANGED_RELOAD:'Pekerjaan berubah di tab lain. Klik Periksa Status Lokal lalu ulangi setelah meninjau perubahan.',AIIDE_MODEL_NOT_DOCUMENTED:'Model ini belum punya profil AIIDE yang didokumentasikan.',AIIDE_MODE_NOT_SUPPORTED:'Mode ini tidak didukung profil model terpilih.',INVALID_PROMPT:'Prompt wajib diisi, maksimal 4.000 karakter.',INVALID_DURATION:'Durasi tidak sesuai batas model.',UNSUPPORTED_RESOLUTION:'Resolusi tidak sesuai kontrak model.',UNEXPECTED_REFERENCES:'Text → Video harus tanpa referensi. Lepaskan referensi atau pilih mode lain.',FIRST_FRAME_REQUIRED:'Lampirkan tepat satu gambar dengan peran First frame.',FIRST_LAST_REQUIRED:'Lampirkan satu First frame dan satu Last frame.',REFERENCE_REQUIRED:'Lampirkan referensi gambar/video sesuai model; audio saja tidak cukup.',REFERENCE_VIDEO_REQUIRED:'Edit video memerlukan tepat satu video referensi.',REF_LIMIT:'Jumlah referensi melebihi batas model.',ASSET_ROLE_MISMATCH:'Peran referensi tidak cocok dengan jenis aset.',REFERENCE_VIDEO_DURATION:'Durasi video referensi tidak sesuai model.',REFERENCE_VIDEO_TOTAL_DURATION:'Total video referensi maksimal 15 detik.',REFERENCE_IMAGE_TOO_SMALL:'Gambar terlalu kecil untuk model ini.',REFERENCE_VIDEO_DIMENSIONS:'Ukuran, rasio, atau frame rate video tidak sesuai model.',REFERENCE_DIMENSIONS:'Dimensi referensi tidak sesuai profil model.',AIIDE_REFERENCE_PUBLIC_HTTPS_REQUIRED:'Gunakan URL HTTPS publik atau ID aset AIIDE yang valid. Alamat lokal tidak dapat digunakan provider.',AIIDE_REFERENCE_INVALID:'Alamat referensi tidak valid.',MEDIA_UNREADABLE_OR_FFPROBE_MISSING:'Media belum dapat dibaca. Periksa file dan ketersediaan FFprobe di Status Studio.',CLIP_RANGE_INVALID:'Rentang klip tidak valid. Periksa titik mulai dan durasi sumber.',MEDIA_REVIEW_REQUIRED:'Setujui semua gambar, klip, dan audio pada Persetujuan untuk versi cerita ini.',TIMELINE_EMPTY:'Tambahkan dan simpan klip lebih dahulu.',TIMELINE_MAX_300_SECONDS:'Total susunan maksimal 300 detik.',RENDER_BUSY:'Render lokal masih berjalan. Tunggu hasilnya.',PRODUCTION_TEXT_INVALID:'Lengkapi nama peninjau atau teks; periksa batas panjang isian.',PACKAGE_INTEGRITY_INVALID:'Paket rusak atau telah berubah. Minta ekspor ulang dari pengirim.',PACKAGE_MAX_64_MB:'Total media paket melebihi 64 MB.',PACKAGE_ASSET_INTEGRITY:'Ukuran atau checksum media paket tidak sesuai.'};
 return messages[code]||`Belum berhasil: ${code}`;
}
const internalNode=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
function internalButton(label,action){const b=internalNode('button',label,'ghost');b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}finally{if(b.isConnected)b.disabled=false;}};return b;}
const internalExpected=()=>({expectedProjectHash:internalState?.projectHash??null,expectedRevision:internalState?.revision??0});
async function internalChange(action,body,statusId){try{await api('/api/production/'+action,{method:'POST',body:{...body,...internalExpected()}});await internalReload();if(statusId&&action!=='render')$(statusId).textContent='Tersimpan di proyek lokal.';return true;}catch(e){if(statusId)$(statusId).textContent=studioError(e);return false;}}
function internalMedia(asset){
 const el=document.createElement(asset.kind==='image'?'img':asset.kind==='video'?'video':'audio');
 el.src=asset.generatedJobId?'/api/aiide-video/jobs/'+asset.generatedJobId+'/media':`/api/seedance/assets/${asset.id}/media`;el.className='internal-media';
 if(asset.kind==='image')el.alt=asset.name;else{el.controls=true;el.preload='metadata';}
 return el;
}
async function internalUpload(inputId,statusId){
 const files=[...$(inputId).files];if(!files.length){$(statusId).textContent='Pilih file dari komputer terlebih dahulu.';return;}
 try{for(const file of files){
  const response=await fetch('/api/seedance/assets',{method:'POST',headers:{'content-type':'application/octet-stream','x-dramasaku-csrf':csrf,'x-asset-name':encodeURIComponent(file.name)},credentials:'same-origin',body:file});
  const result=await response.json();if(!response.ok)throw Error(result.error);await api(`/api/seedance/assets/${result.asset.id}/inspect`,{method:'POST',body:{}});
 }$(inputId).value='';await sdRefresh();await internalReload();$(statusId).textContent='Media lokal tersimpan dan terbaca. Tidak diunggah ke provider.';}catch(e){$(statusId).textContent=studioError(e);await sdRefresh();await internalReload();}
}
function paintAssetLibrary(){
 const grid=$('library-items');grid.replaceChildren();
 $('asset-count').textContent=sdAssets.length+' aset';
 for(const asset of sdAssets){
  const card=internalNode('article',undefined,'internal-media-card library-card');
  const preview=internalNode('div',undefined,'library-preview');
  const remove=internalButton('🗑',async()=>{
   if(!confirm('Hapus '+asset.name+' dari pustaka lokal? Klip dan review yang memakainya akan dilepas.'))return;
   try{
    await api('/api/seedance/assets/'+asset.id,{method:'DELETE'});
    await sdRefresh();await internalReload();
    $('library-status').textContent=asset.name+' dihapus.';
   }catch(e){$('library-status').textContent=studioError(e);}
  });
  remove.classList.add('library-delete');remove.setAttribute('aria-label','Hapus '+asset.name);remove.title='Hapus aset';
  preview.append(internalMedia(asset),remove);
  const limit=new Date(asset.expiresAt||Date.parse(asset.createdAt)+72*3600000);
  card.append(preview,internalNode('strong',asset.name),internalNode('small',asset.retention==='project_master'?'Master proyek · tersimpan sampai dihapus':'Hapus otomatis '+limit.toLocaleString()));
  if(asset.generatedJobId){
   const link=internalNode('a','Unduh MP4');link.href='/api/aiide-video/jobs/'+asset.generatedJobId+'/media?download=1';link.download=asset.name;
   card.append(internalNode('small','Hasil generate AIIDE'),link);
  }
  if(asset.kind!=='audio'||asset.mime==='audio/mpeg'){
   card.append(internalButton('Lampirkan ke video',async()=>{
    try{
     if(!asset.inspected)Object.assign(asset,(await api('/api/seedance/assets/'+asset.id+'/inspect',{method:'POST',body:{}})).asset);
     if(!sdAcceptsAsset(asset)&&!internalSelectMode('reference',asset.kind)){
      $('library-status').textContent='Pilih model yang mendukung jenis media ini.';return;
     }
     if(!sdChosen.some(ref=>ref.assetId===asset.id))sdAttachAsset(asset);
     openView('video-studio');
     sdText('sd-upload-status',asset.name+' terlampir.');
    }catch(e){openView('assets');$('library-status').textContent=studioError(e);}
   }));
  }
  grid.append(card);
 }
 if(!sdAssets.length)grid.textContent='Belum ada aset tersimpan.';
}
$('library-upload').addEventListener('change',async()=>{
 const input=$('library-upload');if(!input.files.length)return;
 input.disabled=true;
 try{await internalUpload('library-upload','library-status');}
 finally{input.value='';input.disabled=false;}
});
// Update open galleries after background expiry or edits from a second tab.
let libraryUpdating=false;
async function refreshAssetGallery(){
 if(!csrf||location.hash!=='#assets'||document.hidden||libraryUpdating)return;
 libraryUpdating=true;
 try{
  const latest=await api('/api/seedance/assets');
  if(latest.assets.length!==sdAssets.length||latest.assets.some((asset,i)=>asset.id!==sdAssets[i].id)){
   await sdRefresh();await internalReload();
  }
 }catch(e){$('library-status').textContent=studioError(e);}
 finally{libraryUpdating=false;}
}
window.addEventListener('hashchange',refreshAssetGallery);
document.addEventListener('visibilitychange',refreshAssetGallery);
setInterval(refreshAssetGallery,60_000);
function internalPaintMedia(){
 paintAssetLibrary();
 const images=$('image-library'),voices=$('voice-library');images.replaceChildren();voices.replaceChildren();
 for(const a of sdAssets){
  if(a.kind==='image'){const card=internalNode('article',undefined,'internal-media-card');card.append(internalMedia(a),internalNode('strong',a.name),internalButton('Gunakan sebagai Frame Awal',()=>{if(!internalSelectMode('image_to_video'))return;sdChosen=[{assetId:a.id,role:'first_frame'}];sdRevise();}));images.append(card);}
  if(a.kind==='audio'){const card=internalNode('article',undefined,'internal-media-card');card.append(internalNode('strong',a.name),internalMedia(a));voices.append(card);}
 }
 if(!images.children.length)images.textContent='Belum ada gambar lokal.';if(!voices.children.length)voices.textContent='Belum ada audio lokal.';
 sdOptions('film-asset',sdAssets.filter(a=>['image','video'].includes(a.kind)).map(a=>({id:a.id,label:`${a.name} · ${a.kind}`})),$('film-asset').value);
 sdOptions('film-audio',[{id:'',label:'Pertahankan audio klip'},...sdAssets.filter(a=>a.kind==='audio').map(a=>({id:a.id,label:a.name}))],internalDirty?$('film-audio').value:internalAudio||'');
 if(internalState)internalPaintReviews();
}
function internalSelectMode(mode,kind){
 const choices=(sdCatalog?.models||[]).filter(model=>model.modes.includes(mode)&&(!kind||model[{image:'maxImages',audio:'maxAudios',video:'maxVideos'}[kind]]));
 const entitled=choices.filter(model=>sdLiveConfiguration?.availableModels?.includes(model.id));
 const candidates=entitled.length?entitled:choices;
 const model=candidates.find(model=>model.id===$('sd-model').value)||candidates[0];
 if(!model){$('motion-status').textContent='Mode ini belum didokumentasikan AIIDE.';return false;}
 const before=sdTags();
 $('sd-model').value=model.id;
 sdOptions('sd-mode',sdCatalog.modes,mode);
 sdRevise();
 sdRemapPromptTags(before);
 sdText('sd-live-status',videoLiveHelp(sdLiveConfiguration));
 openView('video-studio');sdText('sd-plan-status','Siapkan referensi, lalu Uji Mode Lokal. Generate AI memerlukan key valid dan persetujuan biaya.');return true;
}
function internalPaintBriefs(){
 for(const [kind,id,target] of [['image','image-briefs','image-prompt'],['motion','motion-briefs','motion-prompt']]){
  const list=$(id);list.replaceChildren();for(const b of internalState.briefs.filter(b=>b.kind===kind)){
   const row=internalNode('div',undefined,'activity-item');row.append(internalNode('span',`${b.shotId||'Draf'} · ${new Date(b.createdAt).toLocaleString()}`),internalButton('Buka Draf',()=>{if($(target).value.trim()&&!confirm('Ganti isian yang belum disimpan dengan draf ini?'))return;$(target).value=b.prompt;if(kind==='image'){$('image-shot').value=b.shotId||'';updatePromptCount('image-prompt');}}));list.append(row);
  }
 }
}
function internalPaintReviews(){
 const grid=$('review-assets');grid.replaceChildren();
 $('review-stage').textContent=`${internalState.approvedAssets} aset disetujui untuk cerita saat ini`;
 $('review-detail').textContent='Tinjau media sebenarnya sebelum memilih keputusan. Perubahan cerita meminta review ulang.';
 for(const a of sdAssets){
  const r=internalState.reviews.find(r=>r.assetId===a.id),current=r?.projectHash===internalState.projectHash&&r?.sha256===a.sha256;
  const card=internalNode('article',undefined,'internal-media-card');
  card.append(internalMedia(a),internalNode('strong',a.name),internalNode('p',r?(current?(r.decision==='approved'?'Disetujui':'Perlu revisi'):'Review versi cerita sebelumnya')+` · ${r.reviewer}`:'Belum ditinjau'));
  if(r?.note)card.append(internalNode('p',r.note));
  const action=decision=>internalChange('review',{assetId:a.id,decision,reviewer:$('reviewer-name').value,note:$('review-note').value},'review-status');
  card.append(internalButton('Setujui Aset',()=>action('approved')),internalButton('Minta Revisi',()=>action('revision')));
  if(current&&r.decision==='approved'&&a.kind!=='audio'){
   card.append(internalButton('Pakai di Studio Film',()=>{
    $('film-asset').value=a.id;$('film-asset').dispatchEvent(new Event('change'));openView('film-studio');
   }));
  }
  grid.append(card);
 }
 if(!sdAssets.length)grid.textContent='Impor media dari Studio Gambar, Studio Suara, atau Buat Video terlebih dahulu.';
}
function filmRenderHint(){
 if(!internalState?.projectHash)return 'Simpan proyek di Proyek & Cerita.';
 if(internalState.renders.some(job=>job.status==='rendering'))return 'Render sedang berjalan.';
 if(!internalTimeline.length)return 'Tambahkan gambar atau klip ke susunan film.';
 if(internalDirty)return 'Simpan susunan terbaru sebelum render.';
 const ids=new Set(internalTimeline.map(clip=>clip.assetId));
 if(internalAudio)ids.add(internalAudio);
 const pending=[...ids].filter(id=>{
  const asset=sdAssets.find(a=>a.id===id);
  return !asset||!internalState.reviews.some(r=>r.assetId===id&&r.sha256===asset.sha256&&r.projectHash===internalState.projectHash&&r.decision==='approved');
 });
 if(pending.length)return 'Tinjau '+pending.length+' aset pada menu Persetujuan.';
 if(!internalSystem)return 'Memeriksa alat render lokal…';
 const missing=internalSystem.tools.filter(tool=>!tool.available);
 if(missing.length)return 'Periksa Status Sistem untuk '+missing.map(tool=>tool.detail||tool.name).join(', ')+'.';
 return '';
}
function internalRenderReadiness(){
 const hint=filmRenderHint();
 $('film-generate').disabled=!!hint;
 $('film-readiness').textContent=hint||'Siap merender MP4 di perangkat ini.';
}
function internalPaintTimeline(){
 const list=$('film-timeline');list.replaceChildren();
 internalTimeline.forEach((c,i)=>{const a=sdAssets.find(a=>a.id===c.assetId),row=internalNode('div',undefined,'activity-item');row.append(internalNode('span',`${i+1}. ${a?.name||'Media tidak ditemukan'} · ${c.start}–${Math.round((c.start+c.duration)*10)/10} detik`));
  const move=d=>{if(i+d<0||i+d>=internalTimeline.length)return;[internalTimeline[i],internalTimeline[i+d]]=[internalTimeline[i+d],internalTimeline[i]];internalDirty=true;internalPaintTimeline();};
  row.append(internalButton('Naik',()=>move(-1)),internalButton('Turun',()=>move(1)),internalButton('Keluarkan',()=>{internalTimeline.splice(i,1);internalDirty=true;internalPaintTimeline();}));list.append(row);
 });
 $('film-manifest-status').textContent=`${internalTimeline.length} klip · ${Math.round(internalTimeline.reduce((n,c)=>n+c.duration,0)*10)/10} detik · ${internalDirty?'belum disimpan':'tersimpan'}`;
 internalRenderReadiness();
 if(!internalTimeline.length)list.textContent='Belum ada klip di susunan film.';
}
function internalShowRender(r){const url=`/api/production/renders/${r.id}/media`;$('film-player').src=url;$('film-player').load();$('film-download').href=url;$('film-download').hidden=false;$('film-status').textContent=`Film lokal siap · ${r.duration} detik${r.current?'':' · versi sebelumnya'}.`;}
function internalPaintWorkflow(){
 const p=internalState,rows=[['Cerita & storyboard',p.projectHash?`${p.shotCount} shot tersimpan`:'Belum disimpan','projects'],['Referensi & draf',`${sdAssets.length} media lokal`,'assets'],['Review aset',`${p.approvedAssets} aset disetujui untuk versi ini`,'approvals'],['Susunan & render',`${p.timeline.clips.length} klip tersimpan; ${p.renders.filter(r=>r.status==='ready'&&r.current).length} render terkini`,'film-studio'],['Handoff tim','Ekspor paket proyek dan unduh MP4','projects']];
 const grid=$('production-workflow');grid.replaceChildren();for(const [title,status,view] of rows){const c=internalNode('article',undefined,'internal-step');c.append(internalNode('h3',title),internalNode('p',status),internalButton('Buka',()=>openView(view)));grid.append(c);}
 $('stage').textContent=p.projectHash?'Proyek lokal aktif':'Belum ada proyek';$('stagedetail').textContent=p.projectName||'Simpan cerita untuk memulai.';$('shots').textContent=String(p.shotCount);
}
let historyDrafts=[];
function internalPaintHistory(){
 const term=$('history-search').value.trim().toLowerCase();
 const matches=value=>value.toLowerCase().includes(term);
 const modelName=id=>sdCatalog?.models.find(model=>model.id===id)?.label||id;
 const events=$('history-events'),drafts=$('history-drafts'),jobs=$('history-jobs');
 for(const list of [events,drafts,jobs])list.replaceChildren();
 for(const event of internalState?.events||[]){
  if(!matches(event.label))continue;
  const row=internalNode('div',undefined,'activity-item');
  row.append(internalNode('span',event.label),internalNode('small',new Date(event.at).toLocaleString()));events.append(row);
 }
 for(const draft of historyDrafts){
  const label=modelName(draft.model)+' · '+draft.mode;
  if(!matches(label+' '+draft.model))continue;
  const row=internalNode('div',undefined,'activity-item');
  row.append(internalNode('span',label),internalButton('Buka Draf',()=>sdOpenDraft(draft.id)));drafts.append(row);
 }
 const filter=$('history-job-filter').value;
 for(const job of sdLiveConfiguration?.jobs||[]){
  const group=job.status==='ready'?'ready':sdPollable.has(job.status)&&!job.errorCode?'active':'check';
  const source=job.source==='imported'?'Task impor':'Generate';
  const label=[modelName(job.model),job.mode,source,job.status].filter(Boolean).join(' · ');
  if((filter&&filter!==group)||!matches(label+' '+job.model+' '+(job.providerTaskId||'')))continue;
  const row=internalNode('div',undefined,'activity-item');row.append(internalNode('span',label));
  if(job.createdAt)row.append(internalNode('small',new Date(job.createdAt).toLocaleString()));
  if(group==='ready')row.append(internalButton('Lihat hasil',()=>{openView('video-studio');sdShowPlayer(job);}));
  jobs.append(row);
 }
 if(!events.children.length)events.textContent=term?'Tidak ada aktivitas yang cocok.':'Belum ada aktivitas produksi tersimpan.';
 if(!drafts.children.length)drafts.textContent=term?'Tidak ada draf yang cocok.':'Belum ada draf video.';
 if(!jobs.children.length)jobs.textContent=term||filter?'Tidak ada tugas yang cocok.':'Belum ada tugas video di perangkat ini.';
}
$('history-search').addEventListener('input',internalPaintHistory);
$('history-job-filter').addEventListener('change',internalPaintHistory);
async function internalReload(){
 const state=await api('/api/production'),previous=internalState;internalState=state;
 if(previous?.projectId!==state.projectId){$('film-player').pause();$('film-player').removeAttribute('src');$('film-player').load();$('film-download').hidden=true;}
 if(internalDirty){
  internalTimeline=internalTimeline.filter(clip=>sdAssets.some(a=>a.id===clip.assetId));
  if(internalAudio&&!sdAssets.some(a=>a.id===internalAudio)){internalAudio=null;$('film-audio').value='';}
 }
 if(!internalDirty||previous?.projectId!==state.projectId){internalTimeline=structuredClone(state.timeline.clips);internalAudio=state.timeline.audioAssetId;internalDirty=false;}
 sdOptions('image-shot',[{id:'',label:'Tanpa shot'},...(activeWorkspace?.plan.shots||[]).map(s=>({id:s.id,label:`${s.id} · ${s.description.slice(0,70)}`}))],$('image-shot').value);
 internalPaintBriefs();internalPaintMedia();internalPaintTimeline();internalPaintWorkflow();
 const renders=$('film-renders');renders.replaceChildren();for(const r of state.renders){const row=internalNode('div',undefined,'activity-item');row.append(internalNode('span',`${r.status==='ready'?'Selesai':r.status==='rendering'?'Sedang merender':r.status} · ${new Date(r.createdAt).toLocaleString()}${r.current?'':' · versi sebelumnya'}`));if(r.status==='ready')row.append(internalButton('Lihat Film',()=>internalShowRender(r)));renders.append(row);}
 const active=state.renders.find(r=>r.status==='rendering');
 internalPaintHistory();
 if(active)$('film-status').textContent='Merender aset lokal… tidak ada request AI.';
 else if(state.renders[0]?.status==='failed')$('film-status').textContent='Render gagal. Periksa FFmpeg dan media pada Status Studio. Sumber tetap tersimpan.';
 else if(state.renders[0]?.status==='ready'&&!$('film-player').getAttribute('src'))internalShowRender(state.renders[0]);
 clearTimeout(internalPoll);internalPoll=active?setTimeout(()=>internalReload().catch(e=>{$('film-status').textContent=studioError(e);}),1500):null;
 for(const id of ['team-export','team-import','image-generate','motion-save','motion-generate','film-add','film-save'])$(id).disabled=!state.projectHash&&id!=='team-import';
}
async function internalReadiness(){
 internalSystem=await api('/api/studio/status');const s=internalSystem,ready=s.tools.every(t=>t.available),grid=$('studio-readiness');grid.replaceChildren();
 const rows=[['Cerita & storyboard','Siap lokal: simpan, edit, impor/ekspor cerita.'],['Video AIIDE',`${s.modelCount} profil model; validasi, draf, tes transport lokal. Generate berbayar ${s.paidVideoEnabled?'AKTIF':'OFF'}.`],['Gambar & gerak','Draf, referensi lokal, dan kirim ke mode video yang sesuai. Generate gambar AI OFF.'],['Suara','Draf narasi dan impor MP3/WAV tersedia. Generate TTS '+(s.paidTtsEnabled?'AKTIF.':'OFF.')],['Review & riwayat','Tersimpan lintas restart; review mengikuti versi cerita dan aset.'],['Film lokal',ready?'FFmpeg/FFprobe tersedia; susun dan render media yang disetujui.':'Belum siap render: pasang '+s.tools.filter(t=>!t.available).map(t=>t.detail||t.name).join(', ')+'.'],['Berbagi proyek','Paket lintas Dramasaku/Aragi; media maksimal 64 MB. Kredensial tidak disertakan.'],['Lingkup penggunaan','Satu operator per komputer. Berbagi paket secara manual; bukan server multiuser.']];
 for(const [title,detail] of rows){const card=internalNode('article');card.append(internalNode('strong',title),internalNode('p',detail));grid.append(card);}
 internalRenderReadiness();
 $('studio-status-message').textContent=`Versi ${s.version} · pemeriksaan lokal selesai.`;
}
const internalCoreRefresh=refresh;
refresh=async function(){await internalCoreRefresh();if(csrf){await internalReadiness();await internalReload();}};
const internalTtsLoad=ttsLoad;
ttsLoad=async function(){await internalTtsLoad();const status=await api('/api/tts/status'),provider=status.providers.find(p=>p.id===$('tts-provider').value);$('tts-generate').disabled=!(provider?.configured&&provider?.liveAvailable&&status.usedToday<status.maxDaily);};
$('image-generate').onclick=()=>internalChange('brief',{kind:'image',prompt:$('image-prompt').value,shotId:$('image-shot').value||null},'image-status');
$('motion-save').onclick=()=>internalChange('brief',{kind:'motion',prompt:$('motion-prompt').value},'motion-status');
$('motion-generate').onclick=()=>{const prompt=$('motion-prompt').value.trim();if(!prompt){$('motion-status').textContent='Tulis arahan gerak terlebih dahulu.';return;}if(internalSelectMode('image_to_video'))transferVideoPrompt(prompt,'motion-status');};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>internalSelectMode(b.dataset.mode));
$('image-upload-button').onclick=()=>internalUpload('image-upload','image-status');
$('voice-upload-button').onclick=()=>internalUpload('voice-upload','tts-message');
$('film-asset').onchange=async()=>{try{const {asset}=await api(`/api/seedance/assets/${$('film-asset').value}/inspect`,{method:'POST',body:{}});$('film-start').value='0';$('film-duration').value=String(Math.min(3,asset.durationSeconds||3));}catch(e){$('film-status').textContent=studioError(e);}};
$('film-add').onclick=async()=>{try{const {asset}=await api(`/api/seedance/assets/${$('film-asset').value}/inspect`,{method:'POST',body:{}});const start=Number($('film-start').value),duration=Number($('film-duration').value);if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<1||duration>60||(asset.kind==='video'&&start+duration>asset.durationSeconds+0.1)||(asset.kind==='image'&&start!==0))throw Error('CLIP_RANGE_INVALID');if(internalTimeline.length>=24)throw Error('TIMELINE_INVALID');internalTimeline.push({assetId:asset.id,start,duration});internalDirty=true;internalPaintTimeline();}catch(e){$('film-status').textContent=studioError(e);}};
$('film-audio').onchange=()=>{internalAudio=$('film-audio').value||null;internalDirty=true;internalPaintTimeline();};
$('film-save').onclick=async()=>{const saved=await internalChange('timeline',{clips:internalTimeline,audioAssetId:$('film-audio').value||null},'film-status');if(saved){internalDirty=false;await internalReload();}};
$('film-generate').onclick=async()=>{if(internalDirty){$('film-status').textContent='Simpan susunan terbaru sebelum render.';return;}if(!internalSystem?.tools.every(t=>t.available)){openView('audit');await internalReadiness();return;}await internalChange('render',{},'film-status');};
$('studio-status-refresh').onclick=async()=>{try{await internalReadiness();await internalReload();}catch(e){$('studio-status-message').textContent=studioError(e);}};
$('studio-logout').onclick=async()=>{if(!confirm('Keluar dari sesi lokal? Simpan isian terlebih dahulu.'))return;await api('/api/logout',{method:'POST',body:{}});location.reload();};
$('team-export').onclick=async()=>{try{const r=await fetch('/api/project-package/export',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error((await r.json()).error);const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='dramasaku-project.studio.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);$('team-status').textContent='Paket tim diunduh. API key, task provider, dan alamat referensi provider tidak disertakan.';const skipped=Number(r.headers.get('x-skipped-video-drafts'));if(skipped)$('team-status').textContent+=' '+skipped+' draf video dengan lampiran hilang hanya tersedia di riwayat lokal.';}catch(e){$('team-status').textContent=studioError(e);}};
$('team-import').onclick=()=>$('team-file').click();
$('team-file').onchange=async()=>{const f=$('team-file').files?.[0];if(!f)return;try{if(f.size>94_000_000)throw Error('PACKAGE_LIMIT');const bundle=JSON.parse(await f.text()),preview=await api('/api/project-package/preview',{method:'POST',body:bundle}),current=await api('/api/workspace'),state=await api('/api/production');
 if(!confirm(`Impor proyek “${preview.projectName}” dengan ${preview.assets} media, ${preview.videoDrafts} draf video, dan ${preview.voiceDrafts} draf suara? Proyek aktif diganti; paket cadangan dibuat. Isian yang belum disimpan akan hilang. Review perlu dikonfirmasi ulang.`))return;
 await api('/api/project-package/import',{method:'POST',body:{bundle,replace:!!current.saved,expectedCurrentInputHash:current.currentInputHash,expectedProductionRevision:state.revision}});internalDirty=false;await loadWorkspace();await sdRefresh();await ttsLoad();await internalReload();$('team-status').textContent='Paket diimpor. Tinjau kembali aset dan konfirmasi review sebelum merender.';
 }catch(e){$('team-status').textContent=studioError(e);}finally{$('team-file').value='';}};
window.addEventListener('beforeunload',event=>{if(internalDirty){event.preventDefault();event.returnValue='';}});
