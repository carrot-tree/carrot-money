'use strict';
const C=require('./core');
// Resolve literal record references locally. Never turn a date or an amount into
// an identity, and never silently choose between duplicate order numbers.
function references(text){return [...new Set(String(text||'').match(/[A-Za-z]*\d[A-Za-z\d_-]{7,}|[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi)||[])].filter(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x));}
function literal(text,d,book){
 const refs=references(text);if(!refs.length)return null;
 const rows=d.entries.filter(t=>t.book===book),index=new Map();
 for(const t of rows)for(const ref of new Set([t.id,...references([t.title,t.payee,t.note].join(' '))])){const ids=index.get(ref)||[];ids.push(t.id);index.set(ref,ids);}
 const found=refs.filter(ref=>index.has(ref));if(!found.length)return null;
 const unresolved=refs.filter(ref=>!index.has(ref)),ambiguous=found.filter(ref=>index.get(ref).length!==1);
 return {ids:[...new Set(found.filter(ref=>index.get(ref).length===1).map(ref=>index.get(ref)[0]))],unresolved,ambiguous,source:'你列出的账目'};
}
const followup=/这些|这几|这批|这组|那几|上述|上面|刚才|上轮|上一轮|按.*建议|去修改|修改一下|改一下|全部修改|按你说的|分类为|分类是/;
const fullScope=/(?:全部|整个|所有|全期|全账本|重新).{0,12}(?:账单|账目|流水|期间|月份|复核)|(?:复核|检查|重新分类).{0,8}(?:全期|整月|全年|整个账本)/;
function resolve(question,d,book,history=[]){
 if(/记一笔|新增(?:账目|支出|收入)|帮我记|记录(?:一|这)笔/.test(question))return null;
 const explicit=literal(question,d,book);if(explicit)return explicit;
 if(!followup.test(question)||fullScope.test(question))return null;
 // The last answer defines “these”, not every record queried in the session.
 const last=history.at(-1);if(!last)return null;const a=last.answer||{};
 let ids=a.selection?.ids||a.findings?.map(f=>f.id)||(a.task?a.ids:null);
 if(ids?.length){const current=new Set(d.entries.filter(t=>t.book===book).map(t=>t.id));return {ids:ids.filter(id=>current.has(id)),unresolved:ids.filter(id=>!current.has(id)),ambiguous:[],source:'上轮选中的账目'};}
 const shown=literal(a.message,d,book);return shown?{...shown,source:'上轮列出的账目'}:null;
}
function range(d,book,ids){const dates=d.entries.filter(t=>t.book===book&&ids.includes(t.id)).map(t=>t.date).filter(C.validDate).sort();return {start:dates[0]||C.today(),end:dates.at(-1)||C.today(),ids:[...ids]};}
function covers(r,t){return t.date>=r.start&&t.date<=r.end&&(!r.ids||r.ids.includes(t.id));}
function validateIds(ids){if(!Array.isArray(ids)||!ids.length||ids.length>5000||ids.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(ids).size!==ids.length)throw Error('请提供不重复的具体账目ID，最多5000笔');return ids;}
function assertScope(scope,ids){if(scope&&ids.some(id=>!scope.ids.includes(id)))throw Error('本轮只处理选中的 '+scope.ids.length+' 笔账目，不能加入其他记录或扩大到整个期间');}
module.exports={references,literal,resolve,range,covers,validateIds,assertScope};
