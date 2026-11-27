'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),Remote=require('../src/ai-provider'),Presets=require('../src/ai-presets'),Reasoning=require('../src/ai-reasoning'),Models=require('../src/ai-models');
const Agent=require('../src/ai-agent'),Action=require('../src/ai-ask-action'),Write=require('../src/ai-agent-write'),Entries=require('../src/ai-entry-actions');
const UI=require('../src/ai-ask-view'),Sessions=require('../src/ai-sessions'),Workflow=require('../src/ai-workflow'),WorkflowActions=require('../src/ai-workflow-actions');
const AIUI=require('../src/ai-view'),Reply=require('../src/ai-reply'),Caps=require('../src/ai-capabilities');
const settings=(baseUrl='http://localhost:11434/v1',apiKey='')=>({aiEnhancement:{enabled:true,presetId:'custom',baseUrl,apiKey,model:'synthetic',agentConfigVersion:3}});
const wire=(content,usage,finish_reason='stop')=>({status:200,json:{choices:[{message:{content},finish_reason}],usage}});
const body={model:'synthetic',messages:[{role:'user',content:'fictional'}]};
const entry=(d,id,seed={})=>C.newEntry(d,{id,title:id,date:'2026-10-01',amount:100,...seed});
const account=id=>({id,name:id,opening:0,currency:'CNY',rate:1});
function view(d=C.blank()){
 d.settings={...d.settings,...settings()};
 const vault={},saved=[];
 const sessions={vault,get:()=>null,save:async(book,state)=>{saved.push(Sessions.snapshot(state,book));}};
 const v={d,book:'daily',app:{vault},p:{store:{vault},sessions,change:async(fn,{check}={})=>{
  check?.();const draft=C.clone(v.d);fn(draft);C.validate(draft);check?.();v.d=draft;
 }},render(){}};
 return {v,s:UI.stateFor(v,'ai'),saved};
}

test('loopback supports empty auth, model discovery requires user initiation, and link-local metadata is rejected',async()=>{
 for(const address of ['localhost','127.0.0.1','[::1]']){
  const config=settings('http://'+address+':11434/v1');
  assert.equal(Remote.unavailable(config,true),'');assert.deepEqual(Presets.headers(Remote.config(config)),{});
 }
 assert.match(Remote.unavailable(settings('http://192.168.1.1/v1'),true),/未配置/);
 assert.throws(()=>Remote.endpoint('http://169.254.169.254/v1'),/HTTPS/);
 let calls=0;
 const requestUrl=async p=>{calls++;assert.equal(p.method,'GET');assert.deepEqual(p.headers,{});return {status:200,json:{data:[{id:'b'},'a',{name:'b'}]}};};
 assert.equal((await Models.readModels(settings(),{requestUrl,userInitiated:false})).ok,false);
 assert.equal(calls,0);
 assert.deepEqual((await Models.readModels(settings(),{requestUrl,userInitiated:true})).models,['a','b']);
 assert.equal(calls,1);
});

test('reasoning model wire options use the provider-compatible completion budget',()=>{
 for(const model of ['o1','o3-2025-04-16','o4-mini','gpt-5.4']){
  const c={...Remote.config(settings()),model};
  assert.deepEqual(Reasoning.body(c,{model,temperature:0,max_tokens:100}),{model,max_completion_tokens:100});
 }
 const c={...Remote.config(settings()),model:'deepseek-reasoner'};
 assert.deepEqual(Reasoning.body(c,{model:c.model,temperature:0,max_tokens:100}),{model:c.model,max_tokens:100});
 assert.equal(Remote.brief('正常 1234','1'),'正常 1234');
 assert.equal(Remote.brief('contains fictional-secret','fictional-secret'),'contains [已隐藏]');
});

test('HTTP 408 and 429 retry with the same session, normalize text parts and reconstruct usage',async()=>{
 const params=[],c=Remote.config(settings('https://opencode.ai/zen/go/v1','fictional-key'));
 const request=Remote.sessionRequest(async p=>{
  params.push(p);return params.length===1?{status:408}:params.length===2?{status:429}:wire([{type:'text',text:'hel'},'lo',{type:'image',url:'ignored'}],{total_tokens:0,prompt_tokens:6,completion_tokens:2});
 },'synthetic-session');
 const answer=await Remote.completion(c,body,request);
 assert.equal(answer.content,'hello');assert.equal(answer.usage.total_tokens,8);
 assert.equal(params.length,3);
 assert.deepEqual(params.map(p=>p.headers['x-opencode-session']),Array(3).fill('synthetic-session'));
 assert.equal(params[0].headers['User-Agent'],'carrot-money/'+require('../manifest.json').version);
});

