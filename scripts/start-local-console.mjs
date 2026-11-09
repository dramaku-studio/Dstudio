/** Convenience bootstrap for DEV ONLY. Generates local credentials ONCE in ignored 0600 file. */
import {mkdir,open,readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalConsole} from '../apps/control-server/server.mjs';
import {validateOperatorSecretsFile} from './validate-operator-secrets.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=resolve(root,'.local-private','local-console-operator.json');
async function secrets(){
 await mkdir(dirname(file),{recursive:true,mode:0o700});
 try{
  const token=randomBytes(32).toString('hex');const key=randomBytes(32).toString('base64');
  const f=await open(file,'wx',0o600);try{await f.writeFile(JSON.stringify({version:1,token,key}));await f.sync();}finally{await f.close();}
 }catch(e){if(e.code!=='EEXIST')throw e;}
 await validateOperatorSecretsFile(file);
 const data=JSON.parse(await readFile(file,'utf8'));if(data.version!==1||typeof data.token!=='string'||data.token.length<20)throw Error('Invalid local operator secrets');
 return data;
}
const s=await secrets();const port=Number(process.env.PORT||4184);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT must be 1024..65535');
// CP020 internal release is locked to local tests. Old environment flags cannot enable billing.
const app=createLocalConsole({port,adminToken:s.token,vaultKey:s.key,vaultFile:resolve(root,'.local-private','credentials.enc.json'),liveEnabled:false,capabilityVerified:false,aiideVideoEnabled:false,aiideVideoCapabilityVerified:false,aiideReadOnlyEnabled:true,aiideMediaHosts:(process.env.DRAMASAKU_AIIDE_MEDIA_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),ttsEnabled:false,ttsCapabilityVerified:false,aiideTtsCapabilityVerified:false});
await app.listen();
console.log('\nDRAMASAKU LOCAL OPERATOR CONSOLE (DEVELOPMENT ONLY)');
console.log(`Open: http://127.0.0.1:${port}`);
console.log(`Operator token (use on your own machine only): ${s.token}`);
console.log('Never share the token or API keys in chat, screenshots, or GitHub.');
if(process.platform==='win32')console.warn('Windows: review NTFS permissions on .local-private (this console only binds to localhost).');
console.log('Paid video pilot: '+((await app.live.list()).enabled && (await app.live.list()).capabilityVerified ? 'OPT-IN (1 submission/day; no auto retry)' : 'DISABLED (default)'));
console.log('AIIDE video pilot: '+((await app.aiideVideo.list()).enabled?'OPT-IN (1 paid job/day; model contract verification required)':'DISABLED (default)'));
console.log('Voice TTS: DISABLED — CP020 local release lock');
console.log('Publishing remains disabled. Use Ctrl+C to stop.\n');
