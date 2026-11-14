'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),I=require('../src/imports'),AI=require('../src/ai-import'),E=require('../src/ai-exclusions'),R=require('../src/ai-refunds');
const headers=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号','商户单号','原交易单号','原商户订单号'];
function data(){const d=C.blank();d.accounts=[{id:'wx',name:'微信',type:'微信',currency:'CNY',rate:1,opening:0},{id:'bank',name:'虚构银行卡',type:'银行卡',currency:'CNY',rate:1,opening:0}];return d;}
const expense=(extra={})=>({'交易时间':'2026-09-01 12:00:00','交易类型':'商户消费','交易对方':'虚构店铺','商品':'虚构商品','收/支':'支出','金额(元)':'100.00','支付方式':'零钱','当前状态':'支付成功','交易单号':'EXPENSE-A','商户单号':'MERCHANT-A',...extra});
const refund=(extra={})=>({'交易时间':'2026-09-02 12:00:00','交易类型':'商户消费退款','交易对方':'虚构店铺','商品':'退款虚构商品','收/支':'收入','金额(元)':'20.00','支付方式':'零钱','当前状态':'退款成功','交易单号':'REFUND-A','商户单号':'MERCHANT-A','原交易单号':'EXPENSE-A',...extra});
const encode=rows=>[headers,...rows.map(r=>headers.map(k=>r[k]||''))].map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\n');
const analyze=async(rows,d)=>{const parsed=I.parseReview(encode(rows),'fictional-refunds.csv');return AI.analyze({name:'fictional-refunds.csv',records:parsed.records},d);};
const sum=d=>C.totals(d.entries).expense;
async function seed(d){const batch=await analyze([expense()],d);AI.post(d,batch,[batch.rows[0].key]);return d.entries[0];}
function link(batch,d,row,original,amount){AI.edit(batch,row.key,{nature:'refund',related:original.id,amount},d);}

