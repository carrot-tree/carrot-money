'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),A=require('../src/analytics'),G=require('../src/report-grouping'),P=require('../src/planning'),I=require('../src/imports'),AI=require('../src/ai-import'),Category=require('../src/category-tools');
const LocalRefund=require('../src/ai-refund-local');
const account=(id,currency='CNY')=>({id,name:id,opening:0,currency,rate:1,archived:false});
const entry=(d,id,seed={})=>C.newEntry(d,{id,title:id,amount:100,date:'2026-10-01',...seed});

test('validate handles 10,000 entries, 500 trash records and 100 accounts under 80 ms',t=>{
 const d=C.blank();
 for(let i=0;i<100;i++)d.accounts.push(account('a'+i));
 for(let i=0;i<8000;i++)d.entries.push(entry(d,'e'+i,{account:'a'+i%100}));
 for(let i=0;i<2000;i++)d.entries.push(entry(d,'r'+i,{kind:'refund',related:'e'+i,amount:50,date:'2026-11-01'}));
 for(let i=0;i<500;i++)d.trash.push(entry(d,'t'+i,{kind:'refund',related:'e'+i,amount:50,date:'2026-11-01'}));
 C.validate(d);C.validate(d);
 const times=Array.from({length:7},()=>{const start=performance.now();assert.equal(C.validate(d),d);return performance.now()-start;}).sort((a,b)=>a-b);
 t.diagnostic('Median '+times[3].toFixed(2)+' ms, range '+times[0].toFixed(2)+'–'+times.at(-1).toFixed(2)+' ms');
 assert.ok(times[3]<80,'median '+times[3].toFixed(2)+' ms');
 d.entries[8000].amount=101;
 assert.throws(()=>C.validate(d),/合计不能超过/);
});

test('pending reimbursements, parent categories and case-insensitive search use active returns',()=>{
 const d=C.blank();d.categories.push({id:'child',name:'SUSHI',type:'expense',parent:'cat-0'});
 d.entries=[entry(d,'e1',{category:'child',reimbursable:true}),entry(d,'e2',{category:'child',reimbursable:true}),entry(d,'r',{category:'child',kind:'refund',related:'e1'})];
 d.trash=[entry(d,'t',{category:'child',kind:'refund',related:'e2'})];
 assert.deepEqual(C.filter(d,{category:'cat-0',pending:true,query:'sUsHi'}).map(t=>t.id),['e2']);
});

test('split account statistics are additive and preserve the source amount and date',()=>{
 const d=C.blank();d.accounts.push(account('a'),account('b'),account('stale'));
 const e=entry(d,'meal',{account:'stale',splits:[{account:'a',amount:25},{account:'b',amount:75}]});
 const r=entry(d,'refund',{kind:'refund',related:e.id,amount:33,account:'b',date:'2026-11-05'});
 d.entries=[e,r];assert.deepEqual(C.filter(d,{account:'stale'}),[]);
 C.validate(d);assert.equal(e.account,'');assert.deepEqual([...C.accountBalances(d).values()],[-25,-42,0]);
 const a=C.consumption(d,{account:'a',period:'2026-10'}),b=C.consumption(d,{account:'b',period:'2026-10'});
 assert.deepEqual([a[0].amount,a[0].date,C.totals(a).expense,C.totals(b).expense],[100,'2026-10-01',17,50]);
 assert.deepEqual([C.consumptionBreakdown(d,a).gross,C.consumptionBreakdown(d,a).refund],[25,8]);
 assert.equal(C.totals(C.accountCashRows(C.filter(d,{account:'a'}),'a')).expense,25);
 assert.deepEqual(Object.fromEntries(G.groups(d,C.consumption(d),'account').map(g=>[g.key,g.expense])),{b:50,a:17});
 assert.equal(C.totals(C.consumption(d,{period:'2026-11'})).expense,0);
});

test('budget usage and elapsed pace reuse the same original-date net spending index',()=>{
 const d=C.blank();d.categories.push({id:'child',name:'虚构',type:'expense',parent:'cat-0'});
 d.entries.push(entry(d,'e',{category:'child'}),entry(d,'future',{date:'2026-10-29'}),entry(d,'r',{kind:'refund',category:'child',related:'e',amount:40,date:'2026-11-11'}));
 const lookup=C.spendingIndex(d,'daily'),total={amount:500,book:'daily',period:'month'},category={...total,category:'cat-0'};
 assert.deepEqual([C.budgetUsage(d,total,'2026-10-02',lookup).spent,C.budgetUsage(d,category,'2026-10-02',lookup).spent],[160,160]);
 assert.equal(P.budgetPace(d,total,'2026-10-02','2026-10-02',lookup).spentToDate,60);
});

