'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../src/core');
const A=require('../src/analytics');
const P=require('../src/planning');
const S=require('../src/ai-subscriptions');
const D=require('../src/dashboard');
const F=require('../src/ledger-filters');
const G=require('../src/report-grouping');
const I=require('../src/imports');
const Import=require('../src/ai-import');
const {Store,ROOT,PATH}=require('../src/storage');

// All fixtures are invented. These tests never open a vault or call a provider.
function ledger(){
 const d=C.blank();
 d.accounts=[
  {id:'wallet',name:'测试钱包',type:'支付宝',currency:'CNY',rate:1,opening:100000,archived:false},
  {id:'bank',name:'测试银行卡',type:'银行',currency:'CNY',rate:1,opening:20000,archived:false}
 ];
 d.books.push({id:'work',name:'测试工作账本',archived:false});
 d.categories.push({id:'lunch',name:'测试午餐',parent:'cat-0',type:'expense',archived:false});
 return C.validate(d);
}
function entry(d,id,seed={}){return C.newEntry(d,{id,book:'daily',date:'2024-02-10',title:'测试流水 '+id,account:'wallet',category:'lunch',amount:1000,...seed});}
function financialFlow(){
 const d=ledger();
 d.entries=[
  entry(d,'purchase',{amount:12000,reimbursable:true,tags:['测试旅行','测试项目'],payee:'虚构测试商户'}),
  entry(d,'refund',{kind:'refund',related:'purchase',date:'2024-02-11',amount:2000}),
  entry(d,'reimbursement',{kind:'reimbursement',related:'purchase',date:'2024-02-12',amount:3000}),
  entry(d,'salary',{kind:'income',category:'cat-9',amount:50000}),
  entry(d,'transfer',{kind:'transfer',amount:10000,toAccount:'bank',toAmount:10000}),
  entry(d,'adjustment',{kind:'adjustment',amount:-500})
 ];
 return C.validate(d);
}
function memoryVault(seed){
 const files=new Map(seed===undefined?[]:[[PATH,typeof seed==='string'?seed:JSON.stringify(seed)]]);
 const folders=new Set(seed===undefined?[]:[ROOT]);
 const vault={files,folders,beforeProcess:null,
  adapter:{exists:async p=>files.has(p)||folders.has(p),read:async p=>{if(!files.has(p))throw Error('missing file');return files.get(p);},list:async p=>({files:[...files.keys()].filter(k=>k.startsWith(p+'/')),folders:[]})},
  createFolder:async p=>{folders.add(p);},
  getAbstractFileByPath:p=>files.has(p)?{path:p}:null,
  create:async(p,text)=>{assert.equal(files.has(p),false,'must not overwrite an existing file');files.set(p,text);return {path:p};},
  modify:async(f,text)=>{assert.ok(files.has(f.path));files.set(f.path,text);},
  process:async(f,fn)=>{if(vault.beforeProcess){const hook=vault.beforeProcess;vault.beforeProcess=null;await hook();}const next=fn(files.get(f.path));files.set(f.path,next);}
 };
 return vault;
}
function csvInput(rows){
 return {name:'虚构测试账单.csv',...I.parseReview([
  '交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号',
  ...rows
 ].join('\n'),'虚构测试账单.csv')};
}

test('money uses exact cents and rejects unsupported precision or unsafe values',()=>{
 assert.equal(C.cents('￥1,234.50'),123450);
 assert.equal(C.cents('-0.01'),-1);
 assert.equal(A.calculate('0.1 + 0.2'),30);
 assert.equal(A.calculate('(10 - 1) / 3'),300);
 assert.equal(A.calculate('1 / 8'),13);
 for(const value of ['1.001','1e3','NaN','9007199254740992'])assert.throws(()=>C.cents(value));
 assert.throws(()=>A.calculate('1 / 0'),/零/);
});

test('refunds and reimbursements reduce expenses while transfers only move balances',()=>{
 const d=financialFlow();
 assert.deepEqual(C.totals(d.entries),{income:50000,expense:7000,count:6});
 assert.equal(C.outstanding(d,d.entries[0]),7000);
 assert.equal(C.accountBalance(d,'wallet'),132500);
 assert.equal(C.accountBalance(d,'bank'),30000);
 assert.equal(A.accountLedger(d,'wallet').at(-1).balance,132500);
 assert.deepEqual(C.impact(d.entries.find(t=>t.id==='transfer')),{income:0,expense:0});
 const breakdown=F.breakdown(d.entries);
 assert.deepEqual([breakdown.gross,breakdown.refund,breakdown.reimbursement,breakdown.netExpense],[12000,2000,3000,7000]);
 assert.deepEqual(breakdown.groups.neutral.map(t=>t.id),['transfer','adjustment']);
});

