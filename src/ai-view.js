'use strict';
const CategoryIcons=require('./category-icons'),Review=require('./import-review'),Refunds=require('./ai-refunds'),RefundUI=require('./ai-refund-view');
const C=require('./core'),AI=require('./ai-import'),Remote=require('./ai-provider'),Workspace=require('./ai-workspace'),Reconcile=require('./ai-reconcile'),Preview=require('./ai-import-preview');
const Issues=require('./import-issues'),Tasks=require('./import-tasks');
const PAGE=20;
const stateFor=Workspace.stateFor;
const pending=batch=>batch.rows.filter(r=>r.state==='pending');
function pruneSelection(state){const keys=new Set(pending(state.batch).map(r=>r.key));for(const key of state.selected)if(!keys.has(key))state.selected.delete(key);}
function visibleRows(batch,state){
 const query=(state.query||'').trim().toLowerCase(),limit=state.minAmount;
 const rows=pending(batch).filter(r=>(state.issueFocus?Issues.matches(r,state.issueFocus):(state.issueOnly||r.group===state.group))&&(!state.issueOnly||r.blockers.length)&&(!state.flagOnly||r.flags?.length)&&(!state.categoryFilter||r.entry.category===state.categoryFilter)&&(!Number.isSafeInteger(limit)||Number.isSafeInteger(r.entry.amount)&&r.entry.amount>limit)&&(!query||[r.entry.title,r.entry.payee,r.entry.note,r.record.title,r.record.payee,r.record.note,r.entry.amount==null?'':C.money(r.entry.amount),r.entry.amount==null?'':String(r.entry.amount/100)].some(x=>String(x||'').toLowerCase().includes(query))));
 const sorts={'amount-desc':(a,b)=>amountOrder(a,b,-1),'amount-asc':(a,b)=>amountOrder(a,b,1),'date-desc':(a,b)=>dateOrder(a,b,-1),'date-asc':(a,b)=>dateOrder(a,b,1)};
 return sorts[state.sort]?rows.sort(sorts[state.sort]):rows;
}
function amountOrder(a,b,direction){const x=a.entry.amount,y=b.entry.amount;if(!Number.isSafeInteger(x))return Number.isSafeInteger(y)?1:0;if(!Number.isSafeInteger(y))return -1;return direction*(x-y);}
function dateOrder(a,b,direction){const x=a.entry.date? a.entry.date+' '+(a.entry.importTime||''):'',y=b.entry.date?b.entry.date+' '+(b.entry.importTime||''):'';if(!x)return y?1:0;if(!y)return -1;return direction*x.localeCompare(y);}
function bindSearch(search,v,state){
 let composing=false;
 const apply=()=>{if(search.isConnected===false)return;const start=search.selectionStart,end=search.selectionEnd;state.query=search.value;state.page=0;v.render();const next=v.contentEl?.querySelector('.cm-ai-search');next?.focus();if(start!=null)next?.setSelectionRange(start,end??start);};
 search.addEventListener('compositionstart',()=>{composing=true;});
 search.addEventListener('compositionend',()=>{composing=false;apply();});
 search.addEventListener('input',event=>{if(!composing&&!event?.isComposing)apply();});
}
async function bulkUpdate(v,state,values){
 if(state.busy||!state.batch)return;const keys=new Set(state.selected),rows=pending(state.batch).filter(r=>keys.has(r.key));if(!rows.length)return;
 const accounts=v.d.accounts.filter(a=>!a.archived),account=accounts.find(a=>a.id===values.account);
 if(!account)throw Error('请选择可用账户');
 const nature=values.nature;if(nature&&!['transfer','repayment'].includes(nature))throw Error('请选择转账或信用卡还款');
 if(nature){const target=accounts.find(a=>a.id===values.toAccount);if(!target||target.id===account.id)throw Error('请选择不同的转入账户');if(nature==='repayment'&&!['信用卡','负债'].includes(target.type))throw Error('还款请选择信用卡或负债账户');if(account.currency!==target.currency||rows.some(r=>r.entry.currency!==account.currency))throw Error('不同币种请逐笔核实到账金额');}
 else if(rows.some(r=>r.entry.currency!==account.currency))throw Error('账户币种与账单不一致，请逐笔核实');
 const before=rows.map(r=>C.clone(r)),copy=C.clone(state.batch);
 for(const row of copy.rows.filter(r=>keys.has(r.key)&&r.state==='pending')){const t=row.entry;t.account=values.account;
  if(nature){row.nature=nature;t.kind='transfer';t.toAccount=values.toAccount;t.toAmount=t.amount;t.related='';t.splits=[];}
  if(!row.edited)row.reasons=row.reasons.map(x=>'原识别：'+x);row.edited=true;row.reasons.push(nature?'已批量修改交易性质，请核实双方账户':'已批量修改账户，请核实');
 }
 AI.refresh(copy,v.d);
 await Workspace.mutate(v,state,()=>{const changed=new Map(copy.rows.filter(r=>keys.has(r.key)).map(r=>[r.key,r]));state.batch.rows=state.batch.rows.map(r=>changed.get(r.key)||r);state.bulkUndo={kind:'update',batch:state.batch,rows:before,after:new Map(rows.map(r=>[r.key,JSON.stringify(changed.get(r.key))]))};AI.refresh(state.batch,v.d);say(v,state,'已批量修改 '+rows.length+' 笔草稿'+(nature?'为'+AI.natureNames[nature]:'账户')+'，核实后再确认入账');});
}
function bulkForm(v,state,H,nature){
 const batch=state.batch,keys=[...state.selected],accounts=[['','请选择账户'],...v.d.accounts.filter(a=>!a.archived).map(a=>[a.id,a.name])],title=nature?'批量设为'+AI.natureNames[nature]:'批量修改账户';
 const specs=[{key:'account',name:nature?'转出账户':'账户',type:'select',options:accounts},...(nature?[{key:'toAccount',name:nature==='repayment'?'信用卡 / 负债账户':'转入账户',type:'select',options:accounts}]:[])];
 const modal=new H.Form(v.p,title+'（'+keys.length+' 笔）',specs,async values=>{if(state.batch!==batch||v.book!==batch.book||keys.length!==state.selected.size||keys.some(k=>!state.selected.has(k)))throw Error('队列或所选记录已变化，请重新打开');await bulkUpdate(v,state,{...values,nature});});modal.open();return modal;
}
async function bulkExclude(v,state){const rows=pending(state.batch).filter(r=>state.selected.has(r.key)),count=rows.length;if(!count)return;
 await Workspace.mutate(v,state,()=>{state.bulkUndo={kind:'exclude',batch:state.batch,keys:rows.map(r=>r.key)};for(const row of rows){AI.setState(state.batch,row.key,'excluded');state.selected.delete(row.key);}AI.refresh(state.batch,v.d);say(v,state,'已排除 '+count+' 笔草稿（所选中已处理的记录已跳过）');});
}
async function bulkCategory(v,state,categoryId){const rows=pending(state.batch).filter(r=>state.selected.has(r.key));if(!rows.length)return;
 const category=v.d.categories.find(c=>c.id===categoryId&&!c.archived);if(!category){say(v,state,'请选择现有分类');v.render();return;}
 if(rows.some(r=>category.type!==(r.nature==='income'?'income':'expense'))){say(v,state,'所选记录含不同收支类型，请分别修改分类');v.render();return;}
 const before=rows.map(r=>({key:r.key,category:r.entry.category,edited:r.edited,reasons:[...r.reasons]}));
 await Workspace.mutate(v,state,()=>{const count=AI.setCategories(state.batch,rows.map(r=>r.key),categoryId,v.d);state.bulkUndo={kind:'category',batch:state.batch,rows:before};say(v,state,'已修改 '+count+' 笔草稿分类，请核实后再确认');});
}
async function undoBulk(v,state){const undo=state.bulkUndo;if(!undo||undo.batch!==state.batch)return;
 await Workspace.mutate(v,state,()=>{let restored=0;if(undo.kind==='exclude')for(const key of undo.keys){const row=state.batch.rows.find(r=>r.key===key);if(row?.state==='excluded'){AI.setState(state.batch,key,'pending');restored++;}}
  else if(undo.kind==='update'){for(const previous of undo.rows){const i=state.batch.rows.findIndex(r=>r.key===previous.key);if(i>=0&&state.batch.rows[i].state==='pending'&&JSON.stringify(state.batch.rows[i])===undo.after.get(previous.key)){state.batch.rows[i]=C.clone(previous);restored++;}}}
  else for(const previous of undo.rows){const row=state.batch.rows.find(r=>r.key===previous.key);if(row?.state==='pending'){row.entry.category=previous.category;row.edited=previous.edited;row.reasons=previous.reasons;restored++;}}
  AI.refresh(state.batch,v.d);state.bulkUndo=null;say(v,state,'已撤销 '+restored+' 笔草稿的上次批量操作'+(restored?'':'（记录已处理或变化）'));});
}
// 识别结果同时写进页面状态与系统提示，避免「点了没反应」这种感受。
const notify=text=>{try{new (require('obsidian').Notice)(text);}catch{}};
const live=v=>!v.aiClosed&&!v.p.aiUnloaded;
const say=(v,state,text)=>{state.enhanceMessage=text;if(live(v))notify(text);};
function choose(v){v.contentEl.querySelector('.cm-ai-file')?.click();}
async function importFile(v,file,H){
 const state=stateFor(v),book=v.book,previous=state.batch;if(state.busy)return;
 const run=async()=>{
  if(state.busy||state.batch!==previous||v.book!==book){state.error='队列或账本已变化，请重新选择文件';Workspace.redraw(v);return;}
  state.busy=true;state.error='';state.progress={message:'读取本地文件',done:0,total:1};Workspace.redraw(v);
  const progress=value=>{state.progress=value;Workspace.redraw(v);};
  try{const input=await AI.readFile(file,progress),batch=await AI.analyze(input,v.d,book,{onProgress:progress});state.batch=batch;state.issueFocus='all';state.task=null;state.refundPartial=null;state.refundResult=null;state.enhanceMessage='';state.selected.clear();state.bulkUndo=null;state.query='';state.categoryFilter='';state.minAmount=null;state.sort='original';state.page=0;const counts=AI.counts(batch);state.group=counts.review?'review':counts.unknown?'unknown':'ready';await Workspace.persist(v,state);}
  catch(e){state.error=e.message;}
  finally{state.busy=false;state.progress=null;Workspace.redraw(v);}
 };
 if(state.batch?.rows.some(r=>r.state!=='confirmed'))new H.Confirm(v.p,'开始新一批识别','成功读取新文件后将替换当前未入账队列。已确认的账目和导入批次会保留；读取失败则保留当前队列。',run).open();else await run();
}
// The only bill-enhancement network entry point. Import/render/post never call it.
async function enhance(v,{requestUrl,repeat=false,scope,keys:onlyKeys}={}){
 const state=stateFor(v),batch=state.batch,book=v.book;if(state.busy||!batch)return;
 const history=v.d.imports.find(b=>b.id===batch.id);if(history&&!history.undoable||batch.restoreBlocked)return;
 const keys=enhanceCandidates(state,{repeat,scope}).filter(r=>!onlyKeys||onlyKeys.includes(r.key)).map(r=>r.key);if(!keys.length)return;
 const settings=C.clone(v.d.settings),signature=JSON.stringify(Remote.config(settings));
 settings.aiEnhancement={...Remote.config(settings),importSpeed:state.enhanceSpeed||Remote.config(settings).importSpeed};
 const current=()=>!v.aiClosed&&!v.p.aiUnloaded&&state.batch===batch&&v.book===book&&JSON.stringify(Remote.config(v.d.settings))===signature;
 const render=()=>{if(!v.aiClosed&&!v.p.aiUnloaded){if(v.tab&&v.tab!=='ai')Tasks.refresh(v);else v.render();}};
 const began=Date.now();let timer;const heartbeat=()=>{if(current()&&state.progress)Review.progress(v,state,{...state.progress,elapsedMs:Date.now()-began});timer=setTimeout(heartbeat,1000);};timer=setTimeout(heartbeat,1000);
 const controller=new AbortController();state.enhanceController=controller;state.busy=true;state.enhanceMessage='';state.selected.clear();Tasks.begin(state,'classify',keys.length);state.task.remainingKeys=[...keys];render();
 try{
  const result=await Remote.enhance(batch,v.d,settings,{requestUrl:requestUrl||v.p._requestUrl,keys,userInitiated:true,signal:controller.signal,shouldContinue:current,onProgress:value=>{if(current())Review.progress(v,state,value);}});
  state.task.remainingKeys=result.failedKeys||keys;Tasks.finish(state,{done:result.enhanced||0,failed:result.fallback??(result.applied===false?keys.length:0),stopped:result.stopped,message:result.stopped?'已完成建议保留，可继续未完成项':'识别结束，请核实结果'});
  if(result.applied===false)say(v,state,'AI 识别未执行：'+result.reasons.join('；'));
  else{
   await Workspace.persist(v,state);const count=AI.counts(batch);
   const reasons=result.reasons.length?'（'+result.reasons.join('；')+'）':'';
   const slow=/超时/.test(result.reasons.join(' '))?'；慢服务商可在设置 → AI 服务把「单次请求超时」调到 90–120 秒再试':'';
   say(v,state,result.stopped?'AI 识别已停止：保留已采纳的 '+result.enhanced+' 笔建议，其余可再次识别；迟到结果不会采用':(result.enhanced?'AI 识别完成：采纳 '+result.enhanced+' 笔，本地回退 '+result.fallback+' 笔'+(count.flagged?'，其中 '+count.flagged+' 笔有疑点待核实':'')+reasons:'AI 未能采纳任何结果，全部保留本地建议：'+result.reasons.join('；'))+slow);
  }
 }
 catch(e){Tasks.finish(state,{failed:keys.length,message:'请求未完成，草稿保留'});say(v,state,'AI 识别失败：'+(e&&e.message?e.message:'未知错误')+'；已保留本地复核队列');}
 finally{clearTimeout(timer);if(state.enhanceController===controller)state.enhanceController=null;state.busy=false;state.progress=null;render();}
}
function enhanceCandidates(state,{repeat=false,scope=state.enhanceScope||'review'}={}){return state.batch?Remote.candidates(state.batch).filter(r=>scope==='selected'?state.selected.has(r.key):scope==='failed'?r.recognition?.state==='failed':repeat||scope==='all'||r.group!=='ready'&&r.origin!=='ai'&&!r.reasons.some(x=>/^AI 判断：/.test(x))):[];}
function stop(v){
 const drafts=v.p.drafts?.vault===v.p.store?.vault?v.p.drafts:null;
 const states=new Set([...(drafts?.states?.values()||[]),...(v.aiStates?.values()||[])]);
 for(const state of states)state.enhanceController?.abort();
 if(live(v))Workspace.redraw(v);
}
async function save(v,state,keys,highOnly=false){
 if(state.busy)throw Error('还有复核操作未结束，请稍后重试');const batch=state.batch,book=v.book;
 const verify=()=>{if(!live(v)||v.book!==book||state.batch!==batch)throw Error('复核页面或账本已变化，请重新预览');};
 state.busy=true;state.error='';v.render();
 try{verify();Workspace.sync(state,v.d);if(batch.restoreBlocked)throw Error(batch.restoreWarnings.join('；'));if(!await Workspace.persist(v,state))throw Error('草稿尚未保存，本次没有入账；请先重试保存');await v.p.change(d=>{Workspace.sync(state,d);if(batch.restoreBlocked)throw Error(batch.restoreWarnings.join('；'));AI.post(d,batch,keys,{highOnly});},{check:verify});AI.markPosted(batch,keys);for(const key of keys)state.selected.delete(key);const draftSaved=await Workspace.persist(v,state);say(v,state,'已入账 '+keys.length+' 笔'+(draftSaved?'':'；账目已保存，草稿状态待重试保存'));return keys.length;}
 catch(e){state.error='未入账：'+e.message;if(live(v)){notify(state.error);throw Error(state.error);}return 0;}
 finally{state.busy=false;if(live(v)){AI.refresh(batch,v.d);v.render();}}
}
function confirm(v,state,keys,H,highOnly=false){
 if(!keys.length||state.busy)return;
 return Preview.open(v,state,keys,H,save,{highOnly});
}
function edit(v,state,row,H){
 const {Form,el}=H,d=v.d,batch=state.batch,t=row.entry;
 const accounts=[['','请选择账户'],...d.accounts.filter(a=>!a.archived).map(a=>[a.id,a.name+' · '+a.currency])];
 const specs=[
  {key:'nature',name:'收支类型 / 交易性质',type:'select',value:row.nature,options:Object.entries(AI.natureNames)},
  {key:'title',name:'摘要',value:t.title},
  {key:'amount',name:'金额（所选币种）',value:t.amount==null?'':t.amount/100},
  {key:'currency',name:'币种',type:'select',value:t.currency,options:C.currencies.map(code=>[code,code])},
  {key:'rate',name:'折算人民币汇率（1 单位原币）',value:t.rate==null?'':t.rate},
  {key:'date',name:'日期',type:'date',value:t.date},
  {key:'category',name:'分类',type:'category',value:t.category,options:[['','请选择分类'],...d.categories.filter(c=>!c.archived).map(c=>[c.id,CategoryIcons.label(d,c.id)])]},
  {key:'account',name:'账户 / 转出账户',type:'select',value:t.account,options:accounts},
  {key:'toAccount',name:'转入 / 信用卡账户',type:'select',value:t.toAccount,options:accounts},
  {key:'toAmount',name:'实际到账金额（转入账户币种）',value:t.toAmount?t.toAmount/100:''},
  {key:'related',name:'关联原支出',type:'select',value:t.related,options:[['','请选择原支出'],...AI.originals(batch,d,row).map(x=>[x.entry.id,x.source+' · '+x.entry.title])]},
  {key:'note',name:'备注',type:'textarea',value:t.note}
 ];
 const modal=new Form(v.p,'复核这笔账目',specs,async values=>{
  if(state.busy||state.batch!==batch||v.book!==batch.book)throw Error('队列或账本已变化，请重新打开');
  await Workspace.mutate(v,state,()=>{AI.edit(batch,row.key,values,v.d);state.selected.delete(row.key);});
 });
 const open=modal.onOpen.bind(modal);modal.onOpen=()=>{
  open();modal.modalEl.addClass('cm-ai-edit-modal');modal.contentEl.addClass('cm-ai-edit');
  if(v.contentEl.getBoundingClientRect().width<=720)modal.modalEl.addClass('cm-ai-edit-narrow');
  const note=el(modal.contentEl,'p','cm-muted','修改自动保存为本地草稿，确认后才入账。转账 / 还款需选择双方账户；退款继承原支出的分类与汇率。');modal.contentEl.insertBefore(note,modal.contentEl.querySelector('form'));
  modal.contentEl.querySelector('button[type=submit]').textContent='保存复核修改';
  const f=modal.fields,show=()=>{const transfer=['transfer','repayment'].includes(f.nature.value),related=['refund','reimbursement'].includes(f.nature.value);for(const k of ['toAccount','toAmount'])f[k].closest('.cm-field').hidden=!transfer;f.related.closest('.cm-field').hidden=!related;f.category.setChoices?.([['','请选择'+(f.nature.value==='income'?'收入':'支出')+'分类'],...v.d.categories.filter(c=>!c.archived&&c.type===(f.nature.value==='income'?'income':'expense')).map(c=>[c.id,CategoryIcons.label(v.d,c.id)])]);f.category.disabled=f.currency.disabled=f.rate.disabled=related;};
  const relatedField=f.related.closest('.cm-field');f.related.hidden=true;const search=el(relatedField,'input','cm-related-search');search.type='search';search.setAttribute('aria-label','搜索原支出');search.placeholder='搜索摘要、商家、日期、金额或分类';const selected=el(relatedField,'div','cm-related-selected'),list=el(relatedField,'div','cm-related-results');list.setAttribute('role','group');list.setAttribute('aria-label','原支出搜索结果');
  const renderOriginals=()=>{const candidates=AI.originals(batch,v.d,row).filter(x=>f.nature.value!=='reimbursement'||x.entry.reimbursable),query=search.value.trim().toLowerCase(),chosen=candidates.find(x=>x.entry.id===f.related.value);if(chosen){f.category.value=chosen.entry.category;f.currency.value=chosen.entry.currency;f.rate.value=chosen.entry.rate;}selected.empty();el(selected,'strong','',chosen?'已选：'+chosen.source+' · '+chosen.entry.title:'尚未关联原支出');if(chosen?.key)el(selected,'small','cm-muted','本批支出尚未入账，请与这笔退款一起勾选确认。');if(f.related.value)el(selected,'button','cm-link','取消关联').addEventListener('click',e=>{e.preventDefault();f.related.value='';renderOriginals();});list.empty();const matches=candidates.filter(x=>[x.entry.title,x.entry.payee,x.entry.date,C.money(x.entry.amount),CategoryIcons.label(v.d,x.entry.category),x.source].join(' ').toLowerCase().includes(query));el(list,'small','cm-muted','找到 '+matches.length+' 笔'+(matches.length>80?'，显示前 80 笔，请缩小搜索范围':''));for(const x of matches.sort((a,b)=>Number(!!b.key)-Number(!!a.key)||b.entry.date.localeCompare(a.entry.date)).slice(0,80)){const candidate=el(list,'button','cm-related-option'+(f.related.value===x.entry.id?' active':''));candidate.type='button';candidate.dataset.relatedId=x.entry.id;candidate.setAttribute('aria-pressed',String(f.related.value===x.entry.id));el(candidate,'strong','',x.entry.title||'未命名支出');el(candidate,'span','',x.source+' · '+x.entry.date+' · '+x.entry.currency+' '+C.money(x.entry.amount));el(candidate,'small','cm-muted',CategoryIcons.label(v.d,x.entry.category)+' · 可退 '+C.money(C.outstanding(v.d,x.entry)));candidate.addEventListener('click',()=>{f.related.value=x.entry.id;f.category.value=x.entry.category;renderOriginals();});}};
  search.addEventListener('input',e=>{if(!e.isComposing)renderOriginals();});search.addEventListener('compositionend',renderOriginals);search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();if(!e.isComposing&&e.keyCode!==229)renderOriginals();}});
  f.nature.addEventListener('change',()=>{show();renderOriginals();});show();renderOriginals();
 };modal.open();return modal;
}
function render(v,p,H){

 const {el,btn,field,panel,Confirm}=H,state=stateFor(v),section=el(p,'div','cm-ai');section.setAttribute('aria-busy',String(state.busy));if(state.compact===undefined)state.compact=true;Workspace.sync(state,v.d);
 const steps=el(section,'div','cm-import-steps');for(const [i,label]of ['导入账单','核实记录','确认入账'].entries()){const step=el(steps,'span','');if(i===(state.batch?1:0))step.setAttribute('aria-current','step');el(step,'b','',String(i+1));el(step,'span','',label);}
 const intro=panel(section,'导入与识别','CSV · Excel · ZIP');intro.classList.add('cm-import-intro');
 el(intro,'p','cm-muted','选择支付宝或微信导出的 CSV / ZIP，或 Excel（.xlsx）账单。自动建议分类、账户和交易性质，确认前不会写入账目。');
 const engine=Remote.engineStatus(state.batch,v.d.settings),status=el(intro,'p','cm-muted cm-ai-engine',`当前引擎：${engine.label} · ${engine.detail}`+(state.enhanceMessage?'；'+state.enhanceMessage:''));status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const draftBox=el(intro,'details','cm-import-help');el(draftBox,'summary','','草稿与文件管理');Workspace.render(v,draftBox,state,H);
 const actions=el(intro,'div','cm-actions');const file=field(intro,'选择账单 CSV / XLSX / ZIP','file');file.classList.add('cm-ai-file');file.closest?.('.cm-field')?.classList.add('cm-ai-file-field');file.accept='.csv,.xlsx,.xls,.zip';file.disabled=state.busy;
 file.addEventListener('change',()=>{const selected=file.files?.[0];file.value='';if(selected)void importFile(v,selected,H);});
 const upload=btn(actions,'导入账单',()=>file.click(),'cm-primary');upload.disabled=state.busy;
 const history=state.batch&&v.d.imports.find(b=>b.id===state.batch.id);
 const candidates=enhanceCandidates(state),repeats=state.batch?.enhancement?enhanceCandidates(state,{repeat:true,scope:'all'}):[],repeatOnly=!candidates.length&&repeats.length>0&&['review','all'].includes(state.enhanceScope||'review'),count=repeatOnly?repeats.length:candidates.length,undone=!!(history&&!history.undoable)||!!state.batch?.restoreBlocked,settings=v.d.settings;
 const blocked=state.busy?'正在识别，请等待本次完成':!state.batch?'先导入账单，再点「AI 识别」':undone?'该批次已撤销，请重新导入账单':!count?((state.enhanceScope==='selected')?'请先勾选未手改、未处理的记录':state.enhanceScope==='failed'?'没有失败项需要重试':enhanceCandidates(state,{repeat:true,scope:'all'}).length?'当前范围没有待识别条目，可切换「全部未手改记录」识别':'没有可识别条目；手动修改、已入账、已排除和已跳过记录会保留'):'';
 const range=el(actions,'select','cm-ai-enhance-scope');range.setAttribute('aria-label','AI 识别范围');for(const [value,label]of [['review','仅待核实 / 未识别'],['selected','仅识别所选'],['failed','仅重试失败项'],['all','全部未手改记录']]){const option=el(range,'option','',label);option.value=value;}range.value=state.enhanceScope||'review';range.disabled=state.busy;range.addEventListener('change',()=>{state.enhanceScope=range.value;v.render();});
 const speed=el(actions,'select','cm-ai-enhance-speed');speed.setAttribute('aria-label','AI 识别速度');for(const [value,label]of [['fast','快速识别'],['model','按模型设置']]){const option=el(speed,'option','',label);option.value=value;}speed.value=state.enhanceSpeed||Remote.config(settings).importSpeed;speed.disabled=state.busy;speed.addEventListener('change',()=>{state.enhanceSpeed=speed.value;v.render();});
 el(intro,'p','cm-muted cm-ai-speed-note',Remote.speedDetail(settings,state.enhanceSpeed)+'；仅用于账单导入，可切回按模型设置。');
 const enhanceBtn=btn(actions,repeatOnly?'重新识别':'AI 识别',()=>enhance(v,{repeat:repeatOnly,scope:repeatOnly?'all':state.enhanceScope}));
 enhanceBtn.disabled=state.busy||!state.batch||!count||undone;
 enhanceBtn.title=blocked||(repeatOnly?'重新分析全部 '+count+' 笔未手改记录，保留手动修改与已处理记录':'分析 '+count+' 笔未处理条目');
 if(candidates.length&&repeats.length){const retry=btn(actions,'重新识别',()=>enhance(v,{repeat:true,scope:'all'}),'cm-link');retry.disabled=state.busy||undone;retry.title='重新分析全部 '+repeats.length+' 笔未手改记录，保留手动修改与已处理记录';}
 el(actions,'span','cm-muted cm-ai-enhance-hint',blocked||((repeatOnly?'已有识别结果，可重新分析全部 ':'将分析 ')+count+(repeatOnly?' 笔未手改记录；手动修改与已处理记录保留':' 笔未处理条目')+'（每批 '+Remote.config(settings).batchSize+' 笔，最多 '+Remote.config(settings).importConcurrency+' 批并行）'+(Remote.config(settings).enabled?'':'；AI 服务未开启，当前只做本地复核')));
 const selectedAI=btn(actions,'识别所选（'+enhanceCandidates(state,{scope:'selected'}).length+'）',()=>enhance(v,{scope:'selected'}),'cm-ghost');selectedAI.disabled=state.busy||undone||!enhanceCandidates(state,{scope:'selected'}).length;selectedAI.title='只分析所选且未手改、未处理的记录';const failedAI=btn(actions,'重试失败项（'+enhanceCandidates(state,{scope:'failed'}).length+'）',()=>enhance(v,{scope:'failed'}),'cm-link');failedAI.disabled=state.busy||undone||!enhanceCandidates(state,{scope:'failed'}).length;
 const localRefund=btn(actions,'本地核对退款',()=>RefundUI.checkLocal(v),'cm-ghost cm-local-refund-check');localRefund.disabled=state.busy||undone||!Refunds.eligible(state.batch).length;localRefund.title='按完整订单号查找原支出，不发送账单；核实后确认关联';
 const refundAI=btn(actions,'AI 核实退款（'+Refunds.eligible(state.batch).length+'）',()=>RefundUI.check(v),'cm-ghost cm-ai-refund-check');refundAI.disabled=state.busy||undone||!Refunds.eligible(state.batch).length;refundAI.title='AI 比较账本和本批支出，核实后关联退款草稿';
 if(state.enhanceController){const cancel=btn(actions,state.enhanceController.signal.aborted?'正在停止…':state.refundWorking?'停止核对':'停止识别',()=>stop(v),'cm-ai-stop');cancel.disabled=state.enhanceController.signal.aborted;cancel.title='停止等待及后续批次，已完成建议保留；服务商已收到的请求可能继续计费';}
 btn(actions,'AI 服务设置',()=>{v.app.setting.open();v.app.setting.openTabById(v.p.manifest.id);},'cm-link');
 btn(actions,'管理账户',()=>{v.tab='accounts';v.render();},'cm-link');
 const help=el(intro,'details','cm-import-help');el(help,'summary','','支持格式与 AI 发送范围');
 el(help,'p','cm-muted','仅点击「AI 识别」时向已设置的外部服务发送尚未处理且未手工编辑的账单字段：金额、方向、摘要、交易对方、来源、支付方式、交易状态、交易类型及账单自带分类（用于逐笔推理分类与可疑处）。不发送日期、账号 / 余额、备注、位置、人物或标签；AI 只给建议，仍需你复核确认。');
 el(help,'p','cm-muted','点击「核实退款项」会向已配置的 AI 服务发送待关联退款和本账本候选支出的日期、金额、币种、摘要、商家、订单线索及可退金额，用于匹配；不发送账号、余额、备注、位置、人物或标签。AI 只生成配对建议，确认关联只修改本地草稿，不自动入账。');
 el(help,'p','cm-muted','Excel 支持 .xlsx（表头需含日期 / 交易时间、金额等账单列）；旧 .xls 请另存为 .xlsx 或 CSV。UTF-8 / GB18030 自动识别；ZIP 中按文件名和表头查找账单。复核草稿自动保存在本机，显示已保存后可关页，下次继续核实。草稿文件为明文，备份或迁移请一并复制。Notion CSV 与完整 JSON 恢复请使用「数据与备份」。');
 Review.diagnostics(intro,state.batch,H);
 if(state.progress){const status=el(intro,'div','cm-ai-progress');status.setAttribute('role','status');status.setAttribute('aria-live','polite');el(status,'span','',`${state.progress.message} · ${state.progress.done} / ${state.progress.total}`);const progress=el(status,'progress');progress.max=state.progress.total||1;progress.value=state.progress.done||0;progress.setAttribute('aria-label',state.progress.message);el(status,'small','cm-import-job-status','正在处理识别批次');}
 if(state.error){const error=el(intro,'p','cm-error',state.error);error.setAttribute('role','alert');}
 const batch=state.batch;
 if(batch){
  pruneSelection(state);
  const count=AI.counts(batch),history=v.d.imports.find(b=>b.id===batch.id),undone=history&&!history.undoable||batch.restoreBlocked;
  const status=el(section,'div','cm-ai-result');status.setAttribute('role','status');status.setAttribute('aria-live','polite');el(status,'strong','',`本次导入 ${count.total} 笔`+(count.flagged?`，AI 疑点 ${count.flagged} 笔`:''));
  el(status,'small','cm-muted',batch.name+` · 已确认 ${count.confirmed} · 已排除 ${count.excluded+count.skipped}`+(undone?' · 本批次已撤销':''));
  const files=el(status,'details');el(files,'summary','','已识别文件与提示');for(const f of batch.files)el(files,'p','cm-muted',f.name+' · '+(f.source==='alipay'?'支付宝':f.source==='wechat'?'微信':'Excel')+' · '+f.count+' 笔');for(const f of batch.skipped)el(files,'p','cm-muted','未选用 '+f.name+'：'+f.reason);
  if(undone)el(section,'p','cm-muted','这批入账已移入回收站；如需继续处理剩余记录，请重新选择原账单。');
  const pendingCount=count.ready+count.review+count.unknown;if(pendingCount){const metrics=el(status,'div','cm-import-metrics');for(const [key,label]of [['ready','可直接确认'],['review','待核实'],['unknown','无法识别'],['excluded','已排除']]){const m=el(metrics,'div');el(m,'strong','',String(count[key]));el(m,'span','',label);}}else{const done=el(status,'div','cm-import-done');el(done,'strong','',undone?'本批次已撤销入账':`本批次已处理完：入账 ${count.confirmed} 笔，排除 ${count.excluded+count.skipped} 笔`);const acts=el(done,'div','cm-actions');if(history?.ids?.length&&!undone)btn(acts,'查看已入账账目',()=>{v.reportBack={tab:'ai',month:v.month,book:v.book};v.drillLabel=batch.name+' · 本批次入账';v.month='';v.tab='entries';v.filters={ids:[...history.ids]};v.page=0;v.selected.clear();v.render();},'cm-primary');btn(acts,'导入下一批',()=>choose(v),'cm-ghost');}
  if(batch.rows.some(r=>r.autoExclusion))el(status,'small','cm-muted','交易关闭及唯一匹配的全额退款两侧已默认排除，可在下方查看依据并恢复。部分退款、未匹配或有歧义的记录仍待核实。');
  Issues.render(v,section,state,H,{refund:()=>RefundUI.check(v),refundCount:Refunds.eligible(batch).length,category:()=>enhance(v,{scope:'all',repeat:true,keys:batch.rows.filter(r=>Issues.matches(r,'category')).map(r=>r.key)}),categoryCount:enhanceCandidates(state,{scope:'all'}).filter(r=>Issues.matches(r,'category')).length,confirm:keys=>confirm(v,state,keys,H)});
  Review.refunds(v,section,state,{...H,edit:row=>edit(v,state,row,H)});
  require('./refund-groups').render(v,section,state,{...H,edit:row=>edit(v,state,row,H)});
  RefundUI.render(v,section,state,{...H,edit:row=>edit(v,state,row,H)});
  Reconcile.render(v,section,state,H);
  el(section,'p','cm-muted cm-bulk-scope','批量操作作用于所有已勾选记录（包括其他页）；切换问题入口会清除勾选。');
  const toolbar=el(section,'div','cm-actions cm-ai-toolbar');
  const high=btn(toolbar,'一键确认全部高置信（'+count.ready+'）',()=>confirm(v,state,batch.rows.filter(r=>r.state==='pending'&&r.group==='ready').map(r=>r.key),H,true),'cm-primary');high.disabled=state.busy||!count.ready||!!undone;
  const bulk=btn(toolbar,'确认所选（'+state.selected.size+'）',()=>confirm(v,state,[...state.selected],H));bulk.disabled=state.busy||!state.selected.size||!!undone;
  const exclude=btn(toolbar,'排除所选（'+state.selected.size+'）',()=>bulkExclude(v,state));exclude.disabled=state.busy||!state.selected.size||!!undone;
  const accountFill=btn(toolbar,'批量补账户',()=>bulkForm(v,state,H,null),'cm-ghost');accountFill.disabled=state.busy||!state.selected.size||!!undone;
  const more=el(toolbar,'details','cm-import-bulk-more');el(more,'summary','','更多批量操作');const moreActions=el(more,'div','cm-actions');
  const extraBulk=[];for(const [label,nature]of [['批量设为转账','transfer'],['批量设为还款','repayment']]){const b=btn(moreActions,label,()=>bulkForm(v,state,H,nature));b.disabled=state.busy||!state.selected.size||!!undone;extraBulk.push(b);}
  const categories=v.d.categories.filter(c=>!c.archived&&['expense','income'].includes(c.type));
  const bulkSelect=el(moreActions,'select','cm-ai-bulk-category');bulkSelect.setAttribute('aria-label','批量修改分类');
  for(const [id,label] of [['','批量修改分类…'],...categories.map(c=>[c.id,CategoryIcons.label(v.d,c.id)])]){const option=el(bulkSelect,'option','',label);option.value=id;}
  bulkSelect.disabled=state.busy||!state.selected.size||!!undone;
  bulkSelect.addEventListener('change',()=>{const id=bulkSelect.value;if(id)return bulkCategory(v,state,id);});
  btn(moreActions,'撤销上次批量操作',()=>undoBulk(v,state),'cm-link').disabled=state.busy||!!undone||state.bulkUndo?.batch!==batch;
  btn(toolbar,'清除选择',()=>{state.selected.clear();v.render();},'cm-link').disabled=state.busy;
 const flagOnly=btn(toolbar,'只看 AI 疑点（'+count.flagged+'）',()=>{state.flagOnly=!state.flagOnly;state.page=0;v.render();},state.flagOnly?'active':'cm-link');
 flagOnly.setAttribute('aria-pressed',String(!!state.flagOnly));flagOnly.disabled=state.busy||!count.flagged;flagOnly.title='只看模型标出疑点的条目';
  const issues=batch.rows.filter(r=>r.state==='pending'&&r.blockers.length).length;const issueButton=btn(toolbar,'仅看无法入账（'+issues+'）',()=>{state.issueFocus='';state.issueOnly=!state.issueOnly;state.page=0;v.render();},'cm-filter-chip'+(state.issueOnly?' active':''));issueButton.setAttribute('aria-pressed',String(!!state.issueOnly));issueButton.disabled=state.busy;const density=btn(toolbar,state.compact?'切换详细视图':'切换紧凑视图',()=>{state.compact=!state.compact;v.render();},'cm-link');density.setAttribute('aria-pressed',String(!!state.compact));
  const tabs=el(section,'div','cm-ai-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','复核分组');
  for(const [group,name]of Object.entries(AI.groupNames)){const b=btn(tabs,name+' · '+count[group],()=>{state.group=group;state.issueFocus='';state.issueOnly=false;state.page=0;v.render();},state.group===group?'active':'');b.setAttribute('aria-pressed',String(state.group===group));}
  const filterBox=el(section,'div','cm-import-filter-box'),filters=el(filterBox,'div','cm-ai-filters'),amountFilters=el(filterBox,'div','cm-ai-filters cm-import-amount-filters'),categoryFilter=el(filters,'select');categoryFilter.setAttribute('aria-label','按分类筛选');
  const categoryCounts=new Map();for(const row of pending(batch))categoryCounts.set(row.entry.category,(categoryCounts.get(row.entry.category)||0)+1);
  for(const [id,label] of [['','全部分类（'+pending(batch).length+'）'],...[...categoryCounts].map(([id,n])=>[id,CategoryIcons.label(v.d,id)+'（'+n+'）'])]){const option=el(categoryFilter,'option','',label);option.value=id;}
  if(state.categoryFilter&&!categoryCounts.has(state.categoryFilter))state.categoryFilter='';categoryFilter.value=state.categoryFilter||'';
  categoryFilter.addEventListener('change',()=>{state.categoryFilter=categoryFilter.value;state.page=0;v.render();});
  const search=el(filters,'input');search.type='search';search.classList.add('cm-ai-search');search.placeholder='搜索商户、摘要、备注或金额';search.setAttribute('aria-label','搜索复核记录');search.value=state.query||'';
  search.disabled=state.busy;bindSearch(search,v,state);
  btn(filters,'清空搜索',()=>{state.query='';state.page=0;v.render();},'cm-link').disabled=!state.query;
  const amount=el(amountFilters,'input','cm-ai-min-amount');amount.type='number';amount.min='0';amount.step='0.01';amount.placeholder='金额大于（元）';amount.setAttribute('aria-label','金额大于（元）');amount.value=Number.isSafeInteger(state.minAmount)?String(state.minAmount/100):'';amount.disabled=state.busy;
  const applyAmount=()=>{try{const value=amount.value.trim();const cents=value===''?null:C.cents(value);if(cents!==null&&cents<0)throw Error('金额下限不能小于零');state.minAmount=cents;state.page=0;state.error='';v.render();}catch(e){state.error=e.message;v.render();}};
  btn(amountFilters,'筛选金额',applyAmount).disabled=state.busy;amount.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyAmount();}});
  for(const value of [100,500,1000]){const active=state.minAmount===value*100,b=btn(amountFilters,'大于 '+value+' 元',()=>{state.minAmount=active?null:value*100;state.page=0;v.render();},'cm-amount-chip'+(active?' active':''));b.setAttribute('aria-pressed',String(active));b.disabled=state.busy;}
  btn(amountFilters,'全部金额',()=>{state.minAmount=null;state.page=0;v.render();},'cm-link').disabled=state.busy||!Number.isSafeInteger(state.minAmount);
  const sort=el(filters,'select','cm-ai-sort');sort.setAttribute('aria-label','复核排序');for(const [value,label]of [['original','原账单顺序'],['amount-desc','金额从大到小'],['amount-asc','金额从小到大'],['date-desc','日期从新到旧'],['date-asc','日期从旧到新']]){const option=el(sort,'option','',label);option.value=value;}sort.value=state.sort||'original';sort.disabled=state.busy;sort.addEventListener('change',()=>{state.sort=sort.value;state.page=0;v.render();});
  const all=visibleRows(batch,state),pages=Math.max(1,Math.ceil(all.length/PAGE));state.page=Math.min(state.page,pages-1);const rows=all.slice(state.page*PAGE,(state.page+1)*PAGE);
  const overview=el(section,'p','cm-muted cm-ai-overview',`共 ${count.total} 笔 · 当前筛选 ${all.length} 笔 · 已选 ${state.selected.size} 笔`);overview.setAttribute('role','status');
  const list=panel(section,state.issueFocus?Issues.options.find(x=>x[0]===state.issueFocus)?.[1]:state.issueOnly?'无法入账（全部分组）':AI.groupNames[state.group]);list.classList.add('cm-ai-queue');if(state.compact)list.classList.add('cm-ai-compact');
  // 选择控件：本页 / 本组全部（跨分页）。两者都是开关，已全选时再点一次即取消。
  const selectable=all,pageSelectable=rows;
  const picks=el(list,'div','cm-ai-picks');
  const pickUpdates=[];
  const picker=(keys,label,labelDone,title)=>{
   const control=btn(picks,label,()=>{const every=keys.length>0&&keys.every(key=>state.selected.has(key));for(const key of keys){if(every)state.selected.delete(key);else state.selected.add(key);}v.render();},'cm-link');
   const sync=()=>{const every=keys.length>0&&keys.every(key=>state.selected.has(key));control.textContent=every?labelDone:label;control.classList.toggle('active',every);control.setAttribute('aria-pressed',String(every));};pickUpdates.push(sync);sync();control.disabled=state.busy||!!undone||!keys.length;control.title=title;return control;};
  picker(pageSelectable.map(r=>r.key),'选择本页（'+pageSelectable.length+'）','取消本页选择（'+pageSelectable.length+'）','选择或取消当前这一页的记录');
  picker(selectable.map(r=>r.key),'全选本组（'+selectable.length+'）','取消全组选择（'+selectable.length+'）','选择当前筛选结果中的全部记录，含未显示的分页');
  const selectNote=el(picks,'small','cm-muted','已选 '+state.selected.size+' 笔，跨分组保留');
  if(!rows.length)el(list,'p','cm-muted',state.flagOnly?'当前分组没有 AI 疑点，可关掉筛选继续处理。':'这个分组已处理完，可以切换其他分组。');
  for(const row of rows){const t=row.entry,line=el(list,'article','cm-ai-row');line.dataset.key=row.key;
   const checkbox=el(line,'input');checkbox.type='checkbox';checkbox.checked=state.selected.has(row.key);checkbox.disabled=state.busy||!!undone;checkbox.setAttribute('aria-label','选择 '+t.title+' '+row.record.line);
   checkbox.addEventListener('change',()=>{checkbox.checked?state.selected.add(row.key):state.selected.delete(row.key);for(const sync of pickUpdates)sync();bulk.textContent='确认所选（'+state.selected.size+'）';bulk.disabled=!state.selected.size;exclude.textContent='排除所选（'+state.selected.size+'）';exclude.disabled=!state.selected.size;bulkSelect.disabled=!state.selected.size;accountFill.disabled=!state.selected.size;selectedAI.textContent='识别所选（'+enhanceCandidates(state,{scope:'selected'}).length+'）';selectedAI.disabled=!enhanceCandidates(state,{scope:'selected'}).length;if(state.enhanceScope==='selected'){const n=enhanceCandidates(state,{scope:'selected'}).length;enhanceBtn.disabled=!n;enhanceBtn.title=n?'分析所选 '+n+' 笔未处理条目':'请先勾选未手改、未处理的记录';actions.querySelector('.cm-ai-enhance-hint').textContent=n?'将分析所选 '+n+' 笔未处理条目':'请先勾选未手改、未处理的记录';}const pair=section.querySelector('.cm-refund-pair-selected');if(pair)pair.disabled=batch.rows.filter(r=>r.state==='pending'&&!r.entry.related&&require('./ai-exclusions').refund(r.record)&&state.selected.has(r.key)).length<2;for(const b of extraBulk)b.disabled=!state.selected.size;selectNote.textContent='已选 '+state.selected.size+' 笔，跨分组保留';overview.textContent=`共 ${count.total} 笔 · 当前筛选 ${all.length} 笔 · 已选 ${state.selected.size} 笔`;});
   const words=el(line,'div','cm-ai-words'),heading=el(words,'div','cm-ai-row-heading'),cat=v.d.categories.find(c=>c.id===t.category);
   el(heading,'span','cm-category-icon',CategoryIcons.display(cat));el(heading,'strong','',t.title);el(heading,'strong','cm-ai-amount',t.amount==null?'金额待补充':(t.currency==='CNY'?'¥':t.currency||'币种待核实')+' '+C.money(t.amount));
   el(words,'p','cm-muted',`${t.date||'日期待补充'} · ${AI.natureNames[row.nature]} · ${CategoryIcons.label(v.d,t.category)} · ${v.d.accounts.find(a=>a.id===t.account)?.name||'账户待选择'}`);
   if(row.origin==='ai')el(words,'span','cm-badge cm-ai-origin','AI 建议');
   if(row.flags?.length)el(words,'span','cm-badge cm-ai-flag','AI 疑点 '+row.flags.length);
   el(words,'span','cm-badge','置信度 '+AI.confidenceNames[row.confidence]);el(words,'p','cm-ai-reasons',row.reasons[0]||'请核实交易内容');const why=el(words,'details','cm-import-help');el(why,'summary','','全部判断依据');for(const reason of row.reasons.slice(1))el(why,'p','cm-muted',reason);
   if(row.recognition?.state==='failed')el(words,'small','cm-error','上次识别未采纳：'+row.recognition.reason);
   if(row.origin==='ai'&&row.reasons.some(x=>/排除|抵消/.test(x))&&row.state==='pending')el(words,'small','cm-warning','AI 建议排除，尚未执行；请在退款核对或排除操作中确认');
   if(row.blockers.length)el(words,'p','cm-error','确认前需处理：'+row.blockers.join('；'));
   const detail=el(words,'details','cm-ai-original');el(detail,'summary','','查看原账单与重复线索');
   el(detail,'p','cm-muted',(row.record.file||batch.name)+' · 第 '+row.record.line+' 行');
   for(const [name,value]of Object.entries(row.record.raw))if(name&&value)el(detail,'p','cm-muted',name+'：'+value);
   for(const dup of row.duplicates)el(detail,'p','cm-muted',`相似 / 重复：${dup.location} · ${dup.date||'无日期'} · ${dup.title} · ¥ ${C.money(dup.amount)} · ${dup.id}`);
   const controls=el(words,'div','cm-actions');btn(controls,'编辑核实',()=>edit(v,state,row,H)).disabled=state.busy||!!undone;
   btn(controls,'确认入账',()=>confirm(v,state,[row.key],H),'cm-primary').disabled=state.busy||!!undone||!!row.blockers.length;
   const drop=btn(controls,'排除本笔',()=>Workspace.mutate(v,state,()=>{AI.setState(batch,row.key,'excluded');state.selected.delete(row.key);}),'cm-link');drop.disabled=state.busy||!!undone;drop.title='这笔不入账，移到下方「已处理」列表；随时可以点「回到复核」把它捞回来';
  }
  if(all.length>PAGE)v.pager(list,state.page,pages,page=>{state.page=page;v.render();});
  const processed=batch.rows.filter(r=>r.state!=='pending');if(processed.length){const done=el(section,'details','cm-card cm-ai-processed');done.open=!!state.processedOpen;done.addEventListener('toggle',()=>state.processedOpen=done.open);el(done,'summary','',`已处理 ${processed.length} 笔（可恢复「排除」）`);state.donePage=Math.min(state.donePage||0,Math.max(0,Math.ceil(processed.length/PAGE)-1));for(const row of processed.slice(state.donePage*PAGE,(state.donePage+1)*PAGE)){const item=el(done,'div','cm-list-row');item.dataset.key=row.key;el(item,'span','',(row.entry.date||'日期待核实')+' · '+row.entry.title+' · '+row.entry.currency+' '+(row.entry.amount===null?'金额待核实':C.money(row.entry.amount))+' · '+({confirmed:undone?'已撤销入账':'已确认',skipped:'已排除',excluded:'已排除'})[row.state]);if(row.autoExclusion){el(item,'small','cm-muted',row.autoExclusion.reason);if(row.autoExclusion.kind==='refund'){const linked=el(item,'details','cm-import-help');el(linked,'summary','','查看退款配对');for(const key of row.autoExclusion.keys){const other=batch.rows.find(r=>r.key===key);if(other)el(linked,'p','cm-muted',AI.natureNames[other.nature]+' · '+other.entry.date+' · '+other.entry.title+' · '+other.entry.currency+' '+C.money(other.entry.amount));}}}if(row.state!=='confirmed')btn(item,'回到复核',()=>Workspace.mutate(v,state,()=>{AI.setState(batch,row.key,'pending');AI.refresh(batch,v.d);state.group=row.group;state.page=0;}),'cm-link').disabled=state.busy||!!undone;}if(processed.length>PAGE)v.pager(done,state.donePage,Math.ceil(processed.length/PAGE),page=>{state.donePage=page;v.render();});}
 }
 const histories=v.d.imports.filter(b=>b.source==='ai-import'&&b.book===v.book);
 if(histories.length){const history=panel(section,'AI 导入批次','分次确认仍属于同一批次，可整批撤销');for(const b of [...histories].reverse()){const row=el(history,'div','cm-list-row');el(row,'span','',b.name+' · '+b.count+' 笔'+(b.undoable?'':' · 已撤销'));if(b.undoable)btn(row,'撤销这批导入',()=>new Confirm(v.p,'撤销 AI 导入',`这批仍存在的账目将移到回收站，包括之后的修改。批次共 ${b.count} 笔；有其他关联退款时须先处理关联记录。`,async()=>{await v.p.change(d=>{AI.undo(d,b.id);});Workspace.sync(state,v.d);await Workspace.persist(v,state);v.render();}).open()).disabled=state.busy;}}
}
module.exports={checkRefunds:RefundUI.check,checkRefundsLocal:RefundUI.checkLocal,applyRefunds:RefundUI.apply,render,choose,importFile,stateFor,edit,save,enhance,visibleRows,pruneSelection,bulkExclude,bulkCategory,bulkUpdate,bulkForm,undoBulk,stop,bindSearch,confirm,enhanceCandidates};
