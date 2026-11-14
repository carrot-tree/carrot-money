'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),UI=require('../src/ai-ask-view'),Write=require('../src/ai-agent-write');
const {Store,PATH}=require('../src/storage'),Sessions=require('../src/ai-sessions');
const Report=require('../src/ai-agent-report'),Tools=require('../src/ai-agent-tools'),Agent=require('../src/ai-agent');
const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://fictional.invalid/v1',apiKey:'fictional-boundary-key',model:'fictional-model',agentEnabled:true,agentMaxSeconds:30,agentMaxCalls:20,agentMaxTokens:200000}};
function gate(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function vault(seed=[]){
 const files=new Map(seed),folders=new Set(['Carrot记账','Carrot记账/导出']);
 const v={files,writes:[],before:async()=>{},after:async()=>{},adapter:{exists:async p=>{await v.before('exists',p);return files.has(p)||folders.has(p);},read:async p=>{await v.before('read',p);assert.ok(files.has(p),'missing fictional file');return files.get(p);}},createFolder:async p=>folders.add(p),getAbstractFileByPath:p=>files.has(p)?{path:p}:null,
  create:async(p,text)=>{await v.before('create',p);assert.ok(!files.has(p),'must not overwrite');files.set(p,text);v.writes.push(p);await v.after('create',p);return {path:p};},
  modify:async(f,text)=>{await v.before('modify',f.path);files.set(f.path,text);v.writes.push(f.path);await v.after('modify',f.path);},
  process:async(f,fn)=>{await v.before('process',f.path);const text=fn(files.get(f.path));files.set(f.path,text);v.writes.push(f.path);await v.after('process',f.path);}
 };return v;
}
async function view(){
 const data=C.blank();data.books.push({id:'work',name:'虚构另一账本',archived:false});
 const vlt=vault([[PATH,JSON.stringify(data)]]),store=new Store(vlt);await store.load();store.backup=async()=> 'fictional-memory-backup';
 const sessions=new Sessions.SessionStore(vlt);await sessions.load();
 const v={book:'daily',app:{vault:vlt},p:{store,sessions,get data(){return store.data;},change:(fn,opts)=>store.change(fn,opts)},get d(){return store.data;},render(){}};
 const s=UI.stateFor(v,'ai');s.enabled=true;s.agreed=true;
 const turn={question:'虚构创建分类请求',answer:Write.preview(v.d,v.book,'create_category',{name:'虚构边界分类',type:'expense'}),source:v.d,sourceRevision:v.d.revision,book:v.book,mode:'ai'};s.turns.push(turn);
 return {v,s,turn,vlt,store};
}
const invalidations={close:async x=>{x.v.aiClosed=true;await UI.dispose(x.v);},disable:async x=>UI.toggleAI(x.v),book:async x=>{x.v.book='work';},session:async x=>{x.s.sessionId='another-session';},unload:async x=>{x.v.p.aiUnloaded=true;}};
for(const operation of ['confirm','undo'])for(const boundary of ['queue','backup','process'])for(const [name,invalidate]of Object.entries(invalidations)){
 test(`${operation}: ${name} at ${boundary} prevents an uncommitted write`,async()=>{
  const x=await view();if(operation==='undo')await UI.confirm(x.v,x.turn);
  const before=x.vlt.files.get(PATH),entered=gate(),release=gate();
  if(boundary==='queue')x.store.queue=release.promise;
  if(boundary==='backup')x.store.backup=async()=>{entered.resolve();await release.promise;return 'memory-backup';};
  if(boundary==='process')x.vlt.before=async(op,p)=>{if(op==='process'&&p===PATH){entered.resolve();await release.promise;}};
  const pending=UI[operation](x.v,x.turn);
  if(boundary==='queue')await new Promise(setImmediate);else await entered.promise;
  await invalidate(x);release.resolve();await pending;
  assert.equal(x.vlt.files.get(PATH),before);assert.notEqual(x.turn.phase,operation==='undo'?'undone':'done');assert.match(x.turn.warning,/变化|关闭|停止/);
 });
}
test('changing the same preview object during backup cannot change the approved operation',async()=>{
 const x=await view(),before=x.vlt.files.get(PATH);x.store.backup=async()=>{x.turn.answer.item.name='不同的虚构分类';return 'memory';};
 await UI.confirm(x.v,x.turn);assert.equal(x.vlt.files.get(PATH),before);assert.notEqual(x.turn.phase,'done');
});
test('a double confirmation commits once and a normal undo remains available',async()=>{
 const x=await view();await Promise.all([UI.confirm(x.v,x.turn),UI.confirm(x.v,x.turn)]);
 assert.equal(x.vlt.writes.filter(p=>p===PATH).length,1);assert.equal(x.turn.phase,'done');
 await UI.undo(x.v,x.turn);assert.equal(x.turn.phase,'undone');assert.ok(!x.v.d.categories.some(c=>c.name==='虚构边界分类'));
});
test('closing after the ledger commit retains an honest persisted receipt',async()=>{
 const x=await view();let closed=false;x.vlt.after=async(op,p)=>{if(p===PATH&&!closed){closed=true;x.v.aiClosed=true;await UI.dispose(x.v);}};
 await UI.confirm(x.v,x.turn);assert.equal(x.turn.phase,'done');assert.ok(x.v.d.categories.some(c=>c.name==='虚构边界分类'));
 const disk=JSON.parse(x.vlt.files.get(Sessions.PATH));assert.equal(disk.books.daily.sessions[0].turns[0].phase,'done');
});
for(const kind of ['set_category','delete_entries','create_subscription']){
 test(`${kind} retains the same confirmation guard and a reversible normal path`,async()=>{
  const x=await view();await x.store.change(d=>{d.entries.push(C.newEntry(d,{id:'fictional-target',book:'daily',date:'2024-02-10',title:'虚构待核对记录',amount:1234}));});
  x.turn.source=x.v.d;x.turn.sourceRevision=x.v.d.revision;
  x.turn.answer=kind==='set_category'?require('../src/ai-ask-action').preview(x.v.d,'daily',{intent:'action',action:kind,start:'2024-02-01',end:'2024-02-29',ids:['fictional-target'],to:'cat-1'}):Write.preview(x.v.d,'daily',kind,kind==='delete_entries'?{ids:['fictional-target']}:{name:'虚构每月计划',amount:9900,category:'cat-0',next:'2024-03-10',frequency:'monthly'});
  const original=x.vlt.files.get(PATH);x.store.backup=async()=>{UI.toggleAI(x.v);return 'memory';};await UI.confirm(x.v,x.turn);assert.equal(x.vlt.files.get(PATH),original);assert.notEqual(x.turn.phase,'done');
  x.s.enabled=true;x.store.backup=async()=> 'memory';await UI.confirm(x.v,x.turn);assert.equal(x.turn.phase,'done');assert.equal(x.turn.warning,undefined);await UI.undo(x.v,x.turn);assert.equal(x.turn.phase,'undone');
  const old=JSON.parse(original);assert.deepEqual(x.v.d.entries,old.entries);assert.deepEqual(x.v.d.rules,old.rules);assert.deepEqual(x.v.d.trash,old.trash);
 });
}
function reportOptions(v,extra={}){
 const calls=[];const requestUrl=async req=>{const prompt=JSON.parse(JSON.parse(req.body).messages.at(-1).content);calls.push(prompt.板块);return {status:200,json:{choices:[{message:{content:JSON.stringify({markdown:'## '+prompt.板块+'\n\n虚构报告内容，不含未经核验的数字。'})},finish_reason:'stop'}]}};};
 return {calls,options:{d:C.blank(),book:'daily',vault:v,settings:C.clone(settings),cfg:Agent.config(settings),job:{month:'2024-02',resume:false},requestUrl,...extra}};
}
function resume(options,answer){return {...options,job:{month:'2024-02',resume:true,previous:{question:'生成2024-02分析报告',answer:C.clone(answer)}}};}
for(const failed of ['.html','.md','.report-state.json']){
 test(`report ${failed} save failure resumes after reopening without regenerating the section`,async()=>{
  const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),x=reportOptions(v);let fail=true;
  v.before=async(op,p)=>{if(fail&&['create','process','modify'].includes(op)&&p!==Tools.SPEC&&p.endsWith(failed))throw Error('fictional disk failure');};
  const first=await Report.run('生成2024-02分析报告',x.options);
  assert.equal(x.calls.length,1,'a local save failure must not ask the model again');assert.equal(first.ok,false);assert.ok(first.path);assert.equal(first.reportJob.completed.length,0);assert.ok(first.reportJob.pending);
  fail=false;const reopened=vault([...v.files]);const done=await Report.run('继续',resume({...x.options,vault:reopened},first));
  assert.equal(done.status,'done');assert.equal(done.path,first.path);assert.equal(x.calls.length,1);assert.equal(done.reportJob.completed.length,1);assert.equal(done.reportJob.pending,undefined);
  assert.ok(reopened.files.has(done.path));assert.ok(reopened.files.has(done.path.replace(/\.html$/,'.md')));
 });
}
test('report stops during preparation before initiating any report or recovery write',async()=>{
 const v=vault([[Tools.SPEC,Tools.specification]]),controller=new AbortController(),entered=gate(),release=gate(),x=reportOptions(v,{signal:controller.signal});let generated=false;
 const request=x.options.requestUrl;x.options.requestUrl=async r=>{const result=await request(r);generated=true;return result;};
 v.before=async(op,p)=>{if(generated&&op==='exists'&&p===Tools.SPEC){entered.resolve();await release.promise;}};
 const pending=Report.run('生成2024-02分析报告',x.options);await entered.promise;controller.abort();release.resolve();const answer=await pending;
 assert.equal(answer.status,'stopped');assert.equal(v.writes.length,0);assert.equal(answer.reportJob.completed.length,0);
});
test('the full eight-section report resumes the saved section and only generates missing sections',async()=>{
 const v=vault([[Tools.SPEC,Tools.specification]]),x=reportOptions(v);let fail=true;
 v.before=async(op,p)=>{if(fail&&op==='create'&&p.endsWith('.html'))throw Error('fictional html failure');};
 const first=await Report.run('生成2024-02分析报告',x.options);assert.equal(x.calls.length,1);fail=false;
 const done=await Report.run('继续',resume(x.options,first));assert.equal(done.status,'done');assert.equal(done.reportJob.completed.length,8);assert.equal(x.calls.length,8);assert.equal(new Set(x.calls).size,8);assert.equal(Tools.reportSections(v.files.get(done.path)).length,8);
});
test('a save interrupted between the two files is recoverable without modifying the other file after stop',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),controller=new AbortController(),x=reportOptions(v,{signal:controller.signal});
 v.after=async(op,p)=>{if(op==='create'&&p.endsWith('.md')&&p!==Tools.SPEC)controller.abort();};
 const first=await Report.run('生成2024-02分析报告',x.options);assert.equal(first.status,'stopped');assert.equal(first.reportJob.completed.length,0);assert.ok(first.path);assert.ok(!v.files.has(first.path));assert.equal(x.calls.length,1);
 const done=await Report.run('继续',resume({...x.options,signal:undefined,vault:vault([...v.files])},first));assert.equal(done.status,'done');assert.equal(x.calls.length,1);
});
test('external edits to a partially saved report stop recovery without overwriting user content',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),x=reportOptions(v);
 v.before=async(op,p)=>{if(op==='create'&&p.endsWith('.html'))throw Error('fictional failure');};
 const first=await Report.run('生成2024-02分析报告',x.options);assert.ok(first.path);v.before=async()=>{};
 const mdPath=first.path.replace(/\.html$/,'.md'),external='# 手动保留\n\n## 本月总览\n\n用户另行编辑的虚构内容。\n';v.files.set(mdPath,external);
 const result=await Report.run('继续',resume(x.options,first));assert.notEqual(result.status,'done');assert.equal(v.files.get(mdPath),external);assert.equal(x.calls.length,1);assert.match(result.message,/修改|冲突/);
});
test('a failed report checkpoint stops before file writes and retains generated content for retry',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),x=reportOptions(v,{onCheckpoint:async()=>{throw Error('fictional checkpoint failure');}});
 const first=await Report.run('生成2024-02分析报告',x.options);assert.equal(first.ok,false);assert.ok(first.reportJob.pending);assert.equal(v.writes.length,0);assert.equal(x.calls.length,1);
 const done=await Report.run('继续',resume({...x.options,onCheckpoint:async()=>{}},first));assert.equal(done.status,'done');assert.equal(x.calls.length,1);
});
test('report readback failure retains the journal and recovers without another model request',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),x=reportOptions(v);let ready=false;
 v.after=async(op,p)=>{if(op==='create'&&p.endsWith('.html'))ready=true;};v.before=async(op,p)=>{if(ready&&op==='read'&&p.endsWith('.md'))throw Error('fictional readback failure');};
 const first=await Report.run('生成2024-02分析报告',x.options);assert.equal(first.reportJob.completed.length,0);assert.equal(first.ok,false);
 const done=await Report.run('继续',resume({...x.options,vault:vault([...v.files])},first));assert.equal(done.status,'done');assert.equal(x.calls.length,1);
});
test('resuming an append preserves the exact previous section body',async()=>{
 const v=vault([[Tools.SPEC,Tools.specification]]),x=reportOptions(v);let fail=false;
 const first=await Report.run('生成2024-02分析报告',{...x.options,cfg:{...x.options.cfg,agentMaxCalls:1}});const before=v.files.get(first.path.replace(/\.html$/,'.md'));
 v.before=async(op,p)=>{if(fail&&op==='process'&&p.endsWith('.html'))throw Error('fictional append failure');};fail=true;
 const second=await Report.run('继续',resume(x.options,first));assert.equal(second.reportJob.completed.length,1);assert.equal(x.calls.length,2);fail=false;
 const reopened=vault([...v.files]),done=await Report.run('继续',resume({...x.options,vault:reopened},second));assert.equal(done.status,'done');assert.equal(x.calls.length,8);
 const MD=require('../src/ai-report-markdown');assert.deepEqual(MD.parse(reopened.files.get(first.path.replace(/\.html$/,'.md')),{maxSections:100}).sections[0],MD.parse(before).sections[0]);
});
test('a report stopped by a ledger revision change cannot mix old and new facts on resume',async()=>{
 const v=vault([[Tools.SPEC,Tools.specification]]),x=reportOptions(v),first=await Report.run('生成2024-02分析报告',{...x.options,cfg:{...x.options.cfg,agentMaxCalls:1}}),before=[...v.files];
 const updated=C.clone(x.options.d);updated.revision++;updated.entries.push(C.newEntry(updated,{id:'later-fictional-entry',book:'daily',date:'2024-02-12',title:'新虚构记录',amount:1234}));
 const result=await Report.run('继续',resume({...x.options,d:updated},first));assert.notEqual(result.status,'done');assert.match(result.message,/账本已变化/);assert.equal(x.calls.length,1);assert.deepEqual([...v.files],before);
});
test('saving different AI settings does not regenerate previously completed report sections',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |\n| 2 | 收入分析 | 说明 |']]),x=reportOptions(v),first=await Report.run('生成2024-02分析报告',{...x.options,cfg:{...x.options.cfg,agentMaxCalls:1}});
 const updated=C.clone(x.options.d);updated.revision++;updated.settings.aiEnhancement={...settings.aiEnhancement,model:'another-fictional-model'};
 const result=await Report.run('继续保存',resume({...x.options,d:updated},first));assert.equal(result.status,'done');assert.deepEqual(x.calls,['本月总览','收入分析']);
});
test('concurrent writes with the same original bytes cannot silently overwrite each other',async()=>{
 const v=vault([[Tools.SPEC,Tools.specification]]),d=C.blank(),path='Carrot记账/导出/虚构并发.html';
 const results=await Promise.allSettled(['甲','乙'].map(body=>Tools.writeReport(v,{path,mode:'create',markdown:'# 虚构报告\n\n## 总览\n\n'+body},d,Tools.evidence(),undefined,'daily')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const md=v.files.get(path.replace(/\.html$/,'.md')),html=v.files.get(path);assert.equal(html,Tools.renderDoc(require('../src/ai-report-markdown').parse(md),d,'daily'));
});
test('the explicit resume path selects the intended report after unrelated conversation',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),x=reportOptions(v);v.before=async(op,p)=>{if(op==='create'&&p.endsWith('.html'))throw Error('fictional failure');};
 const first=await Report.run('生成2024-02分析报告',x.options);v.before=async()=>{};
 const result=await Agent.run('继续',{...x.options,history:[{question:'生成2024-02分析报告',answer:first},{question:'一个无关的虚构问题',answer:{status:'done',message:'虚构回答'}}],resumeReportPath:first.path});
 assert.equal(result.status,'done');assert.equal(result.path,first.path);assert.equal(x.calls.length,1);
});
test('general Agent report save failures stop model retries and resume through the same guarded store',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),d=C.blank();let calls=0;
 const options={d,book:'daily',vault:v,settings,writeAccess:true,requestUrl:async()=>{calls++;return {status:200,json:{choices:[{message:{content:JSON.stringify({type:'tool',name:'write_report',arguments:{path:'虚构单节.html',mode:'create',markdown:'# 虚构单节报告\n\n## 本月总览\n\n只写这一节的虚构说明。'}})},finish_reason:'stop'}]}};}};
 v.before=async(op,p)=>{if(op==='create'&&p.endsWith('.html'))throw Error('fictional save failure');};
 const first=await Agent.run('只写报告总览',options);assert.equal(calls,1);assert.equal(first.status,'partial');assert.ok(first.pendingReport);
 const done=await Agent.run('继续保存',{...options,vault:vault([...v.files]),history:[{question:'只写报告总览',answer:first}]});assert.equal(done.status,'done');assert.equal(calls,1);assert.equal(done.path,first.path);
});
test('a stopped general report request cannot create its specification or call a model',async()=>{
 const v=vault(),controller=new AbortController();controller.abort();let calls=0;
 const result=await Agent.run('只写报告总览',{d:C.blank(),book:'daily',vault:v,settings,signal:controller.signal,requestUrl:async()=>{calls++;throw Error('must not call model');}});
 assert.notEqual(result.status,'done');assert.equal(calls,0);assert.equal(v.writes.length,0);
});
test('recovering one report write cannot falsely complete a conflicting generated request',async()=>{
 const v=vault([[Tools.SPEC,'| 1 | 本月总览 | 说明 |']]),d=C.blank();let calls=0;
 const options={d,book:'daily',vault:v,settings,writeAccess:true,requestUrl:async()=>{calls++;return {status:200,json:{choices:[{message:{content:JSON.stringify({type:'tool',name:'write_report',arguments:{path:'虚构冲突.html',mode:'create',markdown:'# 虚构报告\n\n## 本月总览\n\n'+(calls===1?'先生成的内容':'另一份冲突内容')}})},finish_reason:'stop'}]}};}};
 v.before=async(op,p)=>{if(op==='create'&&p.endsWith('.md'))throw Error('fictional save failure');};
 const first=await Agent.run('只写报告总览',options),second=await Agent.run('只写报告总览',options);assert.ok(first.pendingReport);assert.ok(second.pendingReport);assert.equal(calls,2);
 const reopened=vault([...v.files]),result=await Agent.run('继续保存',{...options,vault:reopened,history:[{question:'只写报告总览',answer:second}]});
 assert.notEqual(result.status,'done');assert.ok(result.pendingReport);assert.equal(calls,2);assert.match(reopened.files.get(first.path.replace(/\.html$/,'.md')),/先生成的内容/);assert.doesNotMatch(reopened.files.get(first.path),/另一份冲突内容/);
});
