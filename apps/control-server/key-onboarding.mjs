const providers={aiide:['video','AIIDE Video'],volcengine:['video','Volcengine Video'],google:['creative','Google'],openai:['creative','OpenAI'],other:['creative','Lainnya']};
function invalid(code){
 throw Object.assign(new Error(code),{code,status:422});
}
export function keyOnboardingInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('KEY_INPUT_INVALID');
 const keys=Object.keys(input);
 if(keys.some(k=>!['secret','provider','group','label','dailyLimit','priority','enabled'].includes(k)))invalid('KEY_INPUT_INVALID');
 if(keys.some(k=>k!=='provider'&&k!=='secret')){
  if(!input.group||!input.provider)invalid('KEY_INPUT_INVALID');
  return input;
 }
 const secret=input.secret;
 if(typeof secret!=='string'||secret.length<12)invalid('KEY_INPUT_INVALID');
 let provider=input.provider;
 if(provider===undefined){
  if(/^sk-(proj|svcacct)-/.test(secret))provider='openai';
  else if(/^AIza[A-Za-z0-9_-]{35}$/.test(secret))provider='google';
  else invalid('KEY_PROVIDER_REQUIRED');
 }
 if(!Object.hasOwn(providers,provider))invalid('KEY_INPUT_INVALID');
 const [group,label]=providers[provider];
 return {group,provider,label,secret,dailyLimit:provider==='aiide'?null:100,priority:5,enabled:true};
}
