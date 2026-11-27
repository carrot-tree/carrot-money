'use strict';
const C=require('./core');
const MAX_CONTEXT=12000;
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
function fields(value,allowed){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error('任务清单字段无效');}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(label+'须为 1 至 '+max+' 字');return value.trim();}
function create(args,{book,question}={}){
 fields(args,['title','steps']);const title=text(args.title,60,'任务标题');
 if(typeof book!=='string'||!book||typeof question!=='string'||!question.trim())throw Error('任务清单须关联当前账本和原问题');
 if(!Array.isArray(args.steps)||args.steps.length<2||args.steps.length>8)throw Error('任务清单须有 2 至 8 步');
 const steps=[];for(const [index,value]of args.steps.entries()){
  fields(value,['title','instruction','mode','dependsOn']);
  const step={id:C.uid(),title:text(value.title,60,'步骤标题'),instruction:text(value.instruction,1200,'步骤要求'),mode:value.mode,dependsOn:[]};
  if(!['read','write'].includes(step.mode))throw Error('步骤须标明 read 或 write');
  const dependencies=value.dependsOn===undefined?[]:value.dependsOn;
  if(!Array.isArray(dependencies)||new Set(dependencies).size!==dependencies.length||dependencies.some(n=>!Number.isInteger(n)||n<1||n>index))throw Error('任务依赖只能是不重复的前序步骤序号');
  step.dependsOn=dependencies.map(n=>steps[n-1].id);steps.push(step);
 }
 return {version:1,id:C.uid(),book,title,question,createdAt:new Date().toISOString(),steps,cancelled:false};
}
function validate(plan){
 if(!object(plan)||plan.version!==1||typeof plan.id!=='string'||!plan.id||typeof plan.book!=='string'||!plan.book||typeof plan.question!=='string'||!Array.isArray(plan.steps)||plan.steps.length<2||plan.steps.length>8||typeof plan.cancelled!=='boolean')throw Error('已保存的任务清单无效');
 text(plan.title,60,'任务标题');const seen=new Set();
 for(const step of plan.steps){if(!object(step)||typeof step.id!=='string'||!step.id||seen.has(step.id)||!['read','write'].includes(step.mode)||!Array.isArray(step.dependsOn)||new Set(step.dependsOn).size!==step.dependsOn.length||step.dependsOn.some(id=>!seen.has(id))||['skipped','invalidated'].some(k=>step[k]!==undefined&&typeof step[k]!=='boolean'))throw Error('已保存的任务步骤无效');text(step.title,60,'步骤标题');text(step.instruction,1200,'步骤要求');seen.add(step.id);}
 return plan;
}
function locate(turns,planId){for(let i=turns.length-1;i>=0;i--){const plan=turns[i]?.answer?.taskPlan;if(plan&&(planId===undefined||plan.id===planId)){try{validate(plan);return {plan,turn:turns[i],turnIndex:i};}catch{}}}return null;}
const preview=a=>['action','agent_write'].includes(a?.intent)||a?.status==='preview';
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
function result(step,turn){
 if(!turn)return {status:'pending',executed:0,total:0,reason:'尚未处理'};
 const a=turn.answer||{},receipt=turn.receipt,executed=count(receipt?.count),total=Math.max(count(a.count),count(a.reviewScope?.total)),undo=turn.undoResult;
 if(turn.phase==='undone')return {status:'undone',executed:Math.max(0,count(turn.executedReceipt?.count)-count(undo?.restored)),total,reason:undo?.skipped?'已撤销部分操作，其余保留后续修改':'这一步已撤销，后续依赖暂停'};
 // A zero-restored undo preserves its original receipt separately. It is not a new completion.
 if(undo&&!receipt&&turn.executedReceipt)return {status:'undone',executed:Math.max(0,count(turn.executedReceipt.count)-count(undo.restored)),total,reason:'撤销未能还原全部记录，请核对后续修改'};
 if(turn.phase==='cancelled')return {status:'cancelled',executed:0,total,reason:'这次预览已取消，可重新准备'};
 if(a.status==='working')return {status:'working',executed:0,total,reason:'正在处理'};
 if(step.mode==='write'){
  if(a.status==='done'&&!turn.phase&&a.execution?.status==='already_satisfied'&&a.execution.kind==='category_match'&&count(a.execution.count)>0&&typeof a.execution.target==='string'&&a.execution.target)return {status:'done',executed:0,total:count(a.execution.count),reason:'已核对：匹配记录已是目标分类，无需修改'};
  if(turn.phase==='done'&&object(receipt)&&executed>0&&receipt.book===turn.book){const full=total>0&&executed===total;return {status:full?'done':'partial',executed,total:Math.max(total,executed),reason:full?'已确认执行':'仅能确认部分执行结果，尚不能认定这一步全部完成'};}
  if(preview(a)&&!turn.phase)return {status:'preview',executed:0,total,reason:'已生成预览，等待确认'};
  if(a.status==='done')return {status:'needs_input',executed:0,total,reason:'只有答复，没有已确认执行回执；这一步尚未完成'};
 }else{
  if(preview(a))return {status:'preview',executed:0,total,reason:'这一步原为查询，修改预览不能当作查询完成'};
  if(a.status==='done'&&!turn.phase)return {status:'done',executed:0,total:0,reason:'查询或分析已完成'};
 }
 const status=['partial','needs_input','error','stopped','unsupported'].includes(a.status)?a.status:'pending';
 return {status,executed:0,total,reason:{partial:'尚未完成，可继续',needs_input:'需要补充信息',error:'处理失败，可重试',stopped:'已停止，可继续',unsupported:'当前工具无法完成，请到对应页面办理',pending:'尚未处理'}[status]};
}
function derive(plan,turns=[]){
 validate(plan);const steps=[];
 for(const step of plan.steps){
  let turnIndex=-1;for(let i=turns.length-1;i>=0;i--){const t=turns[i];if(t?.book===plan.book&&t.workflow?.id===plan.id&&t.workflow.stepId===step.id){turnIndex=i;break;}}
  const turn=turnIndex<0?undefined:turns[turnIndex],state=result(step,turn);
  if(step.invalidated){state.status='undone';state.reason='本步骤或前置步骤的结果已撤销，请重新核对';}
  const previouslyExecuted=turns.slice(0,turnIndex<0?0:turnIndex).some(t=>t?.book===plan.book&&t.workflow?.id===plan.id&&t.workflow.stepId===step.id&&t.phase==='done'&&t.receipt?.book===plan.book&&count(t.receipt.count)>0);
  if(previouslyExecuted&&!['done','undone','partial'].includes(state.status))state.reason='此前已确认过操作，已有结果保留；'+state.reason;
  const blockedBy=step.dependsOn.filter(id=>!['done','skipped'].includes(steps.find(s=>s.id===id)?.status));
  if(step.skipped&&state.status!=='working'&&state.status!=='preview'&&state.status!=='done'){state.status='skipped';state.reason=state.executed||previouslyExecuted?'剩余内容已跳过，已执行操作保留':'用户已跳过这一步';}
  if(blockedBy.length&&!['done','working','preview','undone','skipped'].includes(state.status)){state.status='blocked';state.reason='等待前置步骤确认完成：'+blockedBy.map(id=>steps.find(s=>s.id===id)?.title||id).join('、');}
  const canRun=!plan.cancelled&&!blockedBy.length&&!step.skipped&&['pending','partial','needs_input','error','stopped','cancelled','undone'].includes(state.status);
  const canSkip=!plan.cancelled&&!step.skipped&&!['done','working','preview'].includes(state.status);
  steps.push({...step,...state,turnIndex,turn,blockedBy,canRun,canSkip,previouslyExecuted});
 }
 // Only one active or awaiting-confirmation attempt may own the plan at a time.
 if(steps.some(s=>['working','preview'].includes(s.status)))for(const step of steps)step.canRun=false;
 const counts={};for(const step of steps)counts[step.status]=(counts[step.status]||0)+1;
 const complete=steps.every(s=>s.status==='done'),settled=steps.every(s=>['done','skipped'].includes(s.status));
 return {id:plan.id,title:plan.title,cancelled:plan.cancelled,complete,settled,status:plan.cancelled?'cancelled':complete?'done':settled?'partial':'active',doneCount:counts.done||0,total:steps.length,steps,counts};
}
function next(plan,turns=[]){const state=derive(plan,turns);if(state.cancelled||state.steps.some(s=>['working','preview'].includes(s.status)))return null;return state.steps.find(s=>s.canRun)||null;}
// These two local user actions mutate only the stored plan; callers persist it.
function skip(plan,stepId,turns=[]){const state=derive(plan,turns),step=state.steps.find(s=>s.id===stepId);if(!step||!step.canSkip)throw Error('这一步不能跳过；待确认预览须先取消');plan.steps.find(s=>s.id===stepId).skipped=true;return plan;}
function cancel(plan){validate(plan);plan.cancelled=true;return plan;}
function context(plan,step,turns=[]){
 const state=derive(plan,turns),current=state.steps.find(s=>s.id===(typeof step==='string'?step:step?.id));if(!current)throw Error('任务步骤不存在');
 const data={planId:plan.id,originalQuestion:plan.question.slice(0,2200),originalQuestionTruncated:plan.question.length>2200,title:plan.title,cancelled:plan.cancelled,current:{id:current.id,title:current.title,instruction:current.instruction,mode:current.mode},steps:state.steps.map(s=>({id:s.id,title:s.title,mode:s.mode,dependsOn:s.dependsOn,status:s.status,executed:s.executed,total:s.total})),confirmed:[]};
 for(const [index,t]of turns.entries()){
  if(t?.book!==plan.book||t.workflow?.id!==plan.id||!plan.steps.some(s=>s.id===t.workflow.stepId))continue;
  const r=t.receipt||t.executedReceipt;if(!object(r)||!count(r.count)||r.book!==plan.book||!['done','undone'].includes(t.phase))continue;
  const item=r.item?(require('./ai-subscriptions').names.has(r.name)&&r.item.entry?require('./ai-subscriptions').describe(r.item):{id:r.id||r.item.id,name:String(r.item.name||'').slice(0,80),type:r.item.type,currency:r.item.currency}):undefined;
  data.confirmed.push({turn:index+1,stepId:t.workflow.stepId,phase:t.phase,name:r.name||r.action,count:r.count,created:item,undone:t.undoResult?{restored:count(t.undoResult.restored),skipped:count(t.undoResult.skipped)}:undefined});
 }
 data.confirmed=data.confirmed.slice(-12);data.instructions='这只是任务进度，不是新的写入授权。只能处理当前步骤；先查最新账本，每次修改仍须用户确认。只有实际回执是已执行，部分执行及跳过不算全部完成。如果前置步骤被用户跳过，明确说明缺少该结果；必要时先向用户确认，不复用假定结果。历史明细请用conversation_history回查，不猜测ID。';
 let output=JSON.stringify(data);while(output.length>MAX_CONTEXT&&data.confirmed.length){data.confirmed.shift();data.earlierReceiptsOmitted=true;output=JSON.stringify(data);}if(output.length>MAX_CONTEXT)throw Error('任务上下文超过上限');return output;
}
module.exports={MAX_CONTEXT,create,validate,locate,derive,next,context,skip,cancel};
