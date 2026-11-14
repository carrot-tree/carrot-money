'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core'),I=require('../src/imports');
const columns=['交易时间','交易分类','交易对方','商品说明','收/支','金额','付款方式','交易状态','交易订单号','备注'];
const cell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
function csv(records=[{}],headers=columns){return '\uFEFF支付宝交易明细\r\n导出说明，纯虚构测试\r\n'+headers.map(cell).join(',')+'\r\n'+records.map((r,i)=>{const values={'交易时间':'2026-10-01 12:34:56','交易分类':'餐饮','交易对方':'虚构餐厅','商品说明':'虚构午餐','收/支':'支出','金额':'25.00','付款方式':'虚构银行卡（尾号1234）','交易状态':'交易成功','交易订单号':'FAKE-ORDER-'+i,'备注':'仅用于测试',...r};return headers.map(k=>cell(values[k])).join(',');}).join('\r\n')+'\r\n----------------交易记录结束----------------';}
function data(){const d=C.blank();d.accounts=[{id:'ali',name:'虚构支付宝',currency:'CNY',type:'支付宝',opening:0,rate:1}];return d;}
const parse=(text,d=data())=>I.parse(text,d,'daily','ali');
const row=(d,extra={})=>C.newEntry(d,{id:'alipay-ORDER',date:'2026-10-01',title:'虚构午餐',payee:'虚构餐厅',amount:2500,book:'daily',account:'ali',category:'cat-0',externalId:'ORDER',importSource:'alipay',...extra});

