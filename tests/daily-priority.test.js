'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),A=require('../src/analytics'),G=require('../src/report-grouping'),Insights=require('../src/insights'),Drafts=require('../src/entry-drafts'),Task=require('../src/ai-task-status');
function ledger(){const d=C.blank();d.books.push({id:'second',name:'另一本',archived:false});d.accounts.push({id:'cash',name:'演示钱包',currency:'CNY',rate:1,opening:1000000});return d;}
function add(d,id,kind,date,amount,extra={}){const t=C.newEntry(d,{id,kind,date,amount,account:'cash',category:kind==='income'?'cat-9':'cat-0',...extra});d.entries.push(t);return t;}
test('each chart series counts the same records its drilldown includes, including dual-value history',()=>{
 const d=ledger();add(d,'i','income','2026-11-01',20000);add(d,'e','expense','2026-11-01',5000);add(d,'r','refund','2026-11-02',1000,{related:'e'});add(d,'a','adjustment','2026-11-01',2000);add(d,'l','legacy','2026-11-01',0,{legacyIncome:1000,legacyExpense:1000});
 const rows=C.consumption(d),slots=A.buckets(rows,'2026-11-01','2026-11-02','day').slots;
 assert.deepEqual(slots[0].metricCounts,{income:2,expense:2,net:3});assert.equal(slots[0].count,4);
 assert.deepEqual(slots[1].metricCounts,{income:0,expense:0,net:0});assert.equal(slots[1].count,1);
 for(const slot of slots)for(const metric of ['income','expense','net'])assert.equal(slot.metricCounts[metric],rows.filter(t=>slot.ids.includes(t.id)&&A.matchesMetric(t,metric)).length);
 assert.deepEqual(Insights.cumulative(slots).at(-1).metricCounts,{income:2,expense:2,net:3});
 const cash=A.buckets(d.entries,'2026-11-01','2026-11-02','day').slots;assert.equal(cash[1].metricCounts.expense,1);
});
test('tag timelines preserve purchase-date refund effects and do not double count multiple tags',()=>{
 const d=ledger();add(d,'e','expense','2026-10-15',197500,{tags:['生活','数码']});add(d,'r','refund','2026-11-18',135000,{related:'e',tags:['退货']});
 const before=JSON.stringify(d),rows=C.consumption(d),range=['2026-10-01','2026-11-30','month'];
 for(const cumulative of [false,true]){
  const expected=cumulative?Insights.cumulative(A.buckets(rows,...range).slots):A.buckets(rows,...range).slots;
  for(const dimension of ['category','account','tag','person','payee']){
   const data=G.timeline(d,rows,...range,dimension,'leaf',cumulative);
   assert.deepEqual(data.slots.map(b=>[b.income,b.expense]),expected.map(b=>[b.income,b.expense]),dimension);
   for(const slot of data.slots)assert.equal(slot.groups.reduce((n,g)=>n+g.expense,0),slot.expense,dimension);
  }
 }
 assert.equal(JSON.stringify(d),before);assert.equal(d.entries[0].amount,197500);assert.equal(C.impact(rows[0]).expense,62500);
});
function vault(){const files=new Map();return {files,adapter:{exists:async p=>files.has(p),read:async p=>files.get(p)},createFolder:async p=>files.set(p,''),create:async(p,s)=>{if(files.has(p))throw Error('exists');files.set(p,s);},getAbstractFileByPath:p=>({path:p}),process:async(f,fn)=>files.set(f.path,fn(files.get(f.path)))};}
function draft(d,edit=false,book='daily'){const entry=C.newEntry(d,{book});return {entry,edit,original:JSON.stringify(entry),values:{amount:'18.5 + 6 ×',title:'输入尚未完成',rate:'',category:'cat-0'},splits:[{account:'cash',amount:0,rawAmount:'3 +'}],fileNames:['收据.png']};}
test('local entry drafts preserve unfinished expressions across reload and isolate books and edit slots',async()=>{
 const v=vault(),store=new Drafts.EntryDraftStore(v),d=ledger(),a=draft(d),b=draft(d,false,'second'),e=draft(d,true);await store.load();await Promise.all([store.save(a),store.save(b),store.save(e)]);
 const restored=new Drafts.EntryDraftStore(v);await restored.load();assert.equal(restored.get('daily').values.amount,'18.5 + 6 ×');assert.equal(restored.get('daily').splits[0].rawAmount,'3 +');assert.equal(restored.get('second').entry.id,b.entry.id);assert.equal(restored.get('daily',e.entry.id).entry.id,e.entry.id);assert.equal(d.entries.length,0);
 await restored.remove('daily','',a.entry.id);assert.equal(restored.get('daily'),null);assert.ok(restored.get('second'));assert.ok(restored.get('daily',e.entry.id));
});
test('saving another new entry cannot erase an unrelated stored draft',async()=>{
 const v=vault(),store=new Drafts.EntryDraftStore(v),a=draft(ledger());await store.save(a);await store.remove('daily','','another-entry');assert.equal(store.get('daily').entry.id,a.entry.id);
});
test('external draft updates and corrupt files are never overwritten',async()=>{
 const v=vault(),a=new Drafts.EntryDraftStore(v),b=new Drafts.EntryDraftStore(v);await Promise.all([a.load(),b.load()]);await a.save(draft(ledger()));const saved=v.files.get(Drafts.PATH);await assert.rejects(b.save(draft(ledger())),/其他窗口/);assert.equal(v.files.get(Drafts.PATH),saved);
 v.files.set(Drafts.PATH,'broken');const c=new Drafts.EntryDraftStore(v);await c.load();await assert.rejects(c.save(draft(ledger())),/读取记账草稿失败/);assert.equal(v.files.get(Drafts.PATH),'broken');
});
test('disk failure keeps old draft intact and the save queue remains usable',async()=>{
 const v=vault(),s=new Drafts.EntryDraftStore(v),a=draft(ledger());await s.save(a);const before=v.files.get(Drafts.PATH),process=v.process;v.process=async()=>{throw Error('disk full');};await assert.rejects(s.save({...a,values:{amount:'88'}}),/disk full/);assert.equal(v.files.get(Drafts.PATH),before);assert.equal(s.get('daily').values.amount,a.values.amount);v.process=process;await s.save({...a,values:{amount:'99'}});assert.equal(s.get('daily').values.amount,'99');
});
test('restoration rejects stale edited entries and already-saved or trashed new entries',()=>{
 const d=ledger(),a=draft(d);assert.equal(Drafts.restoreError(d,a),'');d.entries.push(C.clone(a.entry));assert.match(Drafts.restoreError(d,a),/已保存过/);a.edit=true;assert.equal(Drafts.restoreError(d,a),'');d.entries[0].title='后续修改';assert.match(Drafts.restoreError(d,a),/原账目已变化/);a.edit=false;d.trash=d.entries;d.entries=[];assert.match(Drafts.restoreError(d,a),/已保存过/);
});
test('draft dirty comparison uses editable raw values and not validation-normalized entry fields',()=>{
 const d=ledger(),a=draft(d),b=C.clone(a);b.entry.title='normalized';b.entry.amount=100;assert.equal(Drafts.signature(a),Drafts.signature(b));b.values.amount='12.34';assert.notEqual(Drafts.signature(a),Drafts.signature(b));
});
function task(){const d=ledger(),turn={book:'daily',source:d,question:'核对本月分类',answer:{status:'stopped',reviewJob:{id:'job',question:'核对本月分类',start:'2026-11-01',end:'2026-11-30',total:100,offset:30}}},s={turns:[turn],enabled:true,busy:false},v={d,book:'daily'};return {v,s,turn};}
test('AI disabled, saving failure, busy and changed ledger each have one accurate next step',()=>{
 const x=task();assert.equal(Task.recovery(x.v,x.s,x.turn).action,'resume');x.s.enabled=false;assert.equal(Task.recovery(x.v,x.s,x.turn).action,'enable');assert.match(Task.recovery(x.v,x.s,x.turn).message,/尚未开启/);
 x.turn.answer.checkpointError=true;assert.equal(Task.recovery(x.v,x.s,x.turn).action,'save');delete x.turn.answer.checkpointError;x.s.enabled=true;x.s.busy=true;assert.equal(Task.recovery(x.v,x.s,x.turn).action,null);x.s.busy=false;x.v.d=C.clone(x.v.d);assert.equal(Task.recovery(x.v,x.s,x.turn).label,'校验原范围并继续');
});
test('resumed and finished task history never offers a second continue action',()=>{
 const x=task();x.s.turns.push({...x.turn,answer:{...x.turn.answer,reviewJob:{...x.turn.answer.reviewJob,offset:60}}});assert.equal(Task.recovery(x.v,x.s,x.turn).action,null);assert.equal(Task.recovery(x.v,x.s,x.turn).historyOnly,true);assert.equal(Task.recovery(x.v,x.s,x.s.turns[1]).action,'resume');
 x.s.turns[1].phase='cancelled';assert.equal(Task.recovery(x.v,x.s,x.s.turns[1]).action,null);
});
test('oversized old task displays the actual pasted scope before resuming',()=>{
 const x=task();for(let i=0;i<100;i++)add(x.v.d,'row'+i,'expense','2026-11-01',100,{title:i<2?'虚构订单 P9000000000'+i:'无关账目'});
 x.turn.question=x.turn.answer.reviewJob.question='只修改这两笔分类：P90000000000 P90000000001';const state=Task.recovery(x.v,x.s,x.turn);assert.equal(state.total,2);assert.equal(state.offset,0);assert.equal(state.label,'按原清单核对');assert.equal(x.turn.answer.reviewJob.total,100);
});
