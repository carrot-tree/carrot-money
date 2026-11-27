'use strict';
const C=require('./core'),Remote=require('./ai-provider');
const START='2024-02-01',END='2024-02-29',OUTPUT_LIMIT=2048;
const question='使用当前虚构账本进行只读统计测试。第一步必须调用 stats，参数为 '+JSON.stringify({start:START,end:END})+'。收到本地工具结果后，第二步返回严格 JSON：{"type":"finish","message":"用中文说明查询得到的收入、净支出和结余"}。只能读取当前账本，不添加筛选条件，不跳过工具，不从问题猜测数字，不执行其他操作。';
const emptyUsage=()=>({promptTokens:0,completionTokens:0,totalTokens:0,reported:false});
function usageOf(value){const n=x=>Number.isFinite(x)&&x>=0?Math.floor(x):0;return {promptTokens:n(value?.promptTokens),completionTokens:n(value?.completionTokens),totalTokens:n(value?.totalTokens),reported:value?.reported===true};}
function ledger(){
 const d=C.blank();d.books.push({id:'hidden',name:'隔离虚构账本',archived:false});
 d.accounts=[{id:'wallet',name:'虚构钱包',type:'支付宝',currency:'CNY',rate:1,opening:0,archived:false}];
 const row=(id,seed={})=>C.newEntry(d,{id,date:'2024-02-10',book:'daily',account:'wallet',amount:5000,title:'虚构午餐',...seed});
 d.entries=[row('expense'),row('refund',{kind:'refund',amount:1000,related:'expense'}),row('income',{kind:'income',category:'cat-9',amount:20000,title:'虚构工资'}),row('hidden',{book:'hidden',amount:90000,title:'NEVER_SEND_OTHER_BOOK'})];
 return C.validate(d);
}
// No host vault is supplied. Even an unexpected file tool cannot touch disk.
function isolatedVault(){const denied=()=>{throw Error('能力测试不支持文件操作');};return {adapter:{exists:async()=>false,read:denied},getAbstractFileByPath:()=>null,createFolder:denied,create:denied,modify:denied,process:denied};}
function failedMessage(answer){
 const text=String(answer?.message||''),status=Number(/\bHTTP\s+(\d{3})\b/.exec(text)?.[1]);
 if(status>=400&&status<=599)return 'Agent 能力测试未通过：'+Remote.httpReason(status);
 if(/超时|总时长|时长已到/.test(text))return 'Agent 能力测试超时，尚未完成统计工具验证。';
 if(/JSON|输出太大|截断|返回.*格式/.test(text))return 'Agent 能力测试未通过：模型未返回完整、有效的操作格式。';
 if(/网络请求失败|服务域名|连接被重置|服务拒绝连接/.test(text))return 'Agent 能力测试未通过：网络请求失败，请检查服务地址与网络。';
 return 'Agent 能力测试未通过：没有完成统计工具调用与最终答复验证。';
}
function verifiedStats(answer){
 const sameRange=q=>q?.start===START&&q?.end===END&&Object.keys(q).every(k=>['start','end','groupBy'].includes(k));
 const step=answer.steps?.some(s=>s.name==='stats'&&!s.error&&!s.cached&&sameRange(s.arguments));
 const result=answer.memory?.toolResults?.some(r=>{const x=r.result?.data;return r.name==='stats'&&!r.result?.error&&sameRange(r.arguments)&&x?.currency==='CNY'&&x.count===3&&x.income===20000&&x.expense===4000&&x.grossExpense===5000&&x.netExpense===4000&&x.income-x.expense===16000;});
 return step&&result;
}
async function testAgent(settings,{requestUrl,userInitiated=false}={}){
 const started=Date.now();let current={toolCalls:0,usage:emptyUsage()};
 const result=(ok,message)=>({ok,message,elapsedMs:Math.max(0,Date.now()-started),toolCalls:Number.isSafeInteger(current.toolCalls)&&current.toolCalls>=0?current.toolCalls:0,usage:usageOf(current.usage)});
 if(!userInitiated)return result(false,'请主动点击「测试 Agent 能力」后再执行测试。');
 try{
  const c=Remote.config(settings);
  if(!c.enabled)return result(false,'AI 服务未开启，请先开启后测试。');
  if(!Remote.hasCredentials(c))return result(false,'未配置 API Key，请先填写后测试。');
  if(!c.agentEnabled)return result(false,'Agent 未开启，请先开启后测试。');
  let validated;try{validated=Remote.validateConfig(c);}catch{return result(false,'AI 服务配置无效，请检查地址、模型、超时和思考选项。');}
  const testSettings={aiEnhancement:{...validated,agentConfigVersion:3,timeoutSeconds:Math.min(validated.timeoutSeconds,45),agentMaxSeconds:Math.min(validated.agentMaxSeconds,90),agentMaxCalls:4,agentMaxOutputTokens:OUTPUT_LIMIT}};
  // Agent truncation retries can request a larger output budget. Clamp every
  // actual request as well as its initial configuration, including compatible APIs.
  const boundedRequest=async request=>{
   const body=JSON.parse(request.body);
   for(const key of ['max_tokens','max_completion_tokens'])if(body[key]!==undefined)body[key]=Math.min(Number(body[key])||OUTPUT_LIMIT,OUTPUT_LIMIT);
   if(body.max_tokens===undefined&&body.max_completion_tokens===undefined)body.max_tokens=OUTPUT_LIMIT;
   const transport=requestUrl||require('obsidian').requestUrl;
   return transport({...request,body:JSON.stringify(body)});
  };
  const d=ledger(),before=JSON.stringify(d);
  const answer=await require('./ai-agent').run(question,{d,book:'daily',vault:isolatedVault(),settings:testSettings,requestUrl:boundedRequest,writeAccess:false,workflowMode:'read',onProgress:value=>{current={toolCalls:value.toolCalls,usage:usageOf(value.usage)};}});
  current={toolCalls:answer.toolCalls,usage:usageOf(answer.usage)};
  if(JSON.stringify(d)!==before)return result(false,'Agent 能力测试未通过：虚构账本发生了意外变化。');
  if(answer.ok!==true||answer.status!=='done'||!verifiedStats(answer))return result(false,failedMessage(answer));
  return result(true,'Agent 能力测试通过：已实际调用统计工具，核验收入、退款净额与账本隔离，并完成答复；未修改账本。');
 }catch(error){return result(false,failedMessage({message:Remote.transportReason(error)}));}
}
module.exports={testAgent};
