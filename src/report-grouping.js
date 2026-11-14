'use strict';
const C=require('./core'),Icons=require('./category-icons'),A=require('./analytics'),Insights=require('./insights');
const options=[['date','不分组'],['category','类别'],['account','账户'],['person','人物'],['payee','商家'],['tag','标签']];
function groups(d,rows,dimension='category',level='leaf'){
 if(!options.some(([key])=>key===dimension&&key!=='date'))throw Error('请选择有效的分组属性');
 const map=new Map();for(const t of rows){const {income,expense}=C.impact(t);if(!income&&!expense)continue;let keys;
 if(dimension==='tag')keys=[...new Set(t.tags||[])];else if(dimension==='category'){let id=t.category||'';if(level==='parent')id=d.categories.find(c=>c.id===id)?.parent||id;keys=[id];}else if(dimension==='account')keys=[t.splits?.length?'__split':t.account||''];else keys=[t[dimension]||''];if(!keys.length)keys=[''];
 for(const key of keys){let label;if(dimension==='category')label=key?Icons.label(d,key):'未分类';else if(dimension==='account')label=key==='__split'?'组合付款':d.accounts.find(a=>a.id===key)?.name||'未指定账户';else label=key||{person:'未注明人物',payee:'未注明商家',tag:'无标签'}[dimension];
 if(!map.has(key))map.set(key,{key,label,income:0,expense:0,net:0,count:0,ids:[]});const g=map.get(key);g.income+=income;g.expense+=expense;g.net+=income-expense;g.count++;g.ids.push(t.id);}
 }return [...map.values()].sort((a,b)=>b.expense-a.expense||b.income-a.income||a.label.localeCompare(b.label,'zh-CN'));
}
function csv(slots){const quote=s=>'"'+String(s).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';return '\uFEFF分组,收入,净支出,结余,笔数\r\n'+slots.map(b=>[quote(b.label),(b.income/100).toFixed(2),(b.expense/100).toFixed(2),(b.net/100).toFixed(2),b.count].join(',')).join('\r\n');}
// Tag combinations keep each time column additive: every entry contributes once.
function timeline(d,rows,start,end,grain,dimension,level='leaf',cumulative=false){
 const normalized=dimension==='tag'?rows.map(t=>{const tags=[...new Set(t.tags||[])].sort();return {...t,tags:tags.length?[tags.join(' / ')]:[]};}):rows;
 const data=A.buckets(normalized,start,end,grain);if(cumulative)data.slots=Insights.cumulative(data.slots);
 const byId=new Map(normalized.map(t=>[t.id,t]));data.groups=groups(d,normalized,dimension,level);data.slots=data.slots.map(b=>({...b,groups:groups(d,b.ids.map(id=>byId.get(id)),dimension,level)}));return data;
}
// Soft colours match the existing chart palette; keys retain colour across months.
function color(key){let hash=0;for(const ch of String(key))hash=(hash*31+ch.codePointAt(0))>>>0;hash=Math.imul(hash^(hash>>>16),0x45d9f3b)>>>0;const category=/^cat-(\d+)$/.exec(String(key)),hue=category?(274+Number(category[1])*137.508)%360:hash%360;return 'hsl('+hue.toFixed(1)+' 52% 69%)';}
function context(state){return state.barGroup==='category'?'category:'+(state.barLevel||'leaf'):state.barGroup;}
function hidden(state){return state.barHidden?.[context(state)]||[];}
function toggle(state,key){const keys=hidden(state);state.barHidden={...state.barHidden,[context(state)]:keys.includes(key)?keys.filter(k=>k!==key):[...keys,key]};}
function showAll(state){state.barHidden={...state.barHidden,[context(state)]:[]};}
function isolate(state,key,groups){state.barHidden={...state.barHidden,[context(state)]:groups.filter(g=>g.key!==key).map(g=>g.key)};}
function invert(state,groups){const old=new Set(hidden(state));state.barHidden={...state.barHidden,[context(state)]:groups.filter(g=>!old.has(g.key)).map(g=>g.key)};}
function shown(data,keys=[]){if(!keys.length)return {...data,filtered:false};const hide=new Set(keys),groups=data.groups.filter(g=>!hide.has(g.key));return {...data,filtered:keys.length>0,groups,slots:data.slots.map(b=>{const parts=b.groups.filter(g=>!hide.has(g.key)),ids=[...new Set(parts.flatMap(g=>g.ids))];return {...b,groups:parts,ids,count:ids.length,...Object.fromEntries(['income','expense','net'].map(k=>[k,parts.reduce((n,g)=>n+g[k],0)]))};})};}
function timelineCSV(data){const quote=s=>'"'+String(s).replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';return '\uFEFF日期开始,日期结束,分组,收入,净支出,结余,笔数\r\n'+data.slots.flatMap(b=>b.groups.map(g=>[b.start,b.end,quote(g.label),(g.income/100).toFixed(2),(g.expense/100).toFixed(2),(g.net/100).toFixed(2),g.count].join(','))).join('\r\n');}
module.exports={options,groups,csv,timeline,color,timelineCSV,context,hidden,toggle,showAll,shown,isolate,invert};
