'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),Category=require('../src/ai-category-request');
function ledger(){
 const d=C.blank();d.books.push({id:'other',name:'其他虚构账本',archived:false});
 d.categories.push({id:'medical',name:'医疗',type:'expense',parent:'',archived:false});
 const row=(id,seed={})=>C.newEntry(d,{id,title:'社保缴费',date:'2024-02-10',amount:1000,book:'daily',...seed});
 d.entries=[row('title-a'),row('title-b',{title:'补缴社保'}),row('merchant',{title:'普通付款',payee:'社保服务中心'}),row('note',{title:'普通付款',note:'个人社保补缴'}),row('wrong-month',{date:'2024-03-01'}),row('wrong-book',{book:'other'}),row('income',{kind:'income',category:'cat-9'}),row('legacy-expense',{kind:'legacy',amount:0,legacyIncome:null,legacyExpense:1000}),row('legacy-both',{kind:'legacy',amount:0,legacyIncome:500,legacyExpense:1000})];
 return C.validate(d);
}
const run=(text,d=ledger())=>Category.resolve(text,d,'daily','2026-10-25');

test('the reported sentence extracts the explicit field and literal keyword without scope or preview prose',()=>{
 const d=ledger(),before=JSON.stringify(d),job=run('把2024年2月当前账本中名称包含社保的支出，类别改为医疗。请生成全部匹配记录的逐笔预览。',d);
 assert.ok(job);assert.equal(job.explicit,true);assert.equal(job.keyword,'社保');assert.equal(job.target,'医疗');assert.equal(job.field,'名称');assert.equal(job.to,'medical');
 assert.deepEqual(job.range,{start:'2024-02-01',end:'2024-02-29'});assert.deepEqual(job.rows.map(t=>t.id),['title-a','title-b','legacy-expense']);
 const result=Category.candidates(job,d);assert.equal(result.data.condition.exact,true);assert.equal(result.data.rows.length,3);assert.match(result.summary,/交给 AI 核对/);
 assert.equal(JSON.stringify(d),before);
});

test('normal field syntax supports titles, merchants, counterparties and notes without broadening fields',()=>{
 for(const [label,fields,ids]of [['名称',['title'],['title-a','title-b','legacy-expense']],['标题',['title'],['title-a','title-b','legacy-expense']],['商户',['payee'],['merchant']],['交易对方',['payee'],['merchant']],['备注',['note'],['note']]]){
  const job=run('将2024-02'+label+'包含社保的支出分类改成医疗');
  assert.ok(job,label);assert.equal(job.explicit,true);assert.deepEqual(job.fields,fields);assert.deepEqual(job.rows.map(t=>t.id),ids);
 }
});

test('date and current-book prefixes are recognized only in the grammatical prefix',()=>{
 for(const text of ['请帮我把2024年2月当前账本里的名称包含社保的支出类别改为医疗','2024年2月将当前账本中名称包含社保的支出类别改为医疗','把当前账本中2024年2月名称包含社保的支出类别改为医疗','名称包含社保的支出类别改为医疗']){
  const job=run(text);assert.ok(job,text);assert.equal(job.keyword,'社保');assert.equal(job.field,'名称');
 }
});

test('quoted keywords preserve syntax-looking words, dates, punctuation and spaces exactly',()=>{
 for(const [left,right]of [['“','”'],['「','」'],['『','』'],['【','】'],['"','"'],["'","'"],['‘','’']]){
  const d=ledger(),keyword='当前账本中名称包含社保、和医保 2024年2月';
  d.entries.push(C.newEntry(d,{id:'literal',title:keyword,date:'2024-02-20',book:'daily',amount:1500}));
  const job=run('把2024年2月名称包含'+left+keyword+right+'的支出，类别改为'+left+'医疗'+right+'。',d);
  assert.ok(job,left);assert.equal(job.keyword,keyword);assert.equal(job.target,'医疗');assert.deepEqual(job.rows.map(t=>t.id),['literal']);
 }
 const d=ledger(),keyword=' A B，C。D ';d.entries[0].title=keyword;
 const job=run('名称包含“'+keyword+'”的支出类别改为医疗',d);assert.equal(job.keyword,keyword);assert.deepEqual(job.rows.map(t=>t.id),['title-a']);
});