test('split payments reconcile both balances and reject inconsistent totals',()=>{
 const d=ledger();
 d.entries=[entry(d,'split',{amount:5000,splits:[{account:'wallet',amount:3000},{account:'bank',amount:2000}]})];
 C.validate(d);
 assert.equal(C.accountBalance(d,'wallet'),97000);
 assert.equal(C.accountBalance(d,'bank'),18000);
 assert.equal(C.totals(d.entries).expense,5000);
 assert.equal(C.filter(d,{account:'bank'}).length,1);
 const broken=C.clone(d);broken.entries[0].splits[1].amount=1999;
 assert.throws(()=>C.validate(broken),/组合付款/);
});

test('refund limits, chronology and linked deletion protect the original expense',()=>{
 const d=financialFlow();
 for(const change of [x=>{x.entries[1].amount=10000;},x=>{x.entries[1].date='2024-02-09';},x=>{x.entries[1].book='work';}]){
  const draft=C.clone(d);change(draft);assert.throws(()=>C.validate(draft),/退款|报销/);
 }
 assert.throws(()=>C.removeEntries(d,['purchase']),/关联退款/);
 assert.equal(d.entries.length,6);
 C.removeEntries(d,['purchase','refund','reimbursement']);
 C.validate(d);
 assert.equal(d.trash.length,3);
 C.restoreEntries(d,['purchase','refund','reimbursement']);
 assert.equal(d.trash.length,0);
 assert.equal(C.totals(d.entries).expense,7000);
 assert.ok(d.entries.every(t=>!Object.hasOwn(t,'deletedAt')));
});

test('ledger filters combine book, parent category, dates, amount, tags and text',()=>{
 const d=financialFlow();
 d.entries.push(entry(d,'other-book',{book:'work',payee:'虚构测试商户',tags:['测试旅行'],amount:12000}));
 assert.deepEqual(C.filter(d,{book:'daily',category:'cat-0',start:'2024-02-01',end:'2024-02-29',kind:'expense',min:10000,max:13000,tag:'测试旅行',query:'虚构测试商户'}).map(t=>t.id),['purchase']);
 assert.deepEqual(C.filter(d,{book:'daily',account:'bank'}).map(t=>t.id),['transfer']);
 assert.deepEqual(C.filter(d,{book:'daily',pending:true}).map(t=>t.id),['purchase']);
 assert.deepEqual(C.filter(d,{book:'daily',metric:'expense'}).map(t=>t.id),['purchase','refund','reimbursement']);
});

test('saved filters restore a copy and reject stale accounts or a different book',()=>{
 const d=ledger(),saved=F.save(d,'daily','2024-02',{query:'测试',account:'wallet',min:100},'amount-desc','测试筛选');
 let rendered=0;
 const v={d,book:'daily',filters:{},month:'',selected:new Set(['old']),render(){rendered++;}};
 F.apply(v,saved);
 assert.equal(rendered,1);assert.equal(v.month,'2024-02');assert.equal(v.entrySort,'amount-desc');assert.equal(v.selected.size,0);
 v.filters.query='已更改';assert.equal(saved.filters.query,'测试');
 v.book='work';assert.throws(()=>F.apply(v,saved),/其他账本/);
 v.book='daily';d.accounts[0].archived=true;assert.throws(()=>F.apply(v,saved),/归档/);
 assert.throws(()=>F.save(d,'daily','2024-02',{ids:['one']},'date-desc','图表'),/图表/);
 assert.throws(()=>F.save(d,'daily','2024-02',{min:200,max:100},'date-desc','反向范围'),/金额范围/);
});

test('month-end and leap-day schedules retain their original anchor',()=>{
 assert.equal(C.nextDate('2024-01-31','monthly',31),'2024-02-29');
 assert.equal(C.nextDate('2024-02-29','monthly',31),'2024-03-31');
 assert.equal(C.nextDate('2025-01-31','monthly',31),'2025-02-28');
 let next='2024-02-29';
 for(let year=2025;year<=2028;year++){next=C.nextDate(next,'yearly',29);assert.equal(next,year+'-02-'+(year===2028?'29':'28'));}
 assert.equal(P.days('2024-02-28','2024-03-01'),2);
});

