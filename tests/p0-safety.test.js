'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const C=require('../src/core'),Remote=require('../src/ai-provider');
const Agent=require('../src/ai-agent'),Tools=require('../src/ai-agent-tools'),UI=require('../src/ai-ask-view');
const Write=require('../src/ai-agent-write'),Sessions=require('../src/ai-sessions');
const {Store,ROOT,PATH}=require('../src/storage');

const primaryKey='fictional-p0-primary-key',otherKey='fictional-p0-alternate-key';
const settings={aiEnhancement:{
 enabled:true,presetId:'custom',baseUrl:'https://fictional.invalid/v1',model:'fictional',
 apiKey:primaryKey,profiles:{deepseek:{baseUrl:'https://api.deepseek.com/v1',model:'fictional-alt',apiKey:otherKey}},
 agentMaxCalls:10,agentMaxSeconds:30
}};
const recovery=ROOT+'/恢复副本.json',dayBackup=ROOT+'/备份/'+C.today()+'.json';
const oldExport=ROOT+'/导出/完整账本-123.json';
const range={start:'2025-05-01',end:'2025-05-31'};
function ledger(){
 const d=C.blank();
 d.settings={...d.settings,...C.clone(settings)};
 d.books.push({id:'other',name:'虚构工作账本',archived:false});
 d.accounts.push({id:'wallet',name:'虚构敏感账户',type:'现金',currency:'CNY',rate:1,opening:0,archived:false});
 return d;
}
const expense=(d,id,extra={})=>C.newEntry(d,{
 id,book:'daily',date:'2025-05-01',kind:'expense',amount:1250,category:'cat-0',account:'wallet',title:'测试消费',...extra
});
const draft={kind:'expense',date:'2025-05-01',amount:1250,account:'wallet',category:'cat-0',title:'测试消费'};
function vault(seed=[]){
 const files=new Map(seed),folders=new Set([ROOT,ROOT+'/备份',Tools.ROOT.slice(0,-1)]);
 const writes=[];
 const record=(p,text)=>{writes.push({p,text});files.set(p,text);};
 const v={files,writes,adapter:{
  exists:async p=>files.has(p)||folders.has(p),
  read:async p=>{assert.ok(files.has(p),'missing fake file');return files.get(p);},
  list:async p=>({files:[...files.keys()].filter(name=>name.slice(0,name.lastIndexOf('/'))===p),folders:[]})
 }};
 v.createFolder=async p=>folders.add(p);
 v.getAbstractFileByPath=p=>files.has(p)?{path:p}:null;
 v.create=async(p,text)=>{assert.ok(!files.has(p),'fake create must not overwrite');record(p,text);};
 v.modify=async(f,text)=>record(f.path,text);
 v.process=async(f,fn)=>{await v.beforeProcess?.(f.path);record(f.path,fn(files.get(f.path)));};
 return v;
}
function privatePlugin(){
 return {saved:{preexisting:{pref:true}},writes:0,fail:false,
  async loadData(){return C.clone(this.saved);},
  async saveData(data){if(this.fail)throw Error('fake private write failed');this.saved=C.clone(data);this.writes++;}
 };
}
function noKeys(text){
 assert.doesNotMatch(text,/"apiKey"|fictional-p0-primary-key|fictional-p0-alternate-key|fictional-p0-new-key/);
}
function setupLegacy(){
 const d=ledger();d.entries=[expense(d,'saved')];
 const raw=JSON.stringify(d),v=vault([[PATH,raw],[recovery,raw],[dayBackup,raw],[oldExport,raw]]);
 const plugin=privatePlugin();
 return {v,plugin,d,raw,store:new Store(v,plugin)};
}
test('migrates legacy active and inactive keys before scrubbing existing ledger copies',async()=>{
 const {v,plugin,d,store}=setupLegacy();
 assert.equal(await store.load(),true);
 assert.equal(Remote.config(store.data.settings).apiKey,primaryKey);
 assert.equal(Remote.config(store.data.settings).profiles.deepseek.apiKey,otherKey);
 assert.equal(Remote.config(store.data.settings).profiles.deepseek.model,'fictional-alt');
 assert.equal(plugin.saved.preexisting.pref,true);
 assert.deepEqual(JSON.parse(v.files.get(PATH)).entries,d.entries);
 for(const text of v.files.values())noKeys(text);
 assert.equal(await new Store(v,plugin).load(),true);
 assert.equal(plugin.writes,1,'migration must be idempotent');
});
test('private storage failure preserves the sole legacy primary and avoids backup writes',async()=>{
 const {v,plugin,store,raw}=setupLegacy();
 plugin.fail=true;
 assert.equal(await store.load(),false);
 assert.match(store.error,/fake private write failed/);
 assert.equal(v.files.get(PATH),raw);
 assert.equal(v.writes.length,0);
 plugin.fail=false;
 assert.equal(await store.load(),true);
 noKeys(v.files.get(PATH));
 assert.equal(Remote.config(store.data.settings).apiKey,primaryKey);
});
test('settings, ordinary saves, manual backups, restore and full export only persist sanitized ledger JSON',async()=>{
 const {v,plugin,store,raw}=setupLegacy();
 assert.ok(await store.load(),store.error);
 await store.change(d=>{d.settings.aiEnhancement={...Remote.config(d.settings),apiKey:'fictional-p0-new-key'};},{saveAIKeys:true});
 await store.change(d=>{d.entries.push(expense(d,'saved-later'));});
 const manual=await store.backup(undefined,true),exported=await store.exportJSON();
 assert.equal(JSON.parse(v.files.get(exported)).entries.length,2);
 noKeys(v.files.get(manual));
 await store.restore(raw);
 assert.equal(store.data.entries.length,1);
 assert.equal(Remote.config(store.data.settings).apiKey,'fictional-p0-new-key');
 const reopened=new Store(v,plugin);assert.ok(await reopened.load(),reopened.error);
 assert.equal(Remote.config(reopened.data.settings).apiKey,'fictional-p0-new-key');
 v.writes.forEach(({text})=>noKeys(text));
});
test('clear current and all keys without creating snapshots or resurrecting stale synced keys',async()=>{
 const {v,plugin,store,raw}=setupLegacy();
 assert.ok(await store.load(),store.error);
 const oldSettings=store.data.settings;
 await store.change(d=>{d.entries.push(expense(d,'another'));});
 const clearedAt=v.writes.length;
 await store.clearKeys('custom');
 assert.equal(Remote.config(oldSettings).apiKey,'');
 assert.equal(Remote.config(store.data.settings).apiKey,'');
 assert.equal(Remote.config(store.data.settings).profiles.deepseek.apiKey,otherKey);
 assert.equal(v.writes.length,clearedAt);
 await store.clearKeys();
 assert.equal(v.writes.length,clearedAt);
 assert.equal(Remote.config(store.data.settings).profiles.deepseek.apiKey,'');
 assert.doesNotMatch(JSON.stringify(plugin.saved),/fictional-p0-.*-key/);
 v.files.set(PATH,raw);v.files.set(recovery,raw);v.files.set(dayBackup,raw);
 const reopened=new Store(v,plugin);assert.ok(await reopened.load(),reopened.error);
 assert.equal(Remote.config(reopened.data.settings).apiKey,'');
 assert.equal(Remote.config(reopened.data.settings).profiles.deepseek.apiKey,'');
 await reopened.change(()=>{});
 for(const [name,text] of v.files)if(name.endsWith('.json'))noKeys(text);
});
test('a cancelled ledger settings commit restores its previous private credentials',async()=>{
 const {v,plugin,store}=setupLegacy();
 assert.ok(await store.load(),store.error);
 const previous=C.clone(plugin.saved);
 v.beforeProcess=async p=>{if(p===PATH)throw Error('fake compare-and-swap failure');};
 await assert.rejects(store.change(d=>{d.settings.aiEnhancement.apiKey='fictional-p0-new-key';},{saveAIKeys:true}),/fake compare-and-swap/);
 assert.deepEqual(plugin.saved,previous);
 assert.equal(Remote.config(store.data.settings).apiKey,primaryKey);
});