test('revocation between retries and a late transport rejection cannot issue another request',async()=>{
 const c=Remote.config(settings());let calls=0,allowed=true;
 await assert.rejects(Remote.completion(c,body,async()=>{calls++;allowed=false;return {status:429};},{shouldContinue:()=>allowed}),/已停止/);
 assert.equal(calls,1);
 const controller=new AbortController();let rejectTransport;
 const pending=Remote.completion(c,body,()=>new Promise((_,reject)=>{rejectTransport=reject;}),{signal:controller.signal});
 await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,/已停止/);
 rejectTransport(Error('late rejection'));await new Promise(r=>setImmediate(r));
});

test('missing and metadata-only usage still consumes the Agent budget',async()=>{
 const d=C.blank();let calls=0;
 const config=settings();config.aiEnhancement.agentMaxTokens=10000;
 const result=await Agent.run('查当前月账目',{d,book:'daily',settings:config,requestUrl:async()=>{
  calls++;return wire(JSON.stringify({type:'tool',name:'categories',arguments:{}})+' '.repeat(40_000),{total_tokens:0,prompt_tokens_details:{cached_tokens:1}});
 }});
 assert.equal(calls,1);assert.equal(result.status,'partial');assert.match(result.message,/token/);
 assert.equal(result.usage.reported,false);assert.ok(result.usage.totalTokens>=10000);
});

test('session archive, rename and switching clear pending saves and roll back storage failures',async()=>{
 const {v,s,saved}=view();const first=s.sessionId;
 s.input='keep the draft';UI.scheduleSave(v,s);assert.ok(s.saveTimer);
 assert.equal(await UI.newSession(v),true);assert.equal(s.saveTimer,null);
 assert.equal(s.sessions.find(x=>x.id===first).input,'keep the draft');
 const second=s.sessionId,save=v.p.sessions.save;v.p.sessions.save=async()=>{throw Error('fictional sync conflict');};
 assert.equal(await UI.selectSession(v,first),false);assert.equal(s.sessionId,second);
 assert.equal(await UI.renameSession(v,'should roll back'),false);assert.equal(s.sessions.find(x=>x.id===second).title,'新会话');
 assert.equal(await UI.archiveSession(v,second),false);assert.equal(s.sessions.find(x=>x.id===second).archived,undefined);
 v.p.sessions.save=save;assert.equal(await UI.archiveSession(v,second),true);assert.equal(s.sessionId,first);
 const count=saved.length;s.input='later';UI.scheduleSave(v,s);await UI.clear(v,'ai');
 assert.equal(s.saveTimer,null);assert.equal(saved.length,count+1);
});

test('provider identity changes revoke consent and stop work for every open book',()=>{
 const {v,s}=view();
 UI.agree(v,true);assert.equal(UI.toggleAI(v),true);
 s.controller=new AbortController();const first=s.controller;
 v.book='other';const other=UI.stateFor(v,'ai');UI.agree(v,true);assert.equal(UI.toggleAI(v),true);other.controller=new AbortController();const second=other.controller;
 v.d.settings.aiEnhancement.baseUrl='http://127.0.0.1:18888/v1';
 UI.syncAvailability(v);
 assert.ok(first.signal.aborted&&second.signal.aborted);
 assert.equal(s.enabled,false);assert.equal(other.agreed,false);
 assert.match(s.error,/地址已变化/);
});

test('cancelled or closed submit does not persist a late result into another generation',async()=>{
 const {v,s,saved}=view();UI.agree(v,true);UI.toggleAI(v);
 let release,arrive;
 const reached=new Promise(resolve=>{arrive=resolve;});
 const writing=UI.submit(v,'给出简短建议',{mode:'ai',requestUrl:async()=>{arrive();return new Promise(resolve=>{release=resolve;});}});
 await reached;
 v.aiClosed=true;const before=saved.length;
 await UI.dispose(v);
 release(wire('{"type":"finish","message":"late"}',{total_tokens:10}));
 await writing;assert.equal(saved.length,before);assert.equal(s.saveTimer,null);
});

