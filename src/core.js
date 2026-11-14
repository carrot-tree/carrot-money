'use strict';
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const clone=x=>JSON.parse(JSON.stringify(x));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(new Date(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const kinds={expense:'支出',income:'收入',transfer:'转账 / 还款',refund:'退款',reimbursement:'报销到账',adjustment:'余额调整',legacy:'历史记录'};
const currencies=['CNY','USD','EUR','HKD','JPY','GBP','AUD','CAD','SGD','TWD','KRW'];
function cents(v){const s=String(v??'').trim().replace(/[¥￥$€£,，\s]/g,'');if(!/^[+-]?\d+(\.\d{1,2})?$/.test(s))throw Error('请输入金额，最多两位小数');const [a,b='']=s.replace(/^[+-]/,'').split('.');const n=(s.startsWith('-')?-1:1)*(Number(a)*100+Number(b.padEnd(2,'0')));if(!Number.isSafeInteger(n))throw Error('金额太大');return n;}
const money=n=>(Number(n||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const list=s=>Array.isArray(s)?s:String(s||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean);
const amountOK=(n,negative=false)=>Number.isSafeInteger(n)&&(negative||n>=0);
function blank(){return {version:2,revision:0,updatedAt:'',books:[{id:'daily',name:'生活账本',icon:'🥕',archived:false}],accounts:[],categories:[['餐饮','🍜'],['交通','🚇'],['购物','🛍️'],['居住','🏡'],['娱乐','🎮'],['健康','🌿'],['学习','📖'],['人情','🎁'],['其他','🧾'],['工资','💼'],['广告','🎬'],['咨询','💬'],['求职资料','📚']].map(([name,icon],i)=>({id:'cat-'+i,name,icon,parent:'',type:i<9?'expense':'income',archived:false})),entries:[],budgets:[],templates:[],rules:[],goals:[],trash:[],imports:[],settings:{theme:'auto',accent:'#b17c52',radius:18,density:'comfortable',cards:['summary','trend','budget','categories','subscriptions','goals','recent'],hiddenCards:[]}};}
function base(t){return t.kind==='legacy'?Math.max(Math.abs(t.legacyIncome||0),Math.abs(t.legacyExpense||0)):Math.round(t.amount*t.rate);}
// Statistical projections retain original amounts and dates. Their accounting
// effect lives only in memory, so JSON, edit drafts and exports cannot persist it.
const consumptionEffects=new WeakMap();
function impact(t){const projected=consumptionEffects.get(t);if(projected)return {...projected};if(t.kind==='legacy')return {income:t.legacyIncome||0,expense:t.legacyExpense||0};const n=base(t);return {income:t.kind==='income'?n:0,expense:t.kind==='expense'?n:['refund','reimbursement'].includes(t.kind)?-n:0};}
function expenseSummary(d,t,relatedRows){
 const rows=relatedRows||d.entries.filter(x=>x.related===t.id&&['refund','reimbursement'].includes(x.kind)),refunds=rows.filter(x=>x.kind==='refund'),reimbursements=rows.filter(x=>x.kind==='reimbursement'),refund=refunds.reduce((n,x)=>n+x.amount,0),reimbursement=reimbursements.reduce((n,x)=>n+x.amount,0),paid=t.amount,net=paid-refund-reimbursement,paidBase=base(t),afterRefund=Math.round((paid-refund)*t.rate),netBase=Math.round(net*t.rate);
 return {paid,refund,reimbursement,net,paidBase,refundBase:paidBase-afterRefund,reimbursementBase:afterRefund-netBase,netBase,refunds,reimbursements};
}
function consumption(d,f={}){
 const returned=new Map();for(const t of d.entries)if(['refund','reimbursement'].includes(t.kind))returned.set(t.related,(returned.get(t.related)||0)+t.amount);
 const entries=d.entries.map(t=>{const copy={...t},effect=impact(t);if(t.kind==='expense')effect.expense=Math.round((t.amount-(returned.get(t.id)||0))*t.rate);else if(['refund','reimbursement'].includes(t.kind))effect.expense=0;consumptionEffects.set(copy,effect);return copy;});
 return filter({...d,entries},f);
}
function consumptionBreakdown(d,rows){
 const related=new Map();for(const t of d.entries)if(['refund','reimbursement'].includes(t.kind)){if(!related.has(t.related))related.set(t.related,[]);related.get(t.related).push(t);}
 const groups={income:[],gross:[],refund:[],reimbursement:[],neutral:[]},values={income:0,gross:0,refund:0,reimbursement:0,netExpense:0};
 for(const t of rows){
  if(t.kind==='expense'){const s=expenseSummary(d,t,related.get(t.id)||[]);groups.gross.push(t);groups.refund.push(...s.refunds);groups.reimbursement.push(...s.reimbursements);values.gross+=s.paidBase;values.refund+=s.refundBase;values.reimbursement+=s.reimbursementBase;values.netExpense+=s.netBase;}
  else if(t.kind==='legacy'){if(t.legacyIncome){groups.income.push(t);values.income+=t.legacyIncome;}if(t.legacyExpense){groups.gross.push(t);values.gross+=t.legacyExpense;values.netExpense+=t.legacyExpense;}}
  else if(t.kind==='income'){groups.income.push(t);values.income+=base(t);}
  else if(!['refund','reimbursement'].includes(t.kind))groups.neutral.push(t);
 }
 return {groups,...values};
}
function totals(rows){return rows.reduce((a,t)=>{const v=impact(t);a.income+=v.income;a.expense+=v.expense;a.count++;return a;},{income:0,expense:0,count:0});}
function CImpact(t,metric){const s=impact(t);return metric==='net'?s.income-s.expense:s[metric]||0;}
function filter(d,f={}){const ids=f.ids?new Set(f.ids):null;return d.entries.filter(t=>(!ids||ids.has(t.id))&&(!f.metric||CImpact(t,f.metric)!==0)&&(!f.book||t.book===f.book)&&(!f.period||t.date?.startsWith(f.period))&&(!f.start||t.date>=f.start)&&(!f.end||t.date&&t.date<=f.end)&&(!f.category||t.category===f.category||d.categories.find(c=>c.id===t.category)?.parent===f.category)&&(!f.account||t.account===f.account||t.toAccount===f.account||t.splits?.some(s=>s.account===f.account))&&(!f.kind||t.kind===f.kind)&&(!f.person||t.person===f.person)&&(!f.tag||t.tags.includes(f.tag))&&(!f.query||[t.title,t.note,t.payee,t.location,t.person,...t.tags,d.categories.find(c=>c.id===t.category)?.name].join(' ').toLowerCase().includes(f.query.toLowerCase()))&&(f.min==null||Math.abs(base(t))>=f.min)&&(f.max==null||Math.abs(base(t))<=f.max)&&(!f.pending||t.kind==='expense'&&t.reimbursable&&outstanding(d,t)>0)&&(!f.review||!t.date||t.kind==='legacy'&&t.legacyIncome==null&&t.legacyExpense==null));}
function accountBalance(d,id){const a=d.accounts.find(a=>a.id===id);if(!a)return 0;let n=a.opening;for(const t of d.entries){if(t.kind==='legacy')continue;if(t.kind==='expense'&&t.splits?.length){for(const s of t.splits)if(s.account===id)n-=s.amount;continue;}if(t.account===id)n+=['expense','transfer'].includes(t.kind)?-t.amount:t.amount;if(t.kind==='transfer'&&t.toAccount===id)n+=t.toAmount;}return n;}
function outstanding(d,t){return Math.max(0,t.amount-d.entries.filter(x=>x.related===t.id&&['refund','reimbursement'].includes(x.kind)).reduce((n,x)=>n+x.amount,0));}
function categoryName(d,id){const c=d.categories.find(c=>c.id===id);return c?(c.parent?d.categories.find(x=>x.id===c.parent)?.name+' / ':'')+c.name:'未分类';}
function range(period,at){const dt=new Date(at+'T12:00:00Z');if(period==='year')return [at.slice(0,4)+'-01-01',at.slice(0,4)+'-12-31'];if(period==='week'){dt.setUTCDate(dt.getUTCDate()-(dt.getUTCDay()+6)%7);const start=dt.toISOString().slice(0,10);dt.setUTCDate(dt.getUTCDate()+6);return [start,dt.toISOString().slice(0,10)];}return [at.slice(0,7)+'-01',at.slice(0,7)+'-'+new Date(Date.UTC(dt.getUTCFullYear(),dt.getUTCMonth()+1,0)).getUTCDate()];}
function budgetsAt(d,book,at){const list=d.budgets.filter(b=>(!book||b.book===book)&&(!b.start||range(b.period,at)[0]===b.start)),scoped=new Set(list.filter(b=>b.start).map(b=>JSON.stringify([b.book,b.category||'',b.period])));return list.filter(b=>b.start||!scoped.has(JSON.stringify([b.book,b.category||'',b.period])));}
function budgetUsage(d,b,at){const [start,end]=range(b.period,b.start||at);const spent=totals(consumption(d,{book:b.book,category:b.category,start,end})).expense;return {spent,left:b.amount-spent,start,end,ratio:b.amount?spent/b.amount:0};}
function nextDate(date,frequency,anchor){const d=new Date(date+'T12:00:00Z');if(frequency==='daily'||frequency==='weekly'){d.setUTCDate(d.getUTCDate()+(frequency==='daily'?1:7));return d.toISOString().slice(0,10);}const months=frequency==='yearly'?12:1,y=d.getUTCFullYear(),m=d.getUTCMonth()+months,day=anchor||d.getUTCDate();const end=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(day,end),12)).toISOString().slice(0,10);}
function dueRules(d,until=today(),book=''){const items=[],used=new Set([...d.entries,...d.trash].map(t=>t.id));for(const r of d.rules){if(!r.enabled||book&&r.entry.book!==book)continue;let date=r.next,remaining=r.remaining??null;let count=0;while(date<=until&&(remaining===null||remaining>0)){if(++count>5000)throw Error('单个周期超过 5000 期，请调整开始日期');const id='rule-'+r.id+'-'+date;if(!used.has(id)&&!(r.skipped||[]).includes(date))items.push({...clone(r.entry),id,date,ruleId:r.id,title:r.name+(r.total?' · 分期':''),amount:r.finalAmount!=null&&remaining===1?r.finalAmount:r.entry.amount});date=nextDate(date,r.frequency,r.anchor);if(remaining!==null)remaining--;}}return items;}
function postDue(d,until=today(),book=''){const rows=dueRules(d,until,book);d.entries.push(...rows);for(const r of d.rules){if(!r.enabled||book&&r.entry.book!==book)continue;let n=0;while(r.next<=until&&(r.remaining==null||r.remaining>0)){if(++n>5000)throw Error('周期数量过多');r.next=nextDate(r.next,r.frequency,r.anchor);if(r.remaining!=null)r.remaining--;}if(r.remaining===0)r.enabled=false;}return rows.length;}
function activeBook(d){return d.books.find(b=>b.id===d.settings.defaultBook&&!b.archived)?.id||d.books.find(b=>!b.archived)?.id||d.books[0]?.id||'daily';}
function newEntry(d,seed={}){
 const entry={id:uid(),kind:'expense',title:'',date:today(),amount:0,currency:'CNY',rate:1,book:activeBook(d),category:['transfer','adjustment'].includes(seed.kind)?'':d.categories.find(c=>c.type===(seed.kind==='income'?'income':'expense')&&!c.archived)?.id||'',account:'',toAccount:'',toAmount:0,related:'',person:'',tags:[],payee:'',note:'',location:'',notePath:'',attachments:[],splits:[],reimbursable:false,...seed};
 for(const [key,value]of Object.entries(entry))if(Array.isArray(value))entry[key]=clone(value);
 return entry;
}
const categoryType=t=>t.kind==='income'?'income':['expense','refund','reimbursement'].includes(t.kind)?'expense':'';
function putEntry(d,entry){
 const at=d.entries.findIndex(t=>t.id===entry.id),old=at<0?null:d.entries[at],value=clone(entry);
 if(at<0)d.entries.push(value);else d.entries[at]=value;
 if(old?.kind==='expense'&&value.kind==='expense'&&old.category!==value.category)for(const related of [...d.entries,...d.trash])if(related.related===value.id&&['refund','reimbursement'].includes(related.kind))related.category=value.category;
 return value;
}
// Read old ledgers without rewriting or rejecting historical category mismatches.
// A normal write may preserve one, but must not introduce a new mismatch.
function validateChanges(before,after){
 const records=d=>[...d.entries,...d.trash].map(t=>['entry:'+t.id,t]).concat(...['templates','rules'].map(key=>d[key].map(x=>[key+':'+x.id,x.entry])));
 const prior=new Map(records(before)),oldCategories=new Map(before.categories.map(c=>[c.id,c])),categories=new Map(after.categories.map(c=>[c.id,c]));
 for(const [key,t]of records(after)){
  const expected=categoryType(t),category=categories.get(t.category);if(!expected||!category||category.type===expected)continue;
  const old=prior.get(key);if(!old||old.kind!==t.kind||old.category!==t.category||oldCategories.get(old.category)?.type!==category.type)throw Error('分类的收支类型与账目不一致，请重新选择分类');
 }
 return after;
}
function validate(d){
 if(!d||d.version!==2)throw Error('这不是 Carrot 记账的数据文件');
 for(const k of ['books','accounts','categories','entries','budgets','templates','rules','goals','trash','imports']){if(!Array.isArray(d[k]))throw Error('缺少 '+k);const ids=new Set();for(const x of d[k]){if(!x.id||typeof x.id!=='string'||ids.has(x.id))throw Error(k+' 的 ID 缺失或重复');ids.add(x.id);}}
 const has=(k,id)=>d[k].some(x=>x.id===id);if(!d.books.length)throw Error('至少保留一个账本');
 for(const b of d.books)if(!b.name?.trim())throw Error('账本需要名称');
 for(const a of d.accounts)if(!a.name?.trim()||!amountOK(a.opening,true)||!currencies.includes(a.currency)||!Number.isFinite(a.rate)||a.rate<=0)throw Error('账户名称、余额或汇率无效');
 for(const c of d.categories){if(!c.name?.trim()||!['expense','income'].includes(c.type))throw Error('分类无效');if(c.parent){const p=d.categories.find(x=>x.id===c.parent);if(!p||p.id===c.id||p.parent||p.type!==c.type)throw Error('分类最多两级，父分类需属于相同收支类型');}}
 const checkEntry=(t,allowZero=false,context=d.entries)=>{if(!kinds[t.kind]||!has('books',t.book)||!currencies.includes(t.currency)||!Number.isFinite(t.rate)||t.rate<=0||t.currency==='CNY'&&t.rate!==1)throw Error('账目类型、账本或汇率无效');if(t.date&&!validDate(t.date)||!t.date&&t.kind!=='legacy')throw Error('日期无效');if(!amountOK(t.amount,t.kind==='adjustment')||!Number.isSafeInteger(base(t)))throw Error('金额无效');if(t.kind!=='legacy'&&t.kind!=='adjustment'&&!allowZero&&t.amount<=0)throw Error('金额需大于零');if(!Array.isArray(t.tags)||!Array.isArray(t.attachments)||!Array.isArray(t.splits)||typeof t.title!=='string')throw Error('账目字段不完整');if(t.attachments.some(p=>typeof p!=='string'||!p.startsWith('Carrot记账/附件/')||p.includes('..')))throw Error('附件路径无效');if(t.category&&!has('categories',t.category))throw Error('分类不存在');
 if(t.kind==='legacy'){for(const k of ['legacyIncome','legacyExpense'])if(t[k]!==null&&!amountOK(t[k],true))throw Error('历史金额无效');return;}
 const account=(id)=>{const a=d.accounts.find(x=>x.id===id);if(!a)throw Error('账户不存在');return a;};if(t.account&&account(t.account).currency!==t.currency)throw Error('账目币种需与付款/收款账户一致');
 if(t.kind==='transfer'){if(!t.account||!t.toAccount||t.account===t.toAccount||!amountOK(t.toAmount)||!t.toAmount)throw Error('转账需选择不同账户及有效到账金额');const to=account(t.toAccount);if(to.currency===t.currency&&t.toAmount!==t.amount)throw Error('相同币种转账的转出与到账金额应一致；手续费请另记支出');}
 if(t.kind==='adjustment'&&!t.account)throw Error('余额调整需选择账户');
 if(t.splits.length){if(t.kind!=='expense'||t.splits.some(s=>!s.account||!amountOK(s.amount)||!s.amount||account(s.account).currency!==t.currency)||t.splits.reduce((n,s)=>n+s.amount,0)!==t.amount||new Set(t.splits.map(s=>s.account)).size!==t.splits.length)throw Error('组合付款的账户币种需一致、不能重复，金额合计需等于总额');}
 if(['refund','reimbursement'].includes(t.kind)){const original=context.find(x=>x.id===t.related);if(!original||original.kind!=='expense'||original.currency!==t.currency||original.book!==t.book||original.category!==t.category||original.rate!==t.rate)throw Error('退款 / 报销需关联同一账本、分类和币种的支出，并沿用原汇率');if(t.date<original.date)throw Error('退款 / 报销日期不能早于原支出');if(t.kind==='reimbursement'&&!original.reimbursable)throw Error('原账目未标记为待报销');}
 };
 for(const t of d.entries)checkEntry(t);
 const activeIds=new Set(d.entries.map(t=>t.id));for(const t of d.trash){if(activeIds.has(t.id))throw Error('账目与回收站存在相同 ID');checkEntry(t,false,[...d.entries,...d.trash]);}
 for(const t of [...d.entries,...d.trash])if(t.reviewStamp&&(typeof t.reviewStamp.at!=='string'||Number.isNaN(Date.parse(t.reviewStamp.at))||typeof t.reviewStamp.fingerprint!=='string'))throw Error('核对标记无效');
 for(const t of d.entries.filter(x=>x.kind==='expense')){const returned=d.entries.filter(x=>x.related===t.id&&['refund','reimbursement'].includes(x.kind)).reduce((n,x)=>n+x.amount,0);if(returned>t.amount)throw Error('退款与报销合计不能超过原支出');}
 for(const b of d.budgets)if(!has('books',b.book)||!['week','month','year'].includes(b.period)||!amountOK(b.amount)||b.category&&!has('categories',b.category)||b.start&&(!validDate(b.start)||range(b.period,b.start)[0]!==b.start))throw Error('预算设置无效');
 for(const r of d.rules){if(r.skipped!=null&&(!Array.isArray(r.skipped)||r.skipped.some(x=>!validDate(x))||new Set(r.skipped).size!==r.skipped.length))throw Error('跳过期次无效');if(r.anchor!=null&&(!Number.isInteger(r.anchor)||r.anchor<1||r.anchor>31))throw Error('周期锚点无效');if(r.finalAmount!=null&&(!amountOK(r.finalAmount)||!r.finalAmount))throw Error('末期金额无效');if(!validDate(r.next)||!['daily','weekly','monthly','yearly'].includes(r.frequency)||r.remaining!=null&&(!Number.isInteger(r.remaining)||r.remaining<0))throw Error('周期设置无效');checkEntry(r.entry);if(!['expense','income','transfer'].includes(r.entry.kind))throw Error('周期仅支持支出、收入和转账');}
 for(const t of d.templates)checkEntry(t.entry,true);
 for(const g of d.goals){if(g.archived!=null&&typeof g.archived!=='boolean')throw Error('目标归档状态无效');if(!g.name||!amountOK(g.target)||!amountOK(g.opening)||!Array.isArray(g.contributions)||g.contributions.some(c=>!amountOK(c.amount,true)||!validDate(c.date)))throw Error('存钱目标无效');if(g.opening+g.contributions.reduce((n,x)=>n+x.amount,0)<0)throw Error('已存金额不能小于零');if(g.deadline&&!validDate(g.deadline))throw Error('目标日期无效');const ids=new Set();for(const x of g.contributions){if(typeof x.id!=='string'||!x.id||ids.has(x.id))throw Error('存钱打卡 ID 缺失或重复');ids.add(x.id);}}
 if(!d.settings||!Array.isArray(d.settings.cards)||!Array.isArray(d.settings.hiddenCards))throw Error('外观设置无效');
 if(d.settings.chartDefaults!=null)require('./report-preferences').validate(d.settings.chartDefaults,d);
 if(d.settings.savedEntryFilters!=null){const list=d.settings.savedEntryFilters;if(!Array.isArray(list)||list.length>20||new Set(list.map(x=>x?.id)).size!==list.length)throw Error('常用流水筛选列表无效');for(const item of list)require('./ledger-filters').validate(item,d);}
 if(d.settings.savedReports!=null){const presets=d.settings.savedReports,ids=new Set();if(!Array.isArray(presets)||presets.length>20)throw Error('常用分析列表无效');for(const x of presets){if(!x.id||ids.has(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>50||!has('books',x.book)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month))throw Error('常用分析设置无效');ids.add(x.id);const q=x.state;if(q?.barGroup!=null&&!['date','category','account','person','payee','tag'].includes(q.barGroup)||q?.barLevel!=null&&!['leaf','parent'].includes(q.barLevel))throw Error('常用分析分组无效');if(q?.barHidden!=null&&(typeof q.barHidden!=='object'||Array.isArray(q.barHidden)||Object.entries(q.barHidden).some(([k,v])=>!['category:leaf','category:parent','account','person','payee','tag'].includes(k)||!Array.isArray(v)||v.some(id=>typeof id!=='string')||new Set(v).size!==v.length)))throw Error('常用分析分组显隐无效');if(!q||!['month','year','last12','custom'].includes(q.mode)||q.chart!=null&&!['bar','line'].includes(q.chart)||q.grain!=null&&!['auto','day','week','month'].includes(q.grain)||q.visible!=null&&(!Array.isArray(q.visible)||!q.visible.length||q.visible.some(k=>!['income','expense','net'].includes(k))))throw Error('常用分析图表条件无效');if(q.mode==='custom'&&(!validDate(q.start)||!validDate(q.end)||q.start>q.end))throw Error('常用分析日期无效');}}
 const s=totals(d.entries);if(!amountOK(s.income,true)||!amountOK(s.expense,true))throw Error('合计超出安全范围');for(const a of d.accounts)if(!amountOK(accountBalance(d,a.id),true))throw Error('账户余额超出安全范围');
 return d;
}
function removeEntries(d,ids){const deleting=new Set(ids);for(const t of d.entries)if(t.related&&deleting.has(t.related)&&!deleting.has(t.id))throw Error('该支出有关联退款 / 报销，请一并选择或先处理关联账目');const rows=d.entries.filter(t=>deleting.has(t.id));d.trash.push(...rows.map(t=>({...t,deletedAt:new Date().toISOString()})));d.entries=d.entries.filter(t=>!deleting.has(t.id));}
function restoreEntries(d,ids){const set=new Set(ids);for(const t of d.trash.filter(t=>set.has(t.id))){if(d.entries.some(x=>x.id===t.id))throw Error('已有相同账目');const x=clone(t);delete x.deletedAt;d.entries.push(x);}d.trash=d.trash.filter(t=>!set.has(t.id));validate(d);}
function migrate(old){const d=blank();d.books[0].name='Carrot 生活账本';const cats=new Map();for(const name of [...new Set([...(old.categories||[]),...old.transactions.map(t=>t.category)])]){const c={id:uid(),name:name||'其他',icon:'🧾',parent:'',type:'expense',archived:false};d.categories.push(c);cats.set(name,c.id);}d.entries=old.transactions.map(t=>newEntry(d,{id:t.id,kind:'legacy',title:t.title,date:t.date||'',amount:0,legacyIncome:t.income,legacyExpense:t.expense,category:cats.get(t.category),person:(t.people||[]).join('、'),tags:t.tags||[],payee:t.counterparty||'',note:t.note||'',sourceUrl:t.sourceUrl||'',legacyMonths:t.months||[],createdAt:t.createdAt||''}));
 d.goals=(old.wishes||[]).map(w=>({id:w.id,name:w.title,target:w.price,opening:w.saved,note:w.note||'',deadline:'',contributions:[]}));d.templates=(old.quick||[]).map(q=>({id:q.id,name:q.name,entry:newEntry(d,{title:q.name,kind:q.type,category:cats.get(q.category)||'',amount:0,tags:q.tag?[q.tag]:[]})}));d.imports.push({id:uid(),name:'Notion 明细账本历史迁移',at:new Date().toISOString(),ids:d.entries.map(t=>t.id),count:d.entries.length,undoable:false});d.migration={count:d.entries.length,totals:totals(d.entries),originalPath:'账本数据/ledger.json',note:'历史记录保留原始双金额、空值和月份关系；新版按实际日期统计，不假定历史账户余额。'};return validate(d);}
module.exports={activeBook,uid,clone,today,validDate,kinds,currencies,cents,money,list,blank,base,impact,totals,filter,accountBalance,outstanding,categoryName,categoryType,putEntry,validateChanges,expenseSummary,consumption,consumptionBreakdown,range,budgetsAt,budgetUsage,nextDate,dueRules,postDue,newEntry,validate,removeEntries,restoreEntries,migrate};
