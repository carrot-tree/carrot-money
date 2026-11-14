'use strict';
const C=require('./core');
const names=new Set(['set_budget']);
function preview(d,book,name,args){
 if(!names.has(name)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['amount','period','category','start'].includes(k)))throw Error('预算参数无效');
 if(!d.books.some(b=>b.id===book&&!b.archived))throw Error('当前账本不可用');
 if(!Number.isSafeInteger(args.amount)||args.amount<=0||!['week','month','year'].includes(args.period))throw Error('请明确预算周期和大于零的人民币整数分金额');
 const category=args.category||'';if(category&&!d.categories.some(c=>c.id===category&&c.type==='expense'&&!c.archived))throw Error('请选择可用支出分类或总预算');
 if(args.start!==undefined&&!C.validDate(args.start))throw Error('仅一期预算须提供明确日期');
 const start=args.start?C.range(args.period,args.start)[0]:'',old=d.budgets.find(b=>b.book===book&&b.period===args.period&&(b.category||'')===category&&(b.start||'')===start);
 const item={...(old||{}),book,period:args.period,category,amount:args.amount};if(start)item.start=start;
 const label=(category?C.categoryName(d,category):'总预算')+' · '+(start?C.range(args.period,start).join(' 至 '):'每'+({week:'周',month:'月',year:'年'})[args.period]+'循环');
 return {ok:true,intent:'agent_write',name,book,request:C.clone(args),item,before:old?C.clone(old):null,actionName:'设置预算',count:1,amount:args.amount,rows:[{oldStr:old?'¥ '+C.money(old.amount):'未设置',newStr:'¥ '+C.money(args.amount),title:label,reason:start?'仅影响这个周期；其他月份或周期的预算保持':'按同一周期循环应用，不改写历史账目'}],message:'这是预算预览，确认后保存。'+(start?'仅本期生效。':'按周期循环生效。'),facts:[]};
}
function apply(d,plan){
 const fresh=preview(d,plan.book,plan.name,plan.request);if(JSON.stringify(fresh.item)!==JSON.stringify(plan.item)||JSON.stringify(fresh.before)!==JSON.stringify(plan.before))throw Error('预算已变化，请重新预览');
 const item={...fresh.item,id:fresh.before?.id||C.uid()},draft=C.clone(d),at=draft.budgets.findIndex(b=>b.id===item.id);if(at<0)draft.budgets.push(item);else draft.budgets[at]=item;C.validate(draft);d.budgets=draft.budgets;
 return {name:plan.name,book:plan.book,id:item.id,item:C.clone(item),before:fresh.before,count:1};
}
function undo(d,r){
 const current=d.budgets.find(b=>b.id===r.id&&b.book===r.book);if(!current||JSON.stringify(current)!==JSON.stringify(r.item))return {restored:0,skipped:1};
 const draft=C.clone(d),at=draft.budgets.findIndex(b=>b.id===r.id);if(r.before)draft.budgets[at]=C.clone(r.before);else draft.budgets.splice(at,1);C.validate(draft);d.budgets=draft.budgets;return {restored:1,skipped:0};
}
module.exports={names,preview,apply,undo};