test('部分退款状态不把原支出变成退款；100减20得到80净支出',async()=>{
 const d=data(),batch=await analyze([expense({'当前状态':'已退款(20.00元)'}),refund()],d),[original,returned]=batch.rows;
 assert.equal(original.nature,'expense');assert.equal(original.entry.kind,'expense');assert.equal(returned.nature,'refund');assert.ok(batch.rows.every(r=>r.state==='pending'));
 assert.ok(AI.originals(batch,d,returned).some(x=>x.entry.id===original.entry.id));link(batch,d,returned,original.entry,'20.00');
 assert.equal(AI.preflight(d,batch,batch.rows.map(r=>r.key)).ok,true);AI.post(d,batch,batch.rows.map(r=>r.key));assert.equal(sum(d),8000);assert.equal(C.outstanding(d,d.entries.find(t=>t.kind==='expense')),8000);
});
test('原支出已入账时重叠文件不会整组排除新全额退款',async()=>{
 const d=data(),original=await seed(d),batch=await analyze([expense({'当前状态':'已全额退款'}),refund({'金额(元)':'100.00'})],d),[duplicate,returned]=batch.rows;
 assert.equal(sum(d),10000);assert.equal(duplicate.state,'pending');assert.ok(duplicate.issues.includes('duplicate'));assert.equal(returned.state,'pending');assert.equal(returned.autoExclusion,undefined);
 assert.equal(R.originals(batch,d,returned).find(x=>x.entry.id===original.id)?.source,'账本');link(batch,d,returned,original,'100.00');assert.equal(AI.preflight(d,batch,[returned.key]).ok,true);AI.post(d,batch,[returned.key]);assert.equal(sum(d),0);assert.equal(d.entries.length,2);
 const again=await analyze([expense({'当前状态':'已全额退款'}),refund({'金额(元)':'100.00'})],d);assert.ok(again.rows.every(r=>r.issues.includes('duplicate')));assert.equal(AI.preflight(d,again,again.rows.map(r=>r.key)).ok,false);assert.equal(sum(d),0);
});
test('现存原单改过本地ID仍按importIdentity识别，不隐藏新退款',async()=>{
 const d=data(),original=await seed(d);original.id='LOCAL-RENAMED-ID';C.validate(d);const batch=await analyze([expense(),refund({'金额(元)':'100.00'})],d);assert.equal(batch.rows[1].state,'pending');assert.equal(E.pairs(batch.rows,d).length,0);
});
test('回收站里的原单不能与新退款自动或手动整组排除',async()=>{
 const d=data(),original=await seed(d);C.removeEntries(d,[original.id]);const batch=await analyze([expense(),refund({'金额(元)':'100.00'})],d);assert.equal(batch.rows[1].state,'pending');assert.ok(batch.rows[0].blockers.some(x=>/回收站/.test(x)));assert.throws(()=>E.pair(batch,batch.rows[0].key,[batch.rows[1].key],d),/已存在/);assert.equal(d.trash.length,1);
});
test('明确原交易号不同，即使商家标题金额一致也绝不回退猜配',async()=>{
 const d=data(),batch=await analyze([expense(),refund({'金额(元)':'100.00','原交易单号':'EXPENSE-B'})],d);assert.ok(batch.rows.every(r=>r.state==='pending'));assert.equal(E.pairs(batch.rows,d).length,0);
});
test('一个明确原引用匹配、另一个明确引用矛盾时也不自动排除',async()=>{
 const d=data(),batch=await analyze([expense(),refund({'金额(元)':'100.00','原商户订单号':'MERCHANT-B'})],d);assert.ok(batch.rows.every(r=>r.state==='pending'));
});
test('双方商户单号明确冲突时不会降级为同名同价匹配',async()=>{
 const d=data(),batch=await analyze([expense(),refund({'金额(元)':'100.00','原交易单号':'','商户单号':'MERCHANT-B'})],d);assert.ok(batch.rows.every(r=>r.state==='pending'));
});
test('标准微信商户单号纳入线索，可在不同摘要下准确匹配整组',async()=>{
 const d=data(),batch=await analyze([expense(),refund({'金额(元)':'100.00','原交易单号':'','商品':'退款另一条摘要'})],d);assert.ok(E.refs(batch.rows[0].record).has('MERCHANT-A'));assert.ok(batch.rows.every(r=>r.state==='excluded'&&r.autoExclusion.kind==='refund'));assert.equal(d.entries.length,0);
});
test('占位商户单号不成为所有账目共有的订单证据',async()=>{
 assert.deepEqual([...E.refs({order:'ROW-A',raw:{'商户单号':'/','原交易单号':'—','商家订单号':'无'}})],['ROW-A']);
 const d=data(),batch=await analyze([expense({'商户单号':'/'}),refund({'金额(元)':'100.00','原交易单号':'','商户单号':'/','商品':'退款完全不同商品','交易对方':'不同虚构店铺'})],d);assert.ok(batch.rows.every(r=>r.state==='pending'));
});
test('本批未入账的真实同订单全额抵消仍可自动排除',async()=>{
 const d=data(),batch=await analyze([expense({'当前状态':'已全额退款'}),refund({'金额(元)':'100.00'})],d);assert.equal(batch.rows[0].nature,'expense');assert.ok(batch.rows.every(r=>r.state==='excluded'&&r.autoExclusion.kind==='refund'));assert.equal(sum(d),0);
});
test('本批多次部分退款合计全额抵消仍可匹配，少于原额则不排除',async()=>{
 for(const last of ['80.00','70.00']){const d=data(),batch=await analyze([expense({'当前状态':'已退款'}),refund(),refund({'金额(元)':last,'交易单号':'REFUND-B'})],d);assert.ok(batch.rows.every(r=>r.state===(last==='80.00'?'excluded':'pending')));}
});
test('关闭、失败交易默认排除，但失败退款不与原支出抵消',async()=>{
 const d=data(),batch=await analyze([expense({'当前状态':'交易关闭'}),expense({'交易单号':'EXPENSE-B','商户单号':'MERCHANT-B'}),refund({'金额(元)':'100.00','原交易单号':'EXPENSE-B','商户单号':'MERCHANT-B','当前状态':'退款失败'})],d);
 assert.equal(batch.rows[0].autoExclusion?.kind,'closed');assert.equal(batch.rows[1].state,'pending');assert.equal(batch.rows[2].autoExclusion?.kind,'closed');assert.equal(E.pairs(batch.rows,d).length,0);
});
test('还款扩展为信用贷/贷款；不计收入或支出，转账收入仍待核实',async()=>{
 for(const r of [{type:'信用借还',title:'借呗 | 信用贷还款',direction:'不计收支',status:'还款成功'},{title:'贷款还款',direction:'支出',status:'交易成功'},{title:'普通摘要',type:'信用借还',direction:'不计收支',status:'还款成功'}])assert.equal(AI.nature(r),'repayment');
 assert.equal(AI.natureNames.repayment,'还款');assert.equal(AI.nature({title:'转账',direction:'收入',status:'交易成功'}),'transfer');assert.equal(AI.nature({title:'余额宝转入',direction:'不计收支'}),'neutral');
 const d=data(),batch=await analyze([expense({'交易类型':'信用借还','商品':'借呗 | 信用贷还款','收/支':'不计收支','当前状态':'还款成功'})],d),row=batch.rows[0];assert.equal(row.entry.kind,'transfer');assert.equal(C.impact(row.entry).expense,0);assert.equal(C.impact(row.entry).income,0);assert.equal(AI.preflight(d,batch,[row.key]).ok,false);assert.ok(row.reasons.some(x=>/双方账户|负债账户|转账/.test(x)));
});
test('明确成功发放的余额宝收益和利息按收入，不把本金流转算收益',()=>{
 for(const title of ['余额宝收益发放','支付宝余额宝-收益发放','利息发放'])assert.equal(AI.nature({type:'投资理财',title,direction:'收入',status:'交易成功'}),'income');
 for(const title of ['余额宝自动转入','收款到余额宝','余额宝本金赎回','余额宝理财转出','收益发放后自动转入','利息发放自动转存'])assert.notEqual(AI.nature({type:'投资理财',title,direction:'收入',status:'交易成功'}),'income');
 for(const status of ['', '处理中','交易失败','待发放'])assert.equal(AI.nature({type:'投资理财',title:'余额宝收益发放',direction:'收入',status}),'neutral');
 assert.notEqual(AI.nature({type:'投资理财',title:'余额宝收益发放',direction:'支出',status:'交易成功'}),'income');
 assert.equal(AI.nature({type:'投资理财',title:'余额宝收益发放',direction:'不计收支',status:'交易成功'}),'neutral');
});
test('原单可退索引合并已入账退款与报销，并扣除待入账关联额',()=>{
 const d=data(),original=C.newEntry(d,{id:'original',date:'2026-09-01',amount:10000,account:'wx',reimbursable:true});
 const returned=C.newEntry(d,{id:'posted-refund',kind:'refund',related:original.id,date:'2026-09-02',amount:2000,account:'wx'}),reimbursed=C.newEntry(d,{id:'posted-reimbursement',kind:'reimbursement',related:original.id,date:'2026-09-02',amount:1000,account:'wx'});d.entries=[original,returned,reimbursed];
 const row={key:'new-refund',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'next-refund',kind:'refund',date:'2026-09-03',amount:5500,account:'wx'})};
 const reserved={key:'reserved',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'pending-refund',kind:'refund',related:original.id,date:'2026-09-02',amount:1500,account:'wx'})},batch={book:'daily',rows:[row,reserved]};
 assert.equal(R.available(batch,d,original),5500);assert.equal(R.originals(batch,d,row).length,1);row.entry.amount=5501;assert.equal(R.originals(batch,d,row).length,0);
 reserved.entry.kind='reimbursement';row.entry.amount=5500;assert.equal(R.originals(batch,d,row).length,1);
});
test('已入账的退款草稿不会重复占用额度，跳过和排除草稿也不占用',()=>{
 const d=data(),original=C.newEntry(d,{id:'original',date:'2026-09-01',amount:10000,account:'wx'}),returned=C.newEntry(d,{id:'posted-refund',kind:'refund',related:'original',date:'2026-09-02',amount:2000,account:'wx'});d.entries=[original,returned];
 const row={key:'new',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'new-refund',kind:'refund',date:'2026-09-03',amount:8000,account:'wx'})},batch={book:'daily',rows:[row,{key:'posted',state:'pending',record:{status:'退款成功'},entry:C.clone(returned)},...['confirmed','skipped','excluded'].map((state,i)=>({key:state,state,record:{status:'退款成功'},entry:{...C.clone(returned),id:'other-'+i,amount:9000}}))]};
 assert.equal(R.available(batch,d,original),8000);assert.equal(R.originals(batch,d,row).length,1);
});
test('可退索引每次重新构建，后续修改及max零下限与原available完全一致',()=>{
 const d=data(),original=C.newEntry(d,{id:'original',date:'2026-09-01',amount:10000,account:'wx'}),returned=C.newEntry(d,{id:'returned',kind:'refund',related:'original',date:'2026-09-02',amount:2000,account:'wx'});d.entries=[original,returned];
 const row={key:'new',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'new-refund',kind:'refund',date:'2026-09-03',amount:8000,account:'wx'})},reserve={key:'reserved',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'reserve-refund',kind:'refund',related:'original',date:'2026-09-02',amount:0,account:'wx'})},batch={book:'daily',rows:[row,reserve]};
 for(const [posted,pending,requested]of [[2000,0,8000],[3000,0,8000],[3000,2000,5000],[10001,1000,1],[0,0,10000]]){returned.amount=posted;reserve.entry.amount=pending;row.entry.amount=requested;assert.equal(R.originals(batch,d,row).length,Number(R.available(batch,d,original)>=requested));}
});
test('原单索引保留账本币种日期过滤，关闭的本批原支出不可候选',()=>{
 const d=data();d.books.push({id:'other',name:'其他虚构账本'});const base=C.newEntry(d,{id:'valid',date:'2026-09-01',amount:10000,account:'wx'});d.entries=[base,{...C.clone(base),id:'future',date:'2026-10-01'},{...C.clone(base),id:'foreign',currency:'USD'},{...C.clone(base),id:'other-book',book:'other'}];
 const row={key:'new',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'new-refund',kind:'refund',date:'2026-09-03',amount:1000,account:'wx'})},batch={book:'daily',rows:[row,{key:'closed',state:'pending',record:{status:'交易关闭'},entry:{...C.clone(base),id:'closed'}}]};assert.deepEqual(R.originals(batch,d,row).map(x=>x.entry.id),['valid']);
});
test('八千笔原支出的筛选不再逐个调用扫描式outstanding',()=>{
 const d=data();d.entries=Array.from({length:8000},(_,i)=>C.newEntry(d,{id:'expense-'+i,date:'2026-09-01',amount:10000,account:'wx'}));const row={key:'new',state:'pending',record:{status:'退款成功'},entry:C.newEntry(d,{id:'new-refund',kind:'refund',date:'2026-09-02',amount:1000,account:'wx'})},batch={book:'daily',rows:[row]},before=C.outstanding;let calls=0;C.outstanding=(...args)=>{calls++;return before(...args);};try{assert.equal(R.originals(batch,d,row).length,8000);assert.equal(calls,0);}finally{C.outstanding=before;}
});
