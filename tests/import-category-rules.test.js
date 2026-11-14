'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core'),AI=require('../src/ai-import');
function data(){const d=C.blank();d.accounts=[{id:'fictional-alipay',name:'虚构支付宝',type:'支付宝',currency:'CNY',opening:0,rate:1}];d.categories.push({id:'fictional-courier',name:'快递',type:'expense',parent:'',icon:'',archived:false},{id:'fictional-clothes',name:'穿滴',type:'expense',parent:'',icon:'',archived:false});return d;}
function classify(title,d=data(),extra={}){return AI.localProvider.classify({source:'alipay',title,payee:'虚构商户',direction:'支出',status:'交易成功',amount:1200,currency:'CNY',method:'支付宝',categoryLabel:'',type:'',note:'',...extra},{data:d});}
test('明确寄件费用只匹配已有快递分类，付款账户和交易性质不变',()=>{
 for(const title of ['闲鱼寄件-寄件费','虚构快递费','虚构寄递运费']){const d=data(),before=JSON.stringify(d),r=classify(title,d);assert.equal(r.category,'fictional-courier');assert.equal(r.nature,'expense');assert.equal(r.account,'fictional-alipay');assert.ok(r.score>=.85);assert.equal(JSON.stringify(d),before);}
});
test('未有快递分类、名称重复或归档时不能高置信猜测分类',()=>{
 for(const kind of ['missing','duplicate','archived']){const d=data();if(kind==='missing')d.categories=d.categories.filter(c=>c.id!=='fictional-courier');if(kind==='duplicate')d.categories.push({...d.categories.find(c=>c.id==='fictional-courier'),id:'second-courier'});if(kind==='archived')d.categories.find(c=>c.id==='fictional-courier').archived=true;const r=classify('虚构寄件费',d);assert.equal(r.category,'cat-8');assert.ok(r.score<.55);}
});
test('运费险、退运费与赠送免运费不会命中快递消费规则',()=>{
 for(const title of ['赠送运费险','虚构退运费','运费退款','退还运费','赠送快递费','免运费虚构商品','无需运费虚构商品','包邮虚构商品'])assert.notEqual(classify(title).category,'fictional-courier',title);
 const refund=classify('虚构退款-退运费');assert.equal(refund.nature,'refund');const income=classify('虚构运费',{...data()},{direction:'收入'});assert.equal(income.nature,'income');assert.notEqual(income.category,'fictional-courier');
});
test('明确棉鞋拖鞋等服饰弱线索可提示分类，但不升级到高置信',()=>{
 for(const title of ['虚构保暖棉鞋','虚构室内拖鞋','虚构皮鞋','虚构凉鞋','虚构靴子']){const r=classify(title);assert.equal(r.category,'fictional-clothes');assert.ok(r.score>=.55&&r.score<.85);}
});
test('快递费与鞋类/书籍多目标线索冲突时保留低置信待核实',()=>{
 for(const title of ['虚构棉鞋和快递费','虚构买书及运费']){const r=classify(title);assert.equal(r.category,'cat-8');assert.ok(r.score<.55);assert.ok(r.reasons.some(x=>x.includes('冲突')));}
});