test('packing keeps receipts and active signatures and limits history tool payloads',()=>{
 const result={summary:'query',data:{rows:Array.from({length:500},(_,i)=>({id:String(i),note:'private test fixture'}))}};
 const answer={status:'preview',signatures:['required'],memory:{reviewRanges:[{start:'2026-10-01'}],toolResults:Array(20).fill({name:'rows',result})}};
 const active=Sessions.turnForDisk({question:'preview',answer,turnId:'active'},'daily');
 const done=Sessions.turnForDisk({question:'done',answer,turnId:'done',phase:'done',receipt:{book:'daily',ids:['e']}},'daily');
 assert.equal(active.answer.memory.toolResults.length,12);
 assert.equal(active.answer.memory.toolResults[0].result.data.rowCount,500);
 assert.doesNotMatch(JSON.stringify(active),/private test fixture/);
 assert.deepEqual(active.answer.signatures,['required']);
 assert.equal(done.answer.signatures,undefined);assert.deepEqual(done.receipt.ids,['e']);
});

test('non-category actions do not require a linked return, and zero-restore keeps the receipt',async()=>{
 const d=C.blank();d.entries.push(entry(d,'e'),entry(d,'r',{kind:'refund',related:'e',amount:10}));
 const {v,s,saved}=view(d);s.enabled=true;
 const plan=Action.preview(d,'daily',{intent:'action',action:'add_tag',start:'2026-10-01',end:'2026-10-01',ids:['e'],tags:['test']});
 const turn={question:'tag',answer:plan,book:'daily',mode:'ai',source:v.d};s.turns.push(turn);
 const change=v.p.change;v.p.change=async()=>{throw Error('simulated conflict');};
 await UI.confirmSelected(v,turn,['e']);assert.equal(turn.answer.selectionIds,undefined);assert.equal(saved.at(-1).sessions[0].turns[0].answer.selectionIds,undefined);
 v.p.change=change;await UI.confirmSelected(v,turn,['e']);
 assert.deepEqual(v.d.entries.map(t=>t.tags),[['test'],[]]);
 const receipt=turn.receipt;v.d.entries[0].tags=['later'];
 await UI.undo(v,turn);assert.equal(turn.receipt,receipt);assert.equal(turn.phase,'done');assert.match(turn.warning,/已撤销 0 笔/);
});

test('delete undo skips missing parents and new or changed relationships without losing unrelated entries',()=>{
 const d=C.blank();d.trash.push(entry(d,'orphan',{kind:'refund',related:'missing'}),entry(d,'safe'));
 assert.deepEqual(Write.undo(d,{name:'delete_entries',book:'daily',ids:['orphan','safe']}),{restored:1,skipped:1});
 assert.deepEqual(d.entries.map(t=>t.id),['safe']);assert.deepEqual(d.trash.map(t=>t.id),['orphan']);
});

test('created categories and accounts cannot be undone while saved filters or chart defaults refer to them',()=>{
 const d=C.blank();
 const category=Write.apply(d,Write.preview(d,'daily','create_category',{name:'虚构',type:'expense'}));
 const a=Write.apply(d,Write.preview(d,'daily','create_account',{name:'虚构账户',type:'cash'}));
 d.settings.savedEntryFilters=[{id:'saved',name:'saved',book:'daily',month:'',sort:'date-desc',filters:{category:category.id}}];
 d.settings.chartDefaults={daily:{reports:{barHidden:{account:[a.id]}}}};
 assert.equal(Write.undo(d,category).restored,0);assert.equal(Write.undo(d,a).restored,0);
 d.settings.savedEntryFilters[0].filters={query:category.id};d.settings.chartDefaults={};
 assert.equal(Write.undo(d,category).restored,1);assert.equal(Write.undo(d,a).restored,1);
});

test('split entry edits rebalance integer cents and preserve the existing preview ID',()=>{
 const d=C.blank();d.accounts.push(account('a'),account('b'));
 const p=Entries.preview(d,'daily','create_entry',{kind:'expense',title:'test',category:'cat-0',date:'2026-10-01',amount:100,splits:[{account:'a',amount:25},{account:'b',amount:75}]});
 const next=Entries.edit(d,p,p.ids[0],{amount:105});
 assert.deepEqual(next.ids,p.ids);
 assert.deepEqual(next.request.splits.map(x=>x.amount),[26,79]);
});

