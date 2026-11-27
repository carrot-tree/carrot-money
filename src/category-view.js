'use strict';
const Themes=require('./appearance');
const Tools=require('./category-tools'),{PATH,parse}=require('./ai-drafts');
// Drafts live outside the ledger. Read both the saved file and unsaved review
// states, and reject changes to either while a cleanup preview is open.
async function draftReferences(p){
 const store=p.drafts;if(store?.error)throw Error('AI 草稿读取失败，请先在 AI 记账重新读取后再清理分类');
 if([...store?.states?.values()||[]].some(x=>x.busy||x.draftStatus==='saving'))throw Error('AI 复核正在处理，请稍后清理分类');
 if(store)await store.queue;
 const adapter=p.app.vault.adapter,raw=await adapter.exists(PATH)?await adapter.read(PATH):null;
 return [...(raw===null?[]:parse(raw).drafts),...[...store?.states?.values()||[]].map(s=>s.batch).filter(Boolean)];
}
function draftMemory(p){
 const store=p.drafts;if(store?.error)throw Error('AI 草稿读取失败，请先重新读取');
 if([...store?.states?.values()||[]].some(x=>x.busy||x.draftStatus==='saving'))throw Error('AI 复核正在处理，请稍后清理分类');
 return JSON.stringify([store?.raw||'',[...store?.states?.values()||[]].map(x=>x.batch).filter(Boolean)]);
}
async function open(v,mode,ids,H){
 const {Modal,el,btn}=H,p=v.p,drafts=mode==='delete'?await draftReferences(p):[],plan=Tools.preview(v.d,mode,ids,drafts),draftStamp=JSON.stringify(drafts),memoryStamp=mode==='delete'?draftMemory(p):'',modal=new Modal(v.app);
 modal.onOpen=()=>{
  const root=modal.contentEl;root.addClass('cm-modal','cm-category-preview');Themes.apply(root,v.p);
  el(root,'h2','',mode==='delete'?'清理空分类预览':'补全分类图标预览');
  el(root,'p','',`全部账本共用分类 · 将${mode==='delete'?'删除':'修改图标'} ${plan.count} 个，跳过 ${plan.items.length-plan.count} 个。账目、回收站及计划内容不变。`);
  el(root,'p','cm-muted','确认后先创建独立快照，再执行。恢复路径：数据与备份 → 快照与恢复副本 → 浏览全部快照 → 对应文件 → 恢复并预览。恢复会回退整个账本，包含快照之后的其他修改。');
  const list=el(root,'div','cm-category-preview-list');for(const x of plan.items){const row=el(list,'div','cm-category-preview-row');el(row,'strong','',x.name+' ['+x.id+']');el(row,'span','',x.change?(mode==='delete'?'将删除':(x.before||'空')+' → '+x.after):'保留');el(row,'small','cm-muted',x.reasons.join('；'));}
  const status=el(root,'p','cm-muted');status.setAttribute('role','status');const actions=el(root,'div','cm-actions');btn(actions,'关闭',()=>modal.close());let done=false;
  const confirm=btn(actions,mode==='delete'?`创建快照并删除 ${plan.count} 个`:`创建快照并补全 ${plan.count} 个`,async()=>{
   if(done)return;let currentDrafts=drafts;
   const check=()=>{if(mode==='delete'&&draftMemory(p)!==memoryStamp)throw Error('AI 草稿已变化，请关闭后重新预览');};
   const beforeCommit=mode==='delete'?async()=>{currentDrafts=await draftReferences(p);if(JSON.stringify(currentDrafts)!==draftStamp)throw Error('AI 草稿已变化，请关闭后重新预览');check();}:undefined;
   try{const result=await p.change(d=>Tools.apply(d,plan,currentDrafts),{snapshot:true,check,beforeCommit});done=true;status.textContent=`已${mode==='delete'?'删除':'补全'} ${plan.count} 个分类。账目仍为 ${p.data.entries.length} 笔。恢复快照：${result.snapshot}`;confirm.hidden=true;}catch(e){status.textContent='未执行：'+e.message;}
  },'mod-cta');confirm.disabled=!plan.count;
 };modal.onClose=()=>modal.contentEl.empty();modal.open();return modal;
}
function actions(v,p,H){const {el,btn}=H,row=el(p,'div','cm-actions');btn(row,'＋ 新建分类',()=>v.categoryForm());btn(row,'清理空分类',()=>open(v,'delete',null,H));btn(row,'一键补全图标',()=>open(v,'icons',null,H));}
module.exports={draftReferences,open,actions};
