'use strict';
const C=require('./core'),A=require('./analytics'),Ask=require('./ai-ask');
const synonyms={正餐:['吃饭','吃了','用餐'],喝滴:['奶茶','咖啡','喝的'],交通:['打车','地铁','公交'],汽车:['加油','充电'],日用滴:['超市','日用'],住:['房租','水电'],医疗:['医院','药'],娱乐:['电影','游戏']};
const changed=()=>Error('记录已变化，请重新预览');
const categoryActions=new Set(['set_categories','set_category','reassign_category','set_category_by_keyword']);

function validate(value,d,book){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.intent!=='action')throw Error('无效指令');
 const allowedActions=['set_category','set_categories','reassign_category','set_category_by_keyword','add_tag','remove_tag','set_account','set_method','set_person','mark_reimbursable','set_note_prefix','set_amount','set_date'];
 if(!allowedActions.includes(value.action))throw Error('不支持的批量操作');
 // 白名单：账本字段只能走下面这些受控参数，模型夹带 amount/date/kind 之类一律拒绝
 const COMMON=['intent','action','start','end','mode','hint','label','reason','explain','summary','say','reply','book','remote','userInitiated'];
 const SPECIFIC={set_categories:['changes'],set_category:['ids','to'],reassign_category:['from','to'],set_category_by_keyword:['from','keyword','to'],add_tag:['from','tags'],remove_tag:['from','tags'],set_account:['from','account'],set_method:['from','method','targetAccountId'],set_person:['from','person'],mark_reimbursable:['from','reimbursable'],set_note_prefix:['from','prefix'],set_amount:['ids','amount'],set_date:['ids','date']};
 const okKeys=[...COMMON,...(SPECIFIC[value.action]||[]),...(value.action!=='set_categories'?['ids']:[])];
 for(const k of Object.keys(value))if(!okKeys.includes(k))throw Error('不支持的字段：'+k);
 if(!d.books.some(b=>b.id===book&&!b.archived))throw Error('账本不存在或已归档');
 if(!C.validDate(value.start)||!C.validDate(value.end)||value.start>value.end||A.days(value.start,value.end)>3660)throw Error('日期范围无效或超过十年');
 const v={intent:'action',action:value.action,start:value.start,end:value.end};if(typeof value.reason==='string')v.reason=value.reason.slice(0,500);
 if(value.ids!==undefined){if(!Array.isArray(value.ids)||!value.ids.length||value.ids.length>d.entries.length||value.ids.some(id=>typeof id!=='string'||!id)||new Set(value.ids).size!==value.ids.length)throw Error('须指定当前账本内不重复的记录 ID');v.ids=[...value.ids];}
 if (value.from) {
  const fromCat = d.categories.find(c => c.id === value.from);
  if (!fromCat) throw Error('源分类不存在');
  v.from = fromCat.id;
 }
 if(value.action==='set_categories'){
  if(!Array.isArray(value.changes)||!value.changes.length||value.changes.length>d.entries.length||value.changes.some(x=>!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['id','to','reason'].includes(k))||typeof x.id!=='string'||!x.id||x.reason!==undefined&&(typeof x.reason!=='string'||x.reason.length>500))||new Set(value.changes.map(x=>x.id)).size!==value.changes.length)throw Error('改分类须提供不重复的具体记录及各自目标分类');
  v.changes=value.changes.map(x=>{const hits=d.categories.filter(c=>c.id===x.to),named=hits.length?hits:d.categories.filter(c=>c.name===x.to||C.categoryName(d,c.id)===x.to);if(named.length!==1||named[0].archived)throw Error('目标分类不存在、已归档或名称不唯一，请读取最新分类清单');return {id:x.id,to:named[0].id,...(x.reason?{reason:x.reason}:{})};});
 }else if(value.action==='set_category'){
  if(!Array.isArray(value.ids)||!value.ids.length||value.ids.length>d.entries.length||value.ids.some(id=>typeof id!=='string'||!id)||new Set(value.ids).size!==value.ids.length)throw Error('改分类须指定当前账本内不重复的记录 ID');
  const hits=d.categories.filter(c=>c.id===value.to);const named=hits.length?hits:d.categories.filter(c=>c.name===value.to||C.categoryName(d,c.id)===value.to);
  if(named.length!==1||named[0].archived)throw Error(named.length>1?'分类名称不唯一，请使用分类 ID':'目标分类不存在或已归档，请读取最新分类清单');
  v.ids=[...value.ids];v.to=named[0].id;
 }else if(value.action==='reassign_category'){
  if(!v.from)throw Error('分类不存在，请使用账本里已有的分类');
  const to=d.categories.find(c=>c.id===value.to);
  if(!to)throw Error('分类不存在，请使用账本里已有的分类');
  if(v.from===to.id)throw Error('原分类和目标分类相同');
  if(d.categories.find(c=>c.id===v.from).type!==to.type)throw Error('只能在同一收支类型的分类之间修改');
  v.to=to.id;
 }else if(value.action==='set_category_by_keyword'){
  if(typeof value.keyword!=='string'||!value.keyword)throw Error('关键词无效');
  if(!v.from)throw Error('关键词筛选必须指定原分类');
  const to=d.categories.find(c=>c.id===value.to);
  if(!to)throw Error('分类不存在，请使用账本里已有的分类');
  if(d.categories.find(c=>c.id===v.from).type!==to.type)throw Error('只能在同一收支类型的分类之间修改');
  v.keyword=value.keyword;v.to=to.id;
 }else if(value.action==='add_tag'||value.action==='remove_tag'){
  if(!Array.isArray(value.tags)||value.tags.length===0||value.tags.some(t=>typeof t!=='string'||!t))throw Error('标签必须为非空字符串数组');
  v.tags=[...new Set(value.tags)];
 }else if(value.action==='set_account'){
  const acc=d.accounts.find(a=>a.id===value.account);
  if(!acc||acc.archived)throw Error('账户不存在或已归档');
  v.account=acc.id;
 }else if(value.action==='set_method'){
  if(typeof value.method!=='string'||!value.method)throw Error('支付方式无效');
  const matches=d.accounts.filter(a=>!a.archived&&(a.type===value.method||a.name===value.method));
  const acc=value.targetAccountId?matches.find(a=>a.id===value.targetAccountId):matches.length===1?matches[0]:null;
  if(!acc)throw Error(matches.length>1?'此支付方式对应多个账户，请明确指定目标账户':'找不到对应的支付方式所属账户');
  v.method=value.method;
  v.targetAccountId=acc.id;
 }else if(value.action==='set_person'){
  if(typeof value.person!=='string')throw Error('人物无效');
  v.person=value.person;
 }else if(value.action==='mark_reimbursable'){
  if(typeof value.reimbursable!=='boolean')throw Error('待报销标记无效');
  v.reimbursable=value.reimbursable;
 }else if(value.action==='set_note_prefix'){
  if(typeof value.prefix!=='string'||!value.prefix||value.prefix.length>30)throw Error('备注前缀无效或超过30字');
  v.prefix=value.prefix;
 }else if(value.action==='set_amount'||value.action==='set_date'){
  if(!Array.isArray(value.ids)||!value.ids.length||value.ids.length>100||value.ids.some(id=>typeof id!=='string'||!id)||new Set(value.ids).size!==value.ids.length)throw Error('金额或日期修改须指定 1 至 100 笔记录 ID');
  v.ids=[...value.ids];
  if(value.action==='set_amount'){if(!Number.isSafeInteger(value.amount)||value.amount<=0)throw Error('金额须为正整数分');v.amount=value.amount;}
  else{if(!C.validDate(value.date))throw Error('新日期无效');v.date=value.date;}
 }
 return v;
}