test('subscription preview and confirmation do not duplicate the source payment',()=>{
 const d=ledger();d.entries.push(entry(d,'subscription-source',{date:'2024-01-01',title:'虚构月刊',amount:2500}));
 const before=JSON.stringify(d);
 const plan=S.preview(d,'daily','create_subscription',{sourceId:'subscription-source',next:'2024-01-31',frequency:'monthly'});
 assert.equal(JSON.stringify(d),before);
 const receipt=S.apply(d,plan);
 assert.equal(d.entries.length,1);assert.equal(d.rules.length,1);
 assert.equal(D.subscriptions(d,'daily')[0].id,receipt.id);
 assert.deepEqual(P.forecast(d,'daily','2024-01-01',90,true).rows.map(t=>t.date),['2024-01-31','2024-02-29']);
 assert.throws(()=>S.preview(d,'daily','create_subscription',{sourceId:'subscription-source',next:'2024-02-29',frequency:'monthly'}),/已有订阅|同名/);
 const jan=P.settle(d,'daily',receipt.id,'2024-01-31','post','2024-03-31');
 assert.throws(()=>P.settle(d,'daily',receipt.id,'2024-01-31','post','2024-03-31'),/已处理|不在计划/);
 C.removeEntries(d,[jan.id]);
 assert.equal(C.dueRules(d,'2024-01-31','daily').length,0);
 P.settle(d,'daily',receipt.id,'2024-02-29','skip','2024-03-31');
 assert.equal(d.rules[0].next,'2024-03-31');
 P.settle(d,'daily',receipt.id,'2024-03-31','post','2024-03-31');
 assert.equal(d.rules[0].next,'2024-04-30');
 assert.equal(C.postDue(d,'2024-03-31','daily'),0);
 assert.deepEqual(S.undo(d,receipt),{restored:0,skipped:1});
 C.validate(d);
});

test('subscription updates reject stale previews and support undo before consumption',()=>{
 const d=ledger();
 const make=()=>S.preview(d,'daily','create_subscription',{name:'虚构年度工具',amount:3600,account:'wallet',category:'cat-4',next:'2024-02-29',frequency:'yearly'});
 const created=S.apply(d,make());
 const change=S.preview(d,'daily','update_subscription',{id:created.id,amount:4800,enabled:false});
 const receipt=S.apply(d,change);
 assert.equal(D.subscriptions(d,'daily').length,0);
 assert.deepEqual(S.undo(d,receipt),{restored:1,skipped:0});
 assert.equal(d.rules[0].entry.amount,3600);
 const stale=S.preview(d,'daily','update_subscription',{id:created.id,amount:5000});
 d.rules[0].entry.amount=3700;
 assert.throws(()=>S.apply(d,stale),/已变化/);
 d.rules[0].entry.amount=3600;
 assert.deepEqual(S.undo(d,created),{restored:1,skipped:0});
 assert.equal(d.rules.length,0);
});

test('installments post the exact final amount and finish without duplicate periods',()=>{
 const d=ledger();d.rules.push({id:'installment',name:'虚构三期',enabled:true,subscription:false,next:'2024-01-31',frequency:'monthly',anchor:31,total:3,remaining:3,finalAmount:332,entry:entry(d,'installment-template',{date:'2024-01-31',amount:334})});
 assert.equal(C.postDue(d,'2024-03-31','daily'),3);
 assert.deepEqual(d.entries.map(t=>[t.date,t.amount]),[['2024-01-31',334],['2024-02-29',334],['2024-03-31',332]]);
 assert.equal(C.totals(d.entries).expense,1000);
 assert.equal(d.rules[0].remaining,0);assert.equal(d.rules[0].enabled,false);
 assert.equal(C.postDue(d,'2025-12-31','daily'),0);
 C.validate(d);
});

test('budget pace includes refunds and distinguishes future-dated spending',()=>{
 const d=financialFlow();
 d.entries.push(entry(d,'future-purchase',{date:'2024-02-25',amount:10000}));
 const budget={id:'budget',book:'daily',category:'cat-0',period:'month',amount:29000};d.budgets.push(budget);
 const pace=P.budgetPace(d,budget,'2024-02-01','2024-02-14');
 assert.deepEqual([pace.spent,pace.spentToDate,pace.expected,pace.totalDays,pace.remainingDays,pace.left],[17000,7000,14000,29,16,12000]);
 assert.equal(pace.ahead,false);
 const future=P.budgetPace(d,budget,'2024-02-01','2024-01-31');
 assert.equal(future.phase,'future');assert.equal(future.spentToDate,0);
 const past=P.budgetPace(d,budget,'2024-02-01','2024-03-01');
 assert.equal(past.phase,'past');assert.equal(past.remainingDays,0);
});

