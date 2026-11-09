import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createEncryptedKeyPools} from '../src/key-pools.mjs';
test('two isolated key pools: encrypted secrets, daily limits, automatic safe selection and persistence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-keypools-')),file=join(dir,'pools.enc.json'),key=randomBytes(32);
 let day='2026-11-05';const manager=createEncryptedKeyPools({file,key,clock:()=>day});
 try {
  const first=await manager.add({group:'creative',provider:'aiide',label:'Main Creative',secret:'CREATIVE_SECRET_FOR_TESTS_0123',dailyLimit:2,priority:1});
  const second=await manager.add({group:'creative',provider:'aiide',label:'Backup Creative',secret:'BACKUP_SECRET_FOR_TESTS_0123',dailyLimit:1,priority:5});
  await assert.rejects(manager.add({group:'video',provider:'aiide',label:'Duplicate Credential',secret:'CREATIVE_SECRET_FOR_TESTS_0123',dailyLimit:2}),/DUPLICATE_PROVIDER_KEY/);
  const vid=await manager.add({group:'video',provider:'volcengine',label:'Video Dedicated',secret:'VIDEO_SECRET_FOR_TESTS_012345',dailyLimit:1});
  assert(!((await readFile(file,'utf8')).includes('SECRET_FOR_TESTS')));
  assert.equal((await manager.preview('creative','aiide')).selected.id,first.id);
  await manager.reserveForInternalDispatch('creative','aiide');await manager.reserveForInternalDispatch('creative','aiide');
  assert.equal((await manager.preview('creative','aiide')).selected.id,second.id);
  await manager.reserveForInternalDispatch('creative','aiide');
  assert.equal((await manager.preview('creative','aiide')).selected,null);
  assert.equal((await manager.preview('video','volcengine')).selected.id,vid.id);
  assert.equal((await manager.list()).pools[0].keys[0].remaining,0);
  assert(!(JSON.stringify(await manager.list()).includes('CREATIVE_SECRET')));
  await assert.rejects(manager.reserveForInternalDispatch('creative','aiide'),/NO_AVAILABLE_KEY/);
  day='2026-11-06';assert.equal((await manager.preview('creative','aiide')).selected.id,first.id);
  await manager.setPolicy('creative','round_robin');
  await manager.reserveForInternalDispatch('creative','aiide');
  assert.equal((await manager.preview('creative','aiide')).selected.id,second.id);
  const again=createEncryptedKeyPools({file,key,clock:()=>day});
  assert.equal((await again.list()).pools[0].strategy,'round_robin');
  await manager.update({id:second.id,enabled:false});assert.equal((await manager.preview('creative','aiide')).selected.id,first.id);
  await manager.remove(second.id);assert.equal((await manager.list()).pools[0].keys.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid group, secret, and daily caps are rejected before storage',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-keypools-reject-'));try{
  const m=createEncryptedKeyPools({file:join(dir,'keys.json'),key:randomBytes(32)});
  await assert.rejects(m.add({group:'unknown',provider:'aiide',label:'abc',secret:'safe-secret-123456'}),/INVALID_KEY_GROUP/);
  await assert.rejects(m.add({group:'creative',provider:'aiide',label:'abc',secret:'short'}),/INVALID_KEY_SECRET/);
  await assert.rejects(m.add({group:'video',provider:'aiide',label:'abc',secret:'valid-secret-123456',dailyLimit:0}),/INVALID_DAILY_LIMIT/);
  await assert.rejects(m.preview('image','aiide'),/INVALID_KEY_GROUP/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
