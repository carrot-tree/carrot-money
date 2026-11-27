'use strict';
const CategoryIcons=require('./category-icons');
const C=require('./core');
function csvRows(text){
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quote=false,line=1,startLine=1;
 const save=()=>{row.push(cell);if(row.some(x=>x.trim())){Object.defineProperty(row,'sourceLine',{value:startLine});rows.push(row);}row=[];cell='';};
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else if(quote||!cell.length)quote=!quote;else cell+=c;}else if(c===','&&!quote){row.push(cell);cell='';}else if(c==='\n'||c==='\r'){const crlf=c==='\r'&&text[i+1]==='\n';if(quote)cell+=crlf?'\r\n':c;else save();if(crlf)i++;line++;if(!quote)startLine=line;}else cell+=c;}
 if(quote)throw Error('CSV 引号不完整');save();return rows;
}
const hash=s=>{let h=14695981039346656037n;for(const c of s)h=BigInt.asUintN(64,(h^BigInt(c.codePointAt(0)))*1099511628211n);return h.toString(16);};
const fingerprint=t=>JSON.stringify([t.date,t.kind,t.currency,t.amount,t.legacyIncome,t.legacyExpense,t.title,t.payee]);
function timestamp(value){
 const match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):([0-5]\d)(?::([0-5]\d)(\.\d+)?)?(?:\s*(?:Z|(?:UTC|GMT)(?:[+-]\d{1,2}(?::?\d{2})?)?|[+-]\d{2}(?::?\d{2})?))?)?$/i.exec(value);
 if(!match)return {date:'',time:''};
 const date=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
 if(!C.validDate(date))return {date:'',time:''};
 // Keep the statement's local calendar date and wall-clock time.
 const time=match[4]&&Number(match[4])<24?`${date}T${match[4].padStart(2,'0')}:${match[5]}:${match[6]||'00'}${match[7]||''}`:'';
 return {date,time};
}
function sheetCents(value){
 try{return C.cents(value);}catch(error){
  if(!/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value))throw error;
  const number=Number(value);
  if(!Number.isSafeInteger(Math.round(number*100)))throw error;
  return C.cents(number.toFixed(2));
 }
}
function decode(buffer){try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return new TextDecoder('gb18030',{fatal:true}).decode(buffer);}}
function parse(text,d,book,account){const rows=csvRows(text);const h=rows.findIndex(r=>r.some(x=>dateHeaders.includes(x.trim())));if(h<0)throw Error('未找到日期表头。支持微信 / 支付宝 CSV、Notion 明细 CSV 和本插件 CSV。');const headers=rows[h].map(x=>x.trim());if(headers.includes('到账金额')&&headers.includes('关联账目'))throw Error('本插件 CSV 用于查阅。完整恢复请导入 JSON，以保留账户和关联关系。');const source=headers.includes('交易单号')?'wechat':headers.some(x=>['交易号','交易订单号'].includes(x))?'alipay':'csv';const occurrences=new Map(),accepted=[],rejected=[],ignored=[];
 for(let i=h+1;i<rows.length;i++){const row=rows[i];if(row.length<3||/^[-—]{3,}/.test(row[0]?.trim()||''))continue;const r=Object.fromEntries(headers.map((k,j)=>[k,(row[j]||'').trim()])),pick=keys=>keys.map(k=>r[k]).find(Boolean)||'';try{const status=pick(sheetAliases.status);if(/失败|关闭|撤销|取消/.test(status)){ignored.push({line:row.sourceLine||i+1,reason:status});continue;}if(/处理中|待支付|未支付|拒绝|退款中|交易中|异常|超时|待确认/.test(status))throw Error('交易状态「'+status+'」尚未确认完成，请使用账单复核入口核实');
 const dateRaw=pick(dateHeaders),day=dateRaw.split(/[ T]/)[0].replace(/\//g,'-'),parts=day.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/),date=parts?`${parts[1]}-${parts[2].padStart(2,'0')}-${parts[3].padStart(2,'0')}`:day;if(date&&!C.validDate(date))throw Error('日期无法识别');const notion='收入' in r&&'支出' in r&&!headers.includes('类型');let kind=pick(['类型','收/支','收支','方向']);kind=Object.keys(C.kinds).find(k=>C.kinds[k]===kind)||({'收入':'income','支出':'expense'})[kind]||kind;const title=pick(['商品说明','商品名称','商品','标题','摘要','用途','交易类型'])||'导入账目',payee=pick(sheetAliases.payee);
 const currency=r['币种']||'CNY';if(notion&&currency!=='CNY')throw Error('Notion 收入/支出双金额格式仅支持人民币，请先折合人民币，或改为含类型、金额、币种和汇率的 CSV');if(currency!=='CNY'&&!r['汇率'])throw Error('外币 CSV 需提供汇率列（1 单位原币折合人民币），请补充后重新导入');
 let t=C.newEntry(d,{date,title,payee,book,account,tags:C.list(r['标签']),person:r['谁']||r['人物']||'',note:r['备注']||'',location:r['位置']||'',currency,rate:Number(r['汇率']||1)});
 if(notion){t.kind='legacy';t.account='';t.legacyIncome=/^(?:[-—]+)?$/.test(r['收入'])?null:C.cents(r['收入']);t.legacyExpense=/^(?:[-—]+)?$/.test(r['支出'])?null:C.cents(r['支出']);t.legacyMonths=C.list(r['所属年月']);}
 else{if(!['income','expense'].includes(kind)){throw Error('中性交易、转账或退款需人工确认，请手动记账避免重复计算');}if(/退款|退还|报销/.test(title+' '+status+' '+(r['交易类型']||'')))throw Error('退款 / 报销请关联原账目后录入');t.kind=kind;t.amount=C.cents(pick(amountHeaders));}
 const category=pick(['交易分类','分类']),available=d.categories.filter(c=>!c.archived&&(notion||c.type===t.kind)),matched=available.filter(c=>C.categoryName(d,c.id)===category||c.name===category);t.category=matched.length===1?matched[0].id:available.find(c=>c.name==='其他')?.id||'';
 const order=pick(['交易单号','交易号','交易订单号','订单号']).replace(/\t/g,'').trim();const fp=fingerprint(t);const n=(occurrences.get(fp)||0)+1;occurrences.set(fp,n);t.id=r.ID||r.id||(order?source+'-'+order:'csv-'+hash(fp)+'-'+n);t.externalId=order;t.importSource=source;t.importIdentity=order?source+'-'+order:t.id;t.importMethod=pick(sheetAliases.method);t.importCategoryLabel=category;t.importStatus=status;const {time}=timestamp(dateRaw);if(time)t.importTime=time;C.validate({...d,entries:[t],trash:[],rules:[],templates:[],budgets:[],goals:[],imports:[]});accepted.push(t);
 }catch(e){rejected.push({line:row.sourceLine||i+1,reason:e.message,raw:r});}}
 if(!accepted.length&&!rejected.length&&!ignored.length)throw Error('CSV 中没有可识别的账目');return {accepted,rejected,ignored,source};}
function plan(d,rows){
 const saved=[...d.entries,...d.trash],prints=new Set(saved.map(fingerprint)),batchPrints=new Map(),add=[],duplicates=[],suspects=[],conflicts=[];
 const keys=t=>[...new Set([t.id,t.importIdentity,t.externalId&&t.importSource?t.importSource+'-'+t.externalId:''].filter(Boolean))];
 const index=()=>({ids:new Map(),orders:new Map()}),existing=index(),batch=index();
 const insert=(idx,item)=>{for(const key of keys(item.t)){if(!idx.ids.has(key))idx.ids.set(key,[]);idx.ids.get(key).push(item);}if(item.t.externalId){if(!idx.orders.has(item.t.externalId))idx.orders.set(item.t.externalId,[]);idx.orders.get(item.t.externalId).push(item);}};
 const find=(idx,t)=>[...new Set([...keys(t).flatMap(key=>idx.ids.get(key)||[]),...(idx.orders.get(t.externalId)||[]).filter(x=>t.importSource==='sheet'||x.t.importSource==='sheet')])];
 for(const t of saved)insert(existing,{t});
 for(const t of rows){const fp=fingerprint(t),stored=find(existing,t),prior=find(batch,t),item={t,conflict:false};
  if(stored.length){if(stored.some(x=>fingerprint(x.t)!==fp))conflicts.push(t);else duplicates.push(t);}
  else if(prior.length){const bad=prior.some(x=>x.conflict||fingerprint(x.t)!==fp);if(bad){item.conflict=true;for(const x of prior){x.conflict=true;for(const list of [add,suspects,duplicates]){const at=list.indexOf(x.t);if(at>=0)list.splice(at,1);}if(!conflicts.includes(x.t))conflicts.push(x.t);}conflicts.push(t);}else duplicates.push(t);}
  else if(prints.has(fp)||(batchPrints.get(fp)||[]).some(x=>!x.externalId||!t.externalId))suspects.push(t);else add.push(t);
  insert(batch,item);
  if(!batchPrints.has(fp))batchPrints.set(fp,[]);batchPrints.get(fp).push(t);
 }
 return {add,duplicates,suspects,conflicts};
}
function confirmPlan(d,rows,preview,includeSuspects=false){
 const current=plan(d,rows);if(JSON.stringify(current)!==JSON.stringify(preview))throw Error('预览后导入结果已变化，请重新打开文件核对');
 return C.clone([...current.add,...(includeSuspects?current.suspects:[])]);
}
function cell(v){let s=String(v??'');if(/^[=+@\t\r]/.test(s)||/^-[^\d]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function exportCSV(d,rows){const headers=['ID','日期','类型','标题','金额','币种','汇率','收入','支出','分类','账本','账户','对方账户','到账金额','交易对方','人物','标签','备注','关联账目','位置','分类图标'];return '\uFEFF'+[headers,...rows.map(t=>{const s=C.impact({...t});return [t.id,t.date,C.kinds[t.kind],t.title,(t.amount/100).toFixed(2),t.currency,t.rate,t.kind==='legacy'&&t.legacyIncome===null?'':(s.income/100).toFixed(2),t.kind==='legacy'&&t.legacyExpense===null?'':(s.expense/100).toFixed(2),C.categoryName(d,t.category),d.books.find(x=>x.id===t.book)?.name,d.accounts.find(x=>x.id===t.account)?.name,d.accounts.find(x=>x.id===t.toAccount)?.name,(t.toAmount/100).toFixed(2),t.payee,t.person,t.tags.join(', '),t.note,t.related,t.location,CategoryIcons.display(d.categories.find(c=>c.id===t.category))];})].map(r=>r.map(cell).join(',')).join('\r\n');}
// Review parsing deliberately does not call validate/newEntry: missing or special
// fields must survive until the user corrects them. The legacy parser accepts
// ordinary completed income/expense rows and keeps special transactions outside it.
const dateHeaders=['交易时间','交易创建时间','付款时间','日期'];
const amountHeaders=['金额','金额(元)','金额（元）','金额(人民币)','金额（人民币）'];
const incomeHeaders=['收入'],expenseHeaders=['支出'];
const sheetAliases={title:['摘要','商品说明','用途','商品名称','商品','标题'],payee:['交易对方','对方','商户','交易对方名称'],direction:['收/支','收支','方向','类型'],status:['交易状态','状态','当前状态'],category:['交易分类','分类'],method:['支付方式','付款方式','收/付款方式','账户','资金状态'],order:['订单号','交易号','交易订单号','交易单号'],note:['备注']};
function reviewHeader(rows){
 const index=rows.findIndex(r=>r.some(x=>dateHeaders.includes(x.trim())));
 if(index<0)throw Error('未找到日期表头。支持微信 / 支付宝 CSV、Notion 明细 CSV 和本插件 CSV。');
 const headers=rows[index].map(x=>x.trim());
 if(headers.includes('到账金额')&&headers.includes('关联账目'))throw Error('本插件 CSV 用于查阅。完整恢复请导入 JSON，以保留账户和关联关系。');
 if(headers.includes('收入')&&headers.includes('支出')&&!headers.includes('类型'))throw Error('Notion 明细 CSV 请使用「数据与备份」中的原有导入入口。');
 const source=headers.includes('交易单号')?'wechat':headers.some(x=>['交易号','交易订单号'].includes(x))?'alipay':'';
 if(!source||!headers.some(x=>amountHeaders.includes(x)))throw Error('AI 记账仅支持支付宝 / 微信账单表头；其他 CSV 请使用「数据与备份」导入。');
 return {index,headers,source};
}
function parseReview(text,file=''){
 const rows=csvRows(text),header=reviewHeader(rows);return parseReviewRows(rows,file,header);
}
function parseReviewRows(rows,file='',header){
 const {index,headers,source}=header,records=[],occurrences=new Map();
 for(let i=index+1;i<rows.length;i++){
  const values=rows[i];if(/^[-—]{3,}/.test(values[0]?.trim()||''))continue;
  // Export footnotes are single-cell lines. A damaged data row is retained.
  if(values.length===1&&!/^\d{4}[-/]/.test(values[0].trim()))continue;
  const raw=Object.fromEntries(headers.map((k,j)=>[k,(values[j]||'').trim()]));
  const pick=keys=>keys.map(k=>raw[k]).find(Boolean)||'';
  const dateRaw=pick(dateHeaders),{date,time}=timestamp(dateRaw),parseAmount=source==='sheet'?sheetCents:C.cents;
  const income=pick(incomeHeaders),expense=pick(expenseHeaders);
  const positive=value=>{try{return parseAmount(value)>0;}catch{return false;}};
  const hasIncome=positive(income),hasExpense=positive(expense);
  const amountRaw=pick(amountHeaders)||(hasExpense?expense:hasIncome?income:expense||income);
  let amount=null,amountError='';try{amount=parseAmount(amountRaw);}catch(e){amountError=e.message;}
  const order=pick(source==='sheet'?sheetAliases.order:['交易单号','交易号','交易订单号']).replace(/\t/g,'').trim();
  const record={source,file,line:values.sourceLine||i+1,raw,order,date,dateRaw,time,amount,amountRaw,amountError,
   title:pick(source==='sheet'?sheetAliases.title:['商品说明','商品名称','商品','标题','交易类型']),payee:pick(source==='sheet'?sheetAliases.payee:['交易对方','交易对方名称']),
   note:pick(['备注']),direction:pick(source==='sheet'?sheetAliases.direction:['收/支','收支','类型'])||(hasIncome&&!hasExpense?'收入':hasExpense&&!hasIncome?'支出':''),status:pick(source==='sheet'?sheetAliases.status:['交易状态','当前状态']),
   type:pick(['交易类型','交易分类']),method:pick(source==='sheet'?sheetAliases.method:['支付方式','收/付款方式','付款方式','资金状态']),
   currency:pick(['币种'])||'CNY',rate:pick(['汇率'])?Number(pick(['汇率'])):null,categoryLabel:pick(['交易分类','分类'])};
  const sheetSignature=[time||date||dateRaw,Number.isSafeInteger(amount)?amount:amountRaw,record.payee];
  const signature=source==='sheet'?JSON.stringify([...sheetSignature,record.title,record.direction]):JSON.stringify([source,dateRaw,amountRaw,record.direction,record.title,record.payee]);
  const n=(occurrences.get(signature)||0)+1;occurrences.set(signature,n);
  record.id=order?source+'-'+order:'ai-'+source+'-'+hash(signature)+'-'+n;
  if(source==='sheet'&&!order&&n===1)record.legacyId='ai-sheet-'+hash(JSON.stringify(sheetSignature));
  record.key=C.uid();records.push(record);
 }
 if(!records.length)throw Error((source==='sheet'?'Excel':'CSV')+' 中没有可识别的账目');
 return {source,records};
}
function parseSheetRows(rows,file=''){
 // Excel 里常见的整行空白（尾部空行、分节空行）不该变成「什么都缺」的待核实记录。
 rows=rows.filter(r=>Array.isArray(r)&&r.some(x=>String(x??'').trim()!==''));
 const header=rows.slice(0,40).map((r,index)=>({index,headers:r.map(x=>String(x??'').trim())})).find(({headers})=>headers.some(x=>dateHeaders.includes(x))&&(headers.some(x=>amountHeaders.includes(x))||headers.includes('收入')||headers.includes('支出')));
 if(!header){const seen=[...new Set(rows.slice(0,40).flat().map(x=>String(x??'').trim()).filter(Boolean))].slice(0,24);const hasDate=seen.some(x=>dateHeaders.includes(x)),hasAmount=seen.some(x=>[...amountHeaders,'收入','支出'].includes(x));throw Error('Excel 前 40 行未找到完整表头；找到的列：'+(seen.join('、')||'无')+'；'+(hasDate&&hasAmount?'日期列与金额列不在同一行':'缺少：'+[!hasDate?'日期列':'',!hasAmount?'金额列':''].filter(Boolean).join('、')));}
 return parseReviewRows(rows,file,{...header,source:'sheet'});
}
module.exports={csvRows,decode,parse,parseReview,parseSheetRows,reviewHeader,plan,confirmPlan,exportCSV,fingerprint,dateHeaders,amountHeaders};
