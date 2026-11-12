import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSeedanceLocalStore} from '../src/seedance-local-store.mjs';

test('72 hours per upload, manual removal is project scoped, interrupted cleanup resumes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'studio-retention-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const hour=3600000,start=Date.UTC(2026,0,1),clock=()=>now;
 let now=start,store=createSeedanceLocalStore({root,clock});await store.init();
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
 const first=await store.addAsset(bytes,'same.png',{projectId:'a'});
 now+=hour;const later=await store.addAsset(bytes,'same.png',{projectId:'b'});
 now=start+72*hour-1;await store.readAsset(first.id);await store.expireAssets();
 assert.equal(store.listAssets().length,2);await access(store.localPath(first.id));
 now++;await store.expireAssets();assert.deepEqual(store.listAssets().map(a=>a.id),[later.id]);
 await assert.rejects(access(join(root,first.id+'.bin')),{code:'ENOENT'});
 await assert.rejects(store.removeAsset(later.id,'a'),{code:'ASSET_NOT_FOUND'});
 await store.removeAsset(later.id,'b');await assert.rejects(access(join(root,later.id+'.bin')),{code:'ENOENT'});
 const file=join(root,'index.json'),index=JSON.parse(await readFile(file,'utf8'));
 index.pending=[later.id];await writeFile(file,JSON.stringify(index));await writeFile(join(root,later.id+'.bin'),bytes);
 store=createSeedanceLocalStore({root,clock});await store.init();await store.expireAssets();
 await assert.rejects(access(join(root,later.id+'.bin')),{code:'ENOENT'});
 assert.deepEqual(store.listAssets(),[]);
});

test('project master survives its upload expiry and restart, and still supports explicit deletion',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ds-master-retention-'));let now=Date.now();
 const store=createSeedanceLocalStore({root,clock:()=>now});
 try{
  await store.init();
  const bytes=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
  const a=await store.addAsset(bytes,'master.png',{projectId:'project-a'});
  await store.pinMaster(a.id,'project-a');now+=73*3600000;await store.expireAssets();
  assert(store.resolveAsset(a.id));assert.equal(store.listAssets()[0].expiresAt,null);
  const reopened=createSeedanceLocalStore({root,clock:()=>now});await reopened.init();await reopened.expireAssets();assert(reopened.resolveAsset(a.id));
  await reopened.removeAsset(a.id,'project-a');assert(!reopened.resolveAsset(a.id));
 }finally{await rm(root,{recursive:true,force:true});}
});
