'use strict';
const {setIcon}=require('obsidian');
function node(p,tag,cls,text){return p.createEl(tag,{cls,text});}
function button(p,text,label,fn){const b=node(p,'button','',text);b.type='button';b.setAttribute('aria-label',label);b.addEventListener('click',e=>{e.preventDefault();fn();});return b;}
function outsideClose(control,details){
 const doc=control.ownerDocument,close=e=>{if(!control.contains(e.target))details.open=false;},remove=()=>doc?.removeEventListener('pointerdown',close,true);
 details.addEventListener('toggle',()=>{remove();if(details.open&&control.isConnected!==false)doc?.addEventListener('pointerdown',close,true);});
 details.cmDispose=()=>{details.open=false;remove();};
}
function dispose(root){for(const details of root.querySelectorAll('.cm-day-picker,.cm-month-picker'))details.cmDispose?.();}
function focusLabel(root,label){
 const nodes=[...root.querySelectorAll('[aria-label]')];
 (nodes.find(x=>x.getAttribute('aria-label')===label&&!x.disabled)||root.querySelector('summary'))?.focus({preventScroll:true});
}
// Month arithmetic uses integer offsets (including year 0000), never local time/DST.
function shiftMonth(value,offset){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||!Number.isInteger(offset))return null;
 const [year,month]=value.split('-').map(Number),index=year*12+month-1+offset;
 if(index<0||index>9999*12+11)return null;
 return String(Math.floor(index/12)).padStart(4,'0')+'-'+String(index%12+1).padStart(2,'0');
}
function monthMode(value,mode){
 mode=mode||(value?'month':'all');
 return {mode,enabled:mode!=='all'&&mode!=='custom',months:mode!=='year',message:mode==='custom'?'自定义日期 · 年月切换停用':'全部时间 · 年月切换停用'};
}
function monthPicker(p,value,onChange,label='当前月份',options={}){
 const state=monthMode(value,options.mode),control=node(p,'div','cm-month-control');control.dataset.mode=state.mode;control.setAttribute('role','group');control.setAttribute('aria-label',label);
 if(!state.enabled){control.addClass('cm-month-inactive');control.setAttribute('aria-disabled','true');node(control,'span','cm-month-status',state.message);return control;}
 const scope=p.parentElement||p;
 const change=(next,buttonLabel)=>{onChange(next);if(control.isConnected===false)focusLabel(scope.isConnected===false?(options.focusRoot?.()||scope):scope,buttonLabel);};
 const current=value||new Date().toISOString().slice(0,7);let year=Number(current.slice(0,4)),monthTrigger,opener;
 const yearGroup=node(control,'div','cm-month-segment cm-month-year-segment');
 function step(parent,text,name,offset){const next=shiftMonth(current,offset),b=button(parent,text,name,()=>{if(next!==null)change(next,name);});b.disabled=next===null;return b;}
 step(yearGroup,'‹','上一年',-12);
 const picker=node(yearGroup,'details','cm-month-picker'),summary=node(picker,'summary','','');summary.setAttribute('aria-label',label+' · '+current+' · 选择年月');summary.setAttribute('aria-haspopup','dialog');node(summary,'span','',current.slice(0,4)+'年');node(summary,'span','cm-month-chevron','⌄');
 outsideClose(control,picker);
 const popup=node(picker,'div','cm-month-popover');popup.setAttribute('role','dialog');popup.setAttribute('aria-label','选择月份');
 function close(){picker.open=false;}
 const render=()=>{popup.empty();const head=node(popup,'div','cm-month-year');const prev=button(head,'‹','选月弹层上一年',()=>{if(year>0){year--;render();focusLabel(popup,'选月弹层上一年');}});prev.disabled=year===0;node(head,'strong','',String(year).padStart(4,'0')+'年');const next=button(head,'›','选月弹层下一年',()=>{if(year<9999){year++;render();focusLabel(popup,'选月弹层下一年');}});next.disabled=year===9999;const grid=node(popup,'div','cm-month-grid');for(let i=1;i<=12;i++){const month=String(year).padStart(4,'0')+'-'+String(i).padStart(2,'0');const b=button(grid,i+'月',year+'年'+i+'月',()=>{close();change(month,label+' · '+month+' · 选择年月');});b.classList.toggle('active',month===current);b.setAttribute('aria-pressed',String(month===current));}};
 step(yearGroup,'›','下一年',12);
 if(state.months){const group=node(control,'div','cm-month-segment cm-month-number-segment');step(group,'‹','上个月',-1);monthTrigger=button(group,current.slice(5)+'月 ⌄','选择月份 · '+current,()=>{opener=monthTrigger;picker.open=!picker.open;});monthTrigger.addClass('cm-month-trigger');monthTrigger.setAttribute('aria-haspopup','dialog');monthTrigger.setAttribute('aria-expanded','false');step(group,'›','下个月',1);}
 summary.addEventListener('click',()=>opener=summary);
 picker.addEventListener('toggle',()=>{control.classList.toggle('cm-month-open',picker.open);monthTrigger?.setAttribute('aria-expanded',String(picker.open));if(picker.open){year=Number(current.slice(0,4));render();}});
 control.addEventListener('keydown',e=>{if(e.key==='Escape'&&picker.open){e.preventDefault();close();(opener||summary).focus();}});
 render();return control;
}
module.exports={monthPicker,shiftMonth,monthMode,dispose,focusLabel};