test('最新支付宝表头与复核入口识别一致，完整保留订单分类付款方式和时间',()=>{
 const d=data(),before=JSON.stringify(d),text=csv([{'交易订单号':'\tFAKE-ALIPAY-001\t'}]),legacy=parse(text,d),review=I.parseReview(text,'fictional.csv');assert.equal(legacy.source,'alipay');assert.equal(legacy.rejected.length,0);assert.equal(legacy.accepted.length,1);const t=legacy.accepted[0];assert.equal(t.id,review.records[0].id);assert.equal(t.externalId,'FAKE-ALIPAY-001');assert.equal(t.importIdentity,t.id);assert.equal(t.category,'cat-0');assert.equal(t.importCategoryLabel,'餐饮');assert.equal(t.importMethod,'虚构银行卡（尾号1234）');assert.equal(t.account,'ali');assert.equal(t.importTime,review.records[0].time);assert.equal(t.importStatus,'交易成功');assert.equal(JSON.stringify(d),before);
});
test('旧支付宝与微信表头兼容，不更换用户所选账户',()=>{
 for(const [time,order,title,method,source]of [['交易创建时间','交易号','商品名称','收/付款方式','alipay'],['交易时间','交易单号','商品','支付方式','wechat']]){const text=csv([{[time]:'2026-09-02 08:00:00',[order]:'OLD-FAKE-001',[title]:'虚构购物',[method]:'虚构卡','金额(元)':'12.34','当前状态':'支付成功'}],[time,'交易对方',title,'收/支','金额(元)',method,'当前状态',order]),r=parse(text);assert.equal(r.source,source);assert.equal(r.accepted.length,1);assert.equal(r.accepted[0].amount,1234);assert.equal(r.accepted[0].account,'ali');assert.equal(r.accepted[0].id,source+'-OLD-FAKE-001');}
});
test('付款时间、全角人民币金额、方向、状态别名可用于普通CSV',()=>{
 const headers=['付款时间','标题','方向','金额（人民币）','付款方式','状态','分类','订单号'],text=csv([{'付款时间':'2026/9/2 08:01','标题':'虚构服务','方向':'收入','金额（人民币）':'￥1,200.50','状态':'交易成功','分类':'工资','订单号':'GENERIC-FAKE'}],headers),r=parse(text);assert.equal(r.accepted.length,1);assert.equal(r.accepted[0].date,'2026-09-02');assert.equal(r.accepted[0].kind,'income');assert.equal(r.accepted[0].category,'cat-9');assert.equal(r.accepted[0].amount,120050);assert.equal(r.accepted[0].importTime,'2026-09-02T08:01:00');
});
test('待支付等未完成交易不能作为已发生支出，全部失败文件保留忽略原因',()=>{
 for(const status of ['处理中','待支付','未支付','交易中','待确认','退款中']){const r=parse(csv([{'交易状态':status}]));assert.equal(r.accepted.length,0);assert.equal(r.rejected.length,1);assert.match(r.rejected[0].reason,/尚未确认完成/);}
 for(const status of ['交易关闭','支付失败','已撤销','已取消']){const r=parse(csv([{'交易状态':status}]));assert.equal(r.accepted.length,0);assert.equal(r.ignored.length,1);assert.equal(r.ignored[0].reason,status);}
});
test('退款、中性、无效日期和负金额仍须人工核实，不因兼容表头放行',()=>{
 for(const r of [{'商品说明':'虚构退款'},{'收/支':'不计收支'},{'交易时间':'2026-02-30 08:00:00'},{'金额':'-12.00'},{'金额':'0'}]){const out=parse(csv([r]));assert.equal(out.accepted.length,0);assert.equal(out.rejected.length,1);}
});
test('类别只匹配唯一可用且收支一致的分类，未知标签留作追溯',()=>{
 const d=data();d.categories.push({id:'duplicate-cat',name:'餐饮',icon:'',type:'expense',parent:'',archived:false});let r=parse(csv(),d);assert.equal(r.accepted[0].category,'cat-8');assert.equal(r.accepted[0].importCategoryLabel,'餐饮');d.categories.find(c=>c.id==='cat-0').archived=true;r=parse(csv(),d);assert.equal(r.accepted[0].category,'duplicate-cat');r=parse(csv([{'收/支':'收入','交易分类':'餐饮'}]),d);assert.equal(r.accepted[0].category,'');
});
test('Notion双金额、空日期与空金额语义保留；本插件查阅CSV仍不可恢复',()=>{
 const d=data(),text='日期,标题,收入,支出,所属年月,分类\n,虚构历史,,12.34,2026-09,餐饮',r=I.parse(text,d,'daily','ali');assert.equal(r.accepted.length,1);assert.equal(r.accepted[0].kind,'legacy');assert.equal(r.accepted[0].legacyIncome,null);assert.equal(r.accepted[0].legacyExpense,1234);assert.equal(r.accepted[0].date,'');assert.equal(r.accepted[0].account,'');assert.throws(()=>parse(I.exportCSV(d,[row(d)]),d),/查阅/);
});
test('本批次同订单同金额只计一次，不同金额整组隔离且不改输入',()=>{
 const d=data(),a=row(d),b={...a,amount:3500},before=JSON.stringify([d,a,b]);let p=I.plan(d,[a,C.clone(a)]);assert.equal(p.add.length,1);assert.equal(p.duplicates.length,1);p=I.plan(d,[a,C.clone(a),b]);assert.equal(p.add.length,0);assert.equal(p.duplicates.length,0);assert.equal(p.conflicts.length,3);assert.equal(JSON.stringify([d,a,b]),before);
});
test('账本已有同订单不同金额进冲突，不会通过疑似重复勾选入口导入',()=>{
 const d=data();d.entries=[row(d)];const p=I.plan(d,[row(d,{amount:2600})]);assert.equal(p.conflicts.length,1);assert.equal(p.add.length,0);assert.equal(p.suspects.length,0);assert.equal(p.duplicates.length,0);
});
test('跨入口及自定义ID按importIdentity或来源订单去重，回收站也保留身份',()=>{
 for(const place of ['entries','trash'])for(const identity of ['importIdentity','externalId']){const d=data(),t=row(d,{id:'custom-ai-id',...(identity==='importIdentity'?{externalId:'',importIdentity:'alipay-ORDER'}:{})});d[place]=[t];const p=I.plan(d,[row(d)]);assert.equal(p.add.length,0);assert.equal(p.duplicates.length,1);}
 const d=data(),legacy=parse(csv(),d).accepted[0],record=I.parseReview(csv()).records[0];d.entries=[C.newEntry(d,{id:record.id,book:'daily',date:record.date,amount:record.amount,title:record.title,payee:record.payee,account:'ali',importSource:record.source,externalId:record.order,importIdentity:record.id})];assert.equal(I.plan(d,[legacy]).duplicates.length,1);
});
test('Excel与原支付来源共用订单号时阻止重复，不误合并不同支付平台同号',()=>{
 const d=data();d.entries=[row(d,{id:'sheet-ORDER',importSource:'sheet'})];assert.equal(I.plan(d,[row(d)]).duplicates.length,1);assert.equal(I.plan(d,[row(d,{amount:2600})]).conflicts.length,1);d.entries=[row(d,{id:'wechat-ORDER',importSource:'wechat',title:'另一个虚构交易'})];assert.equal(I.plan(d,[row(d)]).add.length,1);
});
test('跨入口缺订单号同内容不默认导入，合法同内容不同订单保留各自身份',()=>{
 const d=data();d.entries=[row(d,{id:'ai-no-order',externalId:''})];const p=I.plan(d,[row(d,{id:'csv-no-order',externalId:''})]);assert.equal(p.add.length,0);assert.equal(p.suspects.length,1);const empty=data(),a=row(empty),b=row(empty,{id:'alipay-ORDER-2',externalId:'ORDER-2'}),batch=I.plan(empty,[a,b]);assert.equal(batch.add.length,2);assert.equal(batch.conflicts.length,0);
});
test('逗号、引号、换行不损坏文本；尾注被跳过；引号损坏明确拒绝',()=>{
 const title='虚构,商品"A"\n第二行',r=parse(csv([{'商品说明':title}]));assert.equal(r.accepted[0].title,title);assert.equal(r.accepted.length,1);assert.equal(r.rejected.length,0);assert.throws(()=>I.csvRows('日期,金额\n"未闭合'),/引号不完整/);
});
test('空前导行和多行引号单元格后报告物理行号，元信息不改变数组JSON接口',()=>{
 const text='\r\n\r\n'+csv([{'商品说明':'虚构首行\r\n虚构第二行'},{'交易状态':'待支付'},{'交易状态':'交易关闭'}]),rows=I.csvRows(text),review=I.parseReview(text),legacy=parse(text);
 assert.equal(rows[0].sourceLine,3);assert.deepEqual(review.records.map(r=>r.line),[6,8,9]);assert.equal(legacy.rejected[0].line,8);assert.equal(legacy.ignored[0].line,9);assert.equal(review.records[0].title,'虚构首行\r\n虚构第二行');assert.deepEqual(Object.keys(rows[0]),['0']);assert.doesNotMatch(JSON.stringify(rows),/sourceLine/);
 for(const newline of ['\n','\r','\r\n']){const parsed=I.csvRows(newline+'a,b'+newline+'"x'+newline+'y",z'+newline+'c,d');assert.deepEqual(parsed.map(r=>r.sourceLine),[2,3,5]);assert.equal(parsed[1][0],'x'+newline+'y');}
});
test('混合重复与金额冲突批次每一行都有去向，冲突订单不会漏到可导入列表',()=>{
 const d=data(),rows=[];for(let i=0;i<30;i++){const a=row(d,{id:'alipay-FAKE-'+i,externalId:'FAKE-'+i});rows.push(a,C.clone(a),{...a,amount:i%2?2600:2500});}
 const p=I.plan(d,rows),classified=[...p.add,...p.duplicates,...p.suspects,...p.conflicts];assert.equal(classified.length,rows.length);assert.equal(new Set(classified).size,rows.length);assert.equal(p.add.length,15);assert.equal(p.duplicates.length,30);assert.equal(p.conflicts.length,45);assert.ok(p.add.every(t=>Number(t.externalId.split('-').at(-1))%2===0));
 const repeated=I.plan(d,[row(d,{id:'changed-id-a'}),row(d,{id:'changed-id-b',amount:2700}),row(d,{id:'changed-id-c'})]);assert.equal(repeated.add.length,0);assert.equal(repeated.conflicts.length,3);assert.equal(repeated.duplicates.length,0);
});
