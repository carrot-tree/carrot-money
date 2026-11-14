'use strict';
const C=require('./core'),AI=require('./ai-import');
const names={posted:'本批已入账',duplicate:'确定重复 / 回收站',suspect:'疑似重复',unposted:'未入账待复核',dismissed:'已排除',inconsistent:'状态需核对'};
function postedTotals(rows,d){
 const entries=new Map(d.entries.map(t=>[t.id,t])),totals={},seen=new Set();
 for(const row of rows){const t=entries.get(row.entry.id);if(!t||seen.has(t.id)||!Number.isSafeInteger(t.amount)||!C.currencies.includes(t.currency))continue;seen.add(t.id);
  const g=totals[t.currency]??={income:0,expense:0,refund:0,transfer:0,count:0};g.count++;
  const key=['refund','reimbursement'].includes(t.kind)?'refund':t.kind;if(Object.hasOwn(g,key))g[key]+=t.amount;
 }
 return totals;
}
function summarize(batch,d,{refreshed=false}={}){
 if(!refreshed)AI.refresh(batch,d);
 const groups=Object.fromEntries(Object.keys(names).map(k=>[k,{rows:[],currencies:{},invalidAmounts:0,invalidCurrencies:0}]));
 const history=d.imports.find(b=>b.id===batch.id&&b.source==='ai-import'&&b.book===batch.book),ids=new Set(history?.ids||[]),entries=new Map(d.entries.map(t=>[t.id,t])),trash=new Map(d.trash.map(t=>[t.id,t]));
 for(const row of batch.rows){let kind;
  if(['skipped','excluded'].includes(row.state))kind='dismissed';
  else if(row.state==='confirmed')kind=ids.has(row.entry.id)&&entries.get(row.entry.id)?.book===batch.book?'posted':ids.has(row.entry.id)&&trash.get(row.entry.id)?.book===batch.book?'duplicate':'inconsistent';
  else kind=row.issues?.includes('duplicate')?'duplicate':row.issues?.includes('suspect')?'suspect':'unposted';
  const group=groups[kind];group.rows.push(row);const amount=row.entry.amount,currency=row.entry.currency;
  if(!Number.isSafeInteger(amount)||amount<=0){group.invalidAmounts++;continue;}
  if(!C.currencies.includes(currency)){group.invalidCurrencies++;continue;}
  // Separate currencies; never add an imprecise or fabricated amount.
  const sum=group.currencies[currency]??0;group.currencies[currency]=sum===null||!Number.isSafeInteger(sum+amount)?null:sum+amount;
 }
 return {total:batch.rows.length,groups,postedTotals:postedTotals(groups.posted.rows,d)};
}
function locate(v,state,row){
 if(state.busy||!state.batch.rows.includes(row))return;
 state.selected.clear();if(row.state==='pending'){state.group=row.group;state.page=Math.floor(state.batch.rows.filter(r=>r.state==='pending'&&r.group===row.group).indexOf(row)/20);}
 else{state.processedOpen=true;state.donePage=Math.floor(state.batch.rows.filter(r=>r.state!=='pending').indexOf(row)/20);}
 v.render();const target=[...(v.contentEl?.querySelectorAll('.cm-ai-row, .cm-ai-processed [data-key]')||[])].find(e=>e.dataset.key===row.key);target?.scrollIntoView({block:'center',behavior:'auto'});
}
function render(v,parent,state,H){
 const {el,btn}=H,result=summarize(state.batch,v.d,{refreshed:true}),box=el(parent,'details','cm-card cm-ai-reconcile');box.open=!!state.reconcileOpen;box.addEventListener('toggle',()=>state.reconcileOpen=box.open);
 el(box,'summary','',`本批导入对账 · 未入账 ${result.groups.unposted.rows.length} · 确定重复 ${result.groups.duplicate.rows.length} · 疑似重复 ${result.groups.suspect.rows.length}`);
 el(box,'p','cm-muted','只核对所选文件与现有账目 / 回收站，不推断平台账单是否完整，也不补造缺失历史。金额按当前复核值、分币种汇总，不是收入或支出净额。');
 for(const [currency,g]of Object.entries(result.postedTotals))el(box,'p','cm-import-posted-totals',`本批已入账 ${g.count} 笔 · ${currency} 收入 ${C.money(g.income)} · 支出 ${C.money(g.expense)} − 退款 / 报销 ${C.money(g.refund)} = 净支出 ${C.money(g.expense-g.refund)}${g.transfer?' · 转账 '+C.money(g.transfer)+'（不计收支）':''}`);
 const tabs=el(box,'div','cm-ai-reconcile-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','本批对账分组');
 state.reconcileGroup=Object.hasOwn(names,state.reconcileGroup)?state.reconcileGroup:'unposted';
 for(const [key,name]of Object.entries(names)){const b=btn(tabs,name+' · '+result.groups[key].rows.length,()=>{state.reconcileGroup=key;state.reconcilePage=0;state.reconcileOpen=true;v.render();},state.reconcileGroup===key?'active':'');b.setAttribute('aria-pressed',String(state.reconcileGroup===key));b.disabled=state.busy;}
 const group=result.groups[state.reconcileGroup],totals=Object.entries(group.currencies).map(([currency,amount])=>currency+' '+(amount===null?'合计超出安全范围':C.money(amount)));
 el(box,'p','cm-muted',totals.length?'金额合计：'+totals.join(' / '):'没有可汇总的有效金额');if(group.invalidAmounts)el(box,'p','cm-muted',group.invalidAmounts+' 笔金额缺失 / 非正数，未计入金额合计');
 if(group.invalidCurrencies)el(box,'p','cm-muted',group.invalidCurrencies+' 笔币种无法识别，未计入金额合计');
 const pages=Math.max(1,Math.ceil(group.rows.length/20));state.reconcilePage=Math.min(state.reconcilePage||0,pages-1);
 for(const row of group.rows.slice(state.reconcilePage*20,(state.reconcilePage+1)*20)){const line=el(box,'div','cm-ai-reconcile-row');el(line,'span','',(row.entry.date||'日期待核实')+' · '+row.entry.title+' · '+(row.entry.amount===null?'金额待核实':row.entry.currency+' '+C.money(row.entry.amount)));btn(line,'定位复核记录',()=>locate(v,state,row),'cm-link').disabled=state.busy;}
 if(!group.rows.length)el(box,'p','cm-muted','此分组没有记录。');
 if(pages>1)v.pager(box,state.reconcilePage,pages,page=>{state.reconcilePage=page;state.reconcileOpen=true;v.render();});
}
module.exports={names,summarize,postedTotals,locate,render};
