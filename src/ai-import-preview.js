'use strict';
const Themes=require('./appearance');
const C=require('./core'),AI=require('./ai-import'),Icons=require('./category-icons');
function totals(rows){const groups=new Map();for(const r of rows){const key=r.nature+'|'+r.entry.currency;if(!groups.has(key))groups.set(key,{nature:r.nature,currency:r.entry.currency,count:0,amount:0});const g=groups.get(key);g.count++;if(Number.isSafeInteger(r.entry.amount)&&g.amount!==null){g.amount+=r.entry.amount;if(!Number.isSafeInteger(g.amount))g.amount=null;}else g.amount=null;}return [...groups.values()];}
function open(v,state,keys,H,save,{highOnly=false}={}){
 const batch=state.batch,raw=v.p.store.raw,signature=JSON.stringify(batch),selected=[...keys];
 const modal=new H.Confirm(v.p,'核对入账 · '+selected.length+' 笔','',()=>{});
 modal.onOpen=()=>{const {el,btn}=H,root=modal.contentEl;root.classList.add('cm-modal','cm-import-preview');Themes.apply(root,v.p);modal.modalEl.classList.add('cm-import-preview-modal');
  const head=el(root,'header','cm-import-preview-head');el(head,'span','cm-eyebrow','最后一步 · 核对入账');el(head,'h2','','确认 '+selected.length+' 笔入账');el(head,'p','cm-muted','只有点击下方确认才写入账本。这批入账可在导入批次中撤销。');
  const check=AI.preflight(v.d,batch,selected,{highOnly}),summary=el(root,'div','cm-import-totals');for(const g of totals(check.rows)){const card=el(summary,'div');el(card,'small','',AI.natureNames[g.nature]+' · '+g.count+' 笔');el(card,'strong','',g.currency+' '+(g.amount===null?'金额待核实':C.money(g.amount)));}
  const error=el(root,'p','cm-error cm-import-preview-error');error.setAttribute('role','alert');error.textContent=check.error||(check.blocked.length?'有 '+check.blocked.length+' 笔需要先补全或修正。可返回复核，或仅确认可入账项。':'');
  const blocked=new Map(check.blocked.map(x=>[x.row.key,x])),list=el(root,'div','cm-import-preview-list');const pages=Math.max(1,Math.ceil(check.rows.length/20));let page=0;
  const draw=()=>{list.replaceChildren();for(const r of check.rows.slice(page*20,(page+1)*20)){const t=r.entry,row=el(list,'article','cm-import-preview-row'+(blocked.has(r.key)?' is-blocked':'')),heading=el(row,'div','cm-import-preview-row-head');el(heading,'strong','',t.title||t.payee||'未命名账目');el(heading,'strong','',t.currency+' '+(t.amount===null?'待补充':C.money(t.amount)));el(row,'p','cm-muted',(t.date||'日期待补充')+' · '+AI.natureNames[r.nature]+' · '+Icons.label(v.d,t.category));el(row,'p','cm-muted','账户：'+(v.d.accounts.find(a=>a.id===t.account)?.name||'待选择')+(t.toAccount?' → '+(v.d.accounts.find(a=>a.id===t.toAccount)?.name||'待选择'):''));if(blocked.has(r.key))el(row,'p','cm-error','需处理：'+(blocked.get(r.key).blockers.join('；')||'不再属于高置信'));const detail=el(row,'details');el(detail,'summary','','判断依据与核实提示');for(const reason of r.reasons)el(detail,'p','cm-muted',reason);}}
  draw();
  const footer=el(root,'footer','cm-import-preview-footer'),navigation=el(footer,'div','cm-import-preview-navigation');
  el(navigation,'span','cm-muted cm-import-preview-range');const range=navigation.lastElementChild;
  if(pages>1){const pager=el(navigation,'div','cm-import-preview-pager');let label;const prev=btn(pager,'上一页',()=>{page=Math.max(0,page-1);update();});label=el(pager,'span');label.setAttribute('aria-live','polite');const next=btn(pager,'下一页',()=>{page=Math.min(pages-1,page+1);update();});const update=()=>{draw();label.textContent=(page+1)+' / '+pages;range.textContent='正在核对 '+(page*20+1)+'–'+Math.min((page+1)*20,check.rows.length)+' / '+check.rows.length+' 笔';prev.disabled=page===0;next.disabled=page===pages-1;list.scrollTop=0;};update();}
  else range.textContent='共 '+check.rows.length+' 笔记录';
  const allowed=check.rows.filter(r=>!blocked.has(r.key)).map(r=>r.key),partial=!!check.blocked.length&&!check.error&&allowed.length>0;
  const bottom=el(footer,'div','cm-import-preview-bottom'),note=el(bottom,'div','cm-import-preview-note');
  el(note,'strong','',check.error?'请返回处理后重新核对':check.blocked.length?allowed.length+' 笔可入账 · '+check.blocked.length+' 笔需处理':selected.length+' 笔已就绪');
  el(note,'small','cm-muted',partial?'仅确认可入账项，其余保留在复核队列。':check.ok?'确认后写入账本，可在导入批次中撤销。':'所选记录尚不能入账，请返回补全或修正。');
  const actions=el(bottom,'div','cm-import-preview-actions'),back=btn(actions,'返回复核',()=>modal.close());let confirm;
  const run=async runKeys=>{confirm.disabled=true;back.disabled=true;error.textContent='正在保存…';try{if(state.batch!==batch||v.book!==batch.book||v.p.store.raw!==raw||JSON.stringify(batch)!==signature)throw Error('预览后账本或复核队列已变化，请返回重新核对');const n=await save(v,state,runKeys,highOnly);if(!n)throw Error('本次没有入账，请重新核对');modal.close();}catch(e){error.textContent=e.message;error.scrollIntoView?.({block:'nearest'});}finally{confirm.disabled=!(check.ok||partial);back.disabled=false;}};
  confirm=btn(actions,partial?'仅确认可入账 '+allowed.length+' 笔':check.ok?'确认入账（'+selected.length+' 笔）':'请先处理待核实项',()=>run(partial?allowed:selected),'mod-cta');confirm.disabled=!(check.ok||partial);

 };
 modal.open();return modal;
}
module.exports={open,totals};
