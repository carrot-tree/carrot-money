'use strict';
const C=require('./core');
const dayMs=86400000;
const days=(a,b)=>Math.round((Date.parse(b+'T12:00:00Z')-Date.parse(a+'T12:00:00Z'))/dayMs);
const shift=(at,n)=>new Date(Date.parse(at+'T12:00:00Z')+n*dayMs).toISOString().slice(0,10);
function forecast(d,book,start=C.today(),horizon=30,subscriptions=false){
 if(!C.validDate(start)||![30,90,365].includes(horizon))throw Error('预测日期或范围无效');
 const end=shift(start,horizon-1),rows=C.dueRules(d,end,book).filter(t=>t.date>=start&&(!subscriptions||d.rules.find(r=>r.id===t.ruleId)?.subscription)).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title));
 return {start,end,rows,...C.totals(rows)};
}
function settle(d,book,ruleId,date,action,at=C.today()){
 if(!['post','skip'].includes(action)||!C.validDate(at)||date>at)throw Error('只能处理已到期账单');
 const r=d.rules.find(r=>r.id===ruleId&&r.entry.book===book&&r.enabled);
 if(!r)throw Error('计划不存在、已暂停或不属于当前账本');
 const row=C.dueRules(d,date,book).find(t=>t.ruleId===ruleId&&t.date===date);
 if(!row)throw Error('这期账单已处理或日期不在计划中，请刷新后重试');
 if(action==='post')d.entries.push(row);else r.skipped=[...(r.skipped||[]),date];
 advance(d,r);return row;
}
function advance(d,r){
 const consumed=new Set([...d.entries,...d.trash].map(t=>t.id)),skipped=new Set(r.skipped||[]);let guard=0;
 while(r.remaining!==0&&(consumed.has('rule-'+r.id+'-'+r.next)||skipped.has(r.next))){
  if(++guard>5000)throw Error('计划跨度过长，请检查下次日期');
  r.next=C.nextDate(r.next,r.frequency,r.anchor);if(r.remaining!=null)r.remaining--;
 }
 if(r.remaining===0)r.enabled=false;
}
function budgetPace(d,b,anchor,at=C.today(),spending=C.spendingIndex(d,b.book)){
 const use=C.budgetUsage(d,b,anchor,spending),totalDays=days(use.start,use.end)+1;
 const phase=at<use.start?'future':at>use.end?'past':'current';
 const elapsed=phase==='past'?totalDays:phase==='future'?0:days(use.start,at)+1;
 const remainingDays=phase==='past'?0:phase==='future'?totalDays:days(at,use.end)+1;
 // 未来日期的账目不代表今天已花掉的金额，进度比较仅取截至今天。
 const spentToDate=phase==='future'?0:spending(b.category,use.start,at<use.end?at:use.end);
 const expected=Math.round(b.amount*elapsed/totalDays),ahead=phase==='current'&&spentToDate>expected;
 return {...use,totalDays,elapsed,remainingDays,phase,spentToDate,expected,ahead,daily:remainingDays?Math.floor(Math.max(0,use.left)/remainingDays):0};
}
function goalPlan(g,at=C.today()){
 const saved=g.opening+g.contributions.reduce((n,x)=>n+x.amount,0),left=Math.max(0,g.target-saved),complete=g.target>0&&left===0;
 const remainingDays=g.deadline?days(at,g.deadline):null;
 const months=g.deadline&&remainingDays>=0?Math.max(1,(Number(g.deadline.slice(0,4))-Number(at.slice(0,4)))*12+Number(g.deadline.slice(5,7))-Number(at.slice(5,7))+1):null;
 return {saved,left,complete,remainingDays,months,monthly:months?Math.ceil(left/months):null,overdue:!complete&&remainingDays!==null&&remainingDays<0};
}
module.exports={forecast,settle,advance,budgetPace,goalPlan,days,shift};
