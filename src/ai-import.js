'use strict';
const C=require('./core'),I=require('./imports'),Z=require('./ai-zip'),X=require('./ai-xlsx'),Exclusions=require('./ai-exclusions');
const natureNames={expense:'支出',income:'收入',transfer:'转账',repayment:'还款',refund:'退款',reimbursement:'报销到账',neutral:'中性交易',unknown:'无法判断'};
const groupNames={ready:'可直接确认',review:'待核实',unknown:'无法识别'};
const confidenceNames={high:'高',medium:'中',low:'低'};
// 模型只能从这组代码里提出疑点，代码到中文标签的映射留在本地，避免模型自由发挥。
const flagNames={direction:'方向与摘要矛盾',transfer:'疑似转账未按转账处理',refund:'疑似退款未关联原支出',duplicate:'疑似重复',amount:'金额异常',category:'分类与性质不符',other:'其他疑点'};
const flagLabel=code=>flagNames[code]||String(code);
// 模型可以给代码，也可以给中文说法（提示词里用的是短说法），这里按关键词归一。
const flagHints={direction:/方向/,transfer:/转账/,refund:/退款|退货/,duplicate:/重复/,amount:/金额/,category:/分类|性质/,other:/其他/};
const flagKey=value=>{if(typeof value!=='string')return undefined;const text=value.trim();if(!text)return undefined;return Object.hasOwn(flagNames,text)?text:Object.keys(flagNames).find(code=>flagNames[code]===text||flagHints[code].test(text));};
const LARGE_AMOUNT=10000000,NEAR_MS=5*60*1000;
const level=score=>score>=.85?'high':score>=.55?'medium':'low';
const clean=s=>String(s||'').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
function nature(r){
 const text=[r.type===r.categoryLabel&&r.type==='充值缴费'?'':r.type,r.title,r.status,r.note].join(' ');
 // A debit may later say 已退款 in its status. It remains the original
 // expense; only the separate credit reverses the corresponding amount.
 const refundText=[r.type,r.title,r.note,r.direction==='支出'?'':r.status].join(' ');
 if(/退款|退还|退货|冲正/.test(refundText))return 'refund';
 if(/报销/.test(text))return 'reimbursement';
 if(/信用卡还款|还信用卡|花呗还款|借呗还款|信用贷还款|贷款还款|还贷/.test(text)||/信用借还/.test(r.type||'')&&/还款成功/.test(r.status||''))return 'repayment';
 const yieldText=[r.type,r.title].join(' ');
 if(/收益发放|利息发放/.test(yieldText)&&r.direction!=='支出'){
  const paid=/^(?:支付成功|交易成功|已支付|已收款|对方已收钱|收款成功|已到账|发放成功|到账成功)$/.test(r.status||'');
  // Explicit paid yield is income; moving principal or reinvesting proceeds
  // is not another receipt. Missing/unfinished status stays for manual review.
  return r.direction==='收入'&&paid&&!/本金|赎回|转入|转出|转存|收款到/.test(yieldText)?'income':'neutral';
 }
 if(/余额宝|零钱通|理财|基金|证券|货币基金/.test(text))return 'neutral';
 if(/转账|转入|转出|提现/.test(text)||/充值/.test(text)&&!/缴费|电费|水费|话费|流量/.test(text))return 'transfer';
 if(/^(不计收支|中性|\/|—|-)$/.test(r.direction))return 'neutral';
 return ({收入:'income',支出:'expense'})[r.direction]||'unknown';
}
// Match only unique, active categories. A brand / distinctive industry phrase
// is stronger evidence than a generic shop word; conflicting targets stay low.
const categoryRules=[
 {strong:/美团外卖|饿了么|肯德基|麦当劳|华莱士|沙县|餐饮|饭店|food|cuisine|早餐|午餐|晚餐|木桑森林|川黔娃|凉面凉皮凉粉|小尖尖串串|沈六六手工炸串|李肉肉|黄包子|外卖|轻食|麻辣烫|火锅|凉皮|串串|餐|饭|粉|汉堡|牛丼|咖喱|饺子|食堂|牛肉面|酱香饼|馒头|钵钵鸡|三明治|回锅肉|肝腰|铁板鸡架|砂锅/,weak:/餐厅|餐馆|小吃|饮食/,names:['正餐','餐饮','餐饮美食']},
 {strong:/星巴克|瑞幸|霸王茶姬|蜜雪冰城|m stand/,weak:/咖啡|奶茶|饮料|茶饮/,names:['喝滴','饮品']},
 {strong:/水果|果园/,names:['水果']},
 {strong:/零食|饼干|蛋糕|蛋糕店/,names:['零食']},
 {strong:/滴滴|高德打车|地铁|公交|etc|通行费|高速/,weak:/打车|出租车|高铁|火车|停车|交通/,names:['交通','交通出行']},
 {strong:/^(?![\s\S]*(?:运费险|退运费|运费退|退还|退款|赠送|免运费|无需运费|包邮))[\s\S]*(?:寄件费|快递费|运费)/,names:['快递']},
 {strong:/小桔充电|中石油|中石化|加油站|充电桩/,weak:/加油|汽车充电/,names:['汽车']},
 {strong:/国家电网|房租|物业|电力|供电|自来水|水费|燃气|贝壳租房|商业管理/,weak:/电费|宽带/,names:['住','居住','住房']},
 {strong:/老百姓大药房|益丰|医院|门诊/,weak:/药房|药店|挂号|医疗|体检/,names:['医疗','健康']},
 {strong:/中国移动|中国联通|中国电信/,weak:/话费|流量充值/,names:['日用滴','通讯']},
 {strong:/万达影城|猫眼|哔哩哔哩|网鱼网咖|网鱼电竞|爱奇艺/,weak:/电影|影城|影院|游戏|演唱会|娱乐/,names:['娱乐','影视']},
 {strong:/优衣库|耐克|阿迪达斯|迪卡侬|淘宝服饰|买衣服/,weak:/衣服|服装|服饰|鞋子|棉鞋|拖鞋|皮鞋|凉鞋|靴子/,names:['穿滴','购物']},
 {strong:/珠宝|首饰|金饰/,weak:/项链|耳环|戒指/,names:['饰品']},
 {strong:/手机|电脑|笔记本电脑|酷毅|数码电器|绿联数码/,weak:/数码|电子设备/,names:['电子产品']},
 {strong:/永辉超市|拼多多|京东商城|屈臣氏|万宁|丝芙兰|名创优品|红旗连锁|盒马|客多多|智能柜|便利店|超市|菜场|钱大妈/,weak:/百货|淘宝|天猫|京东|商城|购物/,names:['日用滴','购物']},
 {strong:/app store|icloud|deepseek|chatcut|nous research|yuansfer|瓦力网络|四维图新|稀宇科技|anomaly innovations/,weak:/\bapi\b|软件订阅/,names:['软件']},
 {strong:/花呗|借呗/,names:['金融']},
 {strong:/健身|健身房|游泳馆|运动|球馆/,weak:/瑜伽|球场|体育|跑步|健走/,names:['运动']},
 {strong:/书店|买书|学费/,weak:/课程|培训|教材/,names:['学习','知识']},
 {strong:/礼品|礼物/,weak:/红包|礼金/,names:['礼品','人情','社交']},
 {strong:/工资|薪资|薪酬|奖金/,names:['工资'],kind:'income'},
 {strong:/广告|商单/,names:['广告'],kind:'income'},
 {strong:/咨询/,names:['咨询'],kind:'income'}
];
// Bill labels only narrow down existing expense categories. Multiple available
// candidates are ambiguous; never create a category or guess a transaction nature.
const billCategoryCandidates={
 '餐饮美食':['正餐','夜宵','喝滴'],
 '日用百货':['日用滴'],
 '住房物业':['住'],
 '数码电器':['电子产品'],
 '交通出行':['交通'],
 '酒店旅游':['旅游'],
 '运动户外':['运动'],
 '教育培训':['学习'],
 '服饰装扮':['穿滴'],
 '爱车养车':['汽车'],
 '投资理财':['金融'],
 '其他':['其他']
};
function category(r,d,kind){
 const type=kind==='income'?'income':'expense',available=d.categories.filter(c=>!c.archived&&c.type===type);
 const explicit=available.filter(c=>c.name===r.categoryLabel||C.categoryName(d,c.id)===r.categoryLabel);
 if(explicit.length===1&&!['其他','餐饮美食','文化休闲','商业服务','充值缴费','生活服务'].includes(r.categoryLabel))return {id:explicit[0].id,score:.95,reason:'沿用账单中的分类'};
 const text=[r.title,r.payee,r.type===r.categoryLabel?'':r.type].join(' ').toLowerCase(),matches=new Map();let ambiguous=false;
 // Distinctive providers beat generic product words (a supermarket may sell a sandwich).
 const distinctive=[[/盒马|钱大妈|厨房剪|食品四门市/,['日用滴','购物']],[/m stand|咖啡|奶茶|米凉虾|绵绵冰/,['喝滴','饮品']],[/app store|icloud|deepseek|chatcut|nous research|yuansfer|四维图新/,['软件']],[/网鱼网咖|网鱼电竞/,['娱乐','影视']],[/迪卡侬/,['穿滴','购物']],[/炒老板泡椒三绝/,['正餐','餐饮']],[/蛋糕店/,['零食']]];
 for(const [pattern,names] of distinctive)if(pattern.test(text)){for(const name of names){const found=available.filter(c=>c.name===name);if(found.length===1)return {id:found[0].id,score:.9,reason:'摘要 / 商户命中「'+C.categoryName(d,found[0].id)+'」规则'};if(found.length>1)break;}}
 for(const rule of categoryRules){if((rule.kind||'expense')!==type)continue;const strength=rule.strong?.test(text)?'strong':rule.weak?.test(text)?'weak':'';if(!strength)continue;
  if(rule.names[0]==='日用滴'&&/淘宝服饰|衣服|服装|服饰|鞋子/.test(text)&&!rule.strong?.test(text))continue;
  for(const name of rule.names){const found=available.filter(c=>c.name===name);if(found.length>1){ambiguous=true;break;}if(found.length===1){matches.set(found[0].id,strength==='strong'?.9:.7);break;}}
 }
 if(!ambiguous&&matches.size===1){const [id,score]=[...matches][0];return {id,score,reason:'摘要 / 商户命中「'+C.categoryName(d,id)+'」规则'};}
 if(!ambiguous&&matches.size===0&&type==='expense'&&r.categoryLabel==='餐饮美食'){
  // 「餐饮美食」这个标签本身是混的（正餐/夜宵/喝滴都有），但深夜那几笔几乎都是夜宵，
  // 其余按正餐兜底——比整列丢进「其他」有用得多，改错了也能在复核队列里批量改。
  const matched=String(r.time||'').match(/T(\d{2}):/),hour=matched?Number(matched[1]):NaN;
  const late=Number.isFinite(hour)&&(hour>=22||hour<4);
  const guess=available.filter(c=>c.name===(late?'夜宵':'正餐'));
  if(guess.length===1)return {id:guess[0].id,score:.85,reason:'账单分类「餐饮美食」'+(late?'（深夜时段）':'')+' → '+guess[0].name};
 }
 if(!ambiguous&&matches.size===0&&type==='expense'){
  const candidates=Object.hasOwn(billCategoryCandidates,r.categoryLabel)?billCategoryCandidates[r.categoryLabel]:[];
  const mapped=available.filter(c=>candidates.includes(c.name));
  if(mapped.length===1)return {id:mapped[0].id,score:.85,reason:'账单自带分类「'+r.categoryLabel+'」'};
 }
 const fallback=available.find(c=>['其他','其他收入','待分类收入'].includes(c.name));
 return {id:fallback?.id||'',score:.35,reason:matches.size||ambiguous?'分类线索有冲突，暂列其他':'没有明确分类线索，暂列其他'};
}
const walletMethod=/^(支付宝|微信|支付宝支付|微信支付|余额|余额宝|零钱|零钱通|花呗|借呗|云闪付|银行卡?|储蓄卡?|信用卡?|\/|—|-)$/;
function account(r,d){
 const wallet=r.source==='alipay'?'支付宝':r.source==='wechat'?'微信':'';
 // A bill can name the actual card / credit account instead of the payment app.
 // Accept it only when the distinctive method name resolves to exactly one account.
 const method=String(r.method||'').split('&')[0].replace(/\([^)]*\)/g,'').trim();
 if(method.length>=4&&!walletMethod.test(method)){
  const exact=d.accounts.filter(a=>!a.archived&&a.currency===r.currency&&(a.name.includes(method)||a.type===method));
  if(exact.length===1)return {id:exact[0].id,score:.9,reason:'原付款方式「'+r.method+'」匹配到账本账户「'+exact[0].name+'」'};
 }
 // Excel / 自定义表格没有「这是支付宝账单还是微信账单」这个信息，先看付款方式、摘要、
 // 商户名和文件名里有没有钱包线索；账本里只有一个账户时再退到它；都不行才留空待选。
 const text=[r.method,r.title,r.payee,r.raw&&r.raw['收/付款方式'],r.file].join(' ');
 const name=wallet||(/支付宝|余额宝|花呗|alipay/i.test(text)?'支付宝':/微信|零钱|wechat/i.test(text)?'微信':'');
 const candidates=name?d.accounts.filter(a=>!a.archived&&a.currency===r.currency&&(a.type===name||a.name.includes(name))):[];
 if(!name||candidates.length!==1){
  if(name&&candidates.length>1)return {id:'',score:.35,reason:'有多个'+name+'账户，请选择'};
  const only=d.accounts.filter(a=>!a.archived&&a.currency===r.currency);
  if(only.length===1&&(!method||walletMethod.test(method)))return {id:only[0].id,score:.9,reason:'账单未指明钱包，已按唯一账户「'+only[0].name+'」记账'};
  return {id:'',score:.35,reason:name?'未找到'+name+'账户，请选择或先建立账户':'账户待选择：付款方式未唯一匹配到账本账户'};
 }
 // 账单里的「收/付款方式」常常写的是背后那张卡（例如「招商银行信用卡(0050)」），
 // 而账本里只有「支付宝」这类钱包账户。这只是账户来源的说明，不该把已经
 // 认得很准的分类（0.9）压成「中等」——只留一条提示，分数照给。
 if(!method||walletMethod.test(method))return {id:candidates[0].id,score:.9,reason:'按'+name+'账单来源推断账户'};
 return {id:candidates[0].id,score:.9,reason:'原付款方式「'+r.method+'」未匹配到账本账户，已按「'+candidates[0].name+'」记账'};
}
// Provider contract: { id, classify(record, {data, book}) } -> object or Promise
// of {nature, category, account, score, reasons}. Safety checks are ALWAYS local
// and cannot be bypassed by provider confidence. ai-provider adds an opt-in
// prepared provider; this default local path never invokes it.
const localProvider={id:'local-rules-v1',classify(r,{data}){
 const kind=nature(r),cat=category(r,data,kind),wallet=account(r,data);
 return {nature:kind,category:cat.id,account:wallet.id,score:Math.min(cat.score,wallet.score),reasons:[cat.reason,wallet.reason,'交易性质：'+natureNames[kind]]};
}};
async function readFile(file,onProgress=()=>{}){
 if(file.size>Z.LIMIT)throw Error('文件请小于 32 MB');
 if(/\.xls$/i.test(file.name))throw Error('旧版 .xls 暂不支持，请另存为 .xlsx 或 CSV');
 if(!/\.(csv|zip|xlsx)$/i.test(file.name))throw Error('请选择 CSV、XLSX 或 ZIP 账单');
 onProgress({phase:'reading',done:0,total:1,message:'读取本地文件'});
 const buffer=await file.arrayBuffer();if(buffer.byteLength>Z.LIMIT)throw Error('文件请小于 32 MB');
 const files=/\.zip$/i.test(file.name)?await Z.csvFiles(buffer,(done,total)=>onProgress({phase:'extracting',done,total,message:'正在本地解压账单'})):[{name:file.name,bytes:new Uint8Array(buffer)}];
 const records=[],included=[],skipped=[];
 for(const f of files){try{const parsed=/\.xlsx$/i.test(f.name)?await X.parse(f.bytes,f.name):I.parseReview(I.decode(f.bytes),f.name);records.push(...parsed.records);included.push({name:f.name,source:parsed.source,count:parsed.records.length});}catch(e){skipped.push({name:f.name,reason:e.message});}}
 if(!records.length)throw Error(skipped.map(x=>x.name+'：'+x.reason).join('\n'));
 return {name:file.name,records,files:included,skipped};
}
function entryFrom(record,answer,d,book){
 const transfer=['repayment','transfer'].includes(answer.nature),incoming=transfer&&record.direction==='收入';
 return C.newEntry(d,{
 id:record.id,book,title:record.title||record.payee||'导入账目',payee:record.payee,note:record.note,
 date:record.date,amount:record.amount,currency:record.currency,rate:record.currency==='CNY'?1:Number.isFinite(record.rate)&&record.rate>0?record.rate:null,
 kind:transfer?'transfer':answer.nature,
 category:answer.category||'',account:incoming?'':answer.account||'',toAccount:incoming?answer.account||'':'',importSource:record.source,externalId:record.order,
 importTime:record.time,importIdentity:record.id,importMethod:record.method,importStatus:record.status,importCategoryLabel:record.categoryLabel
});}
async function analyze(input,d,book=C.activeBook(d),{provider=localProvider,onProgress=()=>{}}={}){
 if(!provider?.id||typeof provider.classify!=='function')throw Error('识别引擎无效');
 if(input.records.length>20000)throw Error('一次最多识别 20,000 笔，请按时间范围拆分账单');
 const snapshot=C.clone(d),batch={id:C.uid(),name:input.name,book,files:input.files||[],skipped:input.skipped||[],provider:provider.id,rows:[]};
 if(!snapshot.books.some(b=>b.id===book&&!b.archived))throw Error('请选择可用账本');
 for(const [i,record]of input.records.entries()){
  let answer;try{answer=await provider.classify(C.clone(record),{data:snapshot,book});if(!answer||!Object.hasOwn(natureNames,answer.nature)||!Number.isFinite(answer.score)||answer.score<0||answer.score>1||!Array.isArray(answer.reasons))throw Error('识别结果不完整');}
  catch(e){answer={nature:'unknown',score:0,reasons:['识别未完成：'+e.message]};}
  const flags=(Array.isArray(answer.flags)?answer.flags:[]).filter(x=>Object.hasOwn(flagNames,x)).slice(0,3);
  batch.rows.push({key:record.key||C.uid(),record:C.clone(record),entry:entryFrom(record,answer,d,book),nature:answer.nature,score:answer.score,origin:answer.origin==='ai'?'ai':'local',flags,advice:String(answer.advice||'').slice(0,160),reasons:answer.reasons.map(String),state:'pending',edited:false});
  if(i%100===0||i===input.records.length-1){onProgress({phase:'classifying',done:i+1,total:input.records.length,message:'正在离线识别'});await yieldUI();}
 }
 Exclusions.apply(batch,d);refresh(batch,d);return batch;
}
function identity(t){return t.importIdentity||(t.externalId&&t.importSource?t.importSource+'-'+t.externalId:t.id);}
function duplicateIndex(d,batch){
 const exact=new Map(),similar=new Map(),orders=new Map();
 const add=(t,key,location)=>{
  const x={t,key,location};for(const id of new Set([t.id,identity(t)])){if(!exact.has(id))exact.set(id,[]);exact.get(id).push(x);}
  if(t.externalId){if(!orders.has(t.externalId))orders.set(t.externalId,[]);orders.get(t.externalId).push(x);}
  const who=clean(t.payee||t.title);if(!who||!C.validDate(t.date)||!Number.isSafeInteger(t.amount))return;
  const bucket=[t.book,t.currency,Math.abs(t.amount),who].join('|');if(!similar.has(bucket))similar.set(bucket,[]);similar.get(bucket).push(x);
 };
 d.entries.forEach(t=>add(t,'ledger:'+t.id,'账本'));d.trash.forEach(t=>add(t,'trash:'+t.id,'回收站'));
 for(const r of batch.rows)if(r.state==='pending')add(r.entry,r.key,'本批次');
 return {exact,similar,orders};
}
function nearby(a,b){
 // No timestamp in older entries: the same date is deliberately only a suspect.
 const time=t=>t.importTime?.startsWith(t.date+'T')?Date.parse(t.importTime+'Z'):NaN;
 const ta=time(a),tb=time(b);return Number.isFinite(ta)&&Number.isFinite(tb)?Math.abs(ta-tb)<=NEAR_MS:a.date===b.date;
}
function validateEntry(d,t,links){
 // Keep only the relations needed by this entry. Full-ledger validation happens
 // once at commit; validating all history for every preview row is quadratic.
 const original=t.related&&links.originals.get(t.related)?.entry,related=original?[original,...(links.returns.get(t.related)||[])]:[];
 C.validate({...d,entries:[...related,C.clone(t)],trash:[],rules:[],templates:[],budgets:[],goals:[],imports:[]});
}
function assess(row,d,index,links){
 const t=row.entry,issues=[],blockers=[],reasons=[...row.reasons];
 const issue=(code,why,block=false)=>{issues.push(code);reasons.push(why);if(block)blockers.push(why);};
 if(row.edited)issue('edited','已编辑的记录请逐条或多选核实确认');
 if(!C.validDate(t.date))issue('date',row.record.dateRaw?'日期无法识别，请核实':'缺少日期，请补充',true);
 if(/[ T]\d{1,2}:/.test(row.record.dateRaw)&&!row.record.time)issue('time','原交易时间无法识别，请核实日期与重复线索');
 if(!Number.isSafeInteger(t.amount))issue('amount','金额缺失或无法识别，请补充',true);
 else if(t.amount<=0)issue('amount','金额为零或负数，请核实原始方向和金额',true);
 else if(t.amount>=LARGE_AMOUNT)issue('large','单笔达到 100,000 元，请核实');
 if(!['income','expense'].includes(row.nature))issue('nature',({neutral:'中性交易不计收支，请核实为转账或排除',unknown:'无法判断交易性质，请选择收支类型',transfer:'转账需核实双方账户',repayment:'还款不计收支，需核实付款与负债账户',refund:'退款必须选择原支出，沿用原分类与汇率',reimbursement:'报销到账需关联已标记待报销的原支出'})[row.nature]||'交易性质需核实',['neutral','unknown'].includes(row.nature));
 if(!['income','expense'].includes(nature(row.record))&&['income','expense'].includes(row.nature))issue('original-nature','原账单含特殊交易线索，请人工核实修改后的收支类型');
 if(!/^(支付成功|交易成功|已支付|已收款|对方已收钱|转账成功|还款成功|退款成功)$/.test(row.record.status)){
  const status=row.record.status||'未注明';
  if(!row.record.status||/失败|关闭|取消|撤销|处理中|待支付|未支付|拒绝|退款中|交易中|异常|超时|待确认/.test(status))issue('status-risk','原交易状态「'+status+'」需核实');
  else issue('status','原交易状态文案「'+status+'」非标，请参考原账单');
 }
 if(!d.accounts.some(a=>a.id===t.account&&!a.archived))issue('account','请选择可用账户',true);
 const category=d.categories.find(c=>c.id===t.category&&!c.archived);
 if(t.kind!=='transfer'&&!category)issue('category','请选择现有'+(t.kind==='income'?'收入':'支出')+'分类',true);
 else if(['income','expense'].includes(t.kind)&&category?.type!==t.kind)issue('category-type','分类的收支类型不匹配，请重新选择',true);
 if(!C.currencies.includes(t.currency))issue('currency','请选择支持的币种',true);
 else if(t.currency!=='CNY'&&!row.fxReviewed)issue('currency','外币账目请先编辑并确认币种与折算人民币汇率',true);
 if(!Number.isFinite(t.rate)||t.rate<=0||t.currency==='CNY'&&t.rate!==1)issue('rate','请填写有效的折算人民币汇率（1 单位原币）',true);
 const crossSheet=(index.orders.get(t.externalId)||[]).filter(x=>t.externalId&&(t.importSource==='sheet'||x.t.importSource==='sheet'));
 const legacy=(index.exact.get(row.record.legacyId)||[]).filter(x=>x.location!=='本批次'&&x.t.book===t.book&&x.t.kind===t.kind&&x.t.title===t.title);
 const exact=[...new Set([...(index.exact.get(t.id)||[]),...(index.exact.get(identity(t))||[]),...crossSheet,...legacy])].filter(x=>x.key!==row.key);
 // Same order in the batch stays visible. One may be posted; subsequent attempts
 // are blocked by the fresh ledger index instead of silently dropping records.
 if(exact.length)issue('duplicate','相同订单 / 导入标识已在'+[...new Set(exact.map(x=>x.location))].join('、'),exact.some(x=>x.location!=='本批次'));
 const who=clean(t.payee||t.title),bucket=[t.book,t.currency,Math.abs(t.amount),who].join('|');
 const suspects=(index.similar.get(bucket)||[]).filter(x=>x.key!==row.key&&x.t.id!==t.id&&nearby(t,x.t));
 if(suspects.length)issue('suspect','疑似重复：同金额、同商户、相近时间（仅有日期时按同日比较）');
 if(!blockers.length){try{validateEntry(d,t,links);}catch(e){issue('validation',e.message,true);}}
 if(row.flags?.length)issue('ai-flag','AI 疑点：'+row.flags.map(flagLabel).join('、')+(row.advice?'；修正建议：'+row.advice:''));
 const actionIssues=issues.filter(code=>code!=='status');
 const confidence=level(Math.min(row.score,actionIssues.length?.7:1));
 const unrecognized=!C.validDate(t.date)||!Number.isSafeInteger(t.amount)||row.nature==='unknown';
 return {issues,blockers,reasons:[...new Set(reasons)],confidence,group:unrecognized?'unknown':confidence==='high'&&!actionIssues.length?'ready':'review',duplicates:[...exact,...suspects].map(x=>({id:x.t.id,title:x.t.title,date:x.t.date,amount:x.t.amount,location:x.location}))};
}
function originalIndex(batch,d){
 const seen=new Set(d.entries.map(t=>t.id)),originals=new Map(),returns=new Map();
 for(const t of d.entries){
  if(t.book!==batch.book)continue;
  if(t.kind==='expense')originals.set(t.id,{entry:t,source:'账本',key:''});
  if(['refund','reimbursement'].includes(t.kind)&&t.related){
   if(!returns.has(t.related))returns.set(t.related,[]);
   returns.get(t.related).push(t);
  }
 }
 for(const r of batch.rows)if(r.state==='pending'&&r.entry.kind==='expense'&&r.entry.book===batch.book&&!seen.has(r.entry.id)&&!originals.has(r.entry.id))originals.set(r.entry.id,{entry:r.entry,source:'本批待核实',key:r.key});
 return {originals,returns};
}
function originals(batch,d,row){return [...originalIndex(batch,d).originals.values()].filter(x=>x.key!==row.key);}
function inheritOriginal(row,links){
 if(!row.entry.related||!['refund','reimbursement'].includes(row.entry.kind))return;
 const original=links.originals.get(row.entry.related)?.entry;
 if(original){for(const k of ['category','currency','rate'])row.entry[k]=original[k];row.fxReviewed=true;}
}
function refresh(batch,d){
 const index=duplicateIndex(d,batch),links=originalIndex(batch,d);
 for(const row of batch.rows)if(row.state==='pending'){
  if(row.refundMatch&&row.refundMatch.expenseId!==row.entry.related)delete row.refundMatch;
  inheritOriginal(row,links);Object.assign(row,assess(row,d,index,links));
 }
 return batch;
}
function edit(batch,key,values,d){
 const row=batch.rows.find(r=>r.key===key);if(!row||!['pending','skipped'].includes(row.state))throw Error('这笔记录已处理');
 if(!Object.hasOwn(natureNames,values.nature))throw Error('请选择交易性质');
 const t=C.clone(row.entry);for(const k of ['date','category','account','toAccount','related','note','title'])if(values[k]!==undefined)t[k]=String(values[k]).trim();
 t.amount=values.amount===''?null:C.cents(values.amount);t.kind=values.nature==='repayment'?'transfer':values.nature;
 const original=t.related&&['refund','reimbursement'].includes(t.kind)?originalIndex(batch,d).originals.get(t.related)?.entry:null;
 if(original){t.category=original.category;t.currency=original.currency;t.rate=original.rate;}
 else{
  if(values.currency!==undefined){if(!C.currencies.includes(values.currency))throw Error('请选择支持的币种');t.currency=values.currency;}
  if(t.currency==='CNY')t.rate=1;else if(values.rate!==undefined){t.rate=Number(String(values.rate).trim());if(!Number.isFinite(t.rate)||t.rate<=0)throw Error('请填写有效的折算人民币汇率');}
 }
 t.toAmount=values.toAmount?C.cents(values.toAmount):0;
 if(t.kind!=='transfer'){t.toAccount='';t.toAmount=0;}else{t.category='';if(d.accounts.find(a=>a.id===t.toAccount)?.currency===t.currency)t.toAmount=t.amount;}
 if(!['refund','reimbursement'].includes(t.kind))t.related='';
 if(t.date!==row.entry.date)t.importTime='';
 if(!row.edited)row.reasons=row.reasons.map(x=>'原识别：'+x);
 row.entry=t;row.nature=values.nature;row.edited=true;if(values.currency!==undefined||values.rate!==undefined)row.fxReviewed=values.currency!==undefined&&values.rate!==undefined;row.state='pending';refresh(batch,d);return row;
}
function setState(batch,key,state){const row=batch.rows.find(r=>r.key===key);if(!row||row.state==='confirmed'||!['pending','skipped','excluded'].includes(state))throw Error('这笔记录不能执行此操作');row.state=state;if(state==='pending'&&row.autoExclusion){row.exclusionOverride=true;}}
function setCategories(batch,keys,categoryId,d){
 const category=d.categories.find(c=>c.id===categoryId&&!c.archived);if(!category)throw Error('请选择现有分类');
 const selected=new Set(keys),rows=batch.rows.filter(r=>selected.has(r.key)&&r.state==='pending');
 if(rows.some(r=>category.type!==(r.nature==='income'?'income':'expense')))throw Error('所选记录含不同收支类型，请分别修改分类');
 for(const row of rows){row.entry.category=categoryId;row.edited=true;if(!row.reasons.includes('已批量修改分类，请核实'))row.reasons.push('已批量修改分类，请核实');}
 refresh(batch,d);return rows.length;
}
function counts(batch){const result={total:batch.rows.length,ready:0,review:0,unknown:0,confirmed:0,skipped:0,excluded:0,flagged:0};for(const r of batch.rows){result[r.state==='pending'?r.group:r.state]++;if(r.state==='pending'&&r.flags?.length)result.flagged++;}return result;}
function preflight(d,batch,keys,{highOnly=false}={}){
 const selected=new Set(keys),index=duplicateIndex(d,batch),links=originalIndex(batch,d),rows=batch.rows.filter(r=>selected.has(r.key));
 const checks=rows.map(row=>({row,...assess(row,d,index,links)})),blockedKeys=new Set(checks.filter(x=>x.blockers.length||highOnly&&x.group!=='ready').map(x=>x.row.key));
 for(const x of checks){
  const original=x.row.entry.related&&links.originals.get(x.row.entry.related);
  if(original?.key&&(!selected.has(original.key)||blockedKeys.has(original.key))){
   x.blockers.push('请同时选择可入账的本批原支出「'+original.entry.title+'」');blockedKeys.add(x.row.key);
  }
 }
 const blocked=checks.filter(x=>blockedKeys.has(x.row.key)),allowed=rows.filter(r=>!blockedKeys.has(r.key)).map(r=>r.key);
 let error=rows.length!==selected.size||keys.length!==selected.size||rows.some(r=>r.state!=='pending')?'所选记录已变化，请重新选择':'';
 if(!error&&allowed.length)try{post({...d,imports:[...d.imports]},batch,allowed,{highOnly});}catch(e){error=e.message;}
 return {rows,blocked,allowed:error?[]:allowed,error,ok:!!allowed.length&&!blocked.length&&!error};
}
function post(d,batch,keys,{highOnly=false}={}){
 if(C.activeBook(d)!==batch.book)throw Error('默认账本已切换，请回到原账本后确认');
 if(!d.books.some(b=>b.id===batch.book&&!b.archived))throw Error('原账本已归档或不存在');
 const selected=new Set(keys);if(!selected.size)throw Error('请先选择记录');
 const rows=batch.rows.filter(r=>selected.has(r.key));if(rows.length!==selected.size||rows.some(r=>r.state!=='pending'))throw Error('所选记录已变化，请重新选择');
 const previous=d.imports.find(x=>x.id===batch.id);if(previous&&!previous.undoable)throw Error('该批次已撤销，请重新导入');
 const index=duplicateIndex(d,batch),links=originalIndex(batch,d),entries=[];
 for(const row of rows){const original=row.entry.related&&links.originals.get(row.entry.related);if(original?.key&&!selected.has(original.key))throw Error('请同时选择本批原支出「'+original.entry.title+'」入账');const check=assess(row,d,index,links);if(check.blockers.length)throw Error((row.entry.title||'这笔账目')+'：'+check.blockers.join('；'));if(highOnly&&check.group!=='ready')throw Error('部分记录已不再是高置信，请刷新复核');entries.push(C.clone(row.entry));}
 // Validate the entire group before touching the supplied draft, including two
 // selected rows with one order ID or several refunds exceeding the original.
 const next=C.clone(d);next.entries.push(...entries);C.validate(next);
 const ids=entries.map(t=>t.id),history=previous?{...C.clone(previous),ids:[...previous.ids,...ids]}:{id:batch.id,name:'AI 记账 · '+batch.name,book:batch.book,at:new Date().toISOString(),ids,undoable:true,source:'ai-import'};history.count=history.ids.length;
 d.entries=next.entries;if(previous)d.imports[d.imports.indexOf(previous)]=history;else d.imports.push(history);
 return ids;
}
function markPosted(batch,keys){const set=new Set(keys);for(const row of batch.rows)if(set.has(row.key))row.state='confirmed';}
function undo(d,batchId){const history=d.imports.find(b=>b.id===batchId&&b.source==='ai-import');if(!history?.undoable)throw Error('该批次已撤销或不存在');C.removeEntries(d,history.ids);history.undoable=false;}
module.exports={originals,originalIndex,readFile,analyze,localProvider,accountHint:account,nature,level,refresh,edit,setState,setCategories,counts,post,preflight,markPosted,undo,natureNames,groupNames,confidenceNames,flagNames,flagLabel,flagKey,LARGE_AMOUNT,NEAR_MS};
