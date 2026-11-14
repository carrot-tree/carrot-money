'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core');
const Agent=require('../src/ai-agent');
const Tools=require('../src/ai-agent-tools');
const Write=require('../src/ai-agent-write');
const Report=require('../src/ai-agent-report');
const Sessions=require('../src/ai-sessions');
const UI=require('../src/ai-ask-view');

// Fictional fixtures, injected responses and an in-memory vault only.
const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://example.invalid/v1',apiKey:'fictional-test-key',model:'fictional-model',agentEnabled:true,agentMaxSeconds:30,agentMaxCalls:12,agentMaxTokens:200000}};
function ledger(){
 const d=C.blank();d.books.push({id:'private-book',name:'虚构另一本账',archived:false});
 d.accounts.push({id:'test-wallet',name:'虚构钱包',type:'支付宝',currency:'CNY',rate:1,opening:0,archived:false});
 const row=(id,seed={})=>C.newEntry(d,{id,date:'2024-02-10',book:'daily',account:'test-wallet',amount:1000,title:'虚构测试消费',...seed});
 d.entries=[row('expense',{amount:5000}),row('refund',{kind:'refund',amount:1000,related:'expense'}),row('income',{kind:'income',category:'cat-9',amount:20000}),row('other-book',{book:'private-book',title:'不能跨账本读取的虚构内容',amount:90000})];
 return C.validate(d);
}
function vault(){
 const files=new Map(),folders=new Set();
 return {files,adapter:{exists:async p=>files.has(p)||folders.has(p),read:async p=>{if(!files.has(p))throw Error('missing test file');return files.get(p);}},
  createFolder:async p=>{folders.add(p);},getAbstractFileByPath:p=>files.has(p)?{path:p}:null,
  create:async(p,text)=>{assert.equal(files.has(p),false);files.set(p,text);return {path:p};},
  modify:async(f,text)=>{assert.ok(files.has(f.path));files.set(f.path,text);},
  process:async(f,fn)=>{const next=fn(files.get(f.path));files.set(f.path,next);}
 };
}
function response(value,finishReason='stop'){return {status:200,json:{choices:[{message:{role:'assistant',content:typeof value==='string'?value:JSON.stringify(value)},finish_reason:finishReason}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}};}
function scripted(...answers){let calls=0;const request=async()=>{assert.ok(calls<answers.length,'unexpected extra simulated model call');const answer=answers[calls++];return response(answer);};request.calls=()=>calls;return request;}
function options(d,requestUrl,extra={}){return {d,book:'daily',vault:vault(),settings:C.clone(settings),requestUrl,writeAccess:true,...extra};}

test('unknown model tools become explicit unsupported replies with a usable manual route',async()=>{
 const d=ledger(),before=JSON.stringify(d),request=scripted({type:'tool',name:'restore_backup',arguments:{path:'fictional.json'}});
 const answer=await Agent.run('恢复一个备份',options(d,request));
 assert.equal(answer.status,'unsupported');assert.equal(answer.ok,false);assert.equal(answer.unsupported,'restore_data');
 assert.match(answer.message,/不能.*恢复/);assert.match(answer.message,/没有执行/);assert.equal(answer.manualAction.tab,'data');
 assert.equal(request.calls(),1);assert.equal(JSON.stringify(d),before);
});

test('read tools summarize only the selected book and bound paginated transaction results',async()=>{
 const d=ledger(),before=JSON.stringify(d),context={d,book:'daily',writeAccess:false};
 const stats=await Tools.execute('stats',{start:'2024-02-01',end:'2024-02-29',groupBy:'category'},context);
 assert.deepEqual([stats.data.count,stats.data.income,stats.data.expense,stats.data.balance],[3,20000,4000,16000]);
 const rows=await Tools.execute('rows',{start:'2024-02-01',end:'2024-02-29',limit:2,offset:0},context);
 assert.equal(rows.data.total,3);assert.equal(rows.data.rows.length,2);assert.equal(rows.data.truncated,true);
 assert.ok(rows.data.rows.every(t=>t.id!=='other-book'));
 await assert.rejects(Tools.execute('rows',{start:'2024-02-01',end:'2024-02-29',limit:501},context),/条数/);
 await assert.rejects(Tools.execute('stats',{start:'2024-02-01',end:'2024-02-29',book:'private-book'},context),/参数字段/);
 assert.equal(JSON.stringify(d),before);
});

test('read-only Agent requests cannot turn a model tool response into a ledger write',async()=>{
 const d=ledger(),before=JSON.stringify(d),request=scripted({type:'tool',name:'create_category',arguments:{name:'虚构新分类',type:'expense'}});
 const answer=await Agent.run('添加一个分类',options(d,request,{writeAccess:false}));
 assert.equal(answer.status,'error');assert.match(answer.message,/操作工具不可用/);assert.equal(JSON.stringify(d),before);
 await assert.rejects(Tools.execute('create_category',{name:'虚构新分类',type:'expense'},{d,book:'daily'}),/只能生成预览/);
});

test('a model write request ends at an unchanged-ledger preview until apply is explicitly called',async()=>{
 const d=ledger(),before=JSON.stringify(d),request=scripted({type:'tool',name:'create_category',arguments:{name:'虚构测试运动',type:'expense'}});
 const plan=await Agent.run('新建运动类别',options(d,request));
 assert.equal(plan.status,'preview');assert.equal(plan.intent,'agent_write');assert.match(plan.message,/尚未新建/);assert.equal(JSON.stringify(d),before);
 const receipt=Write.apply(d,plan);
 assert.equal(receipt.count,1);assert.equal(d.categories.find(x=>x.id===receipt.id).name,'虚构测试运动');
 assert.equal(d.entries.length,4);
 assert.deepEqual(Write.undo(d,receipt),{restored:1,skipped:0});assert.equal(JSON.stringify(d),before);
});

test('a finish response cannot falsely claim an unconfirmed ledger operation was executed',async()=>{
 const d=ledger(),before=JSON.stringify(d),request=scripted({type:'finish',message:'已修改账本。'});
 const answer=await Agent.run('看看账本是否需要调整',options(d,request));
 assert.equal(answer.status,'error');assert.equal(answer.ok,false);assert.match(answer.message,/没有用户确认记录/);assert.match(answer.message,/没有写账/);
 assert.equal(JSON.stringify(d),before);
});

test('truncated report output is never saved or marked completed',async()=>{
 const d=ledger(),v=vault();v.files.set(Tools.SPEC,'| 1 | 测试总览 | 说明 |');let calls=0;
 const request=async()=>{calls++;return response('{"markdown":"## 测试总览\n未完','length');};
 const result=await Report.run('生成2024-02分析报告',options(d,request,{vault:v,job:{month:'2024-02',resume:false},cfg:Agent.config(settings)}));
 assert.equal(calls,2);assert.equal(result.ok,false);assert.equal(result.status,'error');assert.equal(result.path,undefined);
 assert.match(result.message,/尚未写入/);assert.match(result.message,/截断/);assert.ok([...v.files.keys()].every(p=>!p.endsWith('.html')));
});

test('a partly saved report stays partial and resume verifies all required sections before done',async()=>{
 const d=ledger(),v=vault();v.files.set(Tools.SPEC,'| 1 | 测试总览 | 说明 |\n| 2 | 测试建议 | 说明 |');
 const written=[];
 const request=async req=>{const body=JSON.parse(req.body),prompt=JSON.parse(body.messages.at(-1).content);written.push(prompt.板块);return response({markdown:'## '+prompt.板块+'\n\n这是虚构测试说明，不包含未经验证的统计。'});};
 const partial=await Report.run('生成2024-02分析报告',options(d,request,{vault:v,job:{month:'2024-02',resume:false},cfg:{...Agent.config(settings),agentMaxCalls:1}}));
 assert.equal(partial.status,'partial');assert.equal(partial.ok,false);assert.match(partial.message,/1 \/ 2/);assert.equal(partial.reportJob.completed.length,1);assert.ok(v.files.has(partial.path));
 const done=await Report.run('继续',options(d,request,{vault:v,job:{month:'2024-02',resume:true,previous:{question:'生成2024-02分析报告',answer:partial}},cfg:Agent.config(settings)}));
 assert.equal(done.status,'done');assert.equal(done.ok,true);assert.equal(done.path,partial.path);
 assert.deepEqual(written,['测试总览','测试建议']);assert.deepEqual(done.reportJob.completed,['测试总览','测试建议']);
 assert.equal(Tools.reportSections(v.files.get(done.path)).length,2);assert.match(done.message,/读回核验/);
});

test('a request for an unsupported report range asks for scope without silently generating one month',async()=>{
 const d=ledger(),v=vault();let calls=0;
 const answer=await Agent.run('生成2024年全年分析报告',options(d,async()=>{calls++;throw Error('must not contact the simulated model');},{vault:v}));
 assert.equal(calls,0);assert.equal(answer.status,'needs_input');assert.equal(answer.execution.status,'not_executed');assert.match(answer.message,/单个月份/);assert.equal(v.files.size,0);
});

async function sessionView(){
 const d=ledger(),vlt=vault(),store=new Sessions.SessionStore(vlt);await store.load();
 const old={id:'old',title:'旧测试对话',createdAt:'2024-01-01T00:00:00Z',updatedAt:'2024-01-02T00:00:00Z',turns:[],input:'旧草稿'};
 const recent={id:'recent',title:'新测试对话',createdAt:'2024-02-01T00:00:00Z',updatedAt:'2024-02-02T00:00:00Z',turns:[],input:'新草稿'};
 await store.save('daily',{sessionId:'recent',sessions:[old,recent],turns:[],input:'新草稿'});
 const v={d,book:'daily',p:{store:{vault:vlt},sessions:store},render(){}};
 return {v,store,vlt};
}
test('opening an older conversation preserves chronological ordering and deletion preserves ledger data',async()=>{
 const {v,store}=await sessionView(),before=JSON.stringify(v.d),timestamps=store.get('daily').sessions.map(s=>[s.id,s.updatedAt]);
 assert.equal(await UI.selectSession(v,'old'),true);
 const state=UI.stateFor(v,'ai');assert.equal(state.input,'旧草稿');
 assert.deepEqual(store.get('daily').sessions.map(s=>[s.id,s.updatedAt]),timestamps);
 assert.deepEqual([...state.sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(s=>s.id),['recent','old']);
 assert.equal(await UI.deleteSession(v,'old'),true);
 assert.equal(state.sessionId,'recent');assert.deepEqual(store.get('daily').sessions.map(s=>s.id),['recent']);
 assert.equal(await UI.deleteSession(v,'recent'),true);
 assert.equal(state.sessions.length,1);assert.equal(state.sessions[0].title,'新会话');assert.equal(JSON.stringify(v.d),before);
});

test('conversation deletion rolls back in memory when its persistence step fails',async()=>{
 const {v,store}=await sessionView(),state=UI.stateFor(v,'ai'),before=store.get('daily');
 const save=store.save.bind(store);let calls=0;
 store.save=async(...args)=>{if(++calls===2)throw Error('模拟保存失败');return save(...args);};
 assert.equal(await UI.deleteSession(v,'recent'),false);
 assert.equal(state.sessionId,'recent');assert.deepEqual(state.sessions.map(s=>s.id),['old','recent']);assert.equal(state.busy,false);assert.match(state.storageError,/模拟保存失败/);
 assert.deepEqual(store.get('daily'),before);
});
