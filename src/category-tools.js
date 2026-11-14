'use strict';
const Icons=require('./category-icons');
// Never search arbitrary string values (notes can contain category IDs).
function hasReference(value,id){if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,v])=>(['category','categoryId'].includes(key)&&v===id)||(['categories','categoryIds'].includes(key)&&Array.isArray(v)&&v.includes(id))||typeof v==='object'&&hasReference(v,id));}
function reasons(d,c,drafts=[]){
 const out=[];if(c.name==='其他')out.push('受保护：CSV 导入与 AI 分类的「其他」兜底');
 for(const [key,label]of [['entries','账目'],['trash','回收站'],['templates','快捷模板'],['rules','周期规则'],['budgets','预算'],['goals','心愿']]){const n=(d[key]||[]).filter(x=>hasReference(x,c.id)).length;if(n)out.push(label+'引用 '+n+' 项');}
 const children=d.categories.filter(x=>x.parent===c.id);if(children.length)out.push('子分类引用：'+children.map(x=>x.name+' ['+x.id+']').join('、'));
 for(const [value,label]of [[d.settings.savedReports,'常用分析'],[d.settings.lastEntry,'记账偏好'],[drafts,'AI 复核草稿']])if(hasReference(value,c.id))out.push(label+'引用');
 return out;
}
function preview(d,mode,ids=null,drafts=[]){
 if(!['delete','icons'].includes(mode))throw Error('未知分类操作');
 const wanted=ids===null?null:new Set(ids),items=d.categories.filter(c=>!wanted||wanted.has(c.id)).map(c=>{
  const item={id:c.id,name:c.name,before:c.icon||'',after:c.icon||'',change:false,reasons:[]};
  if(mode==='delete'){item.reasons=reasons(d,c,drafts);item.change=!item.reasons.length;if(item.change)item.reasons=['无引用，可删除'];}
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
module.exports={hasReference,reasons,preview,apply};
