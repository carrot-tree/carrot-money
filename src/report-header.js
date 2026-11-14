'use strict';
const CategoryIcons=require('./category-icons');
const C=require('./core'),Controls=require('./controls');
// Display descriptors only. Actual filtering remains in reports.rangeFilter/core.filter.
function appliedFilters(d,state){
 const items=[];
 if(state.category)items.push({key:'category',label:'分类',value:CategoryIcons.label(d,state.category)});
 if(state.account)items.push({key:'account',label:'账户',value:d.accounts.find(a=>a.id===state.account)?.name||state.account});
 if(state.person)items.push({key:'person',label:'人物',value:state.person});
 if(state.tag)items.push({key:'tag',label:'标签',value:state.tag});
 if(state.mode==='custom')items.push({key:'date',label:'日期',value:(state.start||'未设置')+' — '+(state.end||'未设置')});
 return items;
}
function render(v,p,H){const {el,btn,select}=H,state=v.report;
 const box=el(p,'section','cm-card cm-report-toolbar');
 const quick=el(box,'div','cm-report-quick-ranges');for(const [mode,name]of [['month','按月看'],['year','按年看'],['last12','近 12 个月'],['custom','自定义']]){const b=btn(quick,name,()=>{state.mode=mode;v.render();},'cm-filter-chip'+(state.mode===mode?' active':''));b.setAttribute('aria-pressed',String(state.mode===mode));}
 btn(quick,'回到本月',()=>{v.month=C.today().slice(0,7);state.mode='month';v.render();},'cm-link');
 const bar=el(box,'div','cm-report-range-row');
 const anchor=el(bar,'div','cm-field');anchor.addClass('cm-report-month-field');el(anchor,'span','cm-label',state.mode==='year'?'基准年份':'基准月份');Controls.monthPicker(anchor,v.month||C.today().slice(0,7),value=>{v.month=value;v.render();},'报表基准月份',{mode:state.mode});
 if(state.mode==='custom'){
  for(const [key,name]of [['start','开始日期'],['end','结束日期']]){const l=el(bar,'label','cm-field');el(l,'span','cm-label',name);const input=el(l,'input');input.type='date';input.value=state[key];input.setAttribute('aria-label','报表'+name);input.addEventListener('change',()=>state[key]=input.value);}
  btn(bar,'应用日期',()=>v.render(),'mod-cta');
 }
 const chips=el(box,'div','cm-report-filter-chips'),applied=appliedFilters(v.d,state);
 const fields=el(box,'div','cm-report-filter-fields');fields.hidden=!state.filtersOpen;
 const toggles=[];
 function open(value,focus){state.filtersOpen=value;fields.hidden=!value;for(const b of toggles)b.setAttribute('aria-expanded',String(value));if(focus)focus.focus();}
 function toggle(label,focus){const b=btn(chips,label,()=>open(focus?true:!state.filtersOpen,focus),'cm-filter-chip');b.setAttribute('aria-expanded',String(!!state.filtersOpen));toggles.push(b);return b;}
 toggle(applied.length?'筛选 · 已应用 '+applied.length+' 项':'筛选 · 全部账目');
 const controls={};
 for(const [key,label,options]of [
  ['category','分类',[['','全部分类'],...v.d.categories.map(c=>[c.id,CategoryIcons.label(v.d,c.id)])]],
  ['account','账户',[['','全部账户'],...v.d.accounts.map(a=>[a.id,a.name])]],
  ['person','人物',[['','所有人'],...[...new Set(v.d.entries.map(t=>t.person).filter(Boolean))].map(x=>[x,x])]],
  ['tag','标签',[['','所有标签'],...[...new Set(v.d.entries.flatMap(t=>t.tags))].sort().map(x=>[x,x])]]
 ])controls[key]=select(fields,label,options,state[key],x=>{state[key]=x;v.render();});
 btn(fields,'重置条件',()=>{state.category=state.account=state.person=state.tag='';v.render();},'cm-ghost');
 // All four entry points stay visible even when no condition is selected.
 for(const [key,label]of [['category','分类'],['account','账户'],['person','人物'],['tag','标签']]){const item=applied.find(x=>x.key===key);const b=toggle(label+(item?' · '+item.value:''),controls[key]);if(item){b.addClass('active');const remove=btn(chips,'×',()=>{state[key]='';v.render();},'cm-filter-remove');remove.setAttribute('aria-label','移除分析筛选：'+item.label+' · '+item.value);}}
 if(applied.some(x=>x.key!=='date'))btn(chips,'清除筛选',()=>{state.category=state.account=state.person=state.tag='';v.render();},'cm-link');
 const date=applied.find(x=>x.key==='date');if(date)el(chips,'span','cm-filter-chip active',date.label+' · '+date.value);
 return box;
}
module.exports={render,appliedFilters};
