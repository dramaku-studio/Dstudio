import test from 'node:test';
import assert from 'node:assert/strict';
import {compileAiideRequest} from '../src/aiide-video-plan.mjs';
const image={id:'image',kind:'image',mime:'image/png',bytes:1000,sha256:'a'};
const input={model:'dreamina-seedance-2-0-mini-hc',mode:'reference',prompt:'@image1 moves to @audio1',ratio:'16:9',resolution:'480p',duration:5,assets:[]};
function compile(assets){return compileAiideRequest({...input,assets:assets.map(a=>({assetId:a.id,role:'reference_'+a.kind}))},id=>assets.find(a=>a.id===id),{mockReferences:true});}
const audio=(id,durationSeconds,bytes=1000)=>({id,kind:'audio',mime:'audio/mpeg',durationSeconds,bytes,sha256:id});
test('audio uses aggregate 30 seconds and 5 MiB, not individual-file checks alone',()=>{
 assert.equal(compile([image,audio('a',15),audio('b',15)]).attachmentCount,3);
 assert.throws(()=>compile([image,audio('a',16),audio('b',15)]),{code:'REFERENCE_AUDIO_TOTAL_DURATION'});
 assert.throws(()=>compile([image,audio('a',10,3*1024*1024),audio('b',10,3*1024*1024)]),{code:'REFERENCE_AUDIO_MAX_5MB'});
 assert.throws(()=>compile([image,{...audio('a',10),mime:'audio/wav'}]),{code:'REFERENCE_AUDIO_MP3_REQUIRED'});
});
test('video bytes, aggregate provider duration and image counts cannot bypass compiler',()=>{
 const video={id:'v',kind:'video',mime:'video/mp4',durationSeconds:10,bytes:1000,sha256:'v'};
 assert.throws(()=>compile([image,{...video,bytes:5*1024*1024+1}]),{code:'REFERENCE_FILE_MAX_5MB'});
 assert.throws(()=>compile([image,video,{...video,id:'v2'}]),{code:'REFERENCE_VIDEO_TOTAL_DURATION'});
 assert.throws(()=>compile(Array.from({length:10},(_,i)=>({...image,id:'i'+i}))),{code:'REF_LIMIT'});
});
