'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),Report=require('../src/ai-agent-report'),Agent=require('../src/ai-agent'),Tools=require('../src/ai-agent-tools'),Remote=require('../src/ai-provider');
const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://example.invalid/v1',apiKey:'fictional-report-key',model:'fictional-model',agentEnabled:true,agentMaxSeconds:30,agentMaxCalls:12,agentMaxTokens:200000}};
function ledger(){
 const d=C.blank(),entry=(id,seed={})=>C.newEntry(d,{id,book:'daily',date:'2024-02-10',title:'虚构'+id,amount:5000,...seed});
 d.entries=[entry('income',{kind:'income',category:'cat-9',amount:20000}),entry('expense',{reimbursable:true}),entry('refund',{kind:'refund',related:'expense',amount:1000}),entry('reimbursement',{kind:'reimbursement',related:'expense',amount:500}),entry('foreign',{amount:1234,currency:'USD',rate:7.2}),entry('fixed-jan',{date:'2024-01-15',amount:1200,payee:'虚构固定商户'}),entry('fixed-feb',{date:'2024-02-15',amount:1200,payee:'虚构固定商户'}),entry('large',{amount:80000}),entry('duplicate-a',{title:'虚构同款',amount:200}),entry('duplicate-b',{title:'虚构同款',amount:200})];
 d.budgets=[{id:'monthly',book:'daily',period:'month',category:'',amount:30000},{id:'category',book:'daily',period:'month',category:'cat-0',amount:10000},{id:'yearly',book:'daily',period:'year',category:'',amount:200000}];
 d.rules=[{id:'foreign-plan',name:'虚构美元订阅',subscription:true,enabled:true,frequency:'monthly',next:'2024-03-10',entry:entry('foreign-template',{currency:'USD',rate:7.2,amount:299})},{id:'paused-plan',name:'虚构暂停订阅',subscription:true,enabled:false,frequency:'yearly',next:'2024-04-10',entry:entry('paused-template',{amount:9900})}];
 return C.validate(d);
}
function vault(titles=['收入分析']){
 const files=new Map([[Tools.SPEC,titles.map((title,i)=>`| ${i+1} | ${title} | 说明 |`).join('\n')]]),folders=new Set(['Carrot记账','Carrot记账/导出']);
 return {files,adapter:{exists:async path=>files.has(path)||folders.has(path),read:async path=>{assert.ok(files.has(path));return files.get(path);}},createFolder:async path=>folders.add(path),getAbstractFileByPath:path=>files.has(path)?{path}:null,create:async(path,text)=>{assert.equal(files.has(path),false);files.set(path,text);return {path};},modify:async(file,text)=>files.set(file.path,text),process:async(file,fn)=>files.set(file.path,fn(files.get(file.path)))};
}
function response(markdown){return {status:200,json:{choices:[{message:{content:JSON.stringify({markdown})},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7}}};}
function options(d,v,requestUrl,extra={}){return {d,book:'daily',vault:v,settings:C.clone(settings),cfg:Agent.config(settings),job:{month:'2024-02',resume:false},requestUrl,...extra};}

test('model amounts use exact money keys while rates, shares, counts and unknown numbers retain their units',()=>{
 const raw={income:20000,netIncome:-1000,expense:0,balance:19000,previousExpense:500,delta:-500,meanExpense:123,monthlyAverage:999,incomeShare:12.34,expensePercent:-8.5,savingsRate:75,overrunPercent:10,rate:7.2,ratio:.5,count:12,total:20,occurrences:2,days:29,limit:12,offset:0,multiplier:3,incomeCount:4,unknown:20000,missing:null,rows:[{amount:1234,baseAmount:8885,income:0,expense:8885,currency:'USD',baseCurrency:'CNY',rate:7.2},{amount:100,currency:'JPY',baseAmount:5,rate:.05}]};
 const before=JSON.stringify(raw),wire=Report.modelFacts(raw);
 assert.equal(wire.income,'¥200.00');assert.equal(wire.netIncome,'¥-10.00');assert.equal(wire.expense,'¥0.00');assert.equal(wire.balance,'¥190.00');assert.equal(wire.previousExpense,'¥5.00');assert.equal(wire.delta,'¥-5.00');assert.equal(wire.meanExpense,'¥1.23');assert.equal(wire.monthlyAverage,'¥9.99');
 for(const key of ['incomeShare','expensePercent','savingsRate','overrunPercent','rate','ratio','count','total','occurrences','days','limit','offset','multiplier','incomeCount','unknown','missing'])assert.equal(wire[key],raw[key],key);
 assert.deepEqual(wire.rows[0],{amount:'USD 12.34',baseAmount:'¥88.85',income:'¥0.00',expense:'¥88.85',currency:'USD',baseCurrency:'CNY',rate:7.2});
 assert.equal(wire.rows[1].amount,'JPY 1.00');assert.equal(wire.rows[1].baseAmount,'¥0.05');
 assert.equal(JSON.stringify(raw),before);assert.notEqual(wire,raw);assert.notEqual(wire.rows,raw.rows);
});

test('real report facts cover statistics, budgets, subscriptions, anomalies and refunds without mutating cents',()=>{
 const d=ledger(),ledgerBefore=JSON.stringify(d),raw=Report.facts(d,'daily','2024-02','收入支出预算固定订阅大额交易复盘行动'),before=JSON.stringify(raw),wire=Report.modelFacts(raw);
 assert.equal(raw.current.income,20000);assert.equal(wire.current.income,'¥200.00');assert.equal(raw.current.expense,93985);assert.equal(wire.current.expense,'¥939.85');
 assert.equal(wire.current.daily.income,'¥6.90');assert.equal(wire.current.period.days,29);assert.equal(wire.current.count,9);
 assert.equal(wire.current.savingsRate,raw.current.savingsRate);assert.equal(wire.current.groups[0].expenseShare,raw.current.groups[0].expenseShare);
 assert.equal(wire.income.income,'¥200.00');assert.equal(wire.income.largestIncome.income,'¥200.00');
 assert.equal(wire.budget.total.budget,'¥300.00');assert.equal(wire.budget.total.actual,'¥939.85');assert.equal(wire.budget.total.difference,'¥-639.85');assert.equal(wire.budget.total.overrun,'¥639.85');assert.equal(wire.budget.total.overrunPercent,raw.budget.total.overrunPercent);
 assert.equal(wire.budget.categoryBudgets[0].budget,'¥100.00');assert.equal(wire.budget.otherPeriods[0].budget,'¥2000.00');assert.equal(wire.budget.actual,'¥939.85');
 assert.equal(wire.fixedCosts.items[0].monthlyAverage,'¥12.00');assert.equal(wire.fixedCosts.items[0].occurrences,2);
 assert.equal(wire.subscriptions.items.find(x=>x.name==='虚构美元订阅').amount,'USD 2.99');assert.equal(wire.subscriptions.items.find(x=>x.name==='虚构暂停订阅').amount,'¥99.00');assert.equal(wire.subscriptions.total,2);assert.equal(wire.subscriptions.activeCount,1);assert.equal(wire.subscriptions.pausedCount,1);
 const foreign=wire.largestTransactions.rows.find(x=>x.id==='foreign');assert.equal(foreign.amount,'USD 12.34');assert.equal(foreign.baseAmount,'¥88.85');assert.equal(foreign.expense,'¥88.85');assert.equal(foreign.rate,7.2);
 assert.equal(wire.largestTransactions.rows.find(x=>x.kind==='refund').expense,'¥-10.00');assert.equal(wire.largestTransactions.rows.find(x=>x.kind==='reimbursement').expense,'¥-5.00');
 assert.equal(wire.anomalies.large[0].amount,'¥800.00');assert.equal(wire.anomalies.pendingRefund[0].amount,'¥50.00');assert.equal(wire.anomalies.reimbursement[0].amount,'¥50.00');assert.equal(wire.anomalies.meanExpense,'¥159.14');assert.equal(wire.anomalies.multiplier,3);
 assert.equal(wire.anomalies.duplicates.items[0][0].amount,'¥2.00');assert.equal(wire.anomalies.duplicates.groups,1);
 assert.equal(wire.categoryChanges[0].expense,'¥939.85');assert.equal(wire.categoryChanges[0].previousExpense,'¥12.00');assert.equal(wire.categoryChanges[0].delta,'¥927.85');
 assert.equal(JSON.stringify(raw),before);assert.equal(JSON.stringify(d),ledgerBefore);
});

test('refund, reimbursement and net amounts use original currency and fractional major units',()=>{
 const raw=Report.facts(ledger(),'daily','2024-02','支出复盘');
 const item=Report.modelFacts(raw).largestTransactions.rows.find(row=>row.id==='expense');
 assert.deepEqual([item.refundedAmount,item.reimbursedAmount,item.netAmount],['¥10.00','¥5.00','¥35.00']);
 const [fx]=Report.modelFacts([{currency:'USD',refundedAmount:123,reimbursedAmount:500,netAmount:700,baseAmount:5040}]);
 assert.deepEqual([fx.refundedAmount,fx.reimbursedAmount,fx.netAmount,fx.baseAmount],['USD 1.23','USD 5.00','USD 7.00','¥50.40']);
 assert.deepEqual(Tools.references([{currency:'USD',refundedAmount:123,baseAmount:886}]).原币金额,['USD 1.23']);
});

test('a fenced report JSON reply saves on the first request',async()=>{
 const d=ledger(),v=vault();let calls=0;
 const result=await Report.run('生成2024-02分析报告',options(d,v,async()=>{
  calls++;
  const reply=response('## 收入分析\n\n本月收入 ¥200.00。');
  const message=reply.json.choices[0].message;
  message.content='\x60\x60\x60json\n'+message.content+'\n\x60\x60\x60';
  return reply;
 }));
 assert.equal(result.status,'done');
 assert.equal(calls,1);
 assert.match(v.files.get(result.path.replace(/\.html$/,'.md')),/收入 ¥200\.00/);
});

test('report sends formatted facts and unit instructions while evidence still validates original cents',async()=>{
 const d=ledger(),before=JSON.stringify(d),v=vault();let captured,calls=0;
 const result=await Report.run('生成2024-02分析报告',options(d,v,async request=>{
  calls++;captured=JSON.parse(request.body);const payload=JSON.parse(captured.messages.at(-1).content);
  assert.equal(payload.本地事实.current.income,'¥200.00');assert.equal(payload.本地事实.income.income,'¥200.00');
  assert.ok(payload.可引用.金额.includes('¥200.00'));assert.match(payload.金额单位,/不要再次除以100/);assert.match(captured.messages[0].content,/禁止再次除以100或乘以100/);assert.doesNotMatch(captured.messages[0].content,/金额单位为分/);
  return response('## 收入分析\n\n本月收入 ¥200.00。');
 }));
 assert.equal(calls,1);assert.equal(result.status,'done');assert.equal(result.ok,true);assert.equal(JSON.stringify(d),before);
 assert.match(v.files.get(result.path.replace(/\.html$/,'.md')),/收入 ¥200.00/);
});

test('the unchanged amount guard rejects a hundredfold error and accepts a corrected retry',async()=>{
 const d=C.blank();d.entries=[C.newEntry(d,{id:'income',kind:'income',category:'cat-9',date:'2024-02-10',amount:20000})];const v=vault();let calls=0;
 const result=await Report.run('生成2024-02分析报告',options(d,v,async request=>{
  const payload=JSON.parse(JSON.parse(request.body).messages.at(-1).content);calls++;
  assert.equal(payload.本地事实.current.income,'¥200.00');
  if(calls===2)assert.match(payload.修正,/报告金额 ¥20,000.*未见/);
  return response('## 收入分析\n\n本月收入 '+(calls===1?'¥20,000':'¥200.00')+'。');
 }));
 assert.equal(calls,2);assert.equal(result.status,'done');assert.doesNotMatch(v.files.get(result.path.replace(/\.html$/,'.md')),/¥20,000/);
});

test('persistent incorrect amounts never produce an accepted report',async()=>{
 const d=C.blank();d.entries=[C.newEntry(d,{id:'income',kind:'income',category:'cat-9',date:'2024-02-10',amount:20000})];const v=vault();let calls=0;
 const result=await Report.run('生成2024-02分析报告',options(d,v,async()=>{calls++;return response('## 收入分析\n\n收入 ¥20,000。');}));
 assert.equal(calls,2);assert.equal(result.status,'error');assert.equal(result.path,undefined);assert.match(result.message,/未见于本轮工具结果/);assert.equal([...v.files.keys()].some(path=>path.endsWith('.html')),false);
});

test('resuming a partial report uses display units and preserves previously saved sections',async()=>{
 const d=ledger(),v=vault(['总览','收入分析']);
 const first=await Report.run('生成2024-02分析报告',options(d,v,async()=>response('## 总览\n\n本月收入 ¥200.00。'),{cfg:{...Agent.config(settings),agentMaxCalls:1}}));
 assert.equal(first.status,'partial');assert.deepEqual(first.reportJob.completed,['总览']);
 let calls=0;
 const result=await Report.run('继续',options(d,v,async request=>{
  calls++;const payload=JSON.parse(JSON.parse(request.body).messages.at(-1).content);
  assert.equal(payload.板块,'收入分析');assert.deepEqual(payload.已有板块,['总览']);assert.equal(payload.本地事实.income.income,'¥200.00');
  return response('## 收入分析\n\n本月收入 ¥200.00。');
 },{job:{month:'2024-02',resume:true,previous:{question:'生成2024-02分析报告',answer:first}}}));
 assert.equal(calls,1);assert.equal(result.status,'done');assert.equal(result.path,first.path);assert.deepEqual(result.reportJob.completed,['总览','收入分析']);
 assert.equal(Tools.reportSections(v.files.get(result.path)).length,2);
});

for(const status of [400,408,415,429]){
 const attempts=[408,429].includes(status)?3:1;
 test(`report HTTP ${status} stops after ${attempts} request(s)`,async()=>{
  let calls=0;const v=vault(),result=await Report.run('生成2024-02分析报告',options(ledger(),v,async()=>{calls++;return {status};}));
  assert.equal(calls,attempts);assert.equal(result.status,'error');assert.match(result.message,new RegExp('HTTP '+status));assert.equal(result.path,undefined);
 });
}

test('legacy HTTP 408 messages stop even without a structured status property',async()=>{
 let calls=0;const result=await Report.run('生成2024-02分析报告',options(ledger(),vault(),async()=>{calls++;throw new Remote.ProviderError('HTTP 408：服务请求超时');}));
 assert.equal(calls,1);assert.equal(result.status,'error');assert.match(result.message,/HTTP 408/);
});

test('temporary report server errors retain one bounded retry',async()=>{
 let calls=0;const result=await Report.run('生成2024-02分析报告',options(ledger(),vault(),async()=>++calls===1?{status:503}:response('## 收入分析\n\n本月收入 ¥200.00。')));
 assert.equal(calls,2);assert.equal(result.status,'done');
});
