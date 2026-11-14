'use strict';
const C=require('./core'),Subscriptions=require('./ai-subscriptions'),Entries=require('./ai-entry-actions'),Budgets=require('./ai-budget-actions');
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function preview(d,book,name,args){
 if(Entries.names.has(name))return Entries.preview(d,book,name,args);
 if(Budgets.names.has(name))return Budgets.preview(d,book,name,args);
 if(Subscriptions.names.has(name))return Subscriptions.preview(d,book,name,args);
 if(!d.books.some(b=>b.id===book&&!b.archived))throw Error('当前账本不存在或已归档');
 if(!object(args))throw Error('工具参数无效');
 const allowed={create_category:['name','type','parent'],create_account:['name','type'],delete_entries:['ids']}[name];
 if(!allowed||Object.keys(args).some(k=>!allowed.includes(k)))throw Error('工具参数字段无效');
 if(name==='create_category'||name==='create_account'){
  const label=name==='create_category'?'分类':'账户',value=String(args.name||'').trim();
  if(typeof args.name!=='string'||!value||value.length>50)throw Error(label+'名称须为 1 至 50 字');
  if(typeof args.type!=='string'||!args.type.trim()||args.type.length>40)throw Error(label+'类型无效');
  if(name==='create_category'&&!['expense','income'].includes(args.type))throw Error('分类须选择收入或支出类型');
  if(name==='create_account'&&d.accounts.some(a=>a.name.trim()===value))throw Error('已存在同名账户');
  if(name==='create_category'&&d.categories.some(c=>c.name.trim()===value&&c.type===args.type&&c.parent===(args.parent||'')))throw Error('已存在同名分类');
  let parent='';if(name==='create_category'&&args.parent){const p=d.categories.find(c=>c.id===args.parent);if(!p||p.parent||p.type!==args.type)throw Error('父分类不存在或类型不一致');parent=p.id;}
  const item=name==='create_category'?{name:value,type:args.type,parent}:{name:value,type:args.type,currency:'CNY'};
  return {ok:true,intent:'agent_write',name,book,item,actionName:'新建'+label,count:1,amount:0,rows:[{oldStr:'无',newStr:`${value} · ${name==='create_category'?(args.type==='income'?'收入':'支出')+(parent?' · '+C.categoryName(d,parent):''):'人民币 · '+args.type}`}],message:'这是预览，尚未新建。',facts:[]};
 }
 if(!Array.isArray(args.ids)||!args.ids.length||args.ids.length>500||args.ids.some(id=>typeof id!=='string'||!id)||new Set(args.ids).size!==args.ids.length)throw Error('删除须提供 1 至 500 个不重复的账目 ID');
 const rows=args.ids.map(id=>d.entries.find(t=>t.id===id&&t.book===book));if(rows.some(x=>!x))throw Error('部分记录不存在于当前账本');
 const ids=new Set(args.ids);if(d.entries.some(t=>t.book===book&&t.related&&ids.has(t.related)&&!ids.has(t.id)))throw Error('关联退款或报销须与原账目一起删除');
 const amount=rows.reduce((n,t)=>n+C.base(t),0);if(!Number.isSafeInteger(amount))throw Error('删除合计超出安全范围');
 return {ok:true,intent:'agent_write',name,book,ids:[...args.ids],signatures:rows.map(t=>JSON.stringify(t)),count:rows.length,amount,rows:rows.map(t=>({id:t.id,date:t.date,title:t.payee||t.title,amount:t.amount,currency:t.currency,oldStr:'账本',newStr:'回收站'})),actionName:'移入回收站',message:'这是预览，尚未删除。',facts:[]};
}
function withSelection(d,plan,ids){
 if(Entries.names.has(plan.name))return Entries.withSelection(d,plan,ids);
 if(plan.name!=='delete_entries'||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!plan.ids.includes(id)))throw Error('请选择预览内的记录');
 const full=preview(d,plan.book,plan.name,{ids:plan.ids});
 if(JSON.stringify(full.signatures)!==JSON.stringify(plan.signatures))throw Error('记录已变化，请重新预览');
 preview(d,plan.book,plan.name,{ids});
 return {...plan,selectionIds:plan.ids.filter(id=>ids.includes(id))};
}
function apply(d,plan){
 if(Entries.names.has(plan.name))return Entries.apply(d,plan);
 if(Budgets.names.has(plan.name))return Budgets.apply(d,plan);
 if(Subscriptions.names.has(plan.name))return Subscriptions.apply(d,plan);
 const args=plan.name==='delete_entries'?{ids:plan.ids}:plan.name==='create_account'?{name:plan.item.name,type:plan.item.type}:plan.item;
 const fresh=preview(d,plan.book,plan.name,args);
 if(plan.name==='delete_entries'){
  if(JSON.stringify(fresh.signatures)!==JSON.stringify(plan.signatures))throw Error('记录已变化，请重新预览');
  const ids=plan.selectionIds?withSelection(d,plan,plan.selectionIds).selectionIds:plan.ids;
  const order=d.entries.map(t=>t.id);   // 删除前的完整顺序，撤销时按它还原位置
  const draft=C.clone(d);C.removeEntries(draft,ids);C.validate(draft);d.entries=draft.entries;d.trash=draft.trash;return {name:plan.name,book:plan.book,ids:[...ids],order,count:ids.length};
 }
 if(JSON.stringify(fresh.item)!==JSON.stringify(plan.item))throw Error('预览已变化，请重新预览');
 const id=C.uid(),item=plan.name==='create_category'?{id,...plan.item,icon:'🧾',archived:false}:{id,...plan.item,opening:0,rate:1,archived:false};
 const table=plan.name==='create_category'?'categories':'accounts',draft=C.clone(d);draft[table].push(item);C.validate(draft);d[table]=draft[table];
 return {name:plan.name,book:plan.book,id,item:C.clone(item),count:1};
}
function undo(d,receipt){
 if(Entries.names.has(receipt.name))return Entries.undo(d,receipt);
 if(Budgets.names.has(receipt.name))return Budgets.undo(d,receipt);
 if(Subscriptions.names.has(receipt.name))return Subscriptions.undo(d,receipt);
 if(receipt.name==='delete_entries'){
  const ids=receipt.ids.filter(id=>d.trash.some(t=>t.id===id&&t.book===receipt.book));
  if(!ids.length)return {restored:0,skipped:receipt.ids.length};
  const draft=C.clone(d);C.restoreEntries(draft,ids);
  // 恢复回原来的位置（而不是一律追加到末尾），这样撤销后数据逐字节还原
  if(Array.isArray(receipt.order)&&receipt.order.length){
   const idx=new Map(receipt.order.map((id,i)=>[id,i]));
   draft.entries.sort((a,b)=>{const ia=idx.has(a.id)?idx.get(a.id):null,ib=idx.has(b.id)?idx.get(b.id):null;if(ia===null&&ib===null)return 0;if(ia===null)return 1;if(ib===null)return -1;return ia-ib;});
  }
  C.validate(draft);d.entries=draft.entries;d.trash=draft.trash;return {restored:ids.length,skipped:receipt.ids.length-ids.length};
 }
 const table=receipt.name==='create_category'?'categories':'accounts',current=d[table].find(x=>x.id===receipt.id);
 if(!current||JSON.stringify(current)!==JSON.stringify(receipt.item))return {restored:0,skipped:1};
 const used=receipt.name==='create_category'?[...d.entries,...d.trash,...d.categories,...d.budgets,...d.templates,...d.rules].some(x=>x!==current&&JSON.stringify(x).includes(receipt.id)):[...d.entries,...d.trash,...d.templates,...d.rules].some(x=>JSON.stringify(x).includes(receipt.id));
 if(used)return {restored:0,skipped:1};
 const draft=C.clone(d);draft[table]=draft[table].filter(x=>x.id!==receipt.id);C.validate(draft);d[table]=draft[table];return {restored:1,skipped:0};
}
module.exports={withSelection,preview,apply,undo};
