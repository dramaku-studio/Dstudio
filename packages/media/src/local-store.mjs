/** Local disk content-addressed store for DEVELOPMENT and single-node staging ONLY.
 * Production requires durable private S3-compatible object storage.
 */
import {mkdir,open,rename,unlink,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export class AssetIntegrityError extends Error {constructor(message){super(message);this.name='AssetIntegrityError';}}
const MAX_DEFAULT=30*1024*1024;
export function createLocalVideoStore({root,maxBytes=MAX_DEFAULT,requireFfprobe=true}={}){
  if(typeof root!=='string'||!root.trim())throw new Error('Private storage root required');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>512*1024*1024)throw new Error('Invalid media maxBytes');
  const folder=resolve(root);
  return {storageType:'local-development-only',
    async ingest({stream,length=null}={}) {
      if(!stream?.getReader)throw new AssetIntegrityError('Web ReadableStream required');
      if(length!==null && (!Number.isSafeInteger(length)||length<1||length>maxBytes))throw new AssetIntegrityError('Declared file size invalid or too large');
      await mkdir(folder,{recursive:true,mode:0o700});
      const tmp=join(folder,`.partial-${randomUUID()}`);
      const f=await open(tmp,'wx',0o600); const sha=createHash('sha256');
      let size=0;let header=Buffer.alloc(0);let closed=false;
      try {
        const reader=stream.getReader();
        try {for (;;) {
          const {done,value}=await reader.read();if(done)break;
          if(!(value instanceof Uint8Array))throw new AssetIntegrityError('Malformed stream chunk');
          size+=value.byteLength;
          if(size>maxBytes) {await reader.cancel().catch(()=>{});throw new AssetIntegrityError('MP4 exceeds size limit');}
          if(header.length<16)header=Buffer.concat([header,Buffer.from(value).subarray(0,16-header.length)]);
          sha.update(value);await f.writeFile(value);
        }} finally {reader.releaseLock();}
        if(size===0||header.length<12||header.toString('latin1',4,8)!=='ftyp')throw new AssetIntegrityError('Not an ISO BMFF/MP4 file');
        if(length!==null && size!==length)throw new AssetIntegrityError('Incomplete video download');
        await f.sync();await f.close();closed=true;
        let media={durationSeconds:null,width:null,height:null};
        if(requireFfprobe) {
          let data;
          try{
            const result=await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',tmp],{timeout:12000,maxBuffer:1024*1024});
            data=JSON.parse(result.stdout);
          }catch{throw new AssetIntegrityError('ffprobe failed: unplayable or unsupported MP4');}
          const video=data.streams?.find(s=>s.codec_type==='video');
          const duration=Number(data.format?.duration);
          if(!video||!Number.isFinite(duration)||duration<=0||duration>3600||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||video.width<=0||video.height<=0)throw new AssetIntegrityError('Invalid video duration/dimensions');
          media={durationSeconds:duration,width:video.width,height:video.height};
        }
        const digest=sha.digest('hex');const path=join(folder,`${digest}.mp4`);
        try{await rename(tmp,path);}catch(e){if(e.code==='EEXIST')await unlink(tmp);else throw e;}
        const saved=await stat(path);
        if(saved.size!==size)throw new AssetIntegrityError('Stored media length mismatch');
        return {sha256:digest,bytes:size,path,...media};
      } catch(e) {
        if(!closed)await f.close().catch(()=>{});
        await unlink(tmp).catch(()=>{});
        throw e;
      }
    }
  };
}
