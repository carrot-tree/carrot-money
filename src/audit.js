'use strict';
const C=require('./core');
function stable(x){if(Array.isArray(x))return '['+x.map(stable).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';return JSON.stringify(x);}
function fingerprint(t){const {reviewStamp,...content}=t;return stable(content);}
function reviewed(t){return !!t.reviewStamp&&t.reviewStamp.fingerprint===fingerprint(t);}
function duplicateKey(t){return stable([t.book,t.date,t.kind,t.currency,t.amount,t.legacyIncome??null,t.legacyExpense??null,t.title.trim(),t.payee||'',t.account||'',t.toAccount||'',t.toAmount||0,t.related||'',t.splits||[]]);}
function scan(d,book){
 const rows=d.entries.filter(t=>t.book===book),groups=new Map();for(const t of rows){if(!t.date)continue;const key=duplicateKey(t);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t.id);}
 return rows.map(t=>{const reasons=[];if(!t.date)reasons.push('date');if(t.kind==='legacy'&&t.legacyIncome===null&&t.legacyExpense===null)reasons.push('amount');if(t.kind!=='legacy'&&!t.account&&!t.splits?.length)reasons.push('account');const duplicates=t.date?groups.get(duplicateKey(t)):null;if(duplicates?.length>1)reasons.push('duplicate');return {t,reasons,duplicates:duplicates?.length>1?duplicates:[],reviewed:reviewed(t)};}).filter(x=>x.reasons.length);
}
function mark(d,book,ids,value=true,at=new Date().toISOString()){
 const selected=new Set(ids);if(!selected.size)throw Error('请先选择账目');const rows=d.entries.filter(t=>selected.has(t.id)&&t.book===book);if(rows.length!==selected.size)throw Error('部分账目已变化或不属于当前账本，请刷新');for(const t of rows){if(value)t.reviewStamp={at,fingerprint:fingerprint(t)};else delete t.reviewStamp;}return rows.length;
}
function restoreDiff(current,next){
 C.validate(next);const tables=['entries','accounts','books','categories','budgets','rules','goals','templates','trash','imports'];const changes=tables.map(key=>{const old=new Map(current[key].map(x=>[x.id,x])),fresh=new Map(next[key].map(x=>[x.id,x]));let added=0,removed=0,changed=0;for(const [id,x]of fresh){if(!old.has(id))added++;else if(stable(old.get(id))!==stable(x))changed++;}for(const id of old.keys())if(!fresh.has(id))removed++;return {key,before:old.size,after:fresh.size,added,removed,changed};});return {changes,before:C.totals(current.entries),after:C.totals(next.entries),settingsChanged:stable(current.settings)!==stable(next.settings)};
}
const names={date:'日期缺失',amount:'金额待核对',account:'未指定账户',duplicate:'疑似重复'};
module.exports={scan,mark,reviewed,fingerprint,restoreDiff,names,stable};
