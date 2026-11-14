'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Diagnostic=require('../src/ai-diagnostics'),Agent=require('../src/ai-agent'),Remote=require('../src/ai-provider');
const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://example.invalid/v1',apiKey:'fictional-diagnostic-key',model:'fictional-model',agentEnabled:true,timeoutSeconds:120,agentMaxSeconds:300,agentMaxCalls:24,agentMaxOutputTokens:16384}};
const stats={type:'tool',name:'stats',arguments:{start:'2024-02-01',end:'2024-02-29'}};
const finish={type:'finish',message:'收入 ¥200.00，净支出 ¥40.00，结余 ¥160.00。'};
function response(value,reason='stop'){return {status:200,json:{choices:[{message:{role:'assistant',content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:reason}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}};}
const copy=()=>JSON.parse(JSON.stringify(settings));

test('Agent diagnostic verifies real local tool results using only fictional data',async()=>{
 const s=copy(),before=JSON.stringify(s),requests=[];
 const result=await Diagnostic.testAgent(s,{userInitiated:true,requestUrl:async req=>{requests.push(JSON.parse(req.body));return response(requests.length===1?stats:finish);}});
 assert.equal(result.ok,true);assert.equal(result.toolCalls,1);assert.equal(result.usage.totalTokens,30);assert.equal(result.usage.reported,true);
 assert.deepEqual(Object.keys(result).sort(),['elapsedMs','message','ok','toolCalls','usage']);assert.ok(result.elapsedMs>=0);
 assert.match(result.message,/实际调用统计工具/);assert.equal(requests.length,2);
 assert.match(JSON.stringify(requests[1].messages),/本地工具 stats 返回/);
 assert.doesNotMatch(JSON.stringify(requests),/NEVER_SEND_OTHER_BOOK|fictional-diagnostic-key/);
 assert.doesNotMatch(JSON.stringify(result),/fictional-diagnostic-key|apiKey|entries|NEVER_SEND_OTHER_BOOK/);
 assert.equal(JSON.stringify(s),before);
});

test('an ordinary final answer cannot pass without calling the statistics tool',async()=>{
 let calls=0;
 const result=await Diagnostic.testAgent(copy(),{userInitiated:true,requestUrl:async()=>{calls++;return response({type:'finish',message:'统计测试完成。'});}});
 assert.equal(calls,1);assert.equal(result.ok,false);assert.equal(result.toolCalls,0);assert.match(result.message,/没有完成统计工具调用/);
});

test('a statistics call over the wrong period cannot pass even when the model finishes',async()=>{
 let calls=0;
 const result=await Diagnostic.testAgent(copy(),{userInitiated:true,requestUrl:async()=>response(++calls===1?{...stats,arguments:{start:'2023-02-01',end:'2023-02-28'}}:{type:'finish',message:'统计测试完成。'})});
 assert.equal(calls,2);assert.equal(result.ok,false);assert.equal(result.toolCalls,1);
});

test('HTTP 400 is a failure, stops immediately, and does not expose server contents',async()=>{
 let calls=0;
 const result=await Diagnostic.testAgent(copy(),{userInitiated:true,requestUrl:async()=>{calls++;return {status:400,json:{error:{message:'fictional-diagnostic-key private request body'}}};}});
 assert.equal(calls,1);assert.equal(result.ok,false);assert.match(result.message,/HTTP 400/);assert.doesNotMatch(JSON.stringify(result),/fictional-diagnostic-key|private request body/);
});

test('explicit initiation, enabled service, key and enabled Agent are required',async()=>{
 const transport=async()=>assert.fail('blocked diagnostics must not send a request');
 const unrequested=await Diagnostic.testAgent(copy(),{requestUrl:transport});assert.equal(unrequested.ok,false);assert.match(unrequested.message,/主动点击/);
 for(const [values,expected]of [[{enabled:false},/服务未开启/],[{apiKey:''},/未配置 API Key/],[{agentEnabled:false},/Agent 未开启/]]){
  const s=copy();Object.assign(s.aiEnhancement,values);
  const result=await Diagnostic.testAgent(s,{userInitiated:true,requestUrl:transport});assert.equal(result.ok,false);assert.match(result.message,expected);assert.equal(result.toolCalls,0);
 }
});

test('invalid configuration fails clearly without any request',async()=>{
 const s=copy();s.aiEnhancement.baseUrl='not a service URL';
 const result=await Diagnostic.testAgent(s,{userInitiated:true,requestUrl:async()=>assert.fail('invalid settings must not be sent')});
 assert.equal(result.ok,false);assert.match(result.message,/配置无效/);
});

test('diagnostic caps tool, time and output budgets, including truncation retries',async t=>{
 const original=Agent.run.bind(Agent),completion=Remote.completion.bind(Remote),configs=[],bodies=[];let runOptions;
 t.mock.method(Agent,'run',(question,opts)=>{runOptions=opts;return original(question,opts);});
 t.mock.method(Remote,'completion',(c,...args)=>{configs.push(c);return completion(c,...args);});
 const result=await Diagnostic.testAgent(copy(),{userInitiated:true,requestUrl:async req=>{
  bodies.push(JSON.parse(req.body));
  if(bodies.length===1)return response('{"type":"tool"','length');
  return response(bodies.length===2?stats:finish);
 }});
 assert.equal(result.ok,true);assert.equal(bodies.length,3);
 assert.ok(bodies.every(b=>b.max_tokens===2048));assert.ok(configs.every(c=>c.timeoutSeconds===45));
 assert.equal(runOptions.settings.aiEnhancement.agentMaxCalls,4);assert.equal(runOptions.settings.aiEnhancement.agentMaxSeconds,90);
 assert.equal(runOptions.settings.aiEnhancement.agentMaxOutputTokens,2048);assert.equal(runOptions.writeAccess,false);assert.equal(runOptions.workflowMode,'read');
});

test('shorter user timeouts remain shorter and unexpected changes cannot pass',async t=>{
 const s=copy();Object.assign(s.aiEnhancement,{timeoutSeconds:5,agentMaxSeconds:20});
 t.mock.method(Agent,'run',async(_q,opts)=>{
  assert.equal(opts.settings.aiEnhancement.timeoutSeconds,5);assert.equal(opts.settings.aiEnhancement.agentMaxSeconds,20);
  opts.d.entries[0].amount=1;
  return {ok:true,status:'done',toolCalls:1,usage:{totalTokens:20}};
 });
 const result=await Diagnostic.testAgent(s,{userInitiated:true,requestUrl:async()=>assert.fail('mocked run must not request')});
 assert.equal(result.ok,false);assert.match(result.message,/意外变化/);
});

test('a done status with incorrect returned tool totals cannot pass',async t=>{
 t.mock.method(Agent,'run',async()=>({ok:true,status:'done',toolCalls:1,usage:{},steps:[{name:'stats',arguments:stats.arguments}],memory:{toolResults:[{name:'stats',arguments:stats.arguments,result:{data:{currency:'CNY',count:4,income:20000,expense:94000,grossExpense:95000,netExpense:94000}}}]}}));
 const result=await Diagnostic.testAgent(copy(),{userInitiated:true});
 assert.equal(result.ok,false);assert.match(result.message,/没有完成统计工具调用/);
});

test('compatible completion-token budgets are also bounded without exposing credentials',async t=>{
 t.mock.method(Agent,'run',async(_q,opts)=>{
  await opts.requestUrl({body:JSON.stringify({max_completion_tokens:32768,messages:[]})});
  return {ok:false,status:'error',message:'fictional-diagnostic-key raw provider failure',toolCalls:0,usage:{}};
 });
 const result=await Diagnostic.testAgent(copy(),{userInitiated:true,requestUrl:async req=>{const body=JSON.parse(req.body);assert.equal(body.max_completion_tokens,2048);assert.equal(body.max_tokens,undefined);return response(finish);}});
 assert.equal(result.ok,false);assert.doesNotMatch(result.message,/fictional-diagnostic-key|raw provider failure/);
});
