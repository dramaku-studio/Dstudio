/** CP-003 PostgreSQL-backed worker. No blind paid POST retries; no direct vendor SDK. */
import {createHttpVideoBridge} from '../../packages/providers/src/http-video-bridge.mjs';
import {createLocalVideoStore} from '../../packages/media/src/local-store.mjs';
import * as generationOps from '../../packages/db/src/generation.mjs';

export async function executeOneCycle({pool,provider,store,logger=console,dbOps=generationOps}={}){
  const report={submitted:0,polling:0,ready:0,unknown:0,rejected:0,errors:0,quarantined:0};
  report.quarantined=await dbOps.quarantineStaleSubmissions(pool);
  const job=await dbOps.claimNextSubmit(pool);
  if(job){
    report.submitted++;
    try{
      const submission=await provider.submit({prompt:job.input.prompt,model:job.modelKey},{clientReference:job.id});
      if(submission.outcome==='accepted')await dbOps.markAccepted(pool,job,submission.externalTaskId);
      else if(submission.outcome==='rejected'&&submission.definitelyNotAccepted){await dbOps.rejectDefinitely(pool,job,submission.code);report.rejected++;}
      else {await dbOps.markUnknown(pool,job,'AMBIGUOUS_PROVIDER_RESPONSE');report.unknown++;}
    }catch(e){
      // A thrown POST could have reached the provider; never resubmit on network errors/timeout.
      await dbOps.markUnknown(pool,job,'POST_OUTCOME_UNKNOWN');report.unknown++;
      logger.warn('Provider POST quarantined; paid retry forbidden', {jobId:job.id,errorType:e.name});
    }
  }
  const pending=await dbOps.claimNextPoll(pool);
  if(pending){
    report.polling++;
    try{
      const status=await provider.getStatus(pending.externalTaskId);
      if(status.state==='succeeded'){
        const remote=await provider.openVideo(pending.externalTaskId);
        const asset=await store.ingest(remote);
        await dbOps.completeVideo(pool,pending,{sha256:asset.sha256,storageKey:`local-sha256://${asset.sha256}`,bytes:asset.bytes,
          width:asset.width,height:asset.height,durationSeconds:asset.durationSeconds},status.actualMinor);
        report.ready++;
      }else if(['failed','canceled'].includes(status.state)){
        await dbOps.blockFailedProviderJob(pool,pending);
      }else{
        await dbOps.deferPoll(pool,pending,{delaySeconds:15});
      }
    }catch(e){
      report.errors++;
      // Poll/download are safe to retry; NEVER repeat the paid POST.
      await dbOps.deferPoll(pool,pending,{delaySeconds:30,reason:e.name});
      logger.warn('Safe polling/ingestion retry scheduled',{jobId:pending.id,errorType:e.name});
    }
  }
  return report;
}

export async function startProductionWorker({env=process.env,logger=console}={}){
  if(env.PAID_GENERATION_ENABLED!=='true')throw new Error('Paid generation disabled: set PAID_GENERATION_ENABLED=true only after explicit approval');
  if(!env.DATABASE_URL||!env.PROVIDER_BRIDGE_URL||!env.PROVIDER_BRIDGE_TOKEN)throw new Error('Database and provider bridge credentials required');
  // Production deployment gate: Local disk cannot safely serve multi-node media. An object store must be implemented before multi-node launch.
  if(env.ALLOW_LOCAL_ASSET_STORE!=='true')throw new Error('Local asset store is DEVELOPMENT ONLY; no production object-store adapter wired');
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:5,connectionTimeoutMillis:8000});
  const provider=createHttpVideoBridge({baseUrl:env.PROVIDER_BRIDGE_URL,token:env.PROVIDER_BRIDGE_TOKEN});
  const store=createLocalVideoStore({root:env.MEDIA_PRIVATE_ROOT,requireFfprobe:true});
  try{
    for(;;){
      const report=await executeOneCycle({pool,provider,store,logger});
      if(Object.values(report).some(v=>v))logger.info('CP-003 worker cycle',report);
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
  }finally{await pool.end();}
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  startProductionWorker().catch(e=>{console.error('Worker did not start:',e.message);process.exitCode=1;});
}
