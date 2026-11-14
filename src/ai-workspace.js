'use strict';
const Drafts=require('./ai-drafts');
// Never reuse a real plugin's draft adapter when a test / isolated view borrows
// its prototype with a different in-memory ledger Store.
const storeFor=v=>v.p.drafts?.vault===v.p.store?.vault?v.p.drafts:null;
function redraw(v){if(v.aiClosed||v.p.aiUnloaded)return;const state=stateFor(v);if(v.tab&&v.tab!=='ai'&&(state.enhanceController||state.refundWorking)){require('./import-tasks').refresh(v);return;}v.p.refresh?.();if(!v.p.app?.workspace?.getLeavesOfType?.('carrot-money-dashboard')?.some(l=>l.view===v))v.render();}
function stateFor(v){const store=storeFor(v);if(store)return store.state(v.book,v.d);v.aiStates||=new Map();if(!v.aiStates.has(v.book))v.aiStates.set(v.book,{batch:null,selected:new Set(),group:'ready',page:0,busy:false,progress:null,error:''});return v.aiStates.get(v.book);}
function sync(state,d){if(state.batch)Drafts.reconcile(state.batch,d);}
async function persist(v,state){
 const store=storeFor(v);if(!store)return true;
 state.draftStatus='saving';state.draftError='';redraw(v);
 try{state.draftAt=await store.save(state.batch?.book||v.book,state);state.draftStatus=state.batch?'saved':'empty';return true;}
 catch(e){state.draftStatus='error';state.draftError='未保存：'+e.message;return false;}
 finally{redraw(v);}
}
async function mutate(v,state,fn){
 if(state.busy)return;state.busy=true;state.error='';
 try{fn();await persist(v,state);}finally{state.busy=false;redraw(v);}
}
async function retry(v,state){if(state.busy)return;state.busy=true;try{return await persist(v,state);}finally{state.busy=false;redraw(v);}}
async function clear(v,state){
 if(state.busy)return;state.busy=true;
 try{const store=storeFor(v);if(store)await store.save(v.book,{batch:null});state.batch=null;state.selected.clear();state.error='';state.enhanceMessage='';state.draftError='';state.draftStatus='empty';state.page=0;}
 catch(e){state.draftStatus='error';state.draftError='清除失败，草稿仍保留：'+e.message;}
 finally{state.busy=false;redraw(v);}
}
async function reload(v){const store=storeFor(v);if(!store)return;const state=stateFor(v);if([...store.states.values()].some(s=>s.busy))throw Error('其他复核操作尚未结束，请稍后重新读取');state.busy=true;
 try{if(!await store.load()){state.draftError=store.error;state.draftStatus='error';}}finally{state.busy=false;redraw(v);}
}
function render(v,parent,state,{el,btn,Confirm}){
 const store=storeFor(v);if(!store)return;
 const box=el(parent,'div','cm-ai-draft-status');box.setAttribute('role','status');box.setAttribute('aria-live','polite');
 const error=state.draftError||store.error;
 el(box,'p',error?'cm-error':'cm-muted',error||({saving:'正在保存本地草稿…',saved:'草稿已保存 · '+(state.draftAt?new Date(state.draftAt).toLocaleString():''),empty:'导入后自动保存草稿，关页或重启后可继续核实。'})[state.draftStatus]||'草稿尚未保存');
 if(error)el(box,'p','cm-muted','内存中的修改仍保留。重试保存成功前请勿关闭；文件损坏时保留原件，修复或移出该草稿文件后再重新读取。');
 const actions=el(box,'div','cm-actions');
 if(state.batch&&error)btn(actions,'重试保存草稿',()=>retry(v,state)).disabled=state.busy;
 btn(actions,'重新读取草稿',()=>new Confirm(v.p,'重新读取本地草稿','会放弃所有账本尚未保存的内存复核修改，读取磁盘上的草稿；已入账记录不变。',()=>reload(v)).open(),'cm-link').disabled=state.busy;
 const batch=state.batch;btn(actions,'清除本账本草稿',()=>new Confirm(v.p,'清除复核草稿','只清除本账本的复核队列；不会删除账目，也不会撤销已确认的导入。',()=>{if(state.batch!==batch)throw Error('队列已变化，请重新操作');return clear(v,state);}).open(),'cm-link').disabled=state.busy||!batch;
 if(state.batch?.restoreBlocked)el(box,'p','cm-error',state.batch.restoreWarnings.join('；'));
}
module.exports={storeFor,stateFor,sync,persist,mutate,retry,clear,reload,render,redraw};
