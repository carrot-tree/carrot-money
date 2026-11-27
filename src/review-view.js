'use strict';
const C=require('./core'),Insights=require('./insights');
function render(v,p,H){const {el,btn,drill}=H;
 const saved=el(p,'div','cm-saved-reports'),strip=el(saved,'div','cm-saved-strip');el(strip,'strong','cm-label','常用分析');
 const items=(v.d.settings.savedReports||[]).filter(x=>x.book===v.book),list=el(strip,'div','cm-saved-chips');
 if(!items.length)el(list,'span','cm-muted','保存常看的范围与筛选，一点即用');
 for(const item of items){const chip=el(list,'span','cm-saved-chip');const apply=btn(chip,item.name,()=>{v.month=item.month;v.report=C.clone(item.state);v.render();},'cm-link');apply.setAttribute('title',item.month+' · '+item.name);const remove=btn(chip,'×',()=>v.p.change(d=>{d.settings.savedReports=d.settings.savedReports.filter(x=>x.id!==item.id);}),'cm-link');remove.setAttribute('aria-label','移除分析：'+item.name);}
 const form=el(saved,'div','cm-report-save-form');form.hidden=!v.reportSaveOpen;
 const name=el(form,'input');name.placeholder='例如：本月餐饮支出';name.setAttribute('aria-label','分析名称');name.maxLength=50;name.value=v.reportSaveName||'';name.addEventListener('input',()=>v.reportSaveName=name.value);
 const saveToggle=btn(strip,'保存当前分析',()=>{v.reportSaveOpen=!v.reportSaveOpen;form.hidden=!v.reportSaveOpen;saveToggle.setAttribute('aria-expanded',String(v.reportSaveOpen));if(v.reportSaveOpen)name.focus();},'cm-link');saveToggle.setAttribute('aria-expanded',String(!!v.reportSaveOpen));
 btn(form,'保存',async()=>{await v.p.change(d=>{Insights.saveReport(d,v.book,v.month||C.today().slice(0,7),v.report,name.value);},{afterSave:()=>{v.reportSaveOpen=false;v.reportSaveName='';}});},'cm-primary');
 const month=v.month||C.today().slice(0,7),box=el(p,'details','cm-month-review'),heading=el(box,'summary','cm-review-summary');
 box.open=!!v.monthReviewOpen;el(heading,'strong','','月度复盘 · '+month);let mounted=false;
 const expand=()=>{if(!box.open||mounted)return;mounted=true;
 const r=Insights.monthly(v.d,v.book,month,v.report),metrics=el(heading,'span','cm-review-summary-metrics');
 for(const [k,label]of [['income','收入'],['expense','支出'],['net','结余']]){const m=el(metrics,'span','cm-review-summary-metric');el(m,'span','',label+' ¥'+C.money(r.current[k]));const delta=r.current[k]-r.prior[k];el(m,'small','cm-muted','较上月 '+(delta>=0?'+':'')+'¥'+C.money(delta));}
 el(heading,'span','cm-review-expand','详情');
 el(box,'p','cm-muted',`复盘固定比较 ${r.month} 与上一个完整月份，沿用分类、账户、人物和标签筛选。${r.undated} 笔无日期未计入。`);
 el(box,'p','cm-muted',r.rows.length?`本月 ${r.rows.length} 笔，日均支出 ¥ ${C.money(r.current.dailyAverage)}，有消费的日子 ${r.current.activeDays} 天。`:'这个月还没有符合筛选条件的记录。');
 if(r.current.largest){const x=r.current.largest;btn(box,'最大单笔：'+x.t.title+' · ¥ '+C.money(x.value),()=>v.details(x.t),'cm-link');}
 el(box,'h4','','变化最大的分类');for(const g of r.changes.slice(0,5)){const line=el(box,'div','cm-review-change');el(line,'strong','',g.label);el(line,'small','cm-muted','上月 '+C.money(g.previous)+' → 本月 '+C.money(g.current));btn(line,(g.delta>=0?'+':'')+C.money(g.delta)+' · 看明细',()=>{const ids=new Set(g.ids);return drill(v,r.rows.filter(t=>ids.has(t.id)),r.range,g.label+' · 月度复盘','expense');},'cm-link');}
 const actions=el(box,'div','cm-actions');btn(actions,'查看本月全部明细',()=>drill(v,r.rows,r.range,r.month+' 月度复盘'),'cm-link');btn(actions,'导出月度复盘 Markdown',()=>v.p.export(Insights.markdown(r),'月度复盘-'+r.month,'md'),'cm-link');
 };box.addEventListener('toggle',()=>{if(box.isConnected===false)return;v.monthReviewOpen=box.open;expand();});expand();
}
module.exports={render};