test('report totals, date buckets, categories and ledger details agree',()=>{
 const d=financialFlow(),range=A.period('month','2024-02'),rows=C.filter(d,{book:'daily',start:range.start,end:range.end});
 assert.deepEqual([range.start,range.end,range.days,range.previousStart,range.previousEnd],['2024-02-01','2024-02-29',29,'2024-01-01','2024-01-31']);
 const report=A.insights(rows,range);
 assert.deepEqual([report.income,report.expense,report.net,report.activeDays,report.dailyAverage],[50000,7000,43000,1,241]);
 const daily=A.buckets(rows,range.start,range.end,'day');
 assert.equal(daily.slots.length,29);
 assert.equal(daily.slots.reduce((n,b)=>n+b.expense,0),7000);
 assert.equal(daily.slots.flatMap(b=>b.ids).length,6);
 assert.deepEqual(A.groups(d,rows,'expense','category','parent').map(g=>[g.key,g.value]),[['cat-0',7000]]);
 const timeline=G.timeline(d,rows,range.start,range.end,'day','category','parent');
 for(const slot of timeline.slots)assert.equal(slot.groups.reduce((n,g)=>n+g.expense,0),slot.expense);
 assert.equal(F.breakdown(rows).netExpense,report.expense);
});

test('a later-month refund remains negative expense rather than becoming income',()=>{
 const d=ledger();d.entries=[entry(d,'old-expense',{date:'2024-01-31',amount:5000}),entry(d,'later-refund',{kind:'refund',date:'2024-02-02',amount:2000,related:'old-expense'})];C.validate(d);
 const rows=C.filter(d,{book:'daily',period:'2024-02'}),totals=C.totals(rows),donut=A.donutGroups(A.groups(d,rows));
 assert.deepEqual(totals,{income:0,expense:-2000,count:1});
 assert.equal(donut.total,0);assert.equal(donut.negativeTotal,-2000);assert.equal(donut.net,-2000);assert.equal(donut.slices.length,0);
 assert.equal(A.comparison(-2000,0).percent,null);
});

test('tag timeline avoids double counting and hidden groups recompute visible totals',()=>{
 const d=financialFlow(),data=G.timeline(d,d.entries,'2024-02-01','2024-02-29','month','tag');
 assert.equal(data.slots[0].expense,7000);
 assert.equal(data.slots[0].groups.reduce((n,g)=>n+g.expense,0),7000);
 const key=data.groups.find(g=>g.key.includes('测试旅行')).key;
 const shown=G.shown(data,[key]);
 assert.equal(shown.slots[0].expense,-5000);
 assert.equal(shown.slots[0].income,50000);
 assert.equal(shown.slots[0].ids.includes('purchase'),false);
});

test('import confirmation, undo, trash duplicate protection and restore form one reversible flow',async()=>{
 const d=ledger(),input=csvInput([
  '2024-02-01 12:00:00,餐饮美食,虚构餐厅,测试午餐,支出,18.25,支付宝,交易成功,fictional-order-a',
  '2024-02-02 09:00:00,工资,虚构单位,测试工资,收入,200.00,支付宝,交易成功,fictional-order-b'
 ]);
 const batch=await Import.analyze(input,d,'daily'),keys=batch.rows.map(r=>r.key);
 assert.equal(Import.preflight(d,batch,keys).ok,true);
 const ids=Import.post(d,batch,keys);Import.markPosted(batch,keys);
 assert.equal(d.imports[0].count,2);assert.equal(d.entries.length,2);
 assert.deepEqual(C.totals(d.entries),{income:20000,expense:1825,count:2});
 Import.undo(d,batch.id);assert.equal(d.entries.length,0);assert.equal(d.trash.length,2);
 assert.throws(()=>Import.undo(d,batch.id),/已撤销/);
 const repeat=await Import.analyze(input,d,'daily');
 assert.ok(repeat.rows.every(r=>r.blockers.some(b=>/回收站/.test(b))));
 C.restoreEntries(d,ids);C.validate(d);
 assert.equal(d.entries.length,2);assert.equal(d.trash.length,0);
 const existing=await Import.analyze(input,d,'daily');assert.ok(existing.rows.every(r=>r.blockers.some(b=>/相同订单/.test(b))));
});

