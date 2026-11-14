'use strict';
// Only match inside this imported batch. Never remove an existing ledger entry.
const norm=s=>String(s||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const closed=r=>/关闭|取消|失败|撤销/.test(r.status||'');
const refund=r=>/退款|退还|退货|冲正/.test([r.type,r.title].join(' '))||r.direction==='收入'&&/退款|退还/.test(r.status);
const referenceSet=values=>new Set(values.map(x=>String(x||'').trim()).filter(x=>x&&!/^(?:[-—/]+|无|不适用|null|none)$/i.test(x)));
const originalRefs=r=>referenceSet(Object.entries(r.raw||{}).filter(([k])=>/原.*(?:订单|交易|商户|商家).*号/.test(k)).map(([,v])=>v));
const merchantRefs=r=>referenceSet(Object.entries(r.raw||{}).filter(([k])=>/^(?:商户单号|商户订单号|商家单号|商家订单号)$/.test(k)).map(([,v])=>v));
const refs=r=>referenceSet([r.order,...originalRefs(r),...merchantRefs(r)]);
const identities=t=>[t.id,t.importIdentity,t.externalId&&t.importSource?t.importSource+'-'+t.externalId:''].filter(Boolean);
const postedIds=d=>new Set([...(d?.entries||[]),...(d?.trash||[])].flatMap(identities));
const persisted=(row,index)=>identities(row.entry).some(id=>index.has(id));
function pairs(rows,d){
 const posted=postedIds(d);
 const eligible=rows.filter(r=>(r.state==='pending'||r.state==='excluded'&&r.autoExclusion?.kind==='closed')&&!r.edited&&!r.exclusionOverride&&!/(处理中|退款中|待|失败|异常|拒绝)/.test(r.record.status||'')&&/^\d{4}-\d{2}-\d{2}$/.test(r.entry.date)&&Number.isSafeInteger(r.entry.amount)&&r.entry.amount>0);
 const expenses=eligible.filter(r=>r.entry.kind==='expense'&&r.record.direction==='支出'&&!refund(r.record)),refunds=eligible.filter(r=>r.state==='pending'&&!closed(r.record)&&refund(r.record)),matches=new Map();
 const orders=new Map(),semantic=new Map(),add=(map,key,e)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(e);},prefix=e=>e.record.source+'|'+e.entry.currency+'|';
 for(const e of expenses){for(const id of refs(e.record))add(orders,prefix(e)+id,e);const who=norm(e.record.payee),title=norm(e.record.title);if(who&&title)add(semantic,prefix(e)+e.entry.amount+'|'+who+'|'+title,e);}
 for(const r of refunds){const ids=refs(r.record),original=originalRefs(r.record),merchant=merchantRefs(r.record),who=norm(r.record.payee),title=norm(r.record.title.replace(/退款|退还|退货|冲正/g,'')),strong=[...new Set([...ids].flatMap(id=>orders.get(prefix(r)+id)||[]))];
  // A stated original order is evidence, even when that order is absent from
  // this batch. Never substitute a same-price purchase with a different order.
  const found=original.size?strong:strong.length?strong:who&&title?semantic.get(prefix(r)+r.entry.amount+'|'+who+'|'+title)||[]:[];
  const candidates=found.filter(e=>{const known=refs(e.record),eMerchant=merchantRefs(e.record);return e.entry.date<=r.entry.date&&e.entry.amount>=r.entry.amount&&[...original].every(id=>known.has(id))&&(!merchant.size||!eMerchant.size||[...merchant].some(id=>eMerchant.has(id)));});
  if(candidates.length===1){const e=candidates[0];if(!matches.has(e))matches.set(e,[]);matches.get(e).push(r);}
 }
 // Netting a new refund against an already posted expense would leave that
 // expense in the ledger. Keep the refund available for a normal linked entry.
 return [...matches].filter(([e,rs])=>rs.reduce((n,r)=>n+r.entry.amount,0)===e.entry.amount&&![e,...rs].some(r=>persisted(r,posted))).map(([e,rs])=>[e,...rs]);
}
function apply(batch,d){let count=0;const exclude=(row,kind,reason,keys)=>{if(row.state==='pending')count++;row.state='excluded';row.autoExclusion={kind,reason,keys};};
 for(const row of batch.rows)if(row.state==='pending'&&!row.edited&&!row.exclusionOverride&&closed(row.record))exclude(row,'closed','原账单交易已关闭 / 取消 / 失败，默认不入账',[row.key]);
 for(const group of pairs(batch.rows,d)){const keys=group.map(r=>r.key);for(const row of group)exclude(row,'refund','本批退款与原支出唯一匹配且全额抵消，两侧默认排除',keys);}
 return count;
}
function pair(batch,expenseKey,refundKeys,d){
 const e=batch.rows.find(r=>r.key===expenseKey),rs=refundKeys.map(k=>batch.rows.find(r=>r.key===k)),group=[e,...rs];
 if(!e||!rs.length||new Set([expenseKey,...refundKeys]).size!==group.length||group.some(r=>!r||r.state!=='pending'||r.autoExclusion?.kind==='refund'&&!r.exclusionOverride))throw Error('请选择未处理的支出与退款；已有配对请先解除');
 const posted=postedIds(d);if(group.some(r=>persisted(r,posted)))throw Error('原支出或退款已存在于账本或回收站，不能整组排除；请关联已有原支出后确认退款');
 if(e.entry.kind!=='expense'||e.record.direction!=='支出'||refund(e.record)||closed(e.record)||rs.some(r=>!refund(r.record)||closed(r.record)||/处理中|退款中|失败|异常|拒绝/.test(r.record.status)))throw Error('请选择交易成功的真实支出和已完成退款，转账不能作为原支出');
 if(group.some(r=>r.record.source!==e.record.source||r.entry.currency!==e.entry.currency||!Number.isSafeInteger(r.entry.amount)||r.entry.amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(r.entry.date))||rs.some(r=>r.entry.date<e.entry.date)||rs.reduce((n,r)=>n+r.entry.amount,0)!==e.entry.amount)throw Error('配对需同来源、同币种、退款不早于支出，且合计全额抵消；部分退款请逐笔关联入账');
 const keys=group.map(r=>r.key);for(const r of group){r.state='excluded';r.exclusionOverride=false;r.autoExclusion={kind:'refund',reason:'用户核对配对：退款与原支出全额抵消，整组排除',keys};}return keys;
}
function unpair(batch,key){const row=batch.rows.find(r=>r.key===key);if(row?.autoExclusion?.kind!=='refund')throw Error('这笔没有退款配对');const keys=row.autoExclusion.keys,group=keys.map(k=>batch.rows.find(r=>r.key===k));if(group.some(r=>!r||r.state==='confirmed'))throw Error('配对记录不存在或已有入账，不能解除');for(const r of group){r.state='pending';r.exclusionOverride=true;delete r.autoExclusion;}return keys;}
module.exports={apply,pairs,closed,refund,refs,pair,unpair};
