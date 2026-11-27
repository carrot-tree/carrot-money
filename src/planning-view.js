'use strict';
const C=require('./core'),P=require('./planning');
function render(v,p,H){
 const {el,btn,panel,field,Confirm}=H;
 const state=v.planState ||= {horizon:30,subscriptions:false,page:0,duePage:0};
 let due=[];try{due=C.dueRules(v.d,C.today(),v.book).sort((a,b)=>a.date.localeCompare(b.date));}catch(e){el(p,'p','cm-error',e.message);}
 const banner=panel(p,'到期账单',`${due.length} 笔待确认`);
 el(banner,'p','cm-muted','逐笔确认后才记账；跳过会消耗当前一期，但不产生收支。暂停计划不会生成待确认项目。');
 if(!due.length)el(banner,'p','cm-muted','已经处理完啦，目前没有到期账单。');
 const count=Math.max(1,Math.ceil(due.length/10));state.duePage=Math.min(state.duePage,count-1);
 for(const t of due.slice(state.duePage*10,state.duePage*10+10)){
  const row=el(banner,'div','cm-plan-row'),words=el(row,'div','cm-plan-words');
  el(words,'strong','',t.title);el(words,'small','cm-muted',t.date+' · '+C.kinds[t.kind]+' · '+(v.d.accounts.find(a=>a.id===t.account)?.name||'未指定账户'));
  el(row,'strong','',t.currency+' '+C.money(t.amount));const actions=el(row,'div','cm-actions');
  btn(actions,'确认入账',()=>new Confirm(v.p,'确认这期账单',`${t.date} · ${t.title} · ${t.currency} ${C.money(t.amount)}`,()=>v.p.change(d=>{P.settle(d,v.book,t.ruleId,t.date,'post');})).open(),'cm-primary');
  btn(actions,'跳过本期',()=>new Confirm(v.p,'跳过这期账单','不产生账目；剩余期数减少一期，下次日期按原周期延续。已跳过的期次可在计划中查看。',()=>v.p.change(d=>{P.settle(d,v.book,t.ruleId,t.date,'skip');})).open(),'cm-link');
 }
 if(due.length>10)v.pager(banner,state.duePage,count,n=>{state.duePage=n;v.render();});
 if(due.length)btn(banner,'确认全部到期账单入账',()=>new Confirm(v.p,'确认周期入账',`将新增 ${due.length} 笔，请先核对金额、账户与日期。`,()=>v.p.change(d=>{C.postDue(d,C.today(),v.book);})).open(),'cm-link');
 const forecast=panel(p,'未来账单','只计算启用的周期计划，不代表全部未来消费');
 const controls=el(forecast,'div','cm-actions cm-plan-controls'),horizon=field(controls,'预测范围','select',state.horizon,[[30,'未来 30 天'],[90,'未来 90 天'],[365,'未来 365 天']]);horizon.addEventListener('change',()=>{state.horizon=Number(horizon.value);state.page=0;v.render();});
 const filter=btn(controls,state.subscriptions?'仅看订阅 ✓':'仅看订阅',()=>{state.subscriptions=!state.subscriptions;state.page=0;v.render();},state.subscriptions?'active':'');filter.setAttribute('aria-pressed',String(state.subscriptions));
 let projection;try{projection=P.forecast(v.d,v.book,C.today(),state.horizon,state.subscriptions);}catch(e){el(forecast,'p','cm-error',e.message);return;}
 const metrics=el(forecast,'div','cm-plan-metrics');for(const [label,value]of [['预计支出',projection.expense],['预计收入',projection.income],['预计结余',projection.income-projection.expense]]){const item=el(metrics,'div');el(item,'small','cm-muted',label);el(item,'strong','','¥ '+C.money(value));}
 el(forecast,'p','cm-muted',projection.start+' — '+projection.end+' · '+projection.rows.length+' 期 · 按已设汇率折算人民币；转账不计收支。');
 const pages=Math.max(1,Math.ceil(projection.rows.length/15));state.page=Math.min(state.page,pages-1);
 for(const t of projection.rows.slice(state.page*15,state.page*15+15)){const row=el(forecast,'div','cm-plan-row'),words=el(row,'div','cm-plan-words');el(words,'strong','',t.title);el(words,'small','cm-muted',t.date+' · '+C.kinds[t.kind]);el(row,'strong','',t.currency+' '+C.money(t.amount));btn(row,'查看计划',()=>{const r=v.d.rules.find(r=>r.id===t.ruleId);v.ruleDetails(r);},'cm-link');}
 if(!projection.rows.length)el(forecast,'p','cm-muted','这个范围内没有计划账单。');
 if(projection.rows.length>15)v.pager(forecast,state.page,pages,n=>{state.page=n;v.render();});
}
module.exports={render};