// 日选择保留标准 ISO 值，外观与月份控件共用日历图标和强调色。
function dateInput(p,label,value=''){
 const C=require('./core'),wrap=node(p,'div','cm-date-control'),input=node(wrap,'input');input.type='text';input.value=value||'';input.placeholder='YYYY-MM-DD';input.setAttribute('aria-label',label);input.autocomplete='off';input.inputMode='numeric';
 const picker=node(wrap,'details','cm-day-picker'),trigger=node(picker,'summary');trigger.setAttribute('aria-label','选择'+label);trigger.setAttribute('aria-haspopup','dialog');setIcon(trigger,'calendar-days');
 const popup=node(wrap,'div','cm-day-popover');popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label',label+'日历');outsideClose(wrap,picker);let month=(C.validDate(value)?value:C.today()).slice(0,7);
 const choose=date=>{input.value=date;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));picker.open=false;input.focus({preventScroll:true});};
 const render=()=>{popup.empty();const head=node(popup,'div','cm-date-heading');const shift=n=>{const next=shiftMonth(month,n);if(next){month=next;render();focusLabel(popup,n<0?'日历上个月':'日历下个月');}};button(head,'‹','日历上个月',()=>shift(-1));const caption=node(head,'div','cm-day-caption');
 const year=node(caption,'select');year.setAttribute('aria-label','日历年份');const selected=Number(month.slice(0,4)),now=Number(C.today().slice(0,4));for(let y=Math.min(selected,now-100);y<=Math.max(selected,now+20);y++){const o=node(year,'option','',y+'年');o.value=String(y);}year.value=String(selected);year.addEventListener('change',()=>{month=String(year.value).padStart(4,'0')+'-'+month.slice(5);render();focusLabel(popup,'日历年份');});
 const mo=node(caption,'select');mo.setAttribute('aria-label','日历月份');for(let m=1;m<=12;m++){const o=node(mo,'option','',m+'月');o.value=String(m).padStart(2,'0');}mo.value=month.slice(5);mo.addEventListener('change',()=>{month=month.slice(0,4)+'-'+mo.value;render();focusLabel(popup,'日历月份');});button(head,'›','日历下个月',()=>shift(1));
 const grid=node(popup,'div','cm-day-grid');for(const name of ['一','二','三','四','五','六','日'])node(grid,'small','cm-day-week',name);const start=(new Date(month+'-01T12:00:00Z').getUTCDay()+6)%7;for(let n=0;n<start;n++)node(grid,'span');const last=Number(C.range('month',month+'-01')[1].slice(-2));for(let n=1;n<=last;n++){const date=month+'-'+String(n).padStart(2,'0'),b=button(grid,String(n),date,()=>choose(date));b.classList.toggle('active',date===input.value);b.setAttribute('aria-pressed',String(date===input.value));if(date===C.today())b.setAttribute('aria-current','date');}const foot=node(popup,'div','cm-day-footer');button(foot,'今天','选择今天',()=>choose(C.today()));button(foot,'清空','清空'+label,()=>choose(''));};
 picker.addEventListener('toggle',()=>{popup.hidden=!picker.open;trigger.setAttribute('aria-expanded',String(picker.open));if(picker.open){month=(C.validDate(input.value)?input.value:C.today()).slice(0,7);render();if(wrap.closest('.cm-modal'))popup.scrollIntoView({block:'nearest',behavior:'instant'});}});trigger.setAttribute('aria-expanded','false');wrap.addEventListener('keydown',e=>{if(e.key==='Escape'&&picker.open){e.preventDefault();e.stopPropagation();picker.open=false;trigger.focus({preventScroll:true});}});render();return input;
}
module.exports.dateInput=dateInput;
