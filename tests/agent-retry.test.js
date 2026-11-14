'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core');
const Agent=require('../src/ai-agent');
const Remote=require('../src/ai-provider');

// Every request is injected. These tests never access a real service or vault.
const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://example.invalid/v1',apiKey:'fictional-test-key',model:'fictional-model',agentEnabled:true,agentMaxSeconds:30,agentMaxCalls:12,agentMaxTokens:200000}};
const finish={type:'finish',message:'可以继续提问，我会先准备修改预览。'};
function response(value=finish,finishReason='stop'){return {status:200,json:{choices:[{message:{role:'assistant',content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:finishReason}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}};}
async function run(requestUrl,extra={}){
 const d=C.blank(),before=JSON.stringify(d);
 const answer=await Agent.run('请说明可以怎样核对账本',{d,book:'daily',settings:C.clone(settings),requestUrl,writeAccess:true,...extra});
 assert.equal(JSON.stringify(d),before,'a failed or answered request must never write the ledger');
 return answer;
}

for(const status of [400,401,402,403,404,405,408,409,415,422,429]){
 test(`HTTP ${status} ends the turn after exactly one request`,async()=>{
  let calls=0;
  const answer=await run(async()=>{calls++;return {status,json:{error:{message:'fictional private response body'}}};});
  assert.equal(calls,1);assert.equal(answer.status,'error');assert.equal(answer.ok,false);
  assert.match(answer.message,new RegExp('HTTP '+status));assert.doesNotMatch(answer.message,/fictional private response body/);
  assert.match(answer.message,/本轮没有执行账本修改/);assert.equal(answer.steps.length,0);
 });
}

test('structured HTTP status is respected without relying on the message text',async t=>{
 let calls=0;
 t.mock.method(Remote,'completion',async()=>{calls++;throw Object.assign(Error('fictional private upstream message'),{status:403});});
 const answer=await run(async()=>assert.fail('the provider is already mocked'));
 assert.equal(calls,1);assert.equal(answer.status,'error');assert.match(answer.message,/HTTP 403/);
 assert.doesNotMatch(answer.message,/fictional private upstream message/);
});

test('legacy sanitized ProviderError text still stops an unrecoverable request',async()=>{
 let calls=0;
 const answer=await run(async()=>{calls++;throw new Remote.ProviderError('HTTP 401：认证失败，请检查 API Key');});
 assert.equal(calls,1);assert.equal(answer.status,'error');assert.match(answer.message,/认证失败/);
});

test('temporary server failures retry the unchanged request within the existing bound',async()=>{
 const requests=[];
 const answer=await run(async request=>{requests.push(JSON.parse(request.body));return requests.length<3?{status:503}:response();});
 assert.equal(requests.length,3);assert.equal(answer.status,'done');assert.equal(answer.ok,true);
 assert.deepEqual(requests[1].messages,requests[0].messages);assert.deepEqual(requests[2].messages,requests[0].messages);
 assert.equal(answer.usage.totalTokens,20);
});

test('persistent server failures stop after three requests',async()=>{
 let calls=0;
 const answer=await run(async()=>{calls++;return {status:502};});
 assert.equal(calls,3);assert.equal(answer.status,'error');assert.match(answer.message,/HTTP 502/);
});

test('a permanent failure on a retry stops without spending the last request',async()=>{
 let calls=0;
 const answer=await run(async()=>({status:++calls===1?503:429}));
 assert.equal(calls,2);assert.equal(answer.status,'error');assert.match(answer.message,/HTTP 429/);
});

test('malformed JSON retains its bounded correction request',async()=>{
 const requests=[];
 const answer=await run(async request=>{requests.push(JSON.parse(request.body));return response(requests.length===1?'this is not JSON':finish);});
 assert.equal(requests.length,2);assert.equal(answer.status,'done');assert.match(requests[1].messages.at(-1).content,/上一轮输出无效/);
});

test('JSON containing HTTP error words is not mistaken for a transport status',async()=>{
 let calls=0;
 const answer=await run(async()=>response(++calls===1?'HTTP 401 is invalid model output':finish));
 assert.equal(calls,2);assert.equal(answer.status,'done');
});

test('invalid model schema still gets at most three correction attempts',async()=>{
 let calls=0;
 const answer=await run(async()=>{calls++;return response({type:'finish'});});
 assert.equal(calls,3);assert.equal(answer.status,'error');assert.match(answer.message,/finish 参数无效/);
});

test('truncated output receives one correction and cannot create unlimited retries',async()=>{
 let calls=0;
 const answer=await run(async()=>{calls++;return response('{"type":"finish","message":"unfinished','length');});
 assert.equal(calls,2);assert.equal(answer.status,'error');assert.match(answer.message,/单次输出太大/);
});

test('fatal errors preserve completed queries and stop before any further model call',async()=>{
 let calls=0;
 const answer=await run(async()=>++calls===1?response({type:'tool',name:'stats',arguments:{start:'2024-02-01',end:'2024-02-29'}}):{status:403});
 assert.equal(calls,2);assert.equal(answer.status,'error');assert.equal(answer.steps.length,1);
 assert.equal(answer.steps[0].name,'stats');assert.match(answer.message,/已完成查询保留/);
});

test('an old timeout message never claims the Agent switched to local processing',async()=>{
 let calls=0;
 const answer=await run(async()=>{calls++;throw new Remote.ProviderError('请求超时（60 秒），已回退本地；迟到结果不会应用');});
 assert.equal(calls,3);assert.equal(answer.status,'error');assert.doesNotMatch(answer.message,/已回退本地/);
 assert.match(answer.message,/本次请求已停止/);assert.match(answer.message,/迟到结果不会应用/);
});

test('timeout wording remains truthful when the total deadline prevents a retry',async()=>{
 let elapsed=0,calls=0;
 const answer=await run(async()=>{calls++;elapsed=31000;throw new Remote.ProviderError('请求超时（60 秒），已回退本地；迟到结果不会应用');},{clock:()=>elapsed});
 assert.equal(calls,1);assert.equal(answer.status,'error');assert.doesNotMatch(answer.message,/已回退本地/);
 assert.match(answer.message,/本次请求已停止/);
});

test('cancellation never launches a retry',async()=>{
 const controller=new AbortController();let calls=0;
 const answer=await run(async()=>{calls++;controller.abort();return {status:503};},{signal:controller.signal});
 assert.equal(calls,1);assert.equal(answer.status,'stopped');
});

test('unknown network failures never disclose raw credentials or request details',async()=>{
 let calls=0;
 const answer=await run(async()=>{calls++;throw Error('Authorization: Bearer fictional-private-key JSON request body');});
 assert.equal(calls,3);assert.equal(answer.status,'error');assert.match(answer.message,/网络请求失败/);
 assert.doesNotMatch(answer.message,/Authorization|fictional-private-key|request body/);
});