test('a month inside a quoted keyword is not used as the requested period',()=>{
 const d=ledger();d.entries[0].title='2022年1月补缴社保';
 const job=run('名称包含“2022年1月”的支出类别改为医疗',d);
 assert.ok(job);assert.equal(job.keyword,'2022年1月');assert.deepEqual(job.range,{start:'2024-02-10',end:'2024-03-01'});assert.deepEqual(job.rows.map(t=>t.id),['title-a']);
});

test('simple literal descriptions retain their original title-or-merchant candidate behavior',()=>{
 const job=run('把2024年2月社保的支出类别改为医疗');
 assert.ok(job);assert.equal(job.explicit,false);assert.equal(job.keyword,'社保');assert.deepEqual(job.fields,['title','payee']);
 assert.deepEqual(job.rows.map(t=>t.id),['title-a','title-b','merchant','legacy-expense']);
 assert.equal(run('把请客的支出类别改为医疗').keyword,'请客');
});

test('complex or ambiguous conditions safely fall back instead of becoming a fabricated keyword',()=>{
 for(const text of [
  '把2024年2月名称包含社保或者医保的支出类别改为医疗',
  '把2024年2月名称包含社保且商户包含医院的支出类别改为医疗',
  '把2024年2月名称包含社保且金额大于100的支出类别改为医疗',
  '把2024年2月名称包含社保的支出类别改为医疗。然后删除其他记录。',
  '把2024年2月名称包含社保的支出类别改为医疗。请生成逐笔预览并自动确认。',
  '把2024年2月和2024年3月名称包含社保的支出类别改为医疗',
  '把2024年13月名称包含社保的支出类别改为医疗',
  '把2024年2月另一个账本中名称包含社保的支出类别改为医疗',
  '把2024年2月当前账本中社保的支出类别改为医疗',
  '把和社保相关的支出类别改为医疗',
  '把名称不包含社保的支出类别改为医疗',
  '把名称包含“社保的支出类别改为医疗',
  '把名称包含“社保”和“医保”的支出类别改为医疗',
  '把名称包含社保的支出类别改为医疗和健康'
 ])assert.equal(run(text),null,text);
});

test('explicit candidates still require AI tool review before returning a preview',async()=>{
 const Agent=require('../src/ai-agent'),d=ledger(),before=JSON.stringify(d),requests=[];
 const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://example.invalid/v1',apiKey:'fictional-only',model:'fictional-model',agentEnabled:true,agentMaxSeconds:30}};
 const result=await Agent.run('把2024年2月当前账本中名称包含社保的支出，类别改为医疗。请生成全部匹配记录的逐笔预览。',{d,book:'daily',settings,writeAccess:true,requestUrl:async request=>{
  requests.push(JSON.parse(request.body));
  const action=requests.length===1?{type:'tool',name:'category_candidates',arguments:{}}:{type:'tool',name:'propose_change',arguments:{action:'set_category',start:'2024-02-01',end:'2024-02-29',ids:['title-a','title-b','legacy-expense'],to:'medical'}};
  return {status:200,json:{choices:[{message:{content:JSON.stringify(action)},finish_reason:'stop'}]}};
 }});
 assert.equal(requests.length,2);assert.equal(result.status,'preview');assert.deepEqual(result.ids,['title-a','title-b','legacy-expense']);
 assert.match(JSON.stringify(requests[1].messages),/category_candidates 返回/);assert.equal(JSON.stringify(d),before);
});

test('quoted target names and missing or duplicate categories keep explicit resolution errors',()=>{
 const d=ledger();d.categories.push({id:'special',name:'健康和医疗',type:'expense',parent:'',archived:false});
 assert.equal(run('名称包含社保的支出类别改为“健康和医疗”',d).to,'special');
 const missing=run('名称包含社保的支出类别改为不存在的分类',d);assert.equal(missing.to,null);assert.match(missing.error,/找不到/);
 d.categories.push({id:'medical-duplicate',name:'医疗',type:'expense',parent:'',archived:false});
 const duplicate=run('名称包含社保的支出类别改为医疗',d);assert.equal(duplicate.to,null);assert.match(duplicate.error,/不唯一/);
});
