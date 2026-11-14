'use strict';

const labels={pending:'待处理',queued:'待处理',blocked:'等待前项',working:'处理中',preview:'待你确认',done:'已完成',partial:'部分完成',needs_input:'待补充',error:'未完成',stopped:'已停止',cancelled:'已取消',undone:'已撤销',skipped:'已跳过',unsupported:'暂不支持'};
const statusLabel=status=>labels[status]||'待核对';
const runLabel=status=>['partial','stopped'].includes(status)?'继续本项':['error','undone','cancelled'].includes(status)?'重新处理本项':status==='needs_input'?'补充信息后继续':'开始本项';

function summary(state){
 const text=`已完成 ${state.doneCount} / ${state.total} 项`,skipped=state.counts?.skipped||0;
 if(state.cancelled)return text+' · 后续任务已取消';
 if(state.complete)return text+(skipped?` · 跳过 ${skipped} 项`:' · 全部完成');
 const current=state.steps.find(s=>s.status==='working')||state.steps.find(s=>s.status==='preview')||state.steps.find(s=>s.status==='needs_input')||state.steps.find(s=>s.canRun);
 return text+(skipped?` · 跳过 ${skipped} 项`:'')+(current?' · '+statusLabel(current.status):'');
}

function detail(step){
 if(step.reason)return step.reason;
 return {pending:step.mode==='write'?'处理后先生成修改预览，确认后才写入。':'准备好后可开始分析。',queued:'准备好后可开始处理。',working:'正在处理这一项。',preview:'请先核对预览并确认，账本尚未修改。',done:'这一项已完成。',partial:'已有部分结果，可以接着处理。',needs_input:'请查看结果，补充缺少的信息后继续。',error:'这次没有完成，可查看原因后重试。',stopped:'处理已停止，可从保存的进度继续。',cancelled:'这一项已取消。',undone:'已执行的修改已撤销。',skipped:'这一项已跳过，不计为完成。',unsupported:'当前工具无法完成这一项，请查看结果中的替代方式。',blocked:'需要先完成前面的依赖任务。'}[step.status]||'请查看结果后核对这一步的状态。';
}

/** Rendering delegates all task changes to the host. Opening this panel never runs a task. */
function render(v,p,H,plan,callbacks={}){
 const {el,btn}=H,state=callbacks.derived||require('./ai-workflow').derive(plan,callbacks.turns||[]);
 const panel=el(p,'details','cm-workflow');panel.dataset.workflowId=plan.id;
 panel.open=callbacks.open??false;
 const head=el(panel,'summary','cm-workflow-head');head.setAttribute('aria-expanded',String(panel.open));
 const heading=el(head,'span','cm-workflow-heading');el(heading,'strong','','任务清单');el(heading,'span','cm-workflow-title',plan.title).setAttribute('title',plan.title);
 el(head,'small','cm-workflow-progress',summary(state));
 panel.addEventListener('toggle',()=>{head.setAttribute('aria-expanded',String(panel.open));callbacks.onToggle?.(panel.open);});
 const body=el(panel,'div','cm-workflow-body');
 const original=el(body,'details','cm-workflow-original');el(original,'summary','','查看原始要求');el(original,'p','',plan.question);el(original,'p','cm-muted cm-workflow-guide','每次处理一项。涉及账本修改时，先核对预览，再确认写入。');
 const list=el(body,'ol','cm-workflow-list');list.setAttribute('aria-label','任务步骤');
 for(const [i,step] of state.steps.entries()){
  const row=el(list,'li','cm-workflow-step');row.dataset.stepId=step.id;row.dataset.status=step.status;
  const title=el(row,'div','cm-workflow-step-head');el(title,'span','cm-workflow-number',i+1);el(title,'strong','',step.title);el(title,'small','cm-workflow-status',statusLabel(step.status));
  const redundantPending=['pending','queued'].includes(step.status)&&(!step.reason||step.reason==='尚未处理');
  if(!redundantPending&&!(step.status==='blocked'&&step.blockedBy?.length))el(row,'p','cm-workflow-detail',detail(step));
  if(step.instruction&&step.instruction!==step.title){const requirement=el(row,'details','cm-workflow-requirement');el(requirement,'summary','','本项要求');el(requirement,'p','',step.instruction);}
  if(step.blockedBy?.length){const titles=step.blockedBy.map(id=>state.steps.find(s=>s.id===id)?.title||'前项');el(row,'small','cm-workflow-dependency','等待完成：'+titles.join('、'));}
  const actions=el(row,'div','cm-actions cm-workflow-actions');
  if(step.canRun&&callbacks.onRun){const run=btn(actions,runLabel(step.status),()=>callbacks.onRun(step),'cm-ghost cm-workflow-run');run.disabled=!!callbacks.busy||callbacks.enabled===false;run.setAttribute('aria-label',runLabel(step.status)+'：'+step.title);}
  if(step.turn&&callbacks.onOpen){const open=btn(actions,step.status==='preview'?'查看修改预览':'查看结果',()=>callbacks.onOpen(step,step.turn),'cm-link cm-workflow-open');open.setAttribute('aria-label',(step.status==='preview'?'查看修改预览：':'查看结果：')+step.title);}
  if(step.canSkip&&callbacks.onSkip){const skip=btn(actions,'跳过本项',()=>callbacks.onSkip(step),'cm-link cm-workflow-skip');skip.disabled=!!callbacks.busy;skip.setAttribute('aria-label','跳过本项：'+step.title);}
 }
 if(callbacks.enabled===false&&!state.settled&&!state.complete&&!state.cancelled)el(body,'p','cm-muted cm-workflow-disabled','开启 AI 管账后可以继续处理任务。');
 if(!state.cancelled&&!state.settled&&!state.complete&&callbacks.onCancel){const footer=el(body,'div','cm-workflow-footer');btn(footer,'取消后续任务',()=>callbacks.onCancel(),'cm-link cm-workflow-cancel').disabled=!!callbacks.busy;el(footer,'small','cm-muted','已完成的操作和结果保留。');}
 return panel;
}

module.exports={render,statusLabel,runLabel,summary,detail};
