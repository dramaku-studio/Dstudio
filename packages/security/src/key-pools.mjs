/** Local-only encrypted multi-key manager. Does not send requests or bypass vendor/account limits.
 * Production requires tenant-scoped KMS/DB, distributed reservations, vendor usage reconciliation.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,rename,writeFile,unlink,stat} from 'node:fs/promises';
import {dirname,resolve,basename,join} from 'node:path';
import {validateVaultKey} from './vault.mjs';

const GROUPS=['creative','video'];
const PROVIDERS=['aiide','volcengine','google','openai','other'];
const STRATEGIES=['priority','round_robin'];
const bad=(code)=>Object.assign(new Error(code),{code,status:422});
const today=()=>new Date().toISOString().slice(0,10);
const validInt=(value,min,max,code)=>{
 if(!Number.isInteger(value)||value<min||value>max)throw bad(code);
 return value;
};
const validGroup=(value)=>{if(!GROUPS.includes(value))throw bad('INVALID_KEY_GROUP');return value;};
const validProvider=(value)=>{if(!PROVIDERS.includes(value))throw bad('INVALID_KEY_PROVIDER');return value;};
const validStrategy=(value)=>{if(!STRATEGIES.includes(value))throw bad('INVALID_ROUTING_STRATEGY');return value;};
const mask=(item,now)=>({id:item.id,label:item.label,provider:item.provider,group:item.group,enabled:item.enabled,
 dailyLimit:item.dailyLimit,usedToday:item.usageDay===now?item.usedToday:0,remaining:item.dailyLimit-(item.usageDay===now?item.usedToday:0),
 priority:item.priority,createdAt:item.createdAt});

export function createEncryptedKeyPools({file,key,clock=today}={}){
 const k=Buffer.isBuffer(key)?key:validateVaultKey(key);
 if(k.length!==32)throw bad('KEY_POOL_MASTER_INVALID');
 if(typeof file!=='string'||!file.trim())throw bad('KEY_POOL_FILE_REQUIRED');
 const filename=resolve(file);let queue=Promise.resolve();
 const serialize=fn=>{const r=queue.then(fn);queue=r.catch(()=>{});return r;};
 function encode(id,secret){
   const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',k,nonce);
   c.setAAD(Buffer.from(`dramasaku:keypool:v1:${id}`));
   const encrypted=Buffer.concat([c.update(secret,'utf8'),c.final()]);
   return {alg:'A256GCM',nonce:nonce.toString('base64'),body:encrypted.toString('base64'),tag:c.getAuthTag().toString('base64')};
 }
 function decode(id,secret){
   if(secret?.alg!=='A256GCM')throw bad('KEY_POOL_DATA_INVALID');
   const iv=Buffer.from(secret.nonce,'base64'),tag=Buffer.from(secret.tag,'base64');
   if(iv.length!==12||tag.length!==16)throw bad('KEY_POOL_DATA_INVALID');
   const d=createDecipheriv('aes-256-gcm',k,iv);d.setAAD(Buffer.from(`dramasaku:keypool:v1:${id}`));d.setAuthTag(tag);
   return Buffer.concat([d.update(Buffer.from(secret.body,'base64')),d.final()]).toString('utf8');
 }
 const fresh=()=>({version:1,items:[],policies:{creative:'priority',video:'priority'},cursor:{creative:{},video:{}}});
 async function read(){
   try{
     const st=await stat(filename);if(!st.isFile()||st.size>1_000_000)throw bad('KEY_POOL_DATA_INVALID');
     const data=JSON.parse(await readFile(filename,'utf8'));
     if(data.version!==1||!Array.isArray(data.items)||!data.policies||!data.cursor||data.items.length>50)throw bad('KEY_POOL_DATA_INVALID');
     for(const item of data.items){validGroup(item.group);validProvider(item.provider);decode(item.id,item.secret);}
     return data;
   }catch(e){if(e.code==='ENOENT')return fresh();throw e;}
 }
 async function save(data){
   const parent=dirname(filename);await mkdir(parent,{recursive:true,mode:0o700});
   const tmp=join(parent,`.${basename(filename)}.${randomBytes(6).toString('hex')}.tmp`);
   await writeFile(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});
   try{await rename(tmp,filename);}catch(e){await unlink(tmp).catch(()=>{});throw e;}
 }
 function eligible(data,group,provider,day){
   return data.items.filter(i=>i.group===group&&i.provider===provider&&i.enabled&&(i.usageDay===day?i.usedToday:0)<i.dailyLimit)
    .sort((a,b)=>a.priority-b.priority||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 }
 function choose(data,group,provider,day){
   const pool=eligible(data,group,provider,day);if(!pool.length)return null;
   return data.policies[group]==='round_robin'?pool[((data.cursor[group]||{})[provider]||0)%pool.length]:pool[0];
 }
 return Object.freeze({
   async list(){const data=await read(),day=clock();return {
    pools:GROUPS.map(group=>({id:group,strategy:data.policies[group]||'priority',keys:data.items.filter(i=>i.group===group).map(i=>mask(i,day))})),
    liveCallsEnabled:false,quotaUnit:'requests_per_utc_day'
   };},
   async add({group,provider,label,secret,dailyLimit=100,priority=5,enabled=true}={}){
     validGroup(group);validProvider(provider);
     if(typeof label!=='string'||label.trim().length<2||label.length>80)throw bad('INVALID_KEY_LABEL');
     if(typeof secret!=='string'||secret.trim().length<12||secret.length>8192||secret.includes('\0'))throw bad('INVALID_KEY_SECRET');
     validInt(dailyLimit,1,100000,'INVALID_DAILY_LIMIT');validInt(priority,1,10,'INVALID_PRIORITY');
     if(typeof enabled!=='boolean')throw bad('INVALID_ENABLED_FLAG');
     return serialize(async()=>{
       const data=await read();if(data.items.length>=50)throw bad('KEY_POOL_FULL');
       const id=randomBytes(12).toString('hex'),createdAt=new Date().toISOString();
       const item={id,group,provider,label:label.trim(),secret:encode(id,secret.trim()),dailyLimit,priority,enabled,
          usageDay:clock(),usedToday:0,createdAt};
       if(data.items.some(existing=>existing.provider===provider&&decode(existing.id,existing.secret)===secret.trim()))throw bad('DUPLICATE_PROVIDER_KEY');
       data.items.push(item);await save(data);return mask(item,clock());
     });
   },
   async update({id,dailyLimit,priority,enabled}={}){
     if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw bad('INVALID_KEY_ID');
     if(dailyLimit!==undefined)validInt(dailyLimit,1,100000,'INVALID_DAILY_LIMIT');
     if(priority!==undefined)validInt(priority,1,10,'INVALID_PRIORITY');
     if(enabled!==undefined&&typeof enabled!=='boolean')throw bad('INVALID_ENABLED_FLAG');
     return serialize(async()=>{const data=await read(),item=data.items.find(i=>i.id===id);if(!item)throw bad('KEY_NOT_FOUND');
       if(dailyLimit!==undefined)item.dailyLimit=dailyLimit;if(priority!==undefined)item.priority=priority;if(enabled!==undefined)item.enabled=enabled;
       await save(data);return mask(item,clock());});
   },
   async moveToVideo(id){
     if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw bad('INVALID_KEY_ID');
     return serialize(async()=>{const data=await read(),item=data.items.find(i=>i.id===id);
       if(!item)throw bad('KEY_NOT_FOUND');
       if(item.provider!=='aiide'||item.group!=='creative'||item.usedToday!==0)throw bad('KEY_MOVE_NOT_ALLOWED');
       item.group='video';await save(data);return mask(item,clock());
     });
   },
   async remove(id){if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw bad('INVALID_KEY_ID');
     return serialize(async()=>{const data=await read();const n=data.items.length;data.items=data.items.filter(i=>i.id!==id);
       if(data.items.length===n)throw bad('KEY_NOT_FOUND');await save(data);return {removed:true};});
   },
   async setPolicy(group,strategy){validGroup(group);validStrategy(strategy);
     return serialize(async()=>{const data=await read();data.policies[group]=strategy;data.cursor[group]={};await save(data);return {group,strategy};});
   },
   async preview(group,provider){validGroup(group);validProvider(provider);const data=await read(),day=clock();const selected=choose(data,group,provider,day);
     return {group,provider,selected:selected?mask(selected,day):null,reason:selected?'within_local_daily_limit':'NO_AVAILABLE_KEY',
       charge:false,requestsSent:0};},
   // Server-only task lookup: use exactly the key that originally submitted a job.
   // No browser API route should expose this method or its returned plaintext.
   async getForInternalTask(keyId,group,provider){
     validGroup(group);validProvider(provider);
     if(typeof keyId!=='string'||!/^[a-f0-9]{24}$/.test(keyId))throw bad('INVALID_KEY_ID');
     const data=await read(),item=data.items.find(k=>k.id===keyId&&k.group===group&&k.provider===provider);
     if(!item)throw bad('TASK_PROVIDER_KEY_NOT_FOUND');
     return decode(item.id,item.secret);
   },
   // Server-only hook. DO NOT expose as a UI endpoint. Must be backed by DB transaction + vendor policies before paid use.
   async reserveForInternalDispatch(group,provider,{authorize}={}){validGroup(group);validProvider(provider);
     return serialize(async()=>{const data=await read(),day=clock(),item=choose(data,group,provider,day);
       if(!item)throw bad('NO_AVAILABLE_KEY');
       if(authorize)await authorize(mask(item,day));
       if(item.usageDay!==day){item.usedToday=0;item.usageDay=day;}
       item.usedToday+=1;
       if(data.policies[group]==='round_robin'){data.cursor[group]??={};data.cursor[group][provider]=(data.cursor[group][provider]||0)+1;}
       await save(data);
       return {keyId:item.id,provider:item.provider,secret:decode(item.id,item.secret),remaining:item.dailyLimit-item.usedToday};
     });
   }
 });
}