test('last installment adjusts same-currency destination or allocates split cents exactly',()=>{
 const d=C.blank();d.accounts.push(account('a'),account('b'));
 const make=(id,item)=>({id,name:id,next:'2026-10-01',enabled:true,frequency:'monthly',remaining:1,finalAmount:103,entry:entry(d,id,item)});
 d.rules.push(make('transfer',{kind:'transfer',account:'a',toAccount:'b',toAmount:100}),make('split',{account:'a',splits:[{account:'a',amount:30},{account:'b',amount:70}]}));
 C.validate(d);const rows=C.dueRules(d,'2026-10-02');
 assert.equal(rows[0].toAmount,103);assert.deepEqual(rows[1].splits.map(x=>x.amount),[31,72]);assert.equal(rows[1].account,'');
 C.postDue(d,'2026-10-02');C.validate(d);
});

test('trashed returns allow editing the original, require current compatibility on restore and purge with it',()=>{
 const d=C.blank(),e=entry(d,'e');d.entries.push(e);d.trash.push(entry(d,'r',{kind:'refund',related:'e'}));
 C.putEntry(d,{...e,date:'2026-11-10',currency:'USD',rate:7});C.validate(d);
 assert.throws(()=>C.restoreEntries(C.clone(d),['r']),/需关联/);
 C.removeEntries(d,['e']);C.validate(d);C.purgeEntries(d,['e']);assert.deepEqual(d.trash,[]);
});

test('category reference index checks report visibility and presets without free-text matches',()=>{
 const d=C.blank();d.settings.savedEntryFilters=[{filters:{category:'cat-0',query:'cat-1'}}];d.settings.chartDefaults={daily:{home:{barHidden:{'category:parent':['cat-2'],account:['cat-3']}}}};
 const plan=Category.preview(d,'delete',['cat-0','cat-1','cat-2','cat-3']);
 assert.deepEqual(plan.items.map(x=>x.change),[false,true,false,true]);
});

test('CSV preserves literal quotes and valid replacement characters and falls back on GB18030',()=>{
 assert.deepEqual(I.csvRows('a,尺寸 12",b\n"a,b","x""y",z'),[['a','尺寸 12"','b'],['a,b','x"y','z']]);
 assert.equal(I.decode(Buffer.from('a�b','utf8')),'a�b');
 assert.equal(I.decode(Buffer.from([0xd6,0xd0])),'中');
 assert.equal(A.calculate('8−3.25'),475);
});

function importRow(d,key,seed={},nature=seed.kind||'expense'){
 return {key,state:'pending',nature,score:1,reasons:[],record:{key,dateRaw:'2026-10-01',source:'sheet',status:'交易成功',title:key},entry:entry(d,key,{account:'a',...seed})};
}
test('import preflight permits category-free repayments and excludes refunds of a blocked in-batch expense',()=>{
 const d=C.blank();d.accounts.push(account('a'),account('b'));
 const parent=importRow(d,'parent',{account:''}),refund=importRow(d,'refund',{kind:'refund',related:'parent',amount:20}),transfer=importRow(d,'transfer',{kind:'transfer',category:'',toAccount:'b',toAmount:100},'repayment');
 const batch={id:'batch',book:'daily',name:'synthetic',rows:[refund,parent,transfer]};
 const result=AI.preflight(d,batch,['refund','parent','transfer']);
 assert.deepEqual(result.allowed,['transfer']);assert.equal(result.error,'');
 assert.match(result.blocked[0].blockers.join(' '),/本批原支出/);
 assert.equal(d.entries.length,0);assert.equal(d.imports.length,0);
 assert.equal(AI.preflight(d,batch,['transfer']).ok,true);
 parent.entry.account='a';assert.equal(AI.preflight(d,batch,['parent','refund']).ok,true);
});

test('local refund index matches full source-specific order references for active and batch purchases',()=>{
 const d=C.blank(),original=entry(d,'purchase',{externalId:'ORDER123456',importSource:'sheet'});
 d.entries.push(original);
 const refund=importRow(d,'refund',{kind:'refund',amount:25});
 refund.record={...refund.record,order:'ORDER123456'};
 const batch={book:'daily',rows:[refund]};
 assert.equal(LocalRefund.match(batch,d).results[0].options[0].expenseId,'purchase');
 refund.record.source='wechat';
 assert.deepEqual(LocalRefund.match(batch,d).results[0].options,[]);
});