function alias(d,name){
 const hits=d.categories.filter(c=>[c.id,c.name,C.categoryName(d,c.id),...(synonyms[c.name]||[])].some(x=>x.replace(/\s/g,'')===name));
 return hits.length===1?hits[0].id:null;
}

function aliasAccount(d, name) {
 const norm = s => String(s || '').replace(/\s/g, '').replace(/(?:的)?(?:支付方式|支付账户|账户|钱包|支付)$/, '');
 const target = norm(name);
 if (!target) return null;
 const hits = d.accounts.filter(a => [a.id, a.name, a.type].some(x => x && norm(x) === target));
 return hits.length === 1 ? hits[0].id : null;
}

function parseLocal(question,d,book,now=C.today()){
 const parsed=Ask.parseMonth(question,now);if(!parsed)return null;
 let s=parsed.rest.replace(/^(?:请|帮我|给我|我想|麻烦你)*/,'').replace(/(?:吧|一下|所有记录|所有账目|所有笔|的记录|的账目)$/,'');

 if (/删除|清空|改成\s*\d+元|把日期改成|修改金额|修改日期/.test(question)) return null;

 const clean = x => x.replace(/^(?:把|将|给|所有|全部|取消)/,'').replace(/(?:的分类|分类|的标签|标签|的人物|人物|的备注|备注|全部|都|所有)$/,'').replace(/\s+/g,'').replace(/^[「『【]|[」』】]$/g,'');
 const cleanTarget = x => x.replace(/^[「『【]|[」』】]$/g,'');

 let m;

 m = s.match(/^(?:把|将)?(.+?)(?:里带|中名称包含|带|包含)\s*[「『【]?(.*?)[」』】]?\s*(?:的分类|的)?(?:改成|改为|换成|记到|记为)(.+)$/);
 if(m) {
  const from=alias(d,clean(m[1])), to=alias(d,clean(m[3]));
  if(from&&to) {
   try{return validate({intent:'action',action:'set_category_by_keyword',from,keyword:cleanTarget(m[2]),to,start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }

 m = s.match(/^(?:把|将|给)?(.+?)(?:全部|都|所有)?(?:加上|打上|加)(?:了)?(?:标签)\s*[「『【]?(.*?)[」』】]?$/);
 if(m) {
  const from=alias(d,clean(m[1]));
  if(from) {
   try{return validate({intent:'action',action:'add_tag',from,tags:cleanTarget(m[2]).split(/、|,|，| /).filter(Boolean),start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }

 m = s.match(/^(?:把|将)?(.+?)(?:全部|都|所有)?(?:去掉|移除|删掉)(?:了)?(?:标签)\s*[「『【]?(.*?)[」』】]?$/) ||
     s.match(/^(?:去掉|移除|删掉)(?:了)?(.+?)(?:的标签|标签)\s*[「『【]?(.*?)[」』】]?$/);
 if(m) {
  const from=alias(d,clean(m[1]));
  if(from) {
   try{return validate({intent:'action',action:'remove_tag',from,tags:cleanTarget(m[2]).split(/、|,|，| /).filter(Boolean),start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }

 m = s.match(/^(?:把|将|给)?(.+?)(?:的人物|的?记在)\s*[「『【]?(.*?)[」』】]?\s*(?:设成|变成|改成|名下)$/) ||
     s.match(/^(?:把|将)?(.+?)(?:全部|都|所有)?(?:的人物设成|的人物设为|设为人物|记在人物)\s*[「『【]?(.*?)[」』】]?$/);
 if(m) {
  const from=alias(d,clean(m[1]));
  if(from) {
   try{return validate({intent:'action',action:'set_person',from,person:cleanTarget(m[2]),start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }

 m = s.match(/^(?:把|将)?(.+?)(?:全部|都|所有)?(?:标成待报销|标记为待报销|设为待报销)$/)
 if (m) {
  const from=alias(d,clean(m[1]));
  if(from) {
   try{return validate({intent:'action',action:'mark_reimbursable',from,reimbursable:true,start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }
 m = s.match(/^(?:取消|去掉)(.+?)(?:的待报销标记|的待报销)$/)
 if (m) {
  const from=alias(d,clean(m[1]));
  if(from) {
   try{return validate({intent:'action',action:'mark_reimbursable',from,reimbursable:false,start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }

 m = s.match(/^(?:给|把|将)(.+?)(?:的备注|备注)(?:全部|都|所有)?(?:加上前缀|加前缀)\s*[「『【]?(.*?)[」』】]?$/);
 if(m) {
  const from=alias(d,clean(m[1]));
  if(from) {
   try{return validate({intent:'action',action:'set_note_prefix',from,prefix:cleanTarget(m[2]),start:parsed.range.start,end:parsed.range.end},d,book);}catch{return null;}
  }
  return null;
 }

 m=s.match(/^(?:把|将)?(.+?)(?:的分类|分类|的账户|账户|的支付方式|支付方式|的付款方式)?(?:全部|都|所有)?(?:改成|改为|换成|调整为|变成)(.+)$/);
 if(m){
  const from=alias(d,clean(m[1])), targetStr=clean(m[2]);
  if(from){
   const toCat = alias(d, targetStr);
   if(toCat) {
    try{return validate({intent:'action',action:'reassign_category',from,to:toCat,start:parsed.range.start,end:parsed.range.end},d,book);}catch{}
   }
   const toAcc = aliasAccount(d, targetStr);
   if(toAcc) {
    try{return validate({intent:'action',action:'set_account',from,account:toAcc,start:parsed.range.start,end:parsed.range.end},d,book);}catch{}
   }
  }
 }

 return null;
}

function getTitleActionName(action){
 const map={set_categories:'改分类',set_category:'按内容改分类',reassign_category:'改分类',set_category_by_keyword:'按关键词改分类',add_tag:'加标签',remove_tag:'去标签',set_account:'改账户',set_method:'改支付方式',set_person:'设人物',mark_reimbursable:'标待报销',set_note_prefix:'备注加前缀',set_amount:'改金额',set_date:'改日期'};
 return map[action]||'批量修改';
}

function applyChange(t,task){
 const has=k=>Object.prototype.hasOwnProperty.call(t,k);
 let oldVal,newVal,field;
 if(task.action==='set_categories'||task.action==='set_category'||task.action==='reassign_category'||task.action==='set_category_by_keyword'){
  field='category';oldVal=t.category;newVal=task.action==='set_categories'?(task.changes.find(x=>x.id===t.id)||task.changes.find(x=>x.id===t.related))?.to:task.to;
 }else if(task.action==='add_tag'){
  field='tags';oldVal=t.tags||[];newVal=[...new Set([...oldVal,...task.tags])];
 }else if(task.action==='remove_tag'){
  field='tags';oldVal=t.tags||[];newVal=oldVal.filter(tag=>!task.tags.includes(tag));
 }else if(task.action==='set_account'){
  field='account';oldVal=t.account;newVal=task.account;
 }else if(task.action==='set_method'){
  field='account';oldVal=t.account;newVal=task.targetAccountId;
 }else if(task.action==='set_person'){
  field='person';oldVal=t.person||'';newVal=task.person;
 }else if(task.action==='mark_reimbursable'){
  field='reimbursable';oldVal=t.reimbursable;newVal=task.reimbursable;
 }else if(task.action==='set_note_prefix'){
  field='note';oldVal=t.note||'';newVal=task.prefix+oldVal;
 }else if(task.action==='set_amount'||task.action==='set_date'){
  field=task.action==='set_amount'?'amount':'date';oldVal=t[field];newVal=task[field];
 }
 return {oldVal,newVal,field,hadOld:field?has(field):true};
}

function formatValue(task,val,d){
 if(task.action==='set_categories'||task.action==='set_category'||task.action==='reassign_category'||task.action==='set_category_by_keyword')return C.categoryName(d,val);
 if(task.action==='add_tag'||task.action==='remove_tag')return (val||[]).join('、')||'无';
 if(task.action==='set_account'||task.action==='set_method')return d.accounts.find(a=>a.id===val)?.name||'未指定账户';
 if(task.action==='set_person')return val||'无';
 if(task.action==='mark_reimbursable')return val?'是':'否';
 if(task.action==='set_note_prefix')return val||'无';
 if(task.action==='set_amount')return '¥ '+C.money(val);
 if(task.action==='set_date')return val||'无';
 return String(val);
}

function preview(d,book,value){
 const task=validate(value,d,book);
 let rows=d.entries.filter(t=>t.book===book&&t.date>=task.start&&t.date<=task.end);
 if(task.from) rows=rows.filter(t=>t.category===task.from);
 const requested=task.action==='set_categories'?task.changes.map(x=>x.id):task.ids;
 if(requested){const ids=new Set(requested);rows=rows.filter(t=>ids.has(t.id));if(rows.length!==ids.size)throw Error('部分记录不在当前账本或日期范围');}
 if(task.action==='set_category'||task.action==='set_categories'){
  const target=t=>task.action==='set_categories'?task.changes.find(x=>x.id===t.id).to:task.to;
  for(const t of rows){const to=d.categories.find(c=>c.id===target(t)),type=t.kind==='income'?'income':['expense','refund','reimbursement'].includes(t.kind)?'expense':t.kind==='legacy'?d.categories.find(c=>c.id===t.category)?.type:null;if(!type||type!==to.type)throw Error('只能修改同一收支类型的记录分类，转账和余额调整不适用');}
  rows=rows.filter(t=>t.category!==target(t));
 }else if(task.action==='set_category_by_keyword'){
  rows=rows.filter(t=>[t.title,t.payee,t.note].join(' ').includes(task.keyword));
 }else if(task.action==='add_tag'){
  rows=rows.filter(t=>{
   const curr=t.tags||[];return !task.tags.every(tag=>curr.includes(tag));
  });
 }else if(task.action==='remove_tag'){
  rows=rows.filter(t=>{
   const curr=t.tags||[];return task.tags.some(tag=>curr.includes(tag));
  });
 }else if(task.action==='set_account'){
  rows=rows.filter(t=>t.account!==task.account);
 }else if(task.action==='set_method'){
  rows=rows.filter(t=>t.account!==task.targetAccountId);
 }else if(task.action==='set_person'){
  rows=rows.filter(t=>(t.person||'')!==task.person);
 }else if(task.action==='mark_reimbursable'){
  rows=rows.filter(t=>t.reimbursable!==task.reimbursable);
 }else if(task.action==='set_note_prefix'){
  rows=rows.filter(t=>!(t.note||'').startsWith(task.prefix));
 }else if(task.action==='set_amount'||task.action==='set_date'){
  rows=rows.filter(t=>t[task.action==='set_amount'?'amount':'date']!==task[task.action==='set_amount'?'amount':'date']);
 }

 const primaryCount=rows.length;
 if(categoryActions.has(task.action)){
  const selected=new Map(rows.map(t=>[t.id,t]));
  for(const t of [...d.entries,...d.trash])if(['refund','reimbursement'].includes(t.kind)&&selected.get(t.related)?.kind==='expense'){
   if(selected.has(t.id)&&applyChange(t,task).newVal!==applyChange(selected.get(t.related),task).newVal)throw Error('关联退款或报销须与原支出使用同一目标分类');
   if(!selected.has(t.id))selected.set(t.id,t);
  }
  rows=[...selected.values()];
 }
 const trashIds=new Set(d.trash.map(t=>t.id)),locations=rows.map(t=>trashIds.has(t.id)?'trash':'entries');
 const ids=rows.map(t=>t.id),signatures=rows.map(t=>JSON.stringify(t));
 let amount=0;for(const t of rows){amount+=C.base(t);if(!Number.isSafeInteger(amount))throw Error('合计超出安全范围');}
 const accounts=[...new Set(rows.map(t=>d.accounts.find(a=>a.id===t.account)?.name||'未指定账户'))];
 const months=[...new Set(rows.map(t=>t.date.slice(0,7)))];

 const selected=new Set(ids);
 if(categoryActions.has(task.action)&&[...d.entries,...d.trash].some(t=>['refund','reimbursement'].includes(t.kind)&&selected.has(t.id)!==selected.has(t.related)))throw Error('关联退款或报销须与原支出一起选择，请重新核对相关记录');
 const draft=C.clone(d);for(const t of [...draft.entries,...draft.trash])if(selected.has(t.id)){const change=applyChange(t,task);t[change.field]=Array.isArray(change.newVal)?C.clone(change.newVal):change.newVal;}C.validate(draft);C.validateChanges(d,draft);

 const actionName=getTitleActionName(task.action);
 const displayRows=(task.action==='set_categories'||task.action==='set_category'||task.action==='set_amount'||task.action==='set_date'?rows:rows.slice(0,10)).map((t,index)=>{
  const {oldVal,newVal}=applyChange(t,task);
  const oldStr=formatValue(task,oldVal,d),newStr=formatValue(task,newVal,d);
  return {id:t.id,date:t.date,title:(t.payee||t.title||'未命名账目')+(trashIds.has(t.id)?'（回收站 · 关联'+C.kinds[t.kind]+'）':index>=primaryCount?'（关联'+C.kinds[t.kind]+'）':''),amount:t.amount,currency:t.currency,oldStr,newStr,location:trashIds.has(t.id)?'trash':'entries'};
 });

 const linkedCount=rows.length-primaryCount,trashCount=locations.filter(x=>x==='trash').length;
 return {ok:true,intent:'action',task,book,ids,signatures,locations,linkedCount,trashCount,count:rows.length,amount,accounts,months,rows:displayRows,actionName,message:rows.length?`打算修改 ${task.start} 至 ${task.end} 匹配的 ${primaryCount} 笔记录`+(linkedCount?`，同时同步 ${linkedCount} 笔关联退款/报销`:'')+(trashCount?`（其中回收站 ${trashCount} 笔，仍保留在回收站）`:''):'没有符合条件的记录',facts:[]};
}

function allRows(d,plan){if(!plan.signatures)return plan.rows||[];return plan.ids.map((id,i)=>{const t=JSON.parse(plan.signatures[i]),values=applyChange(t,plan.task),location=plan.locations?.[i]||'entries',linked=i>=plan.count-(plan.linkedCount||0);return {id,date:t.date,title:(t.payee||t.title||'未命名账目')+(location==='trash'?'（回收站 · 关联'+C.kinds[t.kind]+'）':linked?'（关联'+C.kinds[t.kind]+'）':''),content:t.title||t.note||'',amount:t.amount,currency:t.currency,oldStr:formatValue(plan.task,values.oldVal,d),newStr:formatValue(plan.task,values.newVal,d),reason:plan.task.changes?.find(x=>x.id===id)?.reason||plan.task.reason||'',categoryId:categoryActions.has(plan.task.action)?values.newVal:undefined,location};});}
function withSelection(d,plan,ids){
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!plan.ids.includes(id)))throw Error('请选择预览内的记录');
 const fresh=preview(d,plan.book,plan.task);if(JSON.stringify(fresh.ids)!==JSON.stringify(plan.ids)||JSON.stringify(fresh.signatures)!==JSON.stringify(plan.signatures)||JSON.stringify(fresh.locations)!==JSON.stringify(plan.locations||plan.ids.map(()=>'entries')))throw changed();
 const selected=new Set(ids);if(categoryActions.has(plan.task.action)&&[...d.entries,...d.trash].some(t=>['refund','reimbursement'].includes(t.kind)&&selected.has(t.id)!==selected.has(t.related)))throw Error('关联退款或报销须一起选择');
 return {...plan,selectionIds:plan.ids.filter(id=>selected.has(id))};
}
function retarget(d,plan,id,to){
 withSelection(d,plan,plan.ids);const records=new Map([...d.entries,...d.trash].map(t=>[t.id,t])),selected=records.get(id);if(!selected||!plan.ids.includes(id))throw changed();
 const family=t=>['refund','reimbursement'].includes(t.kind)?t.related:t.id,root=family(selected),rows=new Map(allRows(d,plan).map(r=>[r.id,r]));
 const changes=plan.ids.slice(0,plan.count-(plan.linkedCount||0)).map(key=>{const row=rows.get(key),same=family(records.get(key))===root;return {id:key,to:same?to:row.categoryId,reason:same?(row.reason.slice(0,350)+'；用户调整目标：'+C.categoryName(d,to)).slice(0,500):row.reason};});
 return preview(d,plan.book,{intent:'action',action:'set_categories',start:plan.task.start,end:plan.task.end,changes});
}
function apply(d,plan){
 const current=preview(d,plan.book,plan.task);
 if(current.count!==plan.count||JSON.stringify(current.ids)!==JSON.stringify(plan.ids)||JSON.stringify(current.signatures)!==JSON.stringify(plan.signatures)||JSON.stringify(current.locations)!==JSON.stringify(plan.locations||plan.ids.map(()=>'entries')))throw changed();
 if(!plan.count)throw Error('没有可修改的记录');
 const selection=plan.selectionIds?withSelection(d,plan,plan.selectionIds).selectionIds:plan.ids;const ids=new Set(selection);
 const changes=[];
 for(const location of ['entries','trash'])for(const t of d[location])if(ids.has(t.id)){
  if(t.book!==plan.book)throw changed();
  const {oldVal,newVal,field,hadOld}=applyChange(t,plan.task);
  if(plan.task.action==='set_categories'||plan.task.action==='set_category'||plan.task.action==='reassign_category'||plan.task.action==='set_category_by_keyword')t.category=newVal;
  else if(plan.task.action==='add_tag'||plan.task.action==='remove_tag')t.tags=newVal;
  else if(plan.task.action==='set_account'||plan.task.action==='set_method')t.account=newVal;
  else if(plan.task.action==='set_person')t.person=newVal;
  else if(plan.task.action==='mark_reimbursable')t.reimbursable=newVal;
  else if(plan.task.action==='set_note_prefix')t.note=newVal;
  else if(plan.task.action==='set_amount'||plan.task.action==='set_date')t[field]=newVal;
  changes.push({id:t.id,old:oldVal,new:newVal,field,hadOld,location});
 }
 return {book:plan.book,ids:[...selection],action:plan.task.action,changes,count:selection.length};
}

function undo(d,receipt){
 const ids=new Set(receipt.ids);let restored=0,skipped=0;
 const indexes=Object.fromEntries(['entries','trash'].map(key=>[key,new Map(d[key].filter(t=>t.book===receipt.book).map(t=>[t.id,t]))]));
 const row=change=>indexes[change.location||'entries']?.get(change.id);
 const blocked=new Set();if(categoryActions.has(receipt.action)){
  const eligible=new Set(receipt.changes.filter(change=>row(change)?.category===change.new).map(x=>x.id));
  for(const t of [...d.entries,...d.trash])if(['refund','reimbursement'].includes(t.kind)&&(ids.has(t.id)||ids.has(t.related))&&(!eligible.has(t.id)||!eligible.has(t.related)))blocked.add(t.related);
 }
 const activeReturns=new Map();for(const t of d.entries)if(['refund','reimbursement'].includes(t.kind)){if(!activeReturns.has(t.related))activeReturns.set(t.related,[]);activeReturns.get(t.related).push(t);}
 const FIELD={set_categories:'category',set_category:'category',reassign_category:'category',set_category_by_keyword:'category',add_tag:'tags',remove_tag:'tags',set_account:'account',set_method:'account',set_person:'person',mark_reimbursable:'reimbursable',set_note_prefix:'note',set_amount:'amount',set_date:'date'};
 for(const change of receipt.changes){
  const t=row(change);
  if(!t){skipped++;continue;}
  if(blocked.has(t.related||t.id)){skipped++;continue;}
  let matches=false;
  if(receipt.action==='set_categories'||receipt.action==='set_category'||receipt.action==='reassign_category'||receipt.action==='set_category_by_keyword')matches=t.category===change.new;
  else if(receipt.action==='add_tag'||receipt.action==='remove_tag')matches=JSON.stringify(t.tags)===JSON.stringify(change.new);
  else if(receipt.action==='set_account'||receipt.action==='set_method')matches=t.account===change.new;
  else if(receipt.action==='set_person')matches=t.person===change.new;
  else if(receipt.action==='mark_reimbursable')matches=t.reimbursable===change.new;
  else if(receipt.action==='set_note_prefix')matches=t.note===change.new;
  else if(receipt.action==='set_amount'||receipt.action==='set_date')matches=t[change.field]===change.new;

  if(!matches){skipped++;continue;}

  const field=change.field||FIELD[receipt.action];
  if(!field){skipped++;continue;}
  const returned=activeReturns.get(t.id)||[];
  const original=indexes.entries.get(t.related);
  if(field==='date'&&(returned.some(r=>r.date<change.old)||original&&original.date>change.old)||
     field==='amount'&&t.kind==='expense'&&returned.reduce((sum,r)=>sum+r.amount,0)>change.old||
     field==='amount'&&original&&(activeReturns.get(original.id)||[]).reduce((sum,r)=>sum+(r.id===t.id?change.old:r.amount),0)>original.amount||
     field==='reimbursable'&&!change.old&&returned.some(r=>r.kind==='reimbursement')){skipped++;continue;}
  if(change.hadOld===false)delete t[field];   // 原来没有这个字段，撤销要还原成"没有"，不能塞空值
  else t[field]=change.old;

  restored++;
 }
 return {restored,skipped};
}

module.exports={allRows,withSelection,retarget,validate,parseLocal,preview,apply,undo};
