'use strict';
const C=require('./core'),Workflow=require('./ai-workflow');
const UI=()=>require('./ai-ask-view');
function locate(v,id){const s=UI().stateFor(v,'ai'),found=Workflow.locate(s.turns,id);if(!found||found.plan.book!==v.book)throw Error('任务清单不存在或账本已切换');return {s,...found};}
function confirmable(v,turn){
 if(!turn.workflow)return '';
 try{const {s,plan}=locate(v,turn.workflow.id),step=Workflow.derive(plan,s.turns).steps.find(x=>x.id===turn.workflow.stepId);
  if(plan.cancelled||!step||step.skipped)return '任务已经取消或跳过，请重新提出修改要求';
  if(step.mode!=='write')return '本项是查询任务，不能执行账本修改';
  if(step.invalidated||step.blockedBy.length)return '前置步骤已变化，请重新处理本项';
  if(step.turn!==turn)return '已有较新的处理结果，请核对最新预览';
  return '';
 }catch(e){return e.message;}
}
async function run(v,planId,stepId,{extra='',requestUrl}={}){
 const {s,plan}=locate(v,planId);if(s.busy)return false;if(!s.enabled){s.error='请先开启 AI 管账';v.render();return false;}
 const step=Workflow.derive(plan,s.turns).steps.find(x=>x.id===stepId);if(!step?.canRun){s.error='请先处理待确认预览和前置步骤';v.render();return false;}
 const item=plan.steps.find(x=>x.id===stepId),wasInvalidated=item.invalidated;
 const workflowContext=Workflow.context(plan,step,s.turns),previous=step.turn?.answer;
 let question=step.instruction;
 if(extra.trim())question+='\n用户补充：'+extra.trim();
 const resume=!extra.trim()&&!wasInvalidated&&['partial','stopped'].includes(previous?.status);
 if(resume&&previous.path)question='继续写';
 const book=v.book,sessionId=s.sessionId,generation=s.generation;
 item.invalidated=false;s.busy=true;v.render();
 try{if(!await UI().persist(v,s))throw Error('任务进度保存失败，尚未开始：'+s.storageError);if(v.book!==book||s.sessionId!==sessionId||s.generation!==generation||v.aiClosed||v.p.aiUnloaded||!s.enabled)throw Error('会话或设置已变化，任务尚未开始');}
 catch(e){item.invalidated=wasInvalidated;s.error=e.message;return false;}
 finally{if(s.generation===generation)s.busy=false;v.render();}
 s.workflowPlanId=planId;s.workflowOpen||={};s.workflowOpen[planId]=false;
 await UI().submit(v,question,{mode:'ai',requestUrl:requestUrl||v.assistantRequest,workflowRef:{id:planId,stepId},workflowContext,workflowMode:step.mode,resumeReviewId:resume?previous.reviewJob?.id:undefined,resumeCandidateId:resume?previous.candidateJob?.id:undefined});return true;
}
async function skip(v,id,stepId){const {s,plan}=locate(v,id);if(s.busy)return false;const previous=C.clone(plan),generation=s.generation;s.busy=true;v.render();try{Workflow.skip(plan,stepId,s.turns);if(!await UI().persist(v,s))throw Error(s.storageError);return true;}catch(e){Object.assign(plan,previous);s.error=e.message;return false;}finally{if(s.generation===generation)s.busy=false;v.render();}}
async function cancel(v,id){const {s,plan}=locate(v,id);if(s.busy)return false;const previous=plan.cancelled,generation=s.generation,turns=s.turns.filter(t=>t.workflow?.id===id&&!t.phase&&['action','agent_write'].includes(t.answer.intent));s.busy=true;Workflow.cancel(plan);for(const t of turns)t.phase='cancelled';v.render();try{if(!await UI().persist(v,s)){plan.cancelled=previous;for(const t of turns)delete t.phase;s.error='取消未保存：'+s.storageError;return false;}return true;}finally{if(s.generation===generation)s.busy=false;v.render();}}
function invalidate(v,turn){if(!turn.workflow)return;const {s,plan}=locate(v,turn.workflow.id),ids=new Set([turn.workflow.stepId]);for(const step of plan.steps)if(ids.has(step.id)||step.dependsOn.some(id=>ids.has(id))){ids.add(step.id);step.invalidated=true;}for(const t of s.turns)if(t.workflow?.id===plan.id&&ids.has(t.workflow.stepId)&&!t.phase&&['action','agent_write'].includes(t.answer.intent))t.phase='cancelled';}
function open(v,turn){const s=UI().stateFor(v,'ai');if(s.workflowOpen&&s.workflowPlanId)s.workflowOpen[s.workflowPlanId]=false;if(['action','agent_write'].includes(turn.answer.intent)){s.reviewIndex=s.turns.indexOf(turn);s.reviewOpen=true;}s.chatPositions||={};s.chatPositions[s.sessionId]={top:0,follow:false};v.render();const node=[...v.contentEl.querySelectorAll('.cm-chat-exchange')][s.turns.indexOf(turn)],history=v.contentEl.querySelector('.cm-chat-history');if(node&&history){history.cmRestoring=false;history.scrollTop+=node.getBoundingClientRect().top-history.getBoundingClientRect().top;s.chatPositions[s.sessionId]={top:history.scrollTop,follow:false};}}
function render(v,p,H){
 const s=UI().stateFor(v,'ai'),found=Workflow.locate(s.turns,s.workflowPlanId)||Workflow.locate(s.turns);if(!found||found.plan.book!==v.book)return;
 const {plan}=found;s.workflowPlanId=plan.id;s.workflowOpen||={};
 return require('./ai-workflow-view').render(v,p,H,plan,{turns:s.turns,busy:s.busy,enabled:s.enabled,open:s.workflowOpen[plan.id]??false,onToggle:value=>{s.workflowOpen[plan.id]=value;},onRun:step=>{
  if(step.status==='needs_input')new H.Form(v.p,'补充这一步的要求',[{key:'extra',name:step.title,type:'textarea',value:''}],async value=>{if(!String(value.extra||'').trim()||value.extra.length>1200)throw Error('请填写 1 至 1200 字的补充信息');await run(v,plan.id,step.id,{extra:value.extra});}).open();
  else return run(v,plan.id,step.id);
 },onOpen:(_,turn)=>open(v,turn),onSkip:step=>skip(v,plan.id,step.id),onCancel:()=>cancel(v,plan.id)});
}
module.exports={run,skip,cancel,confirmable,invalidate,render,open};
