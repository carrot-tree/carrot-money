'use strict';
const IO=require('./vault-io');
const C=require('./core');
const ROOT='Carrot记账',PATH=ROOT+'/AI会话.json';
const blank=()=>({version:1,books:{}});
const validTurnId=id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id);
function ensureTurnIds(turns){
 const reserved=new Set(turns.map(t=>t.turnId).filter(validTurnId)),assigned=new Set();
 for(const [index,turn] of turns.entries()){
  if(!validTurnId(turn.turnId)||assigned.has(turn.turnId)){
   let id='legacy-'+(index+1),suffix=0;
   while(reserved.has(id)||assigned.has(id))id='legacy-'+(index+1)+'-'+(++suffix);
   turn.turnId=id;
  }
  assigned.add(turn.turnId);
 }
 return turns;
}
function cleanReportPath(answer){
 const {pathFor}=require('./ai-agent-tools');
 try{if(answer.path!==undefined)answer.path=pathFor(answer.path);}catch{delete answer.path;}
 const validPending=pending=>{
  if(!pending)return true;
  try{return !!answer.path&&(pending.request.path=pathFor(pending.request.path))===answer.path;}catch{return false;}
 };
 if(!validPending(answer.pendingReport))delete answer.pendingReport;
 if(!validPending(answer.reportJob?.pending))delete answer.reportJob.pending;
}
function compactMemory(memory){
 if(!memory)return memory;
 const toolResults=(memory.toolResults||[]).slice(-12).map(({name,arguments:args,result})=>{
  const {rows,ids,...data}=result.data||{};
  return {name,arguments:args,result:{summary:String(result.summary||'').slice(0,500),error:result.error,可引用:result.可引用,data:{...data,...(rows?{rowCount:rows.length}:{}),...(ids?{idCount:ids.length}:{})}}};
 });
 return {...memory,toolResults};
}
function turnForDisk(t,book){const value={turnId:t.turnId,question:String(t.question||''),answer:C.clone({...t.answer,...(t.answer?.memory?{memory:compactMemory(t.answer.memory)}:{}),...(t.phase?{signatures:undefined}: {})}),book,mode:'ai',sourceRevision:t.sourceRevision??t.source?.revision??null};for(const key of ['phase','receipt','warning','reportStatus','findingChoices','findingSelected','parentTurn','undoResult','executedReceipt','workflow'])if(t[key]!==undefined)value[key]=C.clone(t[key]);if(value.answer.status==='working'){value.answer.status='stopped';value.answer.message='上次运行已中断，可继续提问。';}cleanReportPath(value.answer);return value;}
function snapshot(state,book){return {activeId:state.sessionId,sessions:state.sessions.map(s=>({id:s.id,title:s.title,archived:s.archived===true,createdAt:s.createdAt,updatedAt:s.updatedAt,input:s.id===state.sessionId?state.input:s.input||'',turns:ensureTurnIds(s.id===state.sessionId?state.turns:s.turns).filter(t=>!t.book||t.book===book).map(t=>turnForDisk(t,book))}))};}
function validate(value){
 if(!value||value.version!==1||!value.books||typeof value.books!=='object'||Array.isArray(value.books))throw Error('AI 会话文件格式无效');
 for(const [book,b] of Object.entries(value.books)){
  if(!book||!b||!Array.isArray(b.sessions))throw Error('AI 会话文件格式无效');
  const ids=new Set();
  for(const s of b.sessions){
   if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.title!=='string'||!Array.isArray(s.turns)||s.turns.some(t=>!t||typeof t.question!=='string'||!t.answer||typeof t.answer!=='object'||Array.isArray(t.answer)||t.book!==book))throw Error('AI 会话文件格式无效');
   ids.add(s.id);
   for(const t of ensureTurnIds(s.turns))cleanReportPath(t.answer);
  }
  if(b.sessions.length&&!ids.has(b.activeId))throw Error('AI 当前会话不存在');
 }
 return value;
}
class SessionStore{
 constructor(vault){this.vault=vault;this.data=blank();this.raw=null;this.queue=Promise.resolve();this.error='';}
 load(){return IO.load(this,PATH,()=>blank(),raw=>validate(JSON.parse(raw)),' AI 会话');}
 stamp(book){return JSON.stringify(this.data.books[book]||null);}
 get(book){return this.data.books[book]?C.clone(this.data.books[book]):null;}
 save(book,state){const copy=snapshot(state,book);const job=this.queue.then(async()=>{if(this.error)throw Error(this.error);if(state.sessionStamp!==undefined&&state.sessionStamp!==this.stamp(book))throw Error('AI 会话已更新，请重新读取本地设置后继续');const raw=await IO.read(this.vault,PATH);if(raw!==this.raw)throw Error('AI 会话文件已在其他窗口更新，请重新读取本地设置后继续');const draft=C.clone(this.data);draft.books[book]=copy;validate(draft);const text=JSON.stringify(draft);await IO.mkdir(this.vault,ROOT);await IO.write(this.vault,PATH,text,raw);this.data=draft;this.raw=text;if(state.sessionStamp!==undefined)state.sessionStamp=this.stamp(book);});this.queue=job.catch(()=>{});return job;}
}
module.exports={SessionStore,PATH,snapshot,turnForDisk,validate,ensureTurnIds};
