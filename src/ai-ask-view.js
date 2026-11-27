'use strict';
const C=require('./core'),Ask=require('./ai-ask'),Tasks=require('./ai-ask-tasks'),Action=require('./ai-ask-action'),Write=require('./ai-agent-write'),Provider=require('./ai-ask-provider'),Remote=require('./ai-provider'),Agent=require('./ai-agent'),Reply=require('./ai-reply');
const TaskStatus=require('./ai-task-status');
const examples=['这个月吃饭花了多少','上个月哪几笔最大','这个月比上个月多花了多少','本月按分类支出排名','本月日均支出','查重复','生成本月分析报告','把 7 月其他的分类全部改成正餐'];
function sessionStore(v){const store=v.p.sessions,vault=v.p.store?.vault||v.app?.vault;return store?.vault===vault?store:null;}
function session(turns=[],input='',title='新会话'){const at=new Date().toISOString();return {id:C.uid(),title,createdAt:at,updatedAt:at,turns,input};}
function available(v){try{return Agent.eligible('',v.d.settings,{force:true})&&!!Remote.validateConfig(Remote.config(v.d.settings));}catch{return false;}}
// Session consent is separate from the saved service switch. Revoking service
// access must stop every open conversation without discarding its draft/history.
function service(v){
 const config=Remote.config(v.d.settings);
 return JSON.stringify([config.presetId,require('./ai-presets').catalogUrl(config.baseUrl)]);
}
function clearSaveTimer(s){clearTimeout(s.saveTimer);s.saveTimer=null;}
function syncAvailability(v){
 const ready=available(v),target=service(v);
 for(const [key,s]of v.askStates||[]){
  if(!key.startsWith('ai:')||(!s.enabled&&!s.agreed)||ready&&(!s.consentTarget||s.consentTarget===target))continue;
  clearSaveTimer(s);s.controller?.abort();s.controller=null;s.generation++;s.busy=false;s.enabled=false;s.agreed=false;s.consentTarget=null;
  s.error=ready?'AI 服务商或地址已变化，请重新确认发送范围。':'AI 服务已关闭或配置不可用。可前往设置中心检查，或使用顶部「本地快捷查询」。';
  const turn=s.turns.at(-1);if(turn?.answer.status==='working')turn.answer={...turn.answer,ok:false,status:'stopped',message:'AI 服务设置已变化，本轮已停止。聊天和已保存的复核进度仍保留。'};
 }
}
function stateFor(v,mode='local'){v.askStates||=new Map();const key=mode==='ai'?'ai:'+v.book:v.book;if(!v.askStates.has(key))v.askStates.set(key,{input:'',open:mode==='local'&&(v.contentEl?.clientWidth||1000)>720,busy:false,turns:[],generation:0,mode,enabled:false,agreed:false,error:''});const s=v.askStates.get(key);if(mode==='ai')s.book=v.book;if(mode==='ai'&&!s.sessions){const store=sessionStore(v),saved=store?.get(v.book);s.sessionStamp=store?.stamp?.(v.book);s.sessions=saved?.sessions?.length?saved.sessions.map(x=>({...x,turns:x.turns.map(t=>({...t,source:t.sourceRevision===v.d.revision?v.d:null}))})):[session(s.turns,s.input,s.turns[0]?.question.slice(0,32)||'新会话')];s.sessionId=saved?.activeId||s.sessions[0].id;const active=s.sessions.find(x=>x.id===s.sessionId)||s.sessions[0];s.sessionId=active.id;s.turns=active.turns;s.input=active.input||'';}return s;}
const redraw=v=>{if(!v.aiClosed&&!v.p.aiUnloaded)v.render();};
function touchSession(s){const active=s.sessions?.find(x=>x.id===s.sessionId);if(active)active.updatedAt=new Date().toISOString();}
function syncSession(s){const active=s.sessions?.find(x=>x.id===s.sessionId);if(active){active.turns=s.turns;active.input=s.input;if(active.title==='新会话'&&s.turns.length)active.title=s.turns[0].question.slice(0,32);}}
async function persist(v,s=stateFor(v,'ai'),book=s.book||v.book){if(!s.sessions)return;syncSession(s);try{await sessionStore(v)?.save(book,s);s.storageError='';}catch(e){s.storageError=e.message||'会话保存失败';}return !s.storageError;}
function scheduleSave(v,s){
 clearSaveTimer(s);
 const generation=s.generation,id=s.sessionId;
 s.saveTimer=setTimeout(()=>{
  s.saveTimer=null;
  if(!v.aiClosed&&!v.p.aiUnloaded&&s.generation===generation&&s.sessionId===id)void persist(v,s).then(()=>{if(s.storageError)redraw(v);});
 },300);
}
function activateSession(s,next){
 s.sessionId=next.id;s.turns=next.turns;s.input=next.input||'';s.undo=null;s.reviewIndex=null;s.chatUnread=false;s.reviewOpen=undefined;s.error='';
}
async function updateSessions(v,s,edit){
 if(s.busy||v.aiClosed||v.p.aiUnloaded)return false;
 clearSaveTimer(s);s.busy=true;redraw(v);
 const keys=['sessions','sessionId','turns','input','undo','reviewIndex','chatUnread','reviewOpen','error'];
 const previous=Object.fromEntries(keys.map(k=>[k,s[k]])),generation=s.generation;
 try{
  syncSession(s);
  s.sessions=s.sessions.map(item=>({...item}));
  if(edit()===false||!await persist(v,s)){Object.assign(s,previous);return false;}
  if(s.generation===generation)s.generation++;
  return true;
 }finally{if(s.generation===generation||s.generation===generation+1)s.busy=false;redraw(v);}
}
function newSession(v){
 const s=stateFor(v,'ai');
 return updateSessions(v,s,()=>{const next=session();s.sessions.push(next);activateSession(s,next);});
}
function selectSession(v,id){
 const s=stateFor(v,'ai');
 return updateSessions(v,s,()=>{const target=s.sessions.find(x=>x.id===id);if(!target)return false;activateSession(s,target);});
}
function renameSession(v,name){
 const s=stateFor(v,'ai'),title=String(name||'').trim();if(!title||title.length>80)return false;
 return updateSessions(v,s,()=>{s.sessions.find(x=>x.id===s.sessionId).title=title;});
}
async function deleteSession(v,id){
 const s=stateFor(v,'ai');if(s.busy||!s.sessions.some(x=>x.id===id))return false;
 s.busy=true;clearSaveTimer(s);redraw(v);
 try{
  if(!await persist(v,s))return false;
  const keys=['sessions','sessionId','turns','input','undo','reviewIndex','reviewOpen','chatUnread','showArchived'],previous=Object.fromEntries(keys.map(k=>[k,s[k]]));
  s.sessions=s.sessions.filter(x=>x.id!==id);
  if(s.sessionId===id){let next=[...s.sessions].filter(x=>!x.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(!next){next=session();s.sessions.push(next);}s.sessionId=next.id;s.turns=next.turns;s.input=next.input||'';s.undo=null;s.reviewIndex=null;s.reviewOpen=undefined;s.chatUnread=false;s.showArchived=false;}
  if(!await persist(v,s)){Object.assign(s,previous);return false;}
  if(s.chatPositions)delete s.chatPositions[id];if(s.chatFingerprints)delete s.chatFingerprints[id];s.reviewSelections?.forEach((_,turn)=>{if(previous.sessions.find(x=>x.id===id).turns.includes(turn))s.reviewSelections.delete(turn);});s.generation++;return true;
 }finally{s.busy=false;redraw(v);}
}
async function clear(v,mode='local'){const s=stateFor(v,mode);clearSaveTimer(s);s.controller?.abort();s.generation++;s.turns=[];s.undo=null;s.input='';s.busy=false;s.error='';s.chatPositions={};s.chatFingerprints={};s.chatUnread=false;s.reviewIndex=null;s.reviewOpen=false;if(mode==='ai'){const active=s.sessions.find(x=>x.id===s.sessionId);active.title='新会话';await persist(v,s);}redraw(v);}
async function dispose(v){const jobs=[];for(const [key,s]of v.askStates||[]){s.controller?.abort();s.generation++;clearSaveTimer(s);if(s.sessions&&!s.busy)jobs.push(persist(v,s,key.slice(3)));}v.askStates?.clear();await Promise.all(jobs);}
function agree(v,value){const s=stateFor(v,'ai');if(!s.enabled){s.agreed=value===true;s.consentTarget=s.agreed?service(v):null;}redraw(v);}
function toggleAI(v){syncAvailability(v);const s=stateFor(v,'ai');if(s.enabled){clearSaveTimer(s);s.controller?.abort();s.generation++;s.busy=false;s.enabled=false;s.agreed=false;s.error='';s.open=false;stateFor(v).open=true;}else{if(!s.agreed){s.error='要先勾选「我了解并同意」。';redraw(v);return false;}if(!available(v)){s.error='请先在设置里开启 AI 服务、Agent 并填写模型服务商和 API Key。';redraw(v);return false;}s.consentTarget=service(v);s.enabled=true;s.error='';s.open=true;}redraw(v);return s.enabled;}
function moveToAI(v,question){if(v.navigate&&v.tab!=='assistant'){v.tab='assistant';}const s=stateFor(v,'ai');s.input=String(question||'');s.open=true;redraw(v);v.contentEl?.querySelector('.cm-ask-ai-input')?.focus({preventScroll:true});}
async function submit(v,question,{mode='local',requestUrl,now,clearInput=false,resumeReviewId,resumeCandidateId,resumeReportPath,workflowRef,workflowContext,workflowMode}={}){
 if(mode==='ai')syncAvailability(v);
 if(mode==='ai'&&!requestUrl)requestUrl=v.assistantRequest||v.p._requestUrl;
 const s=stateFor(v,mode);if(s.busy||v.aiClosed||v.p.aiUnloaded)return;
 const text=String(question||'').trim();if(!text)return;
 if(mode==='ai'&&!s.enabled){s.error=s.error||'要先阅读发送范围、勾选同意并开启 AI 管账；本地查询可直接使用顶部「本地快捷查询」。';redraw(v);return;}
 clearSaveTimer(s);s.error='';
 if(mode==='ai'&&!workflowRef&&await require('./ai-findings-view').followup(v,text)){if(clearInput)s.input='';await persist(v,s);redraw(v);return;}
 const book=v.book,sessionId=s.sessionId,data=v.d,settings=C.clone(data.settings),signature=JSON.stringify(Remote.config(settings)),generation=++s.generation;
 const current=()=>!v.aiClosed&&!v.p.aiUnloaded&&v.book===book&&C.activeBook(v.d)===book&&v.d===data&&s.generation===generation&&JSON.stringify(Remote.config(v.d.settings))===signature&&(mode!=='ai'||s.enabled&&s.sessionId===sessionId);
 if(mode==='ai'&&v.tab==='assistant'){s.chatUnread=false;s.chatPositions||={};s.chatPositions[s.sessionId||'local']={top:0,follow:true};const historyNode=v.contentEl?.querySelector('.cm-chat-history');if(historyNode)historyNode.cmRestoring=true;}
 if(!workflowRef&&!resumeReviewId&&!resumeCandidateId&&!resumeReportPath)s.input=clearInput?'':text;s.open=true;s.busy=true;redraw(v);let activeTurn;
 try{
  if(mode==='ai'){
   const controller=new AbortController();s.controller=controller;
   require('./ai-sessions').ensureTurnIds(s.turns);
   const turn={turnId:C.uid(),question:text,answer:{ok:false,intent:'agent',engine:'AI Agent',status:'working',message:'Agent 工作中',steps:[],facts:[],usage:{},elapsedMs:0},source:data,sourceRevision:data.revision,book,mode,...(workflowRef?{workflow:{...workflowRef}}:{})};activeTurn=turn;s.turns.push(turn);touchSession(s);redraw(v);if(!await persist(v,s,book))throw Error('会话保存失败，尚未请求 AI：'+s.storageError);
   const history=s.turns.slice(0,-1).filter(t=>t.book===book&&t.answer.status!=='working'&&(!workflowRef||t.workflow?.id===workflowRef.id&&t.workflow.stepId===workflowRef.stepId));
   const result=await Agent.run(text,{sessionId:s.sessionId,d:data,book,vault:v.app.vault,settings,history,historyForTools:s.turns.slice(0,-1).filter(t=>t.book===book&&t.answer.status!=='working'),preferences:require('./ai-findings-view').preferences(v),reportMonth:v.month,resumeReviewId,resumeCandidateId,resumeReportPath,workflowContext,workflowMode,requestUrl,signal:controller.signal,writeAccess:true,shouldContinue:current,onCheckpoint:async progress=>{if(!current())throw Error('会话或账本已变化，未保存旧检查点');turn.answer=progress;clearSaveTimer(s);if(!await persist(v,s,book))throw Error('检查点保存失败：'+s.storageError);},onProgress:progress=>{if(current()){turn.answer=progress;scheduleSave(v,s);redraw(v);}}});
   if(current()){if(result.replacesTurn){
     const prior=s.turns.find(t=>t.turnId===result.replacesTurn&&t.book===book&&t!==turn);
     if(!prior||prior.phase||prior.answer.status!=='preview'||!require('./ai-entry-actions').names.has(prior.answer.name)||!current())throw Error('待替代的新增预览已变化，请重新提议。');
     prior.phase='superseded';
     prior.answer={...prior.answer,message:'已被第 '+s.turns.length+' 轮的新预览替代；请核对新预览，旧预览不会入账。'};
    }
    turn.answer=result;if(result.taskPlan){s.workflowPlanId=result.taskPlan.id;s.workflowOpen||={};s.workflowOpen[result.taskPlan.id]=true;}if(['action','agent_write'].includes(result.intent)){s.reviewIndex=s.turns.indexOf(turn);s.reviewOpen=true;}}else if(s.generation===generation&&turn.answer.status==='working')turn.answer={...turn.answer,status:'stopped',message:'账本或设置已变化，本轮已停止。'};
   return;
  }
  let result=await Provider.answer(text,data,book,settings,{allowRemote:false,userInitiated:false,now,shouldContinue:current});
  if(s.generation!==generation||v.aiClosed||v.p.aiUnloaded)return;
  if(current()&&result.ok&&result.intent==='report'){
   try{const model=Tasks.reportModel(data,book,result.month,{document:v.contentEl?.ownerDocument}),html=Tasks.renderReport(model);const path=await v.p.store.export(html,Tasks.filename(result.month),'html');result={...result,path,message:'已生成月度 HTML 报告。'};}
   catch(e){result={ok:false,intent:'report',month:result.month,message:'生成报告失败：'+(e?.message||'磁盘、权限或文件名错误，请检查导出目录。'),facts:[]};}
  }
  const answer=current()?result:{ok:false,message:'账本或设置已变化，已丢弃结果，请重新提问。',facts:[]};
  s.turns.push({question:text,answer,source:data,book,mode});s.turns=s.turns.slice(-10);
 }catch(e){const answer={ok:false,intent:mode==='ai'?'agent':undefined,status:'error',message:e.message||'未完成查询，请换个说法；未生成数字。',facts:[]};if(s.generation===generation&&(mode!=='ai'||s.sessionId===sessionId)){if(mode==='ai'){if(activeTurn)activeTurn.answer=answer;}else{s.turns.push({question:text,answer,source:data,book,mode});s.turns=s.turns.slice(-10);}}}
 finally{if(s.generation===generation){clearSaveTimer(s);s.busy=false;s.controller=null;if(mode==='ai'&&!v.aiClosed&&!v.p.aiUnloaded&&s.sessionId===sessionId)await persist(v,s,book);}redraw(v);}
}
function stale(v,turn){return turn.book!==v.book||turn.source!==v.d;}
function operationGuard(v,s,turn,valid){
 const source=v.d,book=v.book,generation=s.generation,sessionId=s.sessionId,enabled=s.enabled;
 return ()=>{if(v.aiClosed||v.p.aiUnloaded||v.book!==book||turn.book!==book||C.activeBook(v.d)!==book||v.d!==source||s.generation!==generation||s.sessionId!==sessionId||s.enabled!==enabled||!valid())throw Error('页面、会话、设置、账本或预览已变化，尚未提交修改');};
}
async function confirm(v,turn,plan=turn.answer){
 const s=stateFor(v,turn.mode||'local'),original=turn.answer,generation=s.generation,sessionId=s.sessionId;if(s.busy||!['action','agent_write'].includes(plan.intent)||!plan.count||turn.phase)return;
 if(turn.mode==='ai'&&!s.enabled){turn.warning='AI 提问已关闭，请重新开启并预览。';redraw(v);return;}
 const workflowError=require('./ai-workflow-actions').confirmable(v,turn);if(workflowError){turn.warning=workflowError;redraw(v);return;}
 if(stale(v,turn)){turn.warning='记录已变化，请重新预览';redraw(v);return;}
 s.busy=true;redraw(v);
 const signature=JSON.stringify(plan),originalSignature=JSON.stringify(original),live=operationGuard(v,s,turn,()=>turn.answer===original&&JSON.stringify(original)===originalSignature&&JSON.stringify(plan)===signature&&!turn.phase);
 try{const guard=()=>{live();const error=require('./ai-workflow-actions').confirmable(v,turn);if(error)throw Error(error);};if(turn.mode==='ai'&&!await persist(v,s))throw Error('操作记录保存失败，尚未修改账本：'+s.storageError);guard();let receipt;await v.p.change(d=>{receipt=plan.intent==='agent_write'?Write.apply(d,plan):Action.apply(d,plan);},{snapshot:true,check:guard});turn.source=v.d;turn.sourceRevision=v.d.revision;turn.phase='done';delete turn.warning;turn.answer={...plan,message:plan.intent==='agent_write'?`已执行：${plan.actionName}（${receipt.count}）。`:`已修改 ${receipt.count} 笔。`,engine:plan.engine};if(require('./ai-entry-actions').names.has(plan.name))turn.answer.message=`已入账 ${receipt.count} 笔；可在账单流水查看或撤销。`;if(require('./ai-subscriptions').names.has(plan.name))turn.answer.message+=`\n\n${receipt.item.name} · ${receipt.item.entry.currency} ${C.money(receipt.item.entry.amount)} · ${require('./ai-subscriptions').labels[receipt.item.frequency]} · 下次 ${receipt.item.next}。${receipt.item.enabled?'已保存到订阅扣费，可在主页和「周期与分期」查看。':'已暂停本地续费提醒，可在「周期与分期」查看。'}已有支出保持不变。`;turn.receipt=receipt;s.undo={turn,receipt};}
 catch(e){turn.warning=e.message||'修改失败，请重新预览';}
 finally{if(s.generation===generation)s.busy=false;if(turn.mode==='ai'&&s.sessionId===sessionId)await persist(v,s);redraw(v);}
}
async function cancel(v,turn){const s=stateFor(v,turn.mode||'local');if(s.busy||turn.phase)return;clearSaveTimer(s);turn.phase='cancelled';turn.answer={...turn.answer,message:'已取消，本次没有修改任何记录。'};await persist(v,s);redraw(v);}
function archiveSession(v,id,value=true){
 const s=stateFor(v,'ai');
 return updateSessions(v,s,()=>{
  const item=s.sessions.find(x=>x.id===id);if(!item)return false;
  item.archived=value;
  if(value&&s.sessionId===id){
   let next=s.sessions.find(x=>!x.archived);
   if(!next){next=session();s.sessions.push(next);}
   activateSession(s,next);
  }
 });
}
async function confirmSelected(v,turn,ids){
 const s=stateFor(v,turn.mode||'ai');if(s.busy||turn.phase)return;
 if(stale(v,turn)){turn.warning='记录已变化，请重新预览';redraw(v);return;}
 const plan=turn.answer;
 try{
  let selected=plan;
  if(plan.intent==='action')selected=Action.withSelection(v.d,plan,ids);
  else if(plan.name==='delete_entries'||require('./ai-entry-actions').names.has(plan.name))selected=Write.withSelection(v.d,plan,ids);
  else if(ids.length!==1||ids[0]!=='item')throw Error('请选择这项建议');
  await confirm(v,turn,selected);
 }catch(e){turn.warning=e.message;redraw(v);}
}
async function undo(v,turn){
 const s=stateFor(v,turn.mode||'local'),item=turn.receipt||s.undo?.turn===turn&&s.undo.receipt;if(s.busy||!item)return;
 if(turn.book!==v.book||C.activeBook(v.d)!==turn.book){turn.warning='当前账本已变化，不能撤销这次修改。';redraw(v);return;}
 const generation=s.generation,phase=turn.phase,signature=JSON.stringify(item),guard=operationGuard(v,s,turn,()=>turn.phase===phase&&(turn.receipt||s.undo?.turn===turn&&s.undo.receipt)===item&&JSON.stringify(item)===signature);
 s.busy=true;redraw(v);let result;
 try{await v.p.change(d=>{
  const snapshots=item.name?null:new Map([...d.entries,...d.trash].map(t=>[t.id,JSON.stringify(t)]));
  result=item.name?Write.undo(d,item):Action.undo(d,item);
  if(snapshots){
   const current=new Map([...d.entries,...d.trash].map(t=>[t.id,JSON.stringify(t)]));
   result.restoredIds=item.ids.filter(id=>current.has(id)&&snapshots.get(id)!==current.get(id));
   const restored=new Set(result.restoredIds);result.skippedIds=item.ids.filter(id=>!restored.has(id));
  }
  if(!result.restored)throw Error(`已撤销 0 笔，跳过 ${result.skipped} 笔（记录已变化）。`);
 },{snapshot:true,check:guard});turn.source=v.d;turn.sourceRevision=v.d.revision;turn.phase='undone';delete turn.warning;const unit=item.name?'项':'笔';turn.answer={...turn.answer,message:`已撤销 ${result.restored} ${unit}，跳过 ${result.skipped} ${unit}。`+(result.skipped?'跳过的记录或关联关系已变化、或记录不存在，保留后续修改。':'')};turn.undoResult=result;turn.executedReceipt=turn.receipt;turn.receipt=null;if(s.undo?.turn===turn)s.undo=null;require('./ai-workflow-actions').invalidate(v,turn);}
 catch(e){turn.warning=e.message||'撤销失败';}
 finally{if(s.generation===generation)s.busy=false;if(turn.mode==='ai')await persist(v,s);redraw(v);}
}
async function openReport(v,turn,{shell}={}){
 if(v.aiClosed||v.p.aiUnloaded)return;
 try{
  const Tools=require('./ai-agent-tools'),path=Tools.pathFor(turn.answer.path),vault=v.app.vault;
  if(turn.book!==v.book)throw Error('报告不属于当前账本');
  if(typeof vault.adapter.getBasePath!=='function')throw Error('当前设备无法打开本地 HTML 报告，请在桌面端的导出目录查看');
  const base=vault.adapter.getBasePath();
  if(!base)throw Error('无法取得报告的绝对路径');
  const fs=require('node:fs/promises'),nativePath=require('node:path');
  const expected=nativePath.join(await fs.realpath(base),path),abs=await fs.realpath(expected);
  if(abs.normalize('NFC')!==expected.normalize('NFC'))throw Error('报告路径越出导出目录或指向链接');
  const storage=require('./ai-report-storage'),owner=await storage.owner(vault,path,v.book);
  if(!owner&&turn.mode!=='local')throw storage.legacyReport();
  const stat=await fs.stat(abs);
  if(!stat.isFile()||stat.size>8e6)throw Error('报告不是可打开的 HTML 文件');
  const html=Tools.htmlOK(await fs.readFile(abs,'utf8'));
  if(owner&&(owner.status!=='committed'||owner.after.html!==html))throw Error('报告尚未确认保存或内容已变化，请核对后打开');
  if(v.aiClosed||v.p.aiUnloaded)return;
  let reason='';try{const openShell=shell||require('electron').shell;const result=await openShell.openPath(abs);if(result===''){turn.reportStatus='已交给系统默认应用打开报告。';redraw(v);return;}reason=String(result||'系统未确认打开');}catch(e){reason='当前设备无法通过系统应用直接打开';}
  try{if(typeof v.app.openWithDefaultApp!=='function')throw Error('默认应用接口不可用');const result=await v.app.openWithDefaultApp(abs);if(result===false||typeof result==='string'&&result)throw Error(String(result||'默认应用未接受该文件'));turn.reportStatus='已交给系统默认应用打开报告。';redraw(v);return;}catch(e){reason+='；'+(e?.message||'默认应用打开失败');}
  try{if(typeof v.app.showInFolder!=='function')throw Error('访达接口不可用');await v.app.showInFolder(path);turn.reportStatus='已在访达中打开，可手动双击查看。直接打开失败：'+reason;}
  catch(e){turn.reportStatus='打开报告失败：'+reason+'；'+(e?.message||'无法在访达定位文件');}
 }catch(e){turn.reportStatus='打开报告失败：'+(e?.message||'路径无效');}
 redraw(v);
}
function drill(v,turn,fact){
 if(stale(v,turn)){turn.warning='账本已变化，请再来一次后查看明细。';redraw(v);return;}
 const ids=new Set(fact.ids),rows=v.d.entries.filter(t=>t.book===turn.book&&ids.has(t.id));
 require('./reports').drill(v,rows,fact.range,'AI 提问 · '+fact.label);
}
async function copyReply(v,turn){try{await Reply.copy(turn.answer.message,v.clipboard);turn.copyStatus='已复制回答';}catch(e){turn.copyStatus='复制失败，请选中文字后复制：'+(e.message||'剪贴板不可用');}redraw(v);}
function renderSessions(v,p,{el,btn},s){const bar=el(p,'div','cm-agent-sessions');const label=el(bar,'label','cm-field');el(label,'span','cm-label','当前会话');const select=el(label,'select');select.setAttribute('aria-label','AI 会话');for(const item of s.sessions){const option=el(select,'option','',item.title+' · '+item.turns.length+' 轮');option.value=item.id;}select.value=s.sessionId;select.disabled=s.busy;select.addEventListener('change',()=>selectSession(v,select.value));btn(bar,'新建会话',()=>newSession(v),'cm-ghost').disabled=s.busy;const history=el(p,'details','cm-agent-history');el(history,'summary','','历史会话 · '+s.sessions.length+' 个');const title=el(history,'input');title.type='text';title.value=s.sessions.find(x=>x.id===s.sessionId).title;title.maxLength=80;title.setAttribute('aria-label','会话名称');title.disabled=s.busy;title.addEventListener('change',()=>renameSession(v,title.value));for(const item of [...s.sessions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))btn(history,item.title+' · '+item.turns.length+' 轮'+(item.id===s.sessionId?' · 当前':''),()=>selectSession(v,item.id),'cm-link').disabled=s.busy;el(p,'p','cm-muted','会话保存在本地，可切换后继续提问；清除对话只清空当前会话。');if(s.storageError||sessionStore(v)?.error)el(p,'p','cm-error',s.storageError||sessionStore(v).error);}
function renderBoard(v,p,H,mode){
 if(mode==='ai')syncAvailability(v);
 const {el,btn}=H,s=stateFor(v,mode),ai=mode==='ai',drawer=el(p,'details','cm-card cm-ask-drawer '+(ai?'cm-ask-ai':'cm-ask-local'));drawer.open=s.open;
 el(drawer,'summary','',ai?'🤖 AI 提问 · Agent 模式':'💬 本地提问 · 推荐，不联网');drawer.addEventListener('toggle',()=>{s.open=drawer.open;});
 const content=el(drawer,'div','cm-ask-content');
 if(ai){
  el(content,'p','cm-muted cm-ask-privacy','AI 提问会把你的问题、报告规格，以及工具查询到的汇总和逐笔字段发给你在设置里填写的模型服务商。按期间归类时，会发送该期间全部账单的日期、商户、标题、备注、现有分类和金额。每次发送的字段可在回答下方查看。报告只写入 Carrot记账/导出/。');
  el(content,'p','cm-muted','开启后 Agent 可查询账本，也可提议新建分类和账户、修改账目、删除记录。按月份归类时，会把该月全部账单的日期、商户、标题、备注、分类和金额交给 AI 综合推理，自行选择相关记录。每次写入都先给你预览，点确认才执行；删除只进回收站，可以撤销。建议只在需要它动手时开启，用完就关。');
  if(!s.enabled){const label=el(content,'label','cm-field cm-ask-consent'),check=el(label,'input');check.type='checkbox';check.checked=s.agreed;check.addEventListener('change',()=>agree(v,check.checked));el(label,'span','','我了解并同意');btn(content,'开启 AI 提问',()=>toggleAI(v),'cm-primary').disabled=!s.agreed;}
  else btn(content,'关闭 AI 提问',()=>toggleAI(v),'cm-ghost');
  if(s.error)el(content,'p','cm-error',s.error);
 }else el(content,'p','cm-muted','只在本地计算，不联网、不外发任何数据。金额、排名、重复核对等算账问题都可以先在这里问；本地分析报告也在这里生成。');
 if(ai)renderSessions(v,content,H,s);
 if(!ai){const samples=el(content,'div','cm-ask-examples');for(const example of examples)btn(samples,example,()=>submit(v,example),'cm-ghost').disabled=s.busy;}
 const form=el(content,'form','cm-ask-form'),label=el(form,'label','cm-field');el(label,'span','cm-label','想问什么？');const input=el(label,'textarea','cm-ask-input');input.rows=2;input.maxLength=500;input.value=s.input;input.disabled=s.busy;input.placeholder='例如：本月账户微信支出多少；本月人物小明支出合计';input.setAttribute('aria-label','账本问题');input.addEventListener('input',()=>{s.input=input.value;if(ai)scheduleSave(v,s);});
 if(ai)input.className+=' cm-ask-ai-input';
 const actions=el(form,'div','cm-actions cm-ask-actions');btn(actions,s.busy?'正在处理…':ai?'问 AI':'本地提问',()=>submit(v,s.input,{mode}),'cm-primary').disabled=s.busy;
 form.addEventListener('submit',e=>{e.preventDefault();void submit(v,s.input,{mode});});
 btn(actions,'清除对话',()=>clear(v,mode),'cm-link');
 if(s.busy&&s.controller)btn(actions,'停止',()=>s.controller?.abort(),'cm-link');
 const history=el(content,'div','cm-ask-history');history.setAttribute('aria-live','polite');history.setAttribute('aria-busy',String(s.busy));
 renderTurns(v,history,H,mode);
}
function renderProcess(card,{el},result,workspace=false){
 const process=el(card,'details','cm-agent-process');
 el(process,'summary','',workspace?'查看处理详情':`过程 · ${result.toolCalls??result.steps?.length??0} 次工具调用`);
 if(workspace){
  el(process,'p','cm-muted',`${((result.elapsedMs||0)/1000).toFixed(1)} 秒 · token ${result.usage?.reported?result.usage.totalTokens:'服务未回报'}`);
  for(const item of result.providedContext||[])el(process,'p','cm-muted',item.summary);
 }
 for(const step of result.steps||[])el(process,'div','cm-list-row',`${step.name} ${JSON.stringify(step.arguments)} · ${step.summary} · ${step.durationMs} ms`);
 if(result.sentFields?.length){const sent=el(workspace?process:card,'details','cm-agent-sent');el(sent,'summary','','本次发送了哪些字段');for(const item of result.sentFields)el(sent,'p','cm-muted',`第 ${item.attempt} 次：${item.fields.join('、')}；已完成工具结果 ${item.toolResults} 条`);}
}
function renderTurns(v,history,H,mode,{chronological=false,workspace=false}={}){
 const {el,btn}=H,s=stateFor(v,mode),ai=mode==='ai';
 for(const turn of (chronological?s.turns:[...s.turns].reverse())){
  const exchange=workspace?el(history,'article','cm-chat-exchange'):history;if(workspace)el(exchange,'div','cm-chat-user',turn.question);const card=el(exchange,'article','cm-ask-turn'+(workspace?' cm-chat-assistant':''));if(!workspace)el(card,'strong','cm-ask-question',turn.question);const result=turn.answer;
  el(card,'p','cm-muted',workspace?(result.engine==='本地条件筛选'?'本地规则结果（历史）':'AI 管账'):result.engine||'尚未解析');
  if(result.intent==='agent'||result.engine==='Agent 提议'){
   const phaseStatus={done:'已确认执行',undone:'已撤销',cancelled:'已取消',superseded:'已由新预览替代'};const status=phaseStatus[turn.phase]||{working:'Agent 工作中',done:result.path?'报告已保存':'AI 答复 · 未执行修改',needs_input:'待补充信息',planned:'任务清单已准备好',partial:result.reportJob?.pending||result.pendingReport?'报告待保存':result.reviewJob?'复核未完成':result.candidateJob?'匹配核对未完成':result.path?'已写到这里':'尚未完成',stopped:'已停止',error:'出错',local:'本地模式',preview:'已生成预览',unsupported:'暂不支持这项操作'}[result.status]||result.status;
   el(card,'p','cm-muted cm-agent-status',workspace?status:`${status} · ${((result.elapsedMs||0)/1000).toFixed(1)} 秒 · token ${result.usage?.reported?result.usage.totalTokens:'服务未回报'}`);
   for(const item of (workspace?[]:result.providedContext||[]))el(card,'p','cm-muted cm-agent-context',item.summary);
   if(!workspace)renderProcess(card,H,result);
   if(!workspace&&result.status==='working')btn(card,'停止',()=>s.controller?.abort(),'cm-link');
  }
  if(!turn.phase&&result.outcome&&result.execution?.status==='not_executed')el(card,'p','cm-muted cm-agent-execution',result.execution.message);
  const recovery=TaskStatus.recovery(v,s,turn);
  if(recovery){
   const bar=el(card,'section','cm-review-progress cm-task-recovery');el(bar,'strong','',recovery.kind==='review'?'分类复核':'匹配核对');
   el(bar,'span','cm-status cm-review-coverage',recovery.scope);el(bar,'small','cm-muted',recovery.narrowed?'按原清单重新开始':'已核对 '+recovery.offset+' / '+recovery.total+' 笔');
   el(bar,'p','cm-task-next',recovery.message);
   if(recovery.action)btn(bar,recovery.label,async()=>{
    if(recovery.action==='enable'){s.open=true;redraw(v);const area=v.contentEl.querySelector('.cm-assistant-permission');if(area)area.open=true;v.contentEl.querySelector('.cm-ask-consent input')?.focus({preventScroll:true});area?.scrollIntoView({block:'nearest'});return;}
    if(recovery.action==='save'){const previous=result.checkpointError;delete result.checkpointError;if(!await persist(v,s)){result.checkpointError=previous||true;}redraw(v);return;}
    return turn.workflow?require('./ai-workflow-actions').run(v,turn.workflow.id,turn.workflow.stepId):submit(v,recovery.kind==='review'?'继续复核':'继续匹配核对',{mode:'ai',...(recovery.kind==='review'?{resumeReviewId:recovery.job.id}:{resumeCandidateId:recovery.job.id}),requestUrl:v.assistantRequest});
   },'cm-primary').disabled=recovery.disabled;
  }
  if(result.reportJob){el(card,'p','cm-status cm-report-coverage',`报告进度 · 已确认保存 ${result.reportJob.completed.length} / ${result.reportJob.total} 节`);if(['partial','stopped','error'].includes(result.status)&&result.path)btn(card,result.reportJob.pending?'继续保存':'继续生成报告',()=>turn.workflow?require('./ai-workflow-actions').run(v,turn.workflow.id,turn.workflow.stepId):submit(v,'继续',{mode:'ai',resumeReportPath:result.path,requestUrl:v.assistantRequest}),'cm-primary').disabled=s.busy||!s.enabled;}
  if(result.pendingReport)btn(card,'继续保存',()=>submit(v,'继续保存',{mode:'ai',resumeReportPath:result.path,requestUrl:v.assistantRequest}),'cm-primary').disabled=s.busy||!s.enabled;
  if(result.taskPlan)btn(card,'查看任务清单',()=>{s.workflowPlanId=result.taskPlan.id;s.workflowOpen||={};s.workflowOpen[result.taskPlan.id]=true;redraw(v);},'cm-ghost');
  let answerHost=card;if(recovery&&(['partial','stopped','error'].includes(result.status)||recovery.historyOnly)){answerHost=el(card,'details','cm-task-history');el(answerHost,'summary','','查看当时的回复与进度');}const answer=el(answerHost,'div','cm-ask-answer');answer.innerHTML=Reply.html(result.message);
  if(turn.phase==='done'&&require('./ai-subscriptions').names.has(result.name))btn(card,'查看订阅计划',()=>v.navigate('plans'),'cm-ghost');
  if(result.status==='unsupported'){const action=require('./ai-capabilities').result(result.unsupported).manualAction;if(action)btn(card,action.label,()=>v.navigate(action.tab),'cm-ghost');}
  const outdated=stale(v,turn);if(outdated&&!turn.phase&&!result.taskPlan&&!recovery||turn.warning)el(card,'p','cm-error',turn.warning||'账本已变化，以下是旧结果，请再来一次后核对。');
  if(result.query)el(card,'p','cm-muted cm-ask-scope',Ask.scopeText(result.query,turn.source||v.d));
  if(result.intent==='duplicates'){
   el(card,'p','cm-muted cm-ask-scope','范围：'+result.range+' · '+result.groups.length+' 组 · '+result.count+' 笔');
   for(const group of result.groups){const box=el(card,'section','cm-card cm-ask-duplicate-group');el(box,'strong','',group.reason+' · '+group.rows.length+' 笔');el(box,'p','cm-muted','同日期、金额、账户、标题等匹配；请逐笔核对。');for(const row of group.rows){const line=el(box,'div','cm-list-row');const label=`${row.date} · ${row.title} · ${row.currency} ${C.money(row.amount)} · ${C.kinds[row.kind]||row.kind} · ${row.account}`;btn(line,label,()=>{const t=v.d.entries.find(t=>t.id===row.id&&t.book===turn.book);if(t&&!stale(v,turn))v.details(t);},'cm-link').disabled=outdated;}
    btn(box,'这组没问题',async()=>{if(stale(v,turn)){turn.warning='账本已变化，请再查一次。';redraw(v);return;}await v.p.change(d=>require('./audit').mark(d,turn.book,group.ids,true),{snapshot:true});turn.source=v.d;turn.answer=Tasks.duplicates(v.d,turn.book,result.task);redraw(v);},'cm-link').disabled=outdated;
   }
  }
  if(workspace&&result.findings?.length)require('./ai-findings-view').render(v,card,H,turn);
  if(workspace&&(result.intent==='action'||result.intent==='agent_write')){el(card,'p','',turn.phase==='done'?`已执行 ${turn.receipt?.count||0} 项`:turn.phase==='undone'?'这次操作已撤销':turn.phase==='cancelled'?'这次操作已取消':`有 ${result.count} 项建议等待你核对`);btn(card,turn.phase?'查看操作记录':'查看修改建议',()=>{s.reviewIndex=s.turns.indexOf(turn);s.reviewOpen=true;redraw(v);},'cm-ghost');}
  if(!workspace&&(result.intent==='action'||result.intent==='agent_write')){
   el(card,'strong','',result.actionName||'批量修改');
   if(!turn.phase)el(card,'p','cm-muted',`这是预览，还没改。${result.count} ${result.name==='delete_entries'?'笔':'项'} · 合计 ¥ ${C.money(result.amount||0)}${result.months?' · 月份：'+(result.months.join('、')||'无')+' · 账户：'+(result.accounts.join('、')||'无'):''}`);
   else if(turn.phase==='done')el(card,'p','cm-muted',`已执行 ${result.count} ${result.name==='delete_entries'?'笔':'项'}（可撤销）`);
   if(result.count>200)el(card,'p','cm-error',`注意：这次会影响 ${result.count} 笔，请仔细核对。`);
   for(const row of result.rows)el(card,'div','cm-list-row',`${row.date?row.date+' · ':''}${row.title?row.title+' · ':''}${row.currency?row.currency+' '+C.money(row.amount)+' · ':''}${row.oldStr} → ${row.newStr}`);
   if(result.count>result.rows.length)el(card,'p','cm-muted',`先列出 ${result.rows.length} 条，共 ${result.count} 条`);
   if(result.count&&!turn.phase){const bar=el(card,'div','cm-actions');btn(bar,result.intent==='action'?'确认修改':result.name==='delete_entries'?'确认移入回收站':require('./ai-entry-actions').names.has(result.name)?'确认入账':'确认执行',()=>confirm(v,turn),'cm-primary').disabled=outdated||s.busy||(ai&&!s.enabled);btn(bar,'取消',()=>{turn.phase='cancelled';turn.answer={...result,message:'已取消，本次没有修改任何记录。'};if(ai)void persist(v,s);redraw(v);},'cm-link').disabled=s.busy;}
   if(turn.phase==='done'&&(turn.receipt||s.undo?.turn===turn))btn(card,'撤销这次修改',()=>undo(v,turn),'cm-link').disabled=turn.book!==v.book||s.busy;
  }
  if((result.intent==='report'||result.intent==='agent')&&result.path){el(card,'p','cm-muted','报告路径：'+result.path);btn(card,'打开报告',()=>openReport(v,turn),'cm-primary').disabled=!!(result.reportJob?.pending||result.pendingReport);if(turn.reportStatus)el(card,'p',turn.reportStatus.startsWith('打开报告失败')?'cm-error':'cm-muted',turn.reportStatus);}
  const facts=el(card,'div','cm-ask-facts');for(const fact of result.facts||[]){const value=fact.unit==='money'?'¥ '+C.money(fact.value):fact.value+(fact.unit==='days'?' 天':' 笔');const b=btn(facts,fact.label+'：'+value,()=>drill(v,turn,fact),'cm-ask-fact');b.disabled=outdated;b.setAttribute('aria-label',fact.label+'：'+value+'，查看计算依据');}
  if(result.note)el(card,'p','cm-muted',result.note);
  const tools=el(card,'div','cm-actions');if(result.message)btn(tools,'复制回答',()=>copyReply(v,turn),'cm-link');if(turn.copyStatus)el(card,'p',turn.copyStatus.startsWith('复制失败')?'cm-error':'cm-muted',turn.copyStatus);if((!workspace||['error','stopped','partial'].includes(result.status))&&!result.reportJob&&!result.pendingReport&&!result.reviewJob&&!result.candidateJob)btn(tools,workspace?'重试':'再来一次',()=>turn.workflow?require('./ai-workflow-actions').run(v,turn.workflow.id,turn.workflow.stepId):submit(v,turn.question,{mode,clearInput:workspace,requestUrl:workspace?v.assistantRequest:undefined}),'cm-link').disabled=s.busy||(ai&&!s.enabled);
  if(!ai&&!result.ok)btn(tools,'改问 AI',()=>moveToAI(v,turn.question),'cm-primary');
  if(workspace&&(result.intent==='agent'||result.engine==='Agent 提议'))renderProcess(card,H,result,true);
  if(!workspace)btn(tools,'换个说法',()=>{s.input=turn.question;redraw(v);v.contentEl?.querySelector(ai?'.cm-ask-ai-input':'.cm-ask-local .cm-ask-input')?.focus({preventScroll:true});},'cm-link').disabled=s.busy;
 }
}
function render(v,p,H){renderBoard(v,p,H,'local');renderBoard(v,p,H,'ai');}
module.exports={redraw,clearSaveTimer,examples,stateFor,syncAvailability,submit,clear,dispose,persist,newSession,selectSession,renameSession,agree,toggleAI,moveToAI,drill,stale,confirm,undo,openReport,copyReply,render,renderBoard,renderTurns,scheduleSave,archiveSession,deleteSession,touchSession,cancel,confirmSelected};
