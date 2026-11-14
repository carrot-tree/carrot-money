'use strict';
const C=require('./core'),Icons=require('./category-icons');
// A transaction row shows the original cash movement, even when its source is
// a consumption projection that allocates later refunds to the purchase date.
function cashAmount(t){
 if(t.kind==='legacy'){const parts=[];if(t.legacyIncome!=null)parts.push('收入 ¥ '+C.money(t.legacyIncome));if(t.legacyExpense!=null)parts.push('支出 ¥ '+C.money(t.legacyExpense));return {text:parts.join(' / ')||'金额未注明',tone:'balance'};}
 const sign=t.kind==='transfer'?'↔ ':t.kind==='expense'||t.amount<0?'− ':t.amount>0?'+ ':'',unit=t.currency==='CNY'?'¥ ':t.currency+' ';
 return {text:sign+unit+C.money(Math.abs(t.amount)),tone:t.kind==='expense'?'expense':t.kind==='income'?'income':'balance'};
}
function compactMoney(cents){
 const amount=Math.abs(cents)/100,rounded=amount>=100?Number(amount.toPrecision(2)):amount;
 for(const [scale,unit]of [[1e12,'万亿'],[1e11,'千亿'],[1e8,'亿'],[1e7,'千万'],[1e4,'万'],[1e3,'千']])if(rounded>=scale)return Number((rounded/scale).toPrecision(2))+unit;
 return String(rounded);
}
function sorted(rows,mode='date-desc'){
 const date=(a,b)=>!a.date?(!b.date?0:1):!b.date?-1:(mode==='date-asc'?a.date.localeCompare(b.date):b.date.localeCompare(a.date));
 return [...rows].sort(mode.startsWith('amount-')?(a,b)=>(mode==='amount-asc'?1:-1)*(Math.abs(C.base(a))-Math.abs(C.base(b)))||date(a,b):date);
}
function chips(d,f){const list=[];for(const [key,name,value]of [['query','搜索',f.query],['category','分类',f.category&&Icons.label(d,f.category)],['account','账户',f.account&&(d.accounts.find(a=>a.id===f.account)?.name||f.account)],['kind','类型',C.kinds[f.kind]],['person','人物',f.person],['tag','标签',f.tag],['start','从',f.start],['end','至',f.end],['min','最低金额',f.min==null?'':'¥ '+C.money(f.min)],['max','最高金额',f.max==null?'':'¥ '+C.money(f.max)],['review','状态',f.review?'待核对':'']])if(value)list.push({key,label:name+' · '+value});return list;}
function render(v,p,H){const {el,btn,field}=H,box=el(p,'section','cm-card cm-ledger-search'),search=el(box,'div','cm-ledger-search-row'),query=field(search,'搜索账单','search',v.filters.query||'');query.placeholder='说明、商家、备注、分类或标签';
 const update=()=>{v.page=0;v.selected.clear();v.render();},submit=()=>{v.filters={...v.filters,query:query.value.trim()};update();};btn(search,'搜索',submit,'cm-primary');query.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();submit();}});
 const shortcuts=el(box,'div','cm-ledger-shortcuts');for(const [value,name]of [['','全部类型'],['expense','支出'],['income','收入'],['transfer','转账'],['refund','退款']]){const b=btn(shortcuts,name,()=>{v.filters={...v.filters,kind:v.filters.kind===value?'':value};update();},'cm-filter-chip'+((v.filters.kind||'')===value?' active':''));b.setAttribute('aria-pressed',String((v.filters.kind||'')===value));}
 const order=field(shortcuts,'流水排序','select',v.entrySort||'date-desc',[['date-desc','日期从新到旧'],['date-asc','日期从旧到新'],['amount-desc','金额从大到小'],['amount-asc','金额从小到大']]);order.addEventListener('change',()=>{v.entrySort=order.value;update();});
 const applied=chips(v.d,v.filters),scope=el(box,'div','cm-ledger-scope');el(scope,'span','cm-muted',v.month?v.month+' · 所选月份':v.filters.start||v.filters.end?(v.filters.start||'不限起点')+' — '+(v.filters.end||'不限终点'):'全部时间');for(const x of applied){const b=btn(scope,x.label+' ×',()=>{const next={...v.filters};delete next[x.key];v.filters=next;update();},'cm-filter-chip active');b.setAttribute('aria-label','移除筛选：'+x.label);}if(applied.length)btn(scope,'清除全部筛选',()=>{v.drillLabel='';v.filters={};update();},'cm-link');
 require('./ledger-filters').render(v,box,H);
 return query;
}
function changeMonth(v,month){const next={...v.filters};for(const key of ['start','end','ids','metric'])delete next[key];v.drillLabel='';v.reportBack=null;v.filters=next;v.month=month;v.page=0;v.selected.clear();}
function deletePlan(d,id){
 const original=d.entries.find(t=>t.id===id);if(!original)throw Error('这笔账目已不存在，请关闭后刷新');
 const rows=[original,...d.entries.filter(t=>t.related===id&&['refund','reimbursement'].includes(t.kind))];
 return {id,title:original.title||C.kinds[original.kind],ids:rows.map(t=>t.id),signatures:rows.map(t=>JSON.stringify(t)),related:rows.slice(1).map(t=>t.title||C.kinds[t.kind])};
}
function deleteEntry(d,plan){if(JSON.stringify(deletePlan(d,plan.id))!==JSON.stringify(plan))throw Error('账目或关联记录已变化，请重新打开删除预览');C.removeEntries(d,plan.ids);}
function batchEntries(d,ids,values){
 const selected=new Set(ids),rows=d.entries.filter(t=>selected.has(t.id));if(rows.length!==selected.size)throw Error('所选账目已变化，请重新选择');
 if(values.category&&rows.some(t=>['refund','reimbursement'].includes(t.kind)&&!selected.has(t.related)))throw Error('修改退款 / 报销分类时，请同时选择原支出');
 for(const source of rows){const t=C.clone(source);for(const key of ['category','account','person'])if(values[key])t[key]=values[key];if(values.tags)t.tags=[...new Set([...t.tags,...C.list(values.tags)])];C.putEntry(d,t);}
}
function costSummary(parent,d,t,el){
 if(t.kind!=='expense')return;const s=C.expenseSummary(d,t),box=el(parent,'section','cm-cost-summary');el(box,'h4','','这笔消费');const fields=el(box,'dl','cm-cost-summary-values');
 for(const [label,value]of [['原付',s.paid],['已退',s.refund],...(s.reimbursement?[['已报销',s.reimbursement]]:[]),['净支出',s.net]]){const item=el(fields,'div');el(item,'dt','cm-muted',label);el(item,'dd','',t.currency+' '+C.money(value));}
 el(box,'small','cm-muted','退款 / 报销回冲原消费日；原始金额和流水日期保留。');return s;
}
module.exports={render,sorted,chips,changeMonth,deletePlan,deleteEntry,batchEntries,costSummary,cashAmount,compactMoney};
