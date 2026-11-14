'use strict';
const C=require('./core'),AI=require('./ai-import');
const PATH='Carrot记账/AI复核草稿.json',LIMIT=64*1024*1024,MAX_ROWS=20000;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x),strings=x=>Array.isArray(x)&&x.every(v=>typeof v==='string');
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x[k]!==undefined).map(k=>[k,x[k]]));
const rowKeys=['key','record','entry','nature','score','reasons','state','edited','fxReviewed','origin','flags','advice','autoExclusion','exclusionOverride','recognition','refundMatch'];
function checkBatch(b,book){
 if(!object(b)||typeof b.id!=='string'||!b.id||b.book!==book||typeof b.name!=='string'||typeof b.provider!=='string'||!Array.isArray(b.rows)||b.rows.length>MAX_ROWS)throw Error('草稿批次无效或超过 20,000 行');
 if(!Array.isArray(b.files)||b.files.some(f=>!object(f)||typeof f.name!=='string'||!['wechat','alipay','sheet'].includes(f.source)||!Number.isSafeInteger(f.count)||f.count<0)||!Array.isArray(b.skipped)||b.skipped.some(f=>!object(f)||typeof f.name!=='string'||typeof f.reason!=='string'))throw Error('草稿文件信息无效');
 if(b.enhancement){const x=b.enhancement;if(!object(x)||!['local','ai'].includes(x.engine)||!strings(x.reasons))throw Error('识别摘要无效');for(const k of ['elapsedMs','requestMs','mergeMs'])if(x[k]!==undefined&&(!Number.isFinite(x[k])||x[k]<0))throw Error('识别耗时无效');const recordKeys=new Set(b.rows.map(r=>r.key));if(x.failedKeys!==undefined&&(!strings(x.failedKeys)||new Set(x.failedKeys).size!==x.failedKeys.length||x.failedKeys.some(k=>!recordKeys.has(k))))throw Error('失败项清单无效');if(x.batches!==undefined&&(!Array.isArray(x.batches)||x.batches.length>MAX_ROWS*3||x.batches.some(j=>!object(j)||!Number.isInteger(j.index)||j.index<1||!Number.isInteger(j.count)||j.count<1||j.count>100||!Number.isInteger(j.accepted)||j.accepted<0||j.accepted>j.count||!Number.isFinite(j.durationMs)||j.durationMs<0||!['done','partial','failed','stopped'].includes(j.state)||typeof j.reason!=='string')))throw Error('逐批识别摘要无效');}
 const keys=new Set();for(const r of b.rows){
  if(!object(r)||typeof r.key!=='string'||!r.key||keys.has(r.key)||!['pending','confirmed','skipped','excluded'].includes(r.state)||typeof r.edited!=='boolean'||!Object.hasOwn(AI.natureNames,r.nature)||!Number.isFinite(r.score)||r.score<0||r.score>1||!strings(r.reasons))throw Error('草稿行状态无效');keys.add(r.key);
  if(r.autoExclusion!==undefined&&(!object(r.autoExclusion)||!['closed','refund'].includes(r.autoExclusion.kind)||typeof r.autoExclusion.reason!=='string'||!strings(r.autoExclusion.keys)))throw Error('草稿排除依据无效');
  if(r.refundMatch!==undefined&&(!object(r.refundMatch)||typeof r.refundMatch.expenseId!=='string'||r.refundMatch.expenseId!==r.entry?.related||typeof r.refundMatch.reason!=='string'||r.refundMatch.reason.length>160))throw Error('退款关联依据无效');
  if(r.recognition!==undefined&&(!object(r.recognition)||!['success','failed'].includes(r.recognition.state)||typeof r.recognition.reason!=='string'))throw Error('识别状态无效');
  if(r.exclusionOverride!==undefined&&typeof r.exclusionOverride!=='boolean')throw Error('草稿排除恢复状态无效');
  if(r.fxReviewed!==undefined&&typeof r.fxReviewed!=='boolean')throw Error('草稿汇率核对状态无效');
  const t=r.entry,s=r.record;
  if(!object(t)||!object(s)||typeof t.id!=='string'||!t.id||s.id!==t.id||s.key!==r.key||t.book!==book||!object(s.raw)||Object.values(s.raw).some(x=>typeof x!=='string')||!['wechat','alipay','sheet'].includes(s.source))throw Error('草稿账目或原始行无效');
  if(t.kind!==(r.nature==='repayment'?'transfer':r.nature)||t.importIdentity!==s.id||t.importSource!==s.source||t.externalId!==s.order)throw Error('草稿交易性质或导入标识不一致');
  for(const k of ['title','date','category','account','toAccount','related','note','payee','currency','kind','importTime'])if(typeof t[k]!=='string')throw Error('草稿账目字段缺失');
  for(const k of ['dateRaw','time','title','payee','note','direction','status','method','type','currency'])if(typeof s[k]!=='string')throw Error('草稿原始字段缺失');
  if(t.amount!==null&&!Number.isSafeInteger(t.amount)||s.amount!==null&&!Number.isSafeInteger(s.amount)||!Array.isArray(t.tags)||!Array.isArray(t.attachments)||!Array.isArray(t.splits))throw Error('草稿金额或数组字段无效');
 }
 return b;
}
function pack(book,state){
 if(!state.batch)return null;
 const batch=pick(state.batch,['id','book','name','provider','files','skipped']);
 batch.rows=state.batch.rows.map(r=>pick(r,rowKeys));
 if(state.batch.enhancement){const s=state.batch.enhancement;if(['local','ai'].includes(s.engine)&&strings(s.reasons))batch.enhancement=pick(s,['engine','total','enhanced','fallback','reasons','stopped','failedKeys','elapsedMs','requestMs','mergeMs','batches','adaptive']);}
 checkBatch(batch,book);
 return C.clone({book,updatedAt:new Date().toISOString(),batch,group:Object.hasOwn(AI.groupNames,state.group)?state.group:'ready'});
}
function parse(raw){
 if(typeof raw!=='string'||raw.length>LIMIT||new TextEncoder().encode(raw).byteLength>LIMIT)throw Error('草稿文件超过 64 MiB 或内容无效');
 let data;try{data=JSON.parse(raw);}catch{throw Error('草稿 JSON 无法读取，原文件已保留');}
 if(!object(data)||data.version!==1||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.drafts))throw Error('草稿版本或结构无效');
 const books=new Set();for(const item of data.drafts){if(!object(item)||typeof item.book!=='string'||!item.book||books.has(item.book)||typeof item.updatedAt!=='string'||!Number.isFinite(Date.parse(item.updatedAt))||!Object.hasOwn(AI.groupNames,item.group))throw Error('草稿账本信息无效');books.add(item.book);checkBatch(item.batch,item.book);}
 return data;
}
// Reconcile the two independent files after a crash or a full-ledger restore.
// A confirmed marker alone is never evidence that a ledger entry exists.
function reconcile(batch,d){
 const history=d.imports.find(x=>x.id===batch.id),ids=new Set(history?.ids||[]),present=new Map([...d.entries,...d.trash].map(x=>[x.id,x]));
 const warnings=[];if(!d.books.some(b=>b.id===batch.book&&!b.archived))warnings.push('草稿账本不存在或已归档');
 if(history&&(history.source!=='ai-import'||history.book!==batch.book))warnings.push('导入批次归属不一致');
 if(history&&!history.undoable)warnings.push('本批次已撤销，请清除草稿后重新导入核对');
 for(const row of batch.rows){const t=present.get(row.entry.id),posted=history?.source==='ai-import'&&history.book===batch.book&&ids.has(row.entry.id)&&t?.book===batch.book;
  if(posted)row.state='confirmed';
  else if(row.state==='confirmed'||ids.has(row.entry.id))warnings.push('已确认记录与当前账本不一致，请清除草稿后重新导入核对');
 }
 batch.restoreWarnings=[...new Set(warnings)];batch.restoreBlocked=!!warnings.length;AI.refresh(batch,d);return batch;
}
function restore(item,d){const batch=C.clone(item.batch);reconcile(batch,d);return {batch,selected:new Set(),group:item.group,page:0,busy:false,progress:null,error:'',draftStatus:'saved',draftAt:item.updatedAt,draftError:''};}
class DraftStore{
 constructor(vault){this.vault=vault;this.raw=null;this.data={version:1,revision:0,drafts:[]};this.error='';this.queue=Promise.resolve();this.states=new Map();}
 async load(){
  await this.queue;try{const exists=await this.vault.adapter.exists(PATH),raw=exists?await this.vault.adapter.read(PATH):null,data=raw===null?{version:1,revision:0,drafts:[]}:parse(raw);this.raw=raw;this.data=data;this.error='';this.states.clear();return true;}
  catch(e){this.error='草稿读取失败：'+e.message;return false;}
 }
 save(book,state){
  let item;try{item=pack(book,state);}catch(e){return Promise.reject(e);}
  const job=this.queue.then(async()=>{
   if(this.error)throw Error(this.error);
   const exists=await this.vault.adapter.exists(PATH),raw=exists?await this.vault.adapter.read(PATH):null;
   if(raw!==this.raw)throw Error('草稿已在别处更新，请先重新读取，避免覆盖');
   const next=C.clone(this.data);next.revision++;next.drafts=next.drafts.filter(x=>x.book!==book);if(item)next.drafts.push(item);
   const text=JSON.stringify(next);parse(text);
   if(raw===null){if(!await this.vault.adapter.exists('Carrot记账'))await this.vault.createFolder('Carrot记账');await this.vault.create(PATH,text);}
   else{const file=this.vault.getAbstractFileByPath(PATH);if(!file)throw Error('草稿文件已变化，请重新读取');await this.vault.process(file,current=>{if(current!==raw)throw Error('保存时检测到草稿外部更新，已取消覆盖');return text;});}
   this.raw=text;this.data=next;return item?.updatedAt||'';
  });this.queue=job.catch(()=>{});return job;
 }
 state(book,d){if(!this.states.has(book)){const saved=this.data.drafts.find(x=>x.book===book);this.states.set(book,saved?restore(saved,d):{batch:null,selected:new Set(),group:'ready',page:0,busy:false,progress:null,error:'',draftStatus:'empty',draftError:''});}return this.states.get(book);}
}
module.exports={DraftStore,PATH,LIMIT,MAX_ROWS,pack,parse,restore,reconcile};
