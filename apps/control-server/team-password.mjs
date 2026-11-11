import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {promisify} from 'node:util';

const derive=promisify(scrypt);
const initialPassword='654321';

export function validTeamPassword(value){
 return typeof value==='string'&&[...value].length>=6&&value.length<=256&&/\p{L}/u.test(value)&&/\p{N}/u.test(value)&&/[\p{P}\p{S}]/u.test(value);
}

export function teamPassword(file){
 return {
  async verify(value){
   if(typeof value!=='string'||value.length>256)return false;
   let record;
   try{record=JSON.parse(await readFile(file,'utf8'));}
   catch(error){if(error.code==='ENOENT')return value===initialPassword;throw error;}
   if(!/^[0-9a-f]{32}$/.test(record.salt)||!/^[0-9a-f]{128}$/.test(record.hash))throw Error('Invalid local password store');
   const actual=await derive(value,Buffer.from(record.salt,'hex'),64);
   return timingSafeEqual(actual,Buffer.from(record.hash,'hex'));
  },
  async replace(value){
   if(!validTeamPassword(value))throw Error('Invalid new password');
   const salt=randomBytes(16),hash=await derive(value,salt,64);
   const temporary=file+'.'+randomBytes(12).toString('hex');
   try{
    await writeFile(temporary,JSON.stringify({salt:salt.toString('hex'),hash:hash.toString('hex')}),{flag:'wx',mode:0o600});
    await rename(temporary,file);
   }finally{await rm(temporary,{force:true});}
  }
 };
}
