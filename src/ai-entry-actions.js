'use strict';
const C=require('./core');
const names=new Set(['create_entry','create_entries']);
const fields=['kind','title','date','amount','currency','rate','category','account','toAccount','toAmount','related','note','payee','person','tags','reimbursable','splits'];
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
// Only explicit creation commands carry a fixed count. Other numbers (prices,
// dates, past queries) must not turn into an inferred number of new entries.
function requestedCount(question){
 const matches=[...String(question).matchAll(/(?:^|[，,。；;：:\n]|帮我|请|再|先|给我)\s*(?:记录|记|新增|添加)(?:账|下|上|入|一下)?\s*([0-9]{1,2}|[一二两三四五六七八九十]{1,3})\s*笔/g)];
 if(matches.length!==1)return null;
 const text=matches[0][1],digits={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
 let count;if(/^\d+$/.test(text))count=Number(text);else if(text.includes('十')){const [a,b]=text.split('十');if(text.split('十').length!==2||a&&!digits[a]||b&&!digits[b])return null;count=(a?digits[a]:1)*10+(b?digits[b]:0);}else count=digits[text];
 return Number.isInteger(count)&&count>=1&&count<=50?count:null;
}
function argsList(name,args){
 if(!names.has(name)||!object(args))throw Error('新增账目参数无效');
 if(args.replacesTurn!==undefined&&(!Number.isInteger(args.replacesTurn)||args.replacesTurn<1))throw Error('替代预览轮次无效');
 if(name==='create_entry'){const {replacesTurn,...item}=args;return [item];}
 if(Object.keys(args).some(k=>!['entries','replacesTurn'].includes(k))||!Array.isArray(args.entries)||!args.entries.length||args.entries.length>50)throw Error('请提供1至50笔待新增账目');
 return args.entries;
}
function normalize(d,book,raw,id){
 if(!object(raw)||Object.keys(raw).some(k=>!fields.includes(k)))throw Error('新增账目含无效字段');
 if(!['expense','income','transfer','refund','reimbursement'].includes(raw.kind))throw Error('请选择支出、收入、转账、退款或报销到账');
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>200)throw Error('请提供200字以内的账目名称');
 if(!C.validDate(raw.date))throw Error('请提供明确日期YYYY-MM-DD，不能猜测日期');
 if(!Number.isSafeInteger(raw.amount)||raw.amount<=0)throw Error('金额须为大于零的整数分');
 for(const k of ['note','payee','person'])if(raw[k]!==undefined&&(typeof raw[k]!=='string'||raw[k].length>(k==='note'?4000:200)))throw Error(k+'无效');
 if(raw.tags!==undefined&&(!Array.isArray(raw.tags)||raw.tags.length>30||raw.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>80)))throw Error('标签无效');
 if(raw.reimbursable!==undefined&&typeof raw.reimbursable!=='boolean')throw Error('待报销标记须为布尔值');
 const linked=['refund','reimbursement'].includes(raw.kind),original=linked?d.entries.find(t=>t.id===raw.related&&t.book===book&&t.kind==='expense'):null;
 if(linked&&!original)throw Error('请先查询并选择当前账本中真实存在的原支出');
 if(!linked&&raw.related)throw Error('只有退款或报销到账可以关联原支出');
 const currency=linked?original.currency:raw.currency||'CNY';
 const account=id=>{const a=d.accounts.find(a=>a.id===id&&!a.archived);if(!a)throw Error('请先查询并明确选择可用付款/收款账户，不能猜测账户');return a;};
 if(!raw.splits?.length&&!raw.account)throw Error('还缺付款/收款账户，请先向用户询问');
 if(raw.account&&account(raw.account).currency!==currency)throw Error('币种与付款/收款账户不一致');
 if(raw.splits!==undefined&&(!Array.isArray(raw.splits)||raw.splits.some(s=>!object(s)||Object.keys(s).some(k=>!['account','amount'].includes(k))||account(s.account).currency!==currency)))throw Error('组合付款账户无效');
 let rate=linked?original.rate:currency==='CNY'?1:raw.rate;
 if(!Number.isFinite(rate)||rate<=0)throw Error('外币账目缺少明确的历史折算人民币汇率，请补充后再预览');
 if(currency==='CNY'&&raw.rate!==undefined&&raw.rate!==1)throw Error('人民币汇率须为1');
 if(linked&&(raw.currency!==undefined&&raw.currency!==currency||raw.rate!==undefined&&raw.rate!==rate))throw Error('退款/报销须沿用原单币种和汇率');
 const category=linked?original.category:raw.kind==='transfer'?'':raw.category;
 if(['expense','income'].includes(raw.kind)){const cat=d.categories.find(c=>c.id===category&&!c.archived&&c.type===raw.kind);if(!cat)throw Error('请选择收支类型一致的可用分类');}
 let toAmount=0;
 if(raw.kind==='transfer'){
  const to=account(raw.toAccount);if(raw.account===raw.toAccount)throw Error('转出和转入账户不能相同');
  toAmount=to.currency===currency?raw.amount:raw.toAmount;
  if(raw.toAmount!==undefined&&to.currency===currency&&raw.toAmount!==raw.amount)throw Error('同币种转账到账金额应与转出金额一致，手续费另记支出');
  if(!Number.isSafeInteger(toAmount)||toAmount<=0)throw Error('跨币种转账须明确到账原币金额');
 }else if(raw.toAccount||raw.toAmount)throw Error('只有转账可以设置到账账户和金额');
 return C.newEntry(d,{...C.clone(raw),id,book,title:raw.title.trim(),currency,rate,category:category||'',toAmount});
}
const duplicateKey=t=>JSON.stringify([t.kind,t.date,t.amount,t.currency,t.account,t.toAccount,t.toAmount,t.related,t.title.trim(),t.payee||'']);
function detail(d,t){
 const parts=[];if(t.currency!=='CNY')parts.push('历史汇率 1 '+t.currency+' = '+t.rate+' CNY · 折合 ¥'+C.money(C.base(t)));
 if(t.kind==='transfer'){const to=d.accounts.find(a=>a.id===t.toAccount);parts.push('转入 '+to.currency+' '+C.money(t.toAmount)+' · 内部转账，不计收入和支出');}
 if(t.splits?.length)parts.push('组合付款：'+t.splits.map(s=>(d.accounts.find(a=>a.id===s.account)?.name||'账户')+' '+t.currency+' '+C.money(s.amount)).join('、'));
 if(t.reimbursable)parts.push('待报销');
 if(t.related){const original=d.entries.find(x=>x.id===t.related),summary=C.expenseSummary(d,original);parts.push('原单 '+original.date+' · 原付 '+t.currency+' '+C.money(summary.paid)+' · 此前已退/报销 '+C.money(summary.refund+summary.reimbursement)+' · 本次到账 '+C.money(t.amount)+' · 确认后净支出 '+C.money(summary.net-t.amount));}
 if(t.note)parts.push('说明：'+t.note);return parts.join('；');
}
function preview(d,book,name,args,{ids}={}){
 if(!d.books.some(b=>b.id===book&&!b.archived))throw Error('当前账本不存在或已归档');
 const raw=argsList(name,args),items=raw.map((x,i)=>normalize(d,book,x,ids?.[i]||C.uid()));
 if(new Set(items.map(t=>t.id)).size!==items.length||items.some(t=>[...d.entries,...d.trash].some(x=>x.id===t.id)))throw Error('待新增账目ID已存在，请重新预览');
 const draft=C.clone(d);draft.entries.push(...C.clone(items));C.validateChanges(d,draft);C.validate(draft);
 const seen=new Set([...d.entries,...d.trash].filter(t=>t.book===book).map(duplicateKey)),duplicates=[];
 for(const t of items){const key=duplicateKey(t);if(seen.has(key))duplicates.push(t.id);seen.add(key);}
 const amount=items.reduce((n,t)=>n+C.base(t),0);if(!Number.isSafeInteger(amount))throw Error('合计金额超出安全范围');
 const account=id=>d.accounts.find(a=>a.id===id)?.name||'未指定';
 return {ok:true,intent:'agent_write',name,book,request:C.clone(args),items,ids:items.map(t=>t.id),defaultIds:items.filter(t=>!duplicates.includes(t.id)).map(t=>t.id),duplicates,count:items.length,amount,actionName:'新增账目',rows:items.map(t=>({id:t.id,title:t.title,content:detail(d,t),date:t.date,amount:t.amount,currency:t.currency,oldStr:'尚未入账',newStr:C.kinds[t.kind]+' · '+(t.kind==='transfer'?account(t.account)+' → '+account(t.toAccount):account(t.account)+' · '+C.categoryName(d,t.category)),reason:duplicates.includes(t.id)?'疑似与账本、回收站或本批其他记录重复；默认不勾选，请人工核对':t.related?'关联原支出：'+d.entries.find(x=>x.id===t.related)?.title:'确认日期、金额、账户和分类后入账'})),message:'这是新增账目预览，尚未入账。'+(duplicates.length?'有'+duplicates.length+'笔疑似重复，默认不勾选。':''),facts:[]};
}
function fresh(d,plan){const next=preview(d,plan.book,plan.name,plan.request,{ids:plan.ids});if(JSON.stringify(next.items)!==JSON.stringify(plan.items)||JSON.stringify(next.duplicates)!==JSON.stringify(plan.duplicates))throw Error('账户、原单或新增预览已变化，请重新预览');return next;}
function withSelection(d,plan,ids){fresh(d,plan);if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!plan.ids.includes(id)))throw Error('请选择预览中的账目');return {...plan,selectionIds:plan.ids.filter(id=>ids.includes(id))};}
function apply(d,plan){
 fresh(d,plan);const ids=plan.selectionIds||plan.defaultIds;
 if(!ids?.length)throw Error('请先勾选要新增的账目；疑似重复记录需要明确确认');
 const chosen=withSelection(d,plan,ids),items=plan.items.filter(t=>chosen.selectionIds.includes(t.id)),draft=C.clone(d);draft.entries.push(...C.clone(items));C.validateChanges(d,draft);C.validate(draft);d.entries=draft.entries;
 return {name:plan.name,book:plan.book,ids:items.map(t=>t.id),executedIds:items.map(t=>t.id),items:C.clone(items),count:items.length};
}
function undo(d,receipt){
 const ids=new Set(receipt.items.filter(t=>{const current=d.entries.find(x=>x.id===t.id&&x.book===receipt.book);return current&&JSON.stringify(current)===JSON.stringify(t);}).map(t=>t.id));
 for(const t of d.entries)if(t.related&&ids.has(t.related)&&!ids.has(t.id))ids.delete(t.related);
 const draft=C.clone(d);C.removeEntries(draft,[...ids]);C.validate(draft);d.entries=draft.entries;d.trash=draft.trash;
 return {restored:ids.size,skipped:receipt.ids.length-ids.size,restoredIds:[...ids],skippedIds:receipt.ids.filter(id=>!ids.has(id))};
}
function edit(d,plan,id,changes){
 const at=plan.ids.indexOf(id);if(at<0)throw Error('找不到待新增账目');
 const args=C.clone(plan.request),raw=plan.name==='create_entry'?args:args.entries[at];Object.assign(raw,changes);
 return preview(d,plan.book,plan.name,args,{ids:plan.ids});
}
module.exports={names,requestedCount,preview,withSelection,apply,undo,edit};
