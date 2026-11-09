/** Validate local operator secrets using filesystem semantics for the current OS.
 * POSIX: require file mode 0600 (or stricter).
 * Windows: Node stat.mode is not an NTFS ACL; reject non-files/symlinks,
 * but do not mistake the emulated POSIX mode bits for actual Windows access.
 * This is a localhost-only development console, NOT a production secret manager.
 */
import {lstat} from 'node:fs/promises';

export async function validateOperatorSecretsFile(path,{platform=process.platform}={}){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink())throw new Error('Operator secrets must be stored in a regular file (no symlinks)');
 if(platform!=='win32' && (info.mode&0o077)!==0){
  throw new Error('On POSIX, operator secrets file permissions must be 0600 or stricter');
 }
 return true;
}
