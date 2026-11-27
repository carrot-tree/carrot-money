'use strict';
const Scope=require('./ai-entry-scope');
const paused=new Set(['partial','stopped','error']);
function recovery(v,s,turn){
 const answer=turn?.answer||{},kind=answer.reviewJob?'review':answer.candidateJob?'candidate':null;
 if(!kind)return null;
 const job=kind==='review'?answer.reviewJob:answer.candidateJob,index=s.turns.indexOf(turn);
 const later=s.turns.slice(index+1).some(t=>(t.answer?.reviewJob||t.answer?.candidateJob)?.id===job.id||t.answer?.scopeRecovery?.reviewId===job.id);
 let selection=null;if(kind==='review'&&!job.ids){try{selection=Scope.resolve(job.question||turn.question,v.d,turn.book,s.turns.slice(0,index));}catch{}}
 const narrowed=selection?.ids.length>0&&selection.ids.length<job.total&&!selection.unresolved.length&&!selection.ambiguous.length;
 const total=narrowed?selection.ids.length:job.total,scope=narrowed?'原清单 '+total+' 笔':job.ids?.length?'指定清单 '+job.ids.length+' 笔':kind==='candidate'?'原条件匹配 '+total+' 笔':(job.start||'')+' 至 '+(job.end||'')+' · '+total+' 笔';
 const state={kind,job,scope,total,narrowed,offset:narrowed?0:job.offset,action:null,label:'',disabled:false};
 if(turn.phase||later)return {...state,historyOnly:true,message:later?'这次任务已在后续回复中继续，请查看最新进度。':'这次任务已结束。'};
 if(!paused.has(answer.status))return {...state,message:answer.status==='working'?'正在核对指定范围，尚未修改账本。':'本次范围已核对。'};
 if(turn.book!==v.book)return {...state,message:'请回到这次任务所属账本后继续。'};
 if(s.busy)return {...state,message:'正在处理，请等待当前任务结束。',disabled:true};
 if(answer.checkpointError||s.storageError)return {...state,action:'save',label:'重试保存进度',message:'复核进度尚未保存。先保存成功，再继续核对；当前页面请保持打开。'};
 if(!s.enabled)return {...state,action:'enable',label:'前往开启 AI',message:'AI 尚未开启。先在本会话开启 AI，再核对上述范围；当前进度保留。'};
 const changed=turn.source!==v.d;
 return {...state,action:'resume',label:narrowed?'按原清单核对':changed?'校验原范围并继续':kind==='review'?'继续复核':'继续匹配核对',
  message:narrowed?'将重新核对原清单的 '+total+' 笔，不沿用历史扩大范围的进度。':changed?'账本有更新，将先检查原范围和进度是否仍有效；失效时会停止并提示重新核对。':'从已保存的 '+job.offset+' / '+job.total+' 笔继续核对，生成预览后仍需你确认。'};
}
module.exports={recovery};
