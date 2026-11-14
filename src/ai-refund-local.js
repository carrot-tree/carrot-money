'use strict';
const C=require('./core'),Refunds=require('./ai-refunds'),E=require('./ai-exclusions');
// Only complete order references qualify. Similar prices or merchant names are
// not evidence of a refund relationship, and a parent reference takes priority.
function parentRefs(record){return Object.entries(record?.raw||{}).filter(([k])=>/原.*(?:订单|交易|商户|商家).*号/.test(k)).map(([,v])=>String(v||'').trim()).filter(x=>x&&!/^(?:[-/—]+|无|不适用|null|none)$/i.test(x));}
function orderRefs(record){
 const refs=new Set(E.refs(record||{}));
 for(const match of String(record?.title||'').matchAll(/(?:订单|单号)\s*[-：:#]?\s*([A-Za-z0-9][A-Za-z0-9_-]{7,})/g))refs.add(match[1]);
 return refs;
}
function match(batch,d){
 const started=Date.now(),rows=Refunds.eligible(batch),seen=new Set(),results=[];
 for(const row of rows){
  const parents=parentRefs(row.record),refs=parents.length?new Set(parents):orderRefs(row.record),candidates=Refunds.originals(batch,d,row).filter(x=>{
   const record=batch.rows.find(r=>r.key===x.key)?.record||{source:x.entry.importSource,order:x.entry.externalId,title:x.entry.title};
   if(record.source!==row.record.source)return false;
   const other=orderRefs(record);return parents.length?parents.every(id=>other.has(id)):[...refs].some(id=>other.has(id));
  });
  for(const x of candidates)seen.add(x.entry.id);
  const options=candidates.length===1?candidates.map(x=>({expenseId:x.entry.id,key:x.key,entry:C.clone(x.entry),source:x.source,confidence:'高',reason:'完整订单号一致，日期、币种与可退金额符合'})):[];
  results.push({key:row.key,entry:C.clone(row.entry),options,failed:false,error:options.length?'':candidates.length>1?'同一订单找到多笔原支出，请手动核实':'没有找到完整订单号一致的原支出，请手动核实或使用 AI 核对'});
 }
 // A set of individually valid partial refunds can exceed the remaining total.
 const groups=new Map();for(const r of results){const option=r.options[0];if(option){if(!groups.has(option.expenseId))groups.set(option.expenseId,[]);groups.get(option.expenseId).push(r);}}
 for(const group of groups.values())if(group.reduce((n,r)=>n+r.entry.amount,0)>Refunds.available(batch,d,group[0].options[0].entry))for(const r of group){r.options=[];r.error='同一原支出的退款合计超过可退金额，请核实重复退款或金额';}
 return {engine:'local',signature:Refunds.signature(batch,d),results,requests:0,expenseCount:seen.size,refundCount:rows.length,elapsedMs:Date.now()-started};
}
module.exports={match,orderRefs,parentRefs};
