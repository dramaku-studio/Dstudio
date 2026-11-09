/** Localhost-only test bridge. Never expose or deploy as a public provider. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
export async function startFixtureBridge({mp4Path,token='development-token-0123456789',port=0}={}){
  const tasks=new Map();let postCount=0;
  const server=http.createServer(async(req,res)=>{
    const reply=(code,obj)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj));};
    if(req.headers.authorization!==`Bearer ${token}`)return reply(401,{error:'unauthorized'});
    const m=/^\/v1\/video\/tasks\/([A-Za-z0-9_-]+)(\/file)?$/.exec(new URL(req.url,'http://localhost').pathname);
    if(req.method==='POST' && req.url==='/v1/video/tasks'){
      const idem=req.headers['idempotency-key'];if(typeof idem!=='string'||idem.length>128)return reply(422,{definitely_not_accepted:true,code:'IDEMPOTENCY_REQUIRED'});
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return reply(413,{error:'too_large'});}
      let input;try{input=JSON.parse(body);}catch{return reply(422,{definitely_not_accepted:true,code:'INVALID_JSON'});}
      if(typeof input.prompt!=='string'||!input.prompt.trim())return reply(422,{definitely_not_accepted:true,code:'INVALID_PROMPT'});
      postCount++;const taskId=`fixture_${idem}`;
      if(!tasks.has(taskId))tasks.set(taskId,{state:'succeeded',actual_minor:125});
      return reply(202,{outcome:'accepted',task_id:taskId});
    }
    if(m){
      const task=tasks.get(m[1]);if(!task)return reply(404,{error:'unknown'});
      if(req.method==='GET' && m[2]==='/file'){
        const b=await readFile(mp4Path);res.writeHead(200,{'content-type':'video/mp4','content-length':b.length,'cache-control':'no-store'});return res.end(b);
      }
      if(req.method==='GET'&&!m[2])return reply(200,task);
    }
    return reply(404,{error:'not_found'});
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,token, get postCount(){return postCount;},close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
