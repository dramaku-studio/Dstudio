/** Development encrypted credential vault. Production must use tenant-scoped secret manager. */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {dirname,resolve,basename,join} from 'node:path';
const slots=new Set(['story_llm','image','video','volcengine_las','voice','voice_aiide','publishing']);
export function validateSlot(slot){if(!slots.has(slot))throw Error('INVALID_PROVIDER_SLOT');return slot;}
export function validateVaultKey(base64){
  if(typeof base64!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(base64))throw Error('VAULT_KEY_INVALID');
  const buf=Buffer.from(base64,'base64');if(buf.length!==32||buf.toString('base64')!==base64)throw Error('VAULT_KEY_INVALID');return buf;
}
export function createEncryptedVault({file,key}={}){
  const k=Buffer.isBuffer(key)?key:validateVaultKey(key);if(k.length!==32)throw Error('VAULT_KEY_INVALID');
  if(typeof file!=='string'||!file.trim())throw Error('VAULT_FILE_REQUIRED');
  const filename=resolve(file);let chain=Promise.resolve();
  const encode=(slot,secret)=>{
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',k,nonce);cipher.setAAD(Buffer.from(`dramasaku:v1:${slot}`));
    const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
    return {alg:'A256GCM',nonce:nonce.toString('base64'),body:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64'),updatedAt:new Date().toISOString()};
  };
  const decode=(slot,value)=>{
    if(value?.alg!=='A256GCM')throw Error('VAULT_FORMAT_INVALID');
    const nonce=Buffer.from(value.nonce,'base64'),tag=Buffer.from(value.tag,'base64');if(nonce.length!==12||tag.length!==16)throw Error('VAULT_FORMAT_INVALID');
    const decipher=createDecipheriv('aes-256-gcm',k,nonce);decipher.setAAD(Buffer.from(`dramasaku:v1:${slot}`));decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]).toString('utf8');
  };
  const read=async()=>{
    try{const st=await stat(filename);if(!st.isFile()||st.size>100000)throw Error('VAULT_FORMAT_INVALID');
      const data=JSON.parse(await readFile(filename,'utf8'));if(data.version!==1||!data.slots||typeof data.slots!=='object')throw Error('VAULT_FORMAT_INVALID');return data;
    }catch(e){if(e.code==='ENOENT')return {version:1,slots:{}};throw e;}
  };
  const save=async(data)=>{
    const parent=dirname(filename);await mkdir(parent,{recursive:true,mode:0o700});
    const temp=join(parent,`.${basename(filename)}.${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temp,JSON.stringify(data),{mode:0o600,flag:'wx'});
    try {await rename(temp,filename);}catch(e){const {unlink}=await import('node:fs/promises');await unlink(temp).catch(()=>{});throw e;}
  };
  const serialize=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
  return Object.freeze({
    async list(){const data=await read();return Object.fromEntries([...slots].map(s=>[s,{configured:!!data.slots[s],updatedAt:data.slots[s]?.updatedAt??null}]));},
    async put(slot,secret){validateSlot(slot);if(typeof secret!=='string'||secret.trim().length<12||secret.length>8192||secret.includes('\0'))throw Error('SECRET_INVALID');
      return serialize(async()=>{const data=await read();for(const [s,value] of Object.entries(data.slots))decode(s,value);data.slots[slot]=encode(slot,secret.trim());await save(data);return {slot,configured:true};});},
    async remove(slot){validateSlot(slot);return serialize(async()=>{const data=await read();for(const [s,value] of Object.entries(data.slots))decode(s,value);delete data.slots[slot];await save(data);return {slot,configured:false};});},
    async getForServerOnly(slot){validateSlot(slot);const data=await read();return data.slots[slot]?decode(slot,data.slots[slot]):null;}
  });
}
