import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateOperatorSecretsFile} from './validate-operator-secrets.mjs';

test('Windows accepts regular files despite emulated POSIX mode bits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-win-acl-'));
 try{const file=join(dir,'operator.json');await writeFile(file,'{}',{mode:0o644});await chmod(file,0o644);
  assert.equal(await validateOperatorSecretsFile(file,{platform:'win32'}),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('POSIX still rejects file permissions open to group or world',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-posix-acl-'));
 try{const file=join(dir,'operator.json');await writeFile(file,'{}',{mode:0o644});await chmod(file,0o644);
  await assert.rejects(validateOperatorSecretsFile(file,{platform:'linux'}),/0600/);
  await chmod(file,0o600);assert.equal(await validateOperatorSecretsFile(file,{platform:'linux'}),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('symlinks rejected in Windows and POSIX validation',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ds-symlink-acl-'));
 try{const file=join(dir,'operator.json'),link=join(dir,'link.json');await writeFile(file,'{}',{mode:0o600});await symlink(file,link);
  await assert.rejects(validateOperatorSecretsFile(link,{platform:'win32'}),/regular file/);
  await assert.rejects(validateOperatorSecretsFile(link,{platform:'linux'}),/regular file/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
