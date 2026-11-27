'use strict';
const Icons=require('./category-icons');
// Only structured references count. Free text may contain an ID by coincidence.
function references(value,field='category',ids=new Set()){
 if(!value||typeof value!=='object')return ids;
 const plural=field==='category'?'categories':'accounts';
 for(const [key,v] of Object.entries(value)){
  if((key===field||key===field+'Id'||field==='account'&&key==='toAccount')&&typeof v==='string')ids.add(v);
  else if((key===plural||key===field+'Ids')&&Array.isArray(v)){for(const id of v)if(typeof id==='string')ids.add(id);}
  else if(key==='barHidden'&&v){
   const groups=field==='category'?['category:leaf','category:parent']:['account'];
   for(const group of groups)for(const id of Array.isArray(v[group])?v[group]:[])ids.add(id);
  }else if(typeof v==='object')references(v,field,ids);
 }
 return ids;
}
const hasReference=(value,id,field)=>references(value,field).has(id);
function referenceIndex(d,drafts=[]){
 const byId=new Map(),children=new Map();
 const add=(id,label)=>{
  if(!byId.has(id))byId.set(id,new Map());
  const counts=byId.get(id);
  counts.set(label,(counts.get(label)||0)+1);
 };
 const records=[['entries','账目'],['trash','回收站'],['templates','快捷模板'],['rules','周期规则'],['budgets','预算'],['goals','心愿']];
 for(const [key,label] of records)for(const row of d[key]||[])for(const id of references(row))add(id,label);
 for(const c of d.categories)if(c.parent){
  if(!children.has(c.parent))children.set(c.parent,[]);
  children.get(c.parent).push(c.name+' ['+c.id+']');
 }
 const settings=[['savedReports','常用分析'],['lastEntry','记账偏好'],['savedEntryFilters','常用流水筛选'],['chartDefaults','默认图表筛选']];
 for(const [key,label] of settings)for(const id of references(d.settings[key]))add(id,label);
 for(const id of references(drafts))add(id,'AI 复核草稿');
 return {byId,children,records};
}
function reasons(d,c,drafts=[],index=referenceIndex(d,drafts)){
 const out=[];
 if(c.name==='其他')out.push('受保护：CSV 导入与 AI 分类的「其他」兜底');
 const counts=index.byId.get(c.id);
 for(const [,label] of index.records)if(counts?.has(label))out.push(label+'引用 '+counts.get(label)+' 项');
 const children=index.children.get(c.id);
 if(children)out.push('子分类引用：'+children.join('、'));
 for(const label of ['常用分析','记账偏好','常用流水筛选','默认图表筛选','AI 复核草稿'])if(counts?.has(label))out.push(label+'引用');
 return out;
}
function preview(d,mode,ids=null,drafts=[]){
 if(!['delete','icons'].includes(mode))throw Error('未知分类操作');
 const index=mode==='delete'?referenceIndex(d,drafts):null,wanted=ids===null?null:new Set(ids),items=d.categories.filter(c=>!wanted||wanted.has(c.id)).map(c=>{
  const item={id:c.id,name:c.name,before:c.icon||'',after:c.icon||'',change:false,reasons:[]};
  if(mode==='delete'){item.reasons=reasons(d,c,drafts,index);item.change=!item.reasons.length;if(item.change)item.reasons=['无引用，可删除'];}
  else if(!Icons.missing(c.icon))item.reasons=['已有自定义图标，保留'];
  else{const m=Icons.match(c.name);item.reasons=[m.reason];if(m.icon&&m.icon!==c.icon){item.after=m.icon;item.change=true;}else if(m.icon)item.reasons=['已是对应图标，保留'];}
  return item;
 });
 if(wanted&&items.length!==wanted.size)throw Error('分类已不存在，请重新预览');
 return {mode,ids,revision:d.revision,items,count:items.filter(x=>x.change).length};
}
function apply(d,plan,drafts=[]){
 const current=preview(d,plan.mode,plan.ids,drafts);
 if(JSON.stringify(current)!==JSON.stringify(plan))throw Error('分类或引用已变化，请关闭后重新预览');
 if(!current.count)throw Error('没有可执行的分类变更');
 const changes=new Map(current.items.filter(x=>x.change).map(x=>[x.id,x]));
 if(plan.mode==='delete')d.categories=d.categories.filter(c=>!changes.has(c.id));
 else for(const c of d.categories)if(changes.has(c.id))c.icon=changes.get(c.id).after;
}
module.exports={hasReference,referenceIndex,reasons,preview,apply};