const createReport={mode:'create',markdown:'# 测试报告\n\n## 总览\n\n测试内容。'};
const appendReport={mode:'append',markdown:'## 结语\n\n补充说明。'};
const writeReport=(v,d,book,args={})=>Tools.writeReport(v,{...createReport,...args},d,Tools.evidence(),undefined,book);
function scripted(...actions){
 const messages=[];
 const request=async req=>{
  messages.push(JSON.parse(req.body).messages);
  assert.ok(actions.length,'unexpected model request');
  return {status:200,json:{choices:[{message:{content:JSON.stringify(actions.shift())},finish_reason:'stop'}]}};
 };
 return {request,messages};
}
const tool=(name,args={})=>({type:'tool',name,arguments:args});
const finish=(extra={})=>({type:'finish',message:'查询结束。',...extra});
function run(d,v,script,options={}){
 return Agent.run('查询测试', {d,book:'daily',settings,vault:v,requestUrl:script.request,writeAccess:true,...options});
}

test('stored report paths are normalized and unsafe paths cannot reach the shell',async()=>{
 const unsafe=['../private.html','/tmp/private.html','C:\\private.html','C:/private.html','run.command','note.md','Carrot记账/导出/../fake.html','Carrot记账/附件/file.html','报告规格.md'];
 const v={book:'daily',app:{vault:{adapter:{getBasePath(){assert.fail('unsafe path reached filesystem');}}}},p:{},render(){}};
 const storeData={version:1,books:{daily:{activeId:'s',sessions:[{id:'s',title:'测试会话',turns:[...unsafe,'ok.html'].map(path=>({book:'daily',question:'查询',answer:{path,pendingReport:{request:{path}}}}))}]}}};
 const turns=Sessions.validate(storeData).books.daily.sessions[0].turns;
 for(const [i,path] of unsafe.entries()){
  assert.equal(turns[i].answer.path,undefined);
  assert.equal(turns[i].answer.pendingReport,undefined);
  const turn={book:'daily',answer:{path}};
  await UI.openReport(v,turn,{shell:{openPath:async()=>assert.fail('unsafe path reached shell')}});
  assert.match(turn.reportStatus,/路径|必须为 HTML|导出目录/);
 }
 assert.equal(turns.at(-1).answer.path,Tools.ROOT+'ok.html');
 assert.equal(turns.at(-1).answer.pendingReport.request.path,Tools.ROOT+'ok.html');
});
test('verified reports open within a temp vault while foreign and linked reports stay closed',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'carrot-money-p0-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const vlt=vault(),d=ledger(),own=(await writeReport(vlt,d,'daily',{path:'own.html'})).data.path;
 const foreign=(await writeReport(vlt,d,'other',{path:'foreign.html'})).data.path;
 await fs.mkdir(path.join(root,Tools.ROOT),{recursive:true});
 for(const name of [own,foreign])await fs.writeFile(path.join(root,name),vlt.files.get(name));
 await fs.symlink(path.join(root,own),path.join(root,Tools.ROOT,'link.html'));
 vlt.adapter.getBasePath=()=>root;
 const v={book:'daily',p:{},app:{vault:vlt},render(){}},opened=[];
 const shell={openPath:async abs=>{opened.push(abs);return '';}};
 for(const name of [own,foreign,Tools.ROOT+'link.html']){
  const turn={mode:'ai',book:'daily',answer:{path:name}};
  await UI.openReport(v,turn,{shell});
  assert.match(turn.reportStatus,name===own?/已交给系统/:/打开报告失败/);
 }
 assert.deepEqual(opened,[path.join(await fs.realpath(root),own)]);
});
test('reports enforce ownership for read, append, patch and create collisions and preserve legacy files',async()=>{
 const v=vault(),d=ledger(),p=(await writeReport(v,d,'daily',{path:'report.html'})).data.path;
 const before=new Map(v.files);
 assert.match((await Tools.readReport(v,{path:'report.md'},'daily')).data.text,/测试内容/);
 await assert.rejects(Tools.readReport(v,{path:p}),/缺少报告所属账本/);
 await assert.rejects(Tools.readReport(v,{path:p},'other'),/当前账本不一致/);
 for(const args of [createReport,appendReport,{mode:'patch',sectionTitle:'总览',markdown:'## 总览\n\n试图替换。'}]){
  await assert.rejects(writeReport(v,d,'other',{...args,path:p}),/当前账本不一致/);
 }
 assert.deepEqual(v.files,before);
 v.files.delete(p.replace(/\.html$/,'.report-state.json'));
 await assert.rejects(Tools.readReport(v,{path:p},'other'),/旧报告缺少账本归属/);
 await assert.rejects(writeReport(v,d,'other',{...appendReport,path:p}),/旧报告缺少账本归属/);
 assert.equal(v.files.get(p),before.get(p));
 assert.equal(v.files.get(p.replace(/\.html$/,'.md')),before.get(p.replace(/\.html$/,'.md')));
});
test('finish accepts this turn’s successful write and rejects pre-existing paths, even within the same book',async()=>{
 const d=ledger(),v=vault();
 const old=(await writeReport(v,d,'daily',{path:'old.html'})).data.path;
 const bad=await run(d,v,scripted(finish({path:old})));
 assert.equal(bad.ok,false);assert.equal(bad.path,undefined);assert.match(bad.message,/本轮成功写入/);
 const good=await run(d,v,scripted(tool('write_report',{...createReport,path:'new.html'}),finish({path:'new.html'})));
 assert.equal(good.status,'done');assert.equal(good.path,Tools.ROOT+'new.html');
 const swapped=await run(d,v,scripted(tool('write_report',{...createReport,path:'newer.html'}),finish({path:old})));
 assert.equal(swapped.ok,false);assert.equal(swapped.path,Tools.ROOT+'newer.html');
});
test('default report names are exempt and customized names are scanned only for the current book',async()=>{
 const d=ledger(),v=vault();
 d.entries=[expense(d,'local',{person:'月度分析',payee:'本账本敏感商户',title:C.today().slice(0,4)}),expense(d,'foreign',{book:'other',person:'其他账本敏感人员'})];
 assert.match((await writeReport(v,d,'daily')).data.path,/月度分析-\d{4}-\d{2}-\d{2}-\d+\.html$/);
 assert.ok((await writeReport(v,d,'daily',{path:'其他账本敏感人员款项.html'})).data.path);
 await assert.rejects(writeReport(v,d,'daily',{path:'本账本敏感商户款项.html'}),/文件名包含账目字段/);
});
test('sensitive read tools and private stats dimensions are unavailable without consent',async()=>{
 const d=ledger();
 d.entries=[expense(d,'local',{person:'虚构敏感人物',tags:['虚构敏感标签']})];
 const names=['accounts','account_balance','conversation_history'];
 for(const name of names){
  await assert.rejects(Tools.execute(name,{}, {d,book:'daily',writeAccess:false}),/工具不可用/);
  const script=scripted(tool(name));
  const result=await run(d,vault(),script,{writeAccess:false,history:[{book:'daily',question:'虚构敏感历史',answer:{status:'done'}}]});
  assert.match(result.message,/工具不可用/);
  assert.doesNotMatch(JSON.stringify(script.messages),/虚构敏感历史/);
 }
 for(const groupBy of ['person','tag','account']){
  await assert.rejects(Tools.execute('stats',{...range,groupBy},{d,book:'daily',writeAccess:false}),/工具不可用/);
  const script=scripted(tool('stats',{...range,groupBy}),finish());
  assert.equal((await run(d,vault(),script)).status,'done');
  const wire=JSON.stringify(script.messages.at(-1));
  assert.doesNotMatch(wire,/虚构敏感人物|虚构敏感标签|虚构敏感账户/);
  assert.match(wire,/(?:人物|标签|账户) 1/);
 }
});
test('delete preview requires current reads and its receipt preserves only the active book order',async()=>{
 const d=ledger(),v=vault();
 d.entries=[expense(d,'first'),expense(d,'outside',{book:'other'}),expense(d,'delete'),expense(d,'last')];
 const deleteTool=tool('delete_entries',{ids:['delete']});
 const bad=scripted(deleteTool,finish());
 assert.notEqual((await run(d,v,bad)).status,'preview');
 assert.match(JSON.stringify(bad.messages.at(-1)),/删除前须用rows/);
 const good=scripted(tool('rows',{...range,ids:['delete']}),deleteTool);
 const preview=await run(d,v,good);
 assert.equal(preview.status,'preview');
 assert.equal(d.entries.length,4);
 const receipt=Write.apply(d,preview);
 assert.deepEqual(receipt.order,['first','delete','last']);
 assert.doesNotMatch(JSON.stringify(receipt),/outside/);
 assert.deepEqual(Write.undo(d,receipt),{restored:1,skipped:0});
 assert.deepEqual(d.entries.filter(t=>t.book==='daily').map(t=>t.id),['first','delete','last']);
});
test('invalid review responses can be retried and stats retain balance and period bounds',async()=>{
 const d=ledger();
 d.entries=[expense(d,'one')];
 const script=scripted(tool('review_entries',{...range,ids:['missing']}),tool('review_entries',{...range,ids:['one']}),tool('stats',range),finish());
 const result=await run(d,vault(),script);
 assert.equal(result.status,'done');
 assert.match(JSON.stringify(script.messages[1]),/所选记录不存在/);
 const {period,balance}=result.memory.toolResults.find(t=>t.name==='stats').result.data;
 assert.deepEqual(period,{...range,days:31});
 assert.equal(balance,-1250);
});
test('replacement supersedes the stable turn ID even with skipped turns and legacy history',async()=>{
 const d=ledger(),vlt=vault(),v={d,book:'daily',app:{vault:vlt},p:{},render(){}};
 const s=UI.stateFor(v,'ai');s.agreed=true;s.enabled=true;
 const old={book:'daily',question:'旧待确认记录',answer:{name:'create_entry',status:'preview'}};
 const skipped={book:'daily',question:'后台运行',answer:{name:'create_entry',status:'working'}};
 const other={book:'other',question:'不同账本',answer:{name:'create_entry',status:'preview'}};
 s.turns.push(other,skipped,old);
 const requestUrl=async req=>{
  const messages=JSON.parse(req.body).messages;
  const action=messages.some(m=>m.content.startsWith('本地工具 accounts 返回'))
   ?tool('create_entry',{...draft,replacesTurn:old.turnId}):tool('accounts');
  return {status:200,json:{choices:[{message:{content:JSON.stringify(action)},finish_reason:'stop'}]}};
 };
 try{
  await UI.submit(v,'修正刚才的消费',{mode:'ai',requestUrl});
  assert.equal(s.turns.at(-1).answer.status,'preview');
  assert.equal(s.turns.at(-1).answer.replacesTurn,old.turnId);
  assert.equal(old.phase,'superseded');
  assert.equal(skipped.phase,undefined);assert.equal(other.phase,undefined);
  const saved=Sessions.snapshot(s,'daily'),reloaded=Sessions.validate({version:1,books:{daily:saved}});
  assert.ok(reloaded.books.daily.sessions[0].turns.some(t=>t.turnId===old.turnId&&t.phase==='superseded'));
 }finally{clearTimeout(s.saveTimer);}
});
