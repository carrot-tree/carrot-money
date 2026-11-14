'use strict';
const C=require('./core'),Action=require('./ai-ask-action'),Sub=require('./ai-subscriptions');
const typeFor=(d,t)=>t.kind==='income'?'income':['expense','refund','reimbursement'].includes(t.kind)?'expense':t.kind==='legacy'?d.categories.find(c=>c.id===t.category)?.type:null;
function category(d,t,id){const exact=d.categories.filter(c=>c.id===id),matches=exact.length?exact:d.categories.filter(c=>c.name===id||C.categoryName(d,c.id)===id),c=matches.length===1?matches[0]:null;if(!c||c.archived||c.type!==typeFor(d,t))throw Error('建议的分类不存在、已归档或收支类型不符');return c;}
function validate(value,d,book,ranges){
 if(!Array.isArray(value)||value.length>d.entries.length)throw Error('分类建议清单无效');
 const seen=new Set();return value.map(f=>{
  if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['id','to','reason','confidence','question','options'].includes(k))||typeof f.id!=='string'||seen.has(f.id)||!['certain','uncertain'].includes(f.confidence)||typeof f.reason!=='string'||!f.reason.trim()||f.reason.length>500)throw Error('每条建议须有唯一记录 ID、依据与确定程度');
  seen.add(f.id);const t=d.entries.find(t=>t.id===f.id&&t.book===book);if(!t||!ranges.some(r=>t.date>=r.start&&t.date<=r.end))throw Error('建议必须来自已完整读取的期间账单');
  const to=f.to===''||f.to===null?undefined:f.to;const target=to!==undefined?category(d,t,to).id:undefined;if(f.confidence==='certain'&&!target)throw Error('确定的建议须指定目标分类');
  if(f.question!==undefined&&(typeof f.question!=='string'||f.question.length>300))throw Error('待核实问题无效');
  if(f.options!==undefined&&(!Array.isArray(f.options)||f.options.length>8||new Set(f.options).size!==f.options.length))throw Error('待核实选项无效');const options=(f.options||[]).map(id=>category(d,t,id).id);if(new Set(options).size!==options.length)throw Error('待核实选项重复');
  return {...f,to:target,options,signature:JSON.stringify(t),date:t.date,title:t.payee||t.title||'未命名账目',content:[t.title,t.note].filter(Boolean).join(' · '),amount:t.amount,currency:t.currency,from:t.category,oldStr:C.categoryName(d,t.category),newStr:target?C.categoryName(d,target):'等你补充用途',question:f.question||(f.confidence==='uncertain'?'这笔账单应该归入哪个分类？':'')};
 });
}
function assertFresh(d,book,findings){for(const f of findings){const t=d.entries.find(t=>t.id===f.id&&t.book===book);if(!t||JSON.stringify(t)!==f.signature)throw Error('建议对应的账单已变化，请重新分析');}}
function preview(d,book,findings,choices){
 assertFresh(d,book,findings);if(!Array.isArray(choices)||!choices.length||new Set(choices.map(x=>x.id)).size!==choices.length)throw Error('请选择要修改的建议');
 const changes=choices.map(x=>{const f=findings.find(f=>f.id===x.id);if(!f)throw Error('记录不在本次建议中');const t=d.entries.find(t=>t.id===x.id);category(d,t,x.to);return {id:x.id,to:x.to,reason:f.reason+(f.confidence==='uncertain'||x.to!==f.to?'；用户选择：'+C.categoryName(d,x.to):'')};});
 const dates=findings.map(x=>x.date).sort();return Action.preview(d,book,{intent:'action',action:'set_categories',start:dates[0],end:dates.at(-1),changes});
}
function history(turn){
 const a=turn.answer||{},receipt=turn.receipt,applied=new Set(turn.phase==='done'?receipt?.ids||[]:[]);
 const operation=a.task?{task:a.task,ids:a.ids,rows:a.rows?.map(({id,oldStr,newStr,reason})=>({id,oldStr,newStr,reason})),status:turn.phase||'待确认',executedIds:[...applied],unmodifiedIds:(a.ids||[]).filter(id=>!applied.has(id)),actualChanges:receipt?.changes,undo:turn.undoResult}:a.name?{name:a.name,status:turn.phase||'待确认',executedIds:receipt?.ids,proposed:Sub.names.has(a.name)&&!turn.phase?{arguments:a.args,item:Sub.describe(a.item)}:undefined,created:receipt?.item?(Sub.names.has(a.name)?Sub.describe(receipt.item):{id:receipt.id,...receipt.item}):undefined,undo:turn.undoResult}:undefined;
 const findings=a.findings?.map(({id,to,confidence,reason,question,options})=>({id,to,confidence,reason,question,options,resolved:turn.findingChoices?.[id],selected:turn.findingSelected?turn.findingSelected.includes(id):confidence==='certain'}));
 return {operation,findings};
}
module.exports={validate,assertFresh,preview,history,typeFor};