test('workflow resumes report error with its original path and explicit skip releases dependent work',async t=>{
 const {v,s}=view();s.enabled=true;
 const plan=Workflow.create({title:'测试',steps:[{title:'报告',instruction:'生成十月报告',mode:'read'},{title:'下一步',instruction:'按现有资料核对',mode:'read',dependsOn:[1]}]},{book:'daily',question:'测试'});
 const first=plan.steps[0],path='Carrot记账/导出/分析报告-2026-10.html';
 s.turns.push({question:'plan',book:'daily',answer:{taskPlan:plan}},{question:'report',book:'daily',workflow:{id:plan.id,stepId:first.id},answer:{status:'error',path}});
 const submit=t.mock.method(UI,'submit',async()=>{});
 assert.equal(await WorkflowActions.run(v,plan.id,first.id),true);
 assert.equal(submit.mock.calls[0].arguments[2].resumeReportPath,path);
 assert.equal(Workflow.derive(plan,s.turns).steps[1].blockedBy.length,1);
 Workflow.skip(plan,first.id,s.turns);assert.equal(Workflow.derive(plan,s.turns).steps[1].canRun,true);
});

test('mobile copy and report failures expose friendly text and AI stop aborts every book',async()=>{
 const writes=[];await Reply.copy('示例',{writeText:async x=>writes.push(x)});
 assert.deepEqual(writes,['示例']);assert.match(Reply.html('## 标题\n<script>bad</script>'),/&lt;script&gt;/);
 await assert.rejects(Reply.copy('test'),/当前设备无法直接复制/);
 const {v}=view();v.app.vault={adapter:{}};const turn={book:'daily',answer:{path:'Carrot记账/导出/分析报告-2026-10.html'}};
 await UI.openReport(v,turn);assert.match(turn.reportStatus,/当前设备/);
 const a=new AbortController(),b=new AbortController();v.aiStates=new Map([['daily',{enhanceController:a}],['other',{enhanceController:b}]]);AIUI.stop(v);
 assert.ok(a.signal.aborted&&b.signal.aborted);
 assert.ok(Object.hasOwn(Caps.manual,Caps.infer('list_reports')));
 assert.ok(Object.hasOwn(Caps.manual,Caps.infer('write_budget')));
});

test('review and candidate truncation each halve the failed batch exactly once',async()=>{
 const Review=require('../src/ai-review-job'),Candidate=require('../src/ai-candidate-job');
 const d=C.blank(),range={start:'2026-10-01',end:'2026-10-31'},config=settings(),cfg=Agent.config(config);
 for(let i=0;i<80;i++)d.entries.push(entry(d,'sample'+i,{note:'sample target'}));
 for(const kind of ['review','candidate']){
  const sizes=[],requestUrl=async request=>{
   const payload=JSON.parse(JSON.parse(request.body).messages[1].content);
   sizes.push(payload.batch.rows.length);
   if(sizes.length===1)return wire('',{total_tokens:20},'length');
   const response=kind==='review'?{findings:[]}:{batchId:payload.batch.id,to:payload.target.id,ids:payload.batch.rows.map(t=>t.id),reason:'match'};
   return wire(JSON.stringify(response),{total_tokens:20});
  };
  const opts={d,book:'daily',range,settings:config,cfg,requestUrl};
  const result=kind==='review'?await Review.run('核对分类',opts):await Candidate.run('把备注包含target的支出的分类改成交通',opts);
  assert.equal(sizes[1],Math.floor(sizes[0]/2),kind);
  assert.ok(['done','preview'].includes(result.status),result.message);
 }
});

test('undoing an amount skips only expenses made incompatible by later refunds',()=>{
 const d=C.blank();
 d.entries.push(entry(d,'e',{amount:200}),entry(d,'other',{amount:200}),entry(d,'r',{kind:'refund',related:'e',amount:150}));
 const receipt={book:'daily',action:'set_amount',ids:['e','other'],changes:['e','other'].map(id=>({id,field:'amount',old:100,new:200,hadOld:true}))};
 assert.deepEqual(Action.undo(d,receipt),{restored:1,skipped:1});
 assert.deepEqual(d.entries.map(t=>t.amount),[200,100,150]);C.validate(d);
});
