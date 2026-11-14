'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core');
const Presets=require('../src/ai-presets');
const Provider=require('../src/ai-provider');
const Agent=require('../src/ai-agent');

// Fictional credentials, in-memory ledgers and injected transport only.
const fictionalKey='fictional-go-secret';
function settings(extra={}){return {aiEnhancement:{enabled:true,presetId:'opencode-go',baseUrl:'https://opencode.ai/zen/go/v1',apiKey:fictionalKey,model:'fictional-model',agentEnabled:true,agentMaxSeconds:30,agentMaxCalls:12,agentMaxTokens:200000,...extra}};}
function config(extra={}){return Provider.validateConfig(Provider.config(settings(extra)));}
function response(content='OK',extra={}){return {status:200,json:{model:'fictional-model',choices:[{message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7},...extra}};}
const requestBody={model:'fictional-model',messages:[{role:'user',content:'This is a fictional test.'}]};
const finish={type:'finish',message:'可以继续提问，我会先准备修改预览。'};
async function agent(requestUrl,{sessionId,...extra}={}){
 const d=C.blank(),before=JSON.stringify(d);
 const result=await Agent.run('请核对账本概况',{d,book:'daily',settings:settings(),requestUrl,sessionId,writeAccess:true,...extra});
 assert.equal(JSON.stringify(d),before);return result;
}
function captureAgentRequests(){
 const requests=[];
 const request=async params=>{requests.push(params);return response(JSON.stringify(requests.length%2?{type:'tool',name:'stats',arguments:{start:'2024-02-01',end:'2024-02-29'}}:finish));};
 return {requests,request};
}
function assertGoHeaders(headers,id){
 assert.match(headers['User-Agent'],/^carrot-money\/\d+\.\d+\.\d+$/);
 assert.doesNotMatch(headers['User-Agent'],/opencode\/|claude|codex/i);
 assert.match(headers['x-opencode-session'],/^[a-zA-Z0-9_-]{1,128}$/);
 if(id!==undefined)assert.equal(headers['x-opencode-session'],id);
 assert.equal(headers.Authorization,'Bearer '+fictionalKey);
}

for(const baseUrl of ['https://opencode.ai/zen/go/v1','https://opencode.ai/zen/go/v1/chat/completions','https://opencode.ai/inference/go/v1']){
 test(`Go headers identify Carrot Money honestly for ${baseUrl}`,async()=>{
  let captured;
  await Provider.completion(config({baseUrl}),requestBody,Provider.sessionRequest(async params=>{captured=params;return response();},'fictional-session'));
  assertGoHeaders(captured.headers,'fictional-session');assert.equal(captured.throw,false);
  assert.equal(captured.url,Provider.endpoint(baseUrl));
 });
}

for(const baseUrl of ['https://opencode.ai/zen/v1','https://example.invalid/v1','https://opencode.ai.evil.invalid/zen/go/v1','https://sub.opencode.ai/zen/go/v1','https://opencode.ai/zen/good/v1','https://opencode.ai/v1/zen/go/v1','http://localhost:11434/v1']){
 test(`non-Go URL never receives Go identity headers: ${baseUrl}`,async()=>{
  let captured;
  await Provider.completion(config({presetId:'custom',baseUrl}),requestBody,Provider.sessionRequest(async params=>{captured=params;return response();},'fictional-session'));
  assert.equal(captured.headers['User-Agent'],undefined);assert.equal(captured.headers['x-opencode-session'],undefined);
  assert.equal(captured.headers.Authorization,'Bearer '+fictionalKey);
 });
}

test('a Go URL receives required identity headers even when selected as custom',async()=>{
 let captured;
 await Provider.completion(config({presetId:'custom'}),requestBody,async params=>{captured=params;return response();});
 assertGoHeaders(captured.headers);
});

test('MiMo keeps its API-key header without acquiring Go-specific headers',async()=>{
 let captured;
 await Provider.completion(config({presetId:'mimo',baseUrl:'https://api.xiaomimimo.com/v1',model:'mimo-v2.6-flash'}),requestBody,Provider.sessionRequest(async params=>{captured=params;return response();},'fictional-session'));
 assert.equal(captured.headers['api-key'],fictionalKey);assert.equal(captured.headers.Authorization,undefined);
 assert.equal(captured.headers['User-Agent'],undefined);assert.equal(captured.headers['x-opencode-session'],undefined);
});

test('Agent uses one stable session across tool requests and later turns of the same conversation',async()=>{
 const {requests,request}=captureAgentRequests();
 const first=await agent(request,{sessionId:'chat-alpha'}),second=await agent(request,{sessionId:'chat-alpha'});
 assert.equal(first.status,'done');assert.equal(second.status,'done');assert.equal(requests.length,4);
 for(const request of requests)assertGoHeaders(request.headers,'chat-alpha');
 assert.equal(first.usage.totalTokens,36);assert.equal(second.usage.totalTokens,36);
});

test('different Agent conversations never share their explicit session identifier',async()=>{
 const {requests,request}=captureAgentRequests();
 assert.equal((await agent(request,{sessionId:'chat-alpha'})).status,'done');
 assert.equal((await agent(request,{sessionId:'chat-beta'})).status,'done');
 assert.deepEqual(requests.map(x=>x.headers['x-opencode-session']),['chat-alpha','chat-alpha','chat-beta','chat-beta']);
});

test('Agent without a conversation ID creates a fresh session for each turn and keeps it within the turn',async()=>{
 const {requests,request}=captureAgentRequests();
 assert.equal((await agent(request)).status,'done');assert.equal((await agent(request)).status,'done');
 const ids=requests.map(x=>x.headers['x-opencode-session']);
 assert.equal(ids.length,4);assert.equal(ids[0],ids[1]);assert.equal(ids[2],ids[3]);assert.notEqual(ids[0],ids[2]);
 for(const request of requests)assertGoHeaders(request.headers);
});

test('invalid session text is replaced once and never injected into outgoing headers',async()=>{
 const {requests,request}=captureAgentRequests();
 assert.equal((await agent(request,{sessionId:'unsafe\r\nInjected: value'})).status,'done');
 assert.equal(requests[0].headers['x-opencode-session'],requests[1].headers['x-opencode-session']);
 assert.notEqual(requests[0].headers['x-opencode-session'],'unsafe\r\nInjected: value');
 for(const request of requests)assertGoHeaders(request.headers);
});

test('a temporary Agent retry keeps the same session and truthful client identity',async()=>{
 const requests=[];
 const answer=await agent(async params=>{requests.push(params);return requests.length===1?{status:503}:response(JSON.stringify(finish));},{sessionId:'retry-session'});
 assert.equal(answer.status,'done');assert.equal(requests.length,2);
 for(const request of requests)assertGoHeaders(request.headers,'retry-session');
});

test('saved custom configuration restores URL, model, key and reasoning preference together',()=>{
 const original={baseUrl:'https://custom-old.invalid/v1',model:'custom-old-model',apiKey:'fictional-custom-secret',reasoningEffort:'low'};
 let draft=Presets.restore({presetId:'custom',...original});
 Presets.select(draft,'opencode-go');
 assert.equal(draft.baseUrl,Presets.get('opencode-go').baseUrl);assert.equal(draft.apiKey,'');
 Object.assign(draft,{apiKey:fictionalKey,model:'fictional-go-model',reasoningEffort:''});
 Presets.remember(draft);draft=Presets.restore(JSON.parse(JSON.stringify(draft)));
 Presets.select(draft,'custom');
 for(const key of Object.keys(original))assert.equal(draft[key],original[key]);
 Presets.select(draft,'opencode-go');
 assert.equal(draft.baseUrl,Presets.get('opencode-go').baseUrl);assert.equal(draft.model,'fictional-go-model');assert.equal(draft.apiKey,fictionalKey);assert.equal(draft.reasoningEffort,'');
});

test('a first custom selection inherits the editable endpoint but never another provider key',()=>{
 const draft=Presets.restore({presetId:'opencode-go',apiKey:fictionalKey,model:'fictional-go-model'});
 Presets.select(draft,'custom');
 assert.equal(draft.baseUrl,Presets.get('opencode-go').baseUrl);assert.equal(draft.model,'fictional-go-model');assert.equal(draft.apiKey,'');
 assert.equal(draft.profiles['opencode-go'].apiKey,fictionalKey);
});

test('switching between two saved providers never pairs one URL with the other key',()=>{
 const draft=Presets.restore({presetId:'custom',baseUrl:'https://custom-old.invalid/v1',apiKey:'fictional-custom-secret',model:'old',profiles:{'opencode-go':{baseUrl:'https://opencode.ai/zen/go/v1',model:'go',apiKey:fictionalKey}}});
 Presets.select(draft,'opencode-go');assert.equal(draft.baseUrl,'https://opencode.ai/zen/go/v1');assert.equal(draft.apiKey,fictionalKey);
 Presets.select(draft,'custom');assert.equal(draft.baseUrl,'https://custom-old.invalid/v1');assert.equal(draft.apiKey,'fictional-custom-secret');
});

for(const status of [302,400,401,403,404,429,500]){
 test(`non-success HTTP ${status} preserves status and hides raw upstream credentials`,async()=>{
  await assert.rejects(Provider.completion(config(),requestBody,async()=>({status,json:{error:{message:'Authorization: Bearer '+fictionalKey+' private request'}}})),error=>{
   assert.ok(error instanceof Provider.ProviderError);assert.equal(error.status,status);
   assert.match(error.message,new RegExp('HTTP '+status));assert.doesNotMatch(error.message,/fictional-go-secret|Authorization|private request/);return true;
  });
 });
}

test('transport exceptions with status retain it without echoing unsafe exception text',async()=>{
 await assert.rejects(Provider.completion(config(),requestBody,async()=>{throw Object.assign(Error('Authorization: Bearer '+fictionalKey),{status:401});}),error=>{
  assert.ok(error instanceof Provider.ProviderError);assert.equal(error.status,401);assert.match(error.message,/HTTP 401/);assert.doesNotMatch(error.message,/fictional-go-secret|Authorization/);return true;
 });
});

test('known missing-session response gives a useful safe explanation',async()=>{
 await assert.rejects(Provider.completion(config(),requestBody,async()=>({status:400,text:JSON.stringify({error:{message:'Missing x-opencode-session; key='+fictionalKey}})})),error=>{
  assert.equal(error.status,400);assert.match(error.message,/OpenCode Go 缺少会话标识/);assert.doesNotMatch(error.message,/fictional-go-secret|key=/);return true;
 });
});

test('usage totals are computed from returned prompt and completion tokens when absent',async()=>{
 const reply=await Provider.completion(config(),requestBody,async()=>response());
 assert.deepEqual(reply.usage,{prompt_tokens:11,completion_tokens:7,total_tokens:18});
 assert.deepEqual(Provider.usageOf({prompt_tokens:11}),{prompt_tokens:11,total_tokens:11});
 assert.deepEqual(Provider.usageOf({completion_tokens:7}),{completion_tokens:7,total_tokens:7});
 assert.deepEqual(Provider.usageOf({prompt_tokens:11,completion_tokens:7,total_tokens:20}),{prompt_tokens:11,completion_tokens:7,total_tokens:20});
 assert.deepEqual(Provider.usageOf(undefined),{});
});

test('invalid token counters cannot introduce NaN, negative or infinite usage totals',()=>{
 assert.deepEqual(Provider.usageOf({prompt_tokens:NaN,completion_tokens:7,total_tokens:Infinity}),{completion_tokens:7,total_tokens:7});
 assert.deepEqual(Provider.usageOf({prompt_tokens:-10,completion_tokens:7,total_tokens:-3}),{completion_tokens:7,total_tokens:7});
});

test('a reasoning-only length-limited connection test reports connected without claiming Agent success',async()=>{
 let calls=0,captured;
 const result=await Provider.testConnection(settings(),{userInitiated:true,requestUrl:async params=>{calls++;captured=params;return response('',{choices:[{message:{role:'assistant',content:'',reasoning_content:'fictional private reasoning'},finish_reason:'length'}]});}});
 assert.equal(calls,1);assert.equal(result.ok,true);assertGoHeaders(captured.headers);
 assert.equal(JSON.parse(captured.body).max_tokens,512);assert.equal(result.usage.total_tokens,18);
 assert.match(result.message,/连接成功/);assert.match(result.message,/尚未获得正文/);assert.match(result.message,/Agent 工具能力请单独检测/);
 assert.doesNotMatch(result.message,/Agent.*(?:通过|已验证)|fictional private reasoning/);assert.ok(result.elapsedMs>=0);
});

test('an empty completed response is not reported as a successful text connection',async()=>{
 const result=await Provider.testConnection(settings(),{userInitiated:true,requestUrl:async()=>response('',{choices:[{message:{role:'assistant',content:'',reasoning_content:'fictional private reasoning'},finish_reason:'stop'}]})});
 assert.equal(result.ok,false);assert.match(result.message,/未返回可用文本/);assert.doesNotMatch(result.message,/fictional private reasoning/);
});

test('connection tests require user initiation and never contact a service implicitly',async()=>{
 let calls=0;
 const result=await Provider.testConnection(settings(),{requestUrl:async()=>{calls++;return response();}});
 assert.equal(result.ok,false);assert.equal(calls,0);assert.match(result.message,/主动发起/);
});

test('a connection model echo cannot disclose any saved provider key',async()=>{
 const result=await Provider.testConnection(settings({profiles:{custom:{baseUrl:'https://custom-old.invalid/v1',apiKey:'fictional-other-secret',model:'other'}}}),{userInitiated:true,requestUrl:async()=>response('OK',{model:fictionalKey+' fictional-other-secret'})});
 assert.equal(result.ok,true);assert.doesNotMatch(result.message,/fictional-go-secret|fictional-other-secret/);assert.doesNotMatch(result.model,/fictional-go-secret|fictional-other-secret/);
 assert.match(result.model,/已隐藏/);
});


test('configuration validation preserves and bounds the per-turn token budget',()=>{
 const c=Provider.config({aiEnhancement:{presetId:'custom',baseUrl:'https://example.invalid/v1',model:'fictional',agentMaxTokens:54321}});
 assert.equal(Provider.validateConfig(c).agentMaxTokens,54321);
 assert.equal(Provider.config({}).agentMaxTokens,200000);
 for(const n of [9999,1000001,1.5,'bad'])assert.throws(()=>Provider.validateConfig({...c,agentMaxTokens:n}),/token/);
});
