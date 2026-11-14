'use strict';
const C=require('./core'),A=require('./analytics'),Ask=require('./ai-ask'),Audit=require('./audit'),Insights=require('./insights'),Charts=require('./charts');
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥ '+C.money(n);
function validate(intent,d,book){
 if(!d.books.some(b=>b.id===book&&!b.archived)||!plain(intent))throw Error('账本或任务条件无效');
 if(intent.intent==='duplicates'){
  if(Object.keys(intent).some(k=>!['intent','start','end'].includes(k)))throw Error('重复核对条件无效');
  const start=intent.start,end=intent.end;if((start===undefined)!==(end===undefined))throw Error('日期范围缺失');
  if(start!==undefined&&(!C.validDate(start)||!C.validDate(end)||start>end||A.days(start,end)>3660))throw Error('日期范围无效');
  return {intent:'duplicates',...(start===undefined?{}:{start,end})};
 }
 if(intent.intent==='report'){
  if(Object.keys(intent).some(k=>!['intent','month'].includes(k))||typeof intent.month!=='string')throw Error('报告月份缺失');
  A.period('month',intent.month);return {intent:'report',month:intent.month};
 }
 throw Error('任务类型不支持');
}
function parseLocal(question,d,book,now=C.today()){
 const s=String(question).trim().replace(/[\s，,。？！?!：:「」“”]/g,'');if(!s||s.length>500)return null;
 const parsed=Ask.parseMonth(s,now);
 if(/重复/.test(s)){
  let rest=parsed?parsed.rest:s;
  rest=rest.replace(/^(?:帮我|请|给我)/,'').replace(/查|核查|核对|看看|看一下|有没有|找出|列出|一下|的|项|账单|记录|重复|疑似/g,'');
  if(!rest){try{return validate({intent:'duplicates',...(parsed?{start:parsed.range.start,end:parsed.range.end}:{})},d,book);}catch{return null;}}
 }
 if(parsed&&/(?:报告|分析)/.test(s)){
  const rest=parsed.rest.replace(/生成|出个|做一份|做个|做|给我|请|帮我|一份|账单|月度|详细|分析|报告|的/g,'');
  if(!rest){try{return validate({intent:'report',month:parsed.month},d,book);}catch{return null;}}
 }
 return null;
}
function duplicates(d,book,task){
 const q=validate(task,d,book),seen=new Set(),groups=[],scanned=Audit.scan(d,book),byId=new Map(scanned.map(x=>[x.t.id,x]));
 for(const x of scanned){
  if(!x.reasons.includes('duplicate')||x.reviewed||seen.has(x.t.id))continue;
  const rows=x.duplicates.map(id=>byId.get(id)).filter(y=>y?.reasons.includes('duplicate')&&!y.reviewed&&(!q.start||y.t.date>=q.start&&y.t.date<=q.end));
  for(const y of rows)seen.add(y.t.id);
  if(rows.length>1)groups.push({ids:rows.map(y=>y.t.id),rows:rows.map(y=>({id:y.t.id,date:y.t.date,title:y.t.title||y.t.payee||'未命名账目',amount:y.t.amount,kind:y.t.kind,currency:y.t.currency,account:d.accounts.find(a=>a.id===y.t.account)?.name||'未指定账户'})),reason:Audit.names.duplicate});
 }
 const count=groups.reduce((n,g)=>n+g.rows.length,0),range=q.start?`${q.start} 至 ${q.end}`:'全部已入账记录';
 return {ok:true,intent:'duplicates',task:q,groups,count,range,book,message:groups.length?`发现 ${groups.length} 组疑似重复，共 ${count} 笔。仅供核对，不会自动删账。`:'这段时间没有发现疑似重复',facts:[]};
}
function reportModel(d,book,month,{generatedAt=new Date().toISOString(),document}={}){
 const r=Insights.monthly(d,book,month,{}),rows=r.rows,category=A.groups(d,rows,'expense','category'),positive=rows.map(t=>({t,value:C.impact(t).expense,category:C.categoryName(d,t.category)})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value).slice(0,10);
 const accounts=new Map(),methods=new Map();for(const t of rows){const amount=C.impact(t).expense;if(!amount)continue;let parts=[[t.account,amount]];if(t.kind==='expense'&&t.splits?.length){let allocated=0;parts=t.splits.map((s,i)=>{const n=i===t.splits.length-1?amount-allocated:Math.round(s.amount*t.rate);allocated+=n;return [s.account,n];});}for(const [id,value]of parts){const account=d.accounts.find(a=>a.id===id);const name=account?.name||'未指定账户',method=account?.type||'未指定支付方式';accounts.set(name,(accounts.get(name)||0)+value);methods.set(method,(methods.get(method)||0)+value);}}
 const issues=Audit.scan(d,book).filter(x=>!x.reviewed&&x.t.date>=r.range.start&&x.t.date<=r.range.end);
 let trendSvg='',donutSvg='';if(document){const holder=document.createElement('div');holder.className='carrot-money';const slots=A.buckets(rows,r.range.start,r.range.end,'day').slots;trendSvg=Charts.serialize(Charts.trend(holder,slots,{visible:['expense'],mode:'line',title:'逐日支出趋势'}));donutSvg=Charts.serialize(Charts.donut(holder,A.donutGroups(category),{title:'支出分类占比'}));}
 return {bookName:d.books.find(b=>b.id===book)?.name||book,generatedAt,r,category,positive,accounts:[...accounts],methods:[...methods],issues,trendSvg,donutSvg};
}
function renderReport(m){
 const {r}=m;if(!r?.range)throw Error('报告数据不完整');const e=escape,amount=n=>e(money(n)),comparison=k=>{const c=A.comparison(r.current[k],r.prior[k]);return `${c.delta>=0?'增加':'减少'} ${amount(Math.abs(c.delta))}${c.percent===null?' · 上月基数为零或负数':` · ${Math.abs(c.percent).toFixed(1)}%`}`;};
 const rows=(items,empty='暂无记录')=>items.length?items.join(''): `<tr><td colspan="5">${empty}</td></tr>`;
 const chart=s=>s.replace(/^<\?xml[^>]*>\s*/, '').replace(/\s+xmlns(?::\w+)?="https?:\/\/[^\"]*"/g,'').replace(/<script\b[\s\S]*?<\/script\s*>/gi,'');
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(m.bookName)} · ${e(r.month)} 月度分析</title><style>:root{color-scheme:light;--ink:#363b36;--muted:#73786f;--line:#e7e8df;--paper:#f9f7f2;--card:#fffefb;--accent:#a65de8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:980px;margin:auto;padding:32px 18px}h1{font-size:30px;margin:0}h2{font-size:20px;margin:0 0 16px}.muted{color:var(--muted)}section{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:22px;margin:18px 0;overflow:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.stat{background:#f4eef9;padding:16px;border-radius:14px}.stat strong{display:block;font-size:22px}table{width:100%;border-collapse:collapse;min-width:520px}th,td{text-align:left;padding:9px;border-bottom:1px solid var(--line)}th{color:var(--muted)}svg{width:100%;height:auto}footer{color:var(--muted);text-align:center;padding:24px}</style></head><body><main><header><h1>${e(m.bookName)} · ${e(r.month)} 月度分析报告</h1><p class="muted">${e(r.range.start)} 至 ${e(r.range.end)} · 生成时间 ${e(m.generatedAt)}<br>筛选口径：${e(r.scopeText)}；对比 ${e(r.range.previousStart)} 至 ${e(r.range.previousEnd)}。无日期记录 ${r.undated} 笔未参与。</p></header><section><h2>总览与上月对比</h2><div class="grid">${[['income','收入'],['expense','净支出'],['net','结余']].map(([k,label])=>`<div class="stat">${label}<strong>${amount(r.current[k])}</strong><small>上月 ${amount(r.prior[k])}<br>${comparison(k)}</small></div>`).join('')}<div class="stat">笔数<strong>${r.rows.length} 笔</strong><small>已入账记录</small></div></div></section><section><h2>支出分类排名</h2><table><thead><tr><th>分类</th><th>本月净支出</th><th>笔数</th></tr></thead><tbody>${rows(m.category.map(g=>`<tr><td>${e(g.label)}</td><td>${amount(g.value)}</td><td>${g.count}</td></tr>`))}</tbody></table></section><section><h2>变化最大的几类</h2><table><thead><tr><th>分类</th><th>本月</th><th>上月</th><th>变化</th></tr></thead><tbody>${rows(r.changes.slice(0,8).map(g=>`<tr><td>${e(g.label)}</td><td>${amount(g.current)}</td><td>${amount(g.previous)}</td><td>${amount(g.delta)}</td></tr>`))}</tbody></table></section><section><h2>大额支出 Top 10</h2><table><thead><tr><th>日期</th><th>商户 / 说明</th><th>金额</th><th>分类</th></tr></thead><tbody>${rows(m.positive.map(({t,value,category})=>`<tr><td>${e(t.date)}</td><td>${e(t.payee||t.title||'未命名账目')}</td><td>${amount(value)}</td><td>${e(category)}</td></tr>`),'本月没有正向支出')}</tbody></table></section><section><h2>逐日支出趋势图</h2>${chart(m.trendSvg)||'<p>暂无图表</p>'}</section><section><h2>支出分类占比</h2>${chart(m.donutSvg)||'<p>暂无图表</p>'}<p class="muted">圆环仅展示净额为正的分类；总览保留退款与报销的冲减。</p></section><section><h2>账户 / 支付方式分布</h2><div class="grid"><div><h3>账户</h3><ul>${m.accounts.map(([k,v])=>`<li>${e(k)} · ${amount(v)}</li>`).join('')||'<li>暂无记录</li>'}</ul></div><div><h3>支付方式</h3><ul>${m.methods.map(([k,v])=>`<li>${e(k)} · ${amount(v)}</li>`).join('')||'<li>暂无记录</li>'}</ul></div></div><p class="muted">按涉及账户的整笔人民币净支出展示；退款可能形成负数。账户分布不作余额计算。</p></section><section><h2>疑似重复与异常清单</h2><p>本月待核对 ${m.issues.length} 笔，其中疑似重复 ${m.issues.filter(x=>x.reasons.includes('duplicate')).length} 笔；可在插件核对页查看。</p><ul>${m.issues.slice(0,10).map(x=>`<li>${e(x.t.date||'无日期')} · ${e(x.t.title||'未命名账目')} · ${e(x.reasons.map(k=>Audit.names[k]).join(' / '))}</li>`).join('')||'<li>暂无待核对记录</li>'}</ul></section><footer>本报告由 Carrot 记账本地生成，数据未出本机</footer></main></body></html>`;
}
function filename(month){A.period('month',month);return '月度分析-'+month;}
module.exports={validate,parseLocal,duplicates,reportModel,renderReport,filename};