test('batch confirmation fails atomically when selected rows share an order ID',async()=>{
 const d=ledger(),batch=await Import.analyze(csvInput([
  '2024-02-01 12:00:00,餐饮美食,虚构餐厅,测试午餐,支出,18.25,支付宝,交易成功,fictional-duplicate',
  '2024-02-01 12:00:00,餐饮美食,虚构餐厅,测试午餐,支出,18.25,支付宝,交易成功,fictional-duplicate'
 ]),d,'daily');
 const before=JSON.stringify(d);
 assert.throws(()=>Import.post(d,batch,batch.rows.map(r=>r.key)),/ID.*重复/);
 assert.equal(JSON.stringify(d),before);
});

test('storage serializes edits and keeps the previous valid version recoverable',async()=>{
 const vault=memoryVault(ledger()),store=new Store(vault);assert.equal(await store.load(),true);
 const original=vault.files.get(PATH);
 await Promise.all([
  store.change(d=>{d.entries.push(entry(d,'first'));}),
  store.change(d=>{d.entries.push(entry(d,'second'));})
 ]);
 assert.equal(store.data.revision,2);assert.equal(store.data.entries.length,2);
 assert.equal(JSON.parse(vault.files.get(ROOT+'/恢复副本.json')).entries.length,1);
 assert.equal(vault.files.get(ROOT+'/备份/'+C.today()+'.json'),original);
 const snapshot=await store.change(d=>{d.entries.push(entry(d,'third'));},{snapshot:true});
 assert.equal(JSON.parse(vault.files.get(snapshot.snapshot)).entries.length,2);
 assert.equal(snapshot.data.revision,3);
 assert.equal(JSON.parse(vault.files.get(PATH)).entries.length,3);
});

test('storage rejects edits after an external update and reloads the newer ledger',async()=>{
 const vault=memoryVault(ledger()),store=new Store(vault);await store.load();
 const external=ledger();external.revision=7;external.entries.push(entry(external,'external'));
 const text=JSON.stringify(external);vault.files.set(PATH,text);
 let ran=false;await assert.rejects(store.change(()=>{ran=true;}),/别处更新/);
 assert.equal(ran,false);assert.equal(vault.files.get(PATH),text);assert.equal(store.data.revision,7);
 await store.change(d=>{d.entries.push(entry(d,'after-reload'));});
 assert.equal(store.data.revision,8);assert.equal(store.data.entries.length,2);
});

test('storage compare-and-swap blocks an update arriving during save',async()=>{
 const vault=memoryVault(ledger()),store=new Store(vault);await store.load();
 const external=ledger();external.revision=9;external.entries.push(entry(external,'race-winner'));
 const text=JSON.stringify(external);vault.beforeProcess=async()=>{vault.files.set(PATH,text);};
 await assert.rejects(store.change(d=>{d.entries.push(entry(d,'race-loser'));}),/外部更新/);
 assert.equal(vault.files.get(PATH),text);assert.equal(store.data.entries.length,0);
 await assert.rejects(store.change(()=>{}),/别处更新/);
 assert.equal(store.data.revision,9);
});

test('invalid or asynchronous save callbacks never write data and do not poison the queue',async()=>{
 const vault=memoryVault(ledger()),store=new Store(vault);await store.load();const original=vault.files.get(PATH);
 await assert.rejects(store.change(d=>{d.entries.push(entry(d,'invalid',{amount:0}));}),/金额/);
 await assert.rejects(store.change(async d=>{d.entries.push(entry(d,'async'));}),/同步/);
 assert.equal(vault.files.get(PATH),original);assert.equal(vault.files.size,1);
 await store.change(d=>{d.entries.push(entry(d,'valid'));});assert.equal(store.data.entries.length,1);
});

test('damaged storage blocks ordinary writes and preserves the damaged original during restore',async()=>{
 const damaged='{not valid JSON',vault=memoryVault(damaged),store=new Store(vault);
 assert.equal(await store.load(),false);
 await assert.rejects(store.change(()=>{}),/读取失败/);
 assert.equal(vault.files.get(PATH),damaged);
 const replacement=ledger();replacement.entries.push(entry(replacement,'recovered'));
 await store.restore(JSON.stringify(replacement));
 assert.equal(store.error,'');assert.equal(store.data.entries.length,1);
 const originals=[...vault.files].filter(([p])=>p.includes('/损坏原件-'));
 assert.equal(originals.length,1);assert.equal(originals[0][1],damaged);
 C.validate(JSON.parse(vault.files.get(PATH)));
});

test('legacy wishes without a target are not reported complete on the planning page',()=>{
 const goal={id:'unset-wish',name:'尚未定价的心愿',target:0,opening:0,contributions:[],deadline:''};
 assert.equal(require('../src/planning').goalPlan(goal,'2026-10-25').complete,false);
 assert.equal(require('../src/dashboard').goalProgress(goal).complete,false);
});
