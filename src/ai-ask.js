'use strict';
const CategoryIcons=require('./category-icons');
const C=require('./core'),A=require('./analytics');
const EMPTY='按这些条件没算到',NEEDS_AI='这个问题需要开启 AI 服务才能解析';
const keys=['start','end','metric','dimension','operation','sort','limit','filters'];
const dimensions=['none','category','account','person','tag','entry'];
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const monthRange=month=>A.period('month',month);
const categorySynonyms=Object.freeze({正餐:['吃饭','吃了','用餐'],喝滴:['奶茶','咖啡','喝的'],交通:['打车','地铁','公交'],汽车:['加油','充电'],日用滴:['超市','日用'],住:['房租','水电'],医疗:['医院','药'],娱乐:['电影','游戏']});
function validate(q,d,book,{remote=false}={}){
 if(!d.books.some(b=>b.id===book&&!b.archived))throw Error('账本不存在或已归档');
 if(!object(q)||Object.keys(q).some(k=>!keys.includes(k))||keys.some(k=>!own(q,k)))throw Error('查询字段缺失或不支持');
 if(!C.validDate(q.start)||!C.validDate(q.end)||q.start>q.end||A.days(q.start,q.end)>3660)throw Error('日期范围无效或超过十年');
 if(!['expense','income','both'].includes(q.metric)||!dimensions.includes(q.dimension)||!['total','rank','max','compare','average'].includes(q.operation)||!['asc','desc'].includes(q.sort)||!Number.isInteger(q.limit)||q.limit<1||q.limit>20)throw Error('查询方式无效');
 if(!object(q.filters)||Object.keys(q.filters).some(k=>!['category','account','person','tag'].includes(k)))throw Error('过滤条件不支持');
 const rows=d.entries.filter(t=>t.book===book);
 for(const [key,value]of Object.entries(q.filters)){
  if(typeof value!=='string'||!value)throw Error('过滤值缺失');
  if(remote&&['person','tag'].includes(key))throw Error('人物和标签条件请使用本地明确问法');
  const exists=key==='category'?d.categories.some(c=>c.id===value):key==='account'?d.accounts.some(a=>a.id===value):key==='person'?rows.some(t=>t.person===value):rows.some(t=>t.tags.includes(value));
  if(!exists)throw Error('分类、账户、人物或标签不存在');
 }
 if(q.metric==='both'&&(q.operation!=='total'||q.dimension!=='none'))throw Error('收支合计不能与此查询组合');
 if(['compare','average'].includes(q.operation)){
  const r=monthRange(q.start.slice(0,7));if(q.start!==r.start||q.end!==r.end||q.dimension!=='none')throw Error('对比和日均须为完整单月、不分组');
 }
 if(q.operation==='max'&&(q.dimension!=='entry'||q.sort!=='desc'||q.limit!==1)||q.operation==='rank'&&q.dimension==='none'||q.dimension==='entry'&&!['rank','max'].includes(q.operation))throw Error('排名维度无效');
 return C.clone(q);
}
function parseLocal(question,d,book,now=C.today()){
 let s=String(question).trim().replace(/[\s，,。？！?!：:「」“”]/g,'');if(!s||s.length>500)return null;
 let compare=false;
 s=s.replace(/(?:(?:比|与)上(?:个)?月(?:相比|比较|对比)?|和上(?:个)?月(?:相比|比较|对比))/g,()=>{compare=true;return '';});
 const parsed=parseMonth(s,now);if(!parsed)return null;
 const {range}=parsed;s=parsed.rest;
 const q={start:range.start,end:range.end,metric:'expense',dimension:'none',operation:compare?'compare':'total',sort:'desc',limit:5,filters:{}};
 let dimCount=0;s=s.replace(/(?:按|各个?|每个)(分类|账户|人物|标签)/g,(_,name)=>{dimCount++;q.dimension=({分类:'category',账户:'account',人物:'person',标签:'tag'})[name];return '';});if(dimCount>1)return null;
 // Explicit named filters avoid fuzzy matches or dropping unknown conditions.
 const entities={category:d.categories.map(c=>({value:c.id,names:[C.categoryName(d,c.id).replace(/\s/g,''),c.name]})),account:d.accounts.map(a=>({value:a.id,names:[a.name]})),person:[...new Set(d.entries.filter(t=>t.book===book).map(t=>t.person).filter(Boolean))].map(n=>({value:n,names:[n]})),tag:[...new Set(d.entries.filter(t=>t.book===book).flatMap(t=>t.tags))].map(n=>({value:n,names:[n]}))};
 for(const [type,label]of Object.entries({category:'分类',account:'账户',person:'人物',tag:'标签'})){
  const candidates=entities[type].flatMap(e=>e.names.map(name=>({...e,name:name.replace(/\s/g,'')}))).sort((a,b)=>b.name.length-a.name.length);
  if(s.includes(label)){
   const hit=candidates.find(e=>s.includes(label+e.name));if(!hit||candidates.filter(e=>e.name===hit.name&&e.value!==hit.value).length)return null;
   q.filters[type]=hit.value;s=s.replace(label+hit.name,'');
  }
 }
 if(!q.filters.category){
  const aliases=[...entities.category.flatMap(e=>e.names.map(name=>({value:e.value,name:name.replace(/\s/g,'')}))),...entities.category.filter(e=>e.names.includes('餐饮')).flatMap(e=>['吃饭','餐费','伙食'].map(name=>({value:e.value,name}))),...d.categories.filter(c=>c.type==='expense'&&!c.archived).flatMap(c=>(categorySynonyms[c.name]||[]).map(name=>({value:c.id,name})))].sort((a,b)=>b.name.length-a.name.length);
  const hit=aliases.find(e=>s.includes(e.name));if(hit){if(aliases.some(e=>e.name===hit.name&&e.value!==hit.value))return null;q.filters.category=hit.value;s=s.replace(hit.name,'');}
 }
 const both=/收支/.test(s),income=/收入|赚了|挣了/.test(s),expense=/支出|消费|花|餐费/.test(s);if(income&&expense&&!both)return null;q.metric=both?'both':income?'income':!expense&&d.categories.find(c=>c.id===q.filters.category)?.type==='income'?'income':'expense';
 if(/日均|平均每天|每天平均/.test(s)){if(compare)return null;q.operation='average';s=s.replace(/日均|平均每天|每天平均/g,'');}
 if(!compare&&/多花|少花/.test(s))return null;
 const n=s.match(/(?:前|最大)(\d+|[一二三四五六七八九十])(?:笔|项|名)/);if(n){if(compare||q.operation==='average')return null;const nval=/^\d+$/.test(n[1])?Number(n[1]):'一二三四五六七八九十'.indexOf(n[1])+1;q.limit=nval;s=s.replace(n[0],'');q.operation='rank';if(q.dimension==='none')q.dimension='entry';}
 if(/最大单笔|最大一笔|单笔最大/.test(s)){if(compare||q.operation==='average'||q.operation==='rank')return null;q.operation='max';q.dimension='entry';q.limit=1;s=s.replace(/最大单笔|最大一笔|单笔最大/g,'');}
 else if(/哪几笔|最大|排名|排行/.test(s)){if(compare||q.operation==='average')return null;q.operation='rank';if(q.dimension==='none')q.dimension='entry';s=s.replace(/哪几笔|最大|排名|排行/g,'');}
 if(/升序|从小到大/.test(s)&&/降序|从大到小/.test(s))return null;
 if(/升序|从小到大/.test(s)){q.sort='asc';s=s.replace(/升序|从小到大/g,'');}
 s=s.replace(/降序|从大到小|帮我看看|帮我查|请问|请|告诉我|总共|一共|合计|总额|总计|收入|支出|支出|消费|收支|花了|花费|花|赚了|挣了|多少钱|多少|金额|多|少|了|的|是多少|是|情况/g,'');
 if(s)return null;
 if(q.operation==='total'&&q.dimension!=='none')q.limit=20;
 try{return validate(q,d,book);}catch{return null;}
}
function parseMonth(question,now=C.today()){
 let s=String(question).trim().replace(/[\s，,。？！?!：:「」“”]/g,'');if(!s||s.length>500)return null;
 let month,matched=0;
 s=s.replace(/(\d{4})[年\/-](\d{1,2})月?/g,(_,y,m)=>{matched++;month=y+'-'+m.padStart(2,'0');return '';});
 s=s.replace(/本月|这个月|当月|上个月|上月/g,t=>{matched++;month=t.startsWith('上')?A.shift(now.slice(0,7)+'-01',-1).slice(0,7):now.slice(0,7);return '';});
 if(!matched)s=s.replace(/(\d{1,2})月/g,(_,m)=>{matched++;month=now.slice(0,4)+'-'+m.padStart(2,'0');return '';});
 if(matched!==1)return null;
 try{return {month,range:monthRange(month),rest:s};}catch{return null;}
}
function safeTotals(rows){
 // Check intermediate totals too; existing core arithmetic is used only within
 // its exact safe-integer range. Refuse overflow instead of fabricating a sum.
 let income=0n,expense=0n;
 for(const t of rows){const v=C.impact(t);if(!Number.isSafeInteger(v.income)||!Number.isSafeInteger(v.expense))throw Error('金额超出安全计算范围');income+=BigInt(v.income);expense+=BigInt(v.expense);if([income,expense].some(x=>x>BigInt(Number.MAX_SAFE_INTEGER)||x< -BigInt(Number.MAX_SAFE_INTEGER)))throw Error('合计超出安全计算范围');}
 return C.totals(rows);
}
function compute(query,d,book){
 let q;try{q=validate(query,d,book);}catch(e){return {ok:false,message:EMPTY+'：'+e.message,facts:[]};}
 try{
  const range={start:q.start,end:q.end},scope={book,...q.filters,...range},all=C.consumption(d,scope),rows=all.filter(t=>q.metric==='both'?C.impact(t).income!==0||C.impact(t).expense!==0:C.impact(t)[q.metric]!==0);
  if(!rows.length)return {ok:false,query:q,message:EMPTY+'，请调整时间或筛选条件。',facts:[]};
  const totals=safeTotals(rows),facts=[],metric=q.metric==='income'?'收入':'支出';
  const fact=(label,value,items,unit='money',r=range)=>{if(!Number.isSafeInteger(value))throw Error('计算结果超出安全范围');facts.push({label,value,unit,ids:items.map(t=>t.id),range:r});};
  const sum=(items)=>safeTotals(items)[q.metric];
  if(q.operation==='compare'){
   const r=monthRange(q.start.slice(0,7)),priorRange={start:r.previousStart,end:r.previousEnd},prior=C.consumption(d,{...scope,...priorRange}).filter(t=>C.impact(t)[q.metric]!==0);
   if(!prior.length)return {ok:false,query:q,message:EMPTY+'：上月没有符合条件的记录，不能补零比较。',facts:[]};
   const previous=sum(prior),comparison=A.comparison(totals[q.metric],previous);
   fact('所选月'+metric,totals[q.metric],rows);fact('上月'+metric,previous,prior,'money',priorRange);fact('较上月变化',comparison.delta,[...prior,...rows],'money',{start:priorRange.start,end:q.end});
  }else if(q.operation==='average'){
   const r=monthRange(q.start.slice(0,7)),n=q.metric==='expense'?A.insights(rows,r).dailyAverage:Math.round(totals.income/r.days);
   fact('日均'+metric,n,rows);fact('完整月份天数（除数）',r.days,rows,'days');fact('月份'+metric,totals[q.metric],rows);
  }else if(q.dimension!=='none'){
   let groups;
   if(q.dimension==='entry')groups=rows.map(t=>({label:t.date+' · '+(t.title||C.categoryName(d,t.category)),displayLabel:t.date+' · '+(t.title||CategoryIcons.label(d,t.category)),value:C.impact(t)[q.metric],ids:[t.id]})).filter(g=>g.value>0);
   else if(['category','person'].includes(q.dimension)){const buckets=new Map();for(const t of rows){const key=t[q.dimension]||'';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(t);}for(const subset of buckets.values())safeTotals(subset);groups=A.groups(d,rows,q.metric,q.dimension);}
   else{
    const values=q.dimension==='account'?d.accounts.map(a=>({key:a.id,label:a.name})):[...new Set(rows.flatMap(t=>t.tags.length?t.tags:['']))].map(t=>({key:t,label:t||'未注明标签'}));
    groups=values.map(g=>{const subset=q.dimension==='account'?C.filter({...d,entries:rows},{account:g.key}):rows.filter(t=>g.key?t.tags.includes(g.key):!t.tags.length);return {...g,value:sum(subset),ids:subset.map(t=>t.id)};}).filter(g=>g.ids.length);
    if(q.dimension==='account'){const known=new Set(groups.flatMap(g=>g.ids)),missing=rows.filter(t=>!known.has(t.id));if(missing.length)groups.push({label:'未注明账户',value:sum(missing),ids:missing.map(t=>t.id)});}
   }
   groups.sort((a,b)=>(q.sort==='asc'?a.value-b.value:b.value-a.value)||a.label.localeCompare(b.label));
   for(const [i,g]of groups.slice(0,q.operation==='max'?1:q.limit).entries()){const ids=new Set(g.ids),items=rows.filter(t=>ids.has(t.id)),label=q.dimension==='category'?CategoryIcons.label(d,g.key):(g.displayLabel||g.label);fact((q.operation==='total'?'':`第 ${i+1} 项 · `)+label,g.value,items);fact(label+' · 笔数',items.length,items,'count');}
  }else for(const k of q.metric==='both'?['income','expense']:[q.metric]){const items=rows.filter(t=>C.impact(t)[k]!==0);if(items.length)fact(k==='income'?'收入':'支出',totals[k],items);}
  if(!facts.length)return {ok:false,query:q,message:EMPTY+'：没有符合排名条件的记录。',facts:[]};
  fact('相关账目',rows.length,rows,'count');
  return {ok:true,query:q,book,message:'已按下方条件从本地已入账记录计算，点击数字核对明细。',facts,note:'金额为人民币折算值；退款 / 报销冲减支出，转账与调整不计；无日期不计。'+((['account','tag'].includes(q.dimension)||q.filters.account)?'账户条件采用涉及该账户的整笔金额；账户 / 标签分组可能重叠，不可相加。':'')+(q.operation==='average'?'日均按完整月份天数计算。':'')+(q.dimension!=='none'?'仅显示所设上限内的分组 / 单笔。':'')};
 }catch(e){return {ok:false,query:q,message:EMPTY+'：'+e.message,facts:[]};}
}
function scopeText(q,d){return `${q.start} — ${q.end} · ${{income:'收入',expense:'支出',both:'收支'}[q.metric]} · ${{total:'合计',rank:'排名',max:'最大单笔',compare:'与上月对比',average:'日均'}[q.operation]} · ${{none:'不分组',category:'按分类',account:'按账户',person:'按人物',tag:'按标签',entry:'按单笔'}[q.dimension]} · ${q.sort==='asc'?'升序':'降序'}${q.dimension!=='none'?' · 上限 '+q.limit+' 项':''}`+Object.entries(q.filters).map(([k,v])=>' · '+({category:'分类',account:'账户',person:'人物',tag:'标签'})[k]+'：'+(k==='category'?CategoryIcons.label(d,v):k==='account'?d.accounts.find(a=>a.id===v)?.name:v)).join('');}
module.exports={EMPTY,NEEDS_AI,validate,parseLocal,parseMonth,compute,scopeText,safeTotals};
