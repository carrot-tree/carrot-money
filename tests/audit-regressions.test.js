'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),I=require('../src/imports'),AI=require('../src/ai-import'),Drafts=require('../src/ai-drafts');
const Action=require('../src/ai-ask-action'),Category=require('../src/ai-category-request'),Candidate=require('../src/ai-candidate-job');
const Exclusions=require('../src/ai-exclusions'),CategoryUI=require('../src/category-view'),Attachments=require('../src/entry-attachments');
const EntryTools=require('../src/entry-tools');
const Report=require('../src/ai-agent-report'),Tools=require('../src/ai-agent-tools'),Agent=require('../src/ai-agent'),{Store,ROOT,PATH}=require('../src/storage');
const settings={aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://fictional.invalid/v1',apiKey:'fictional-key',model:'fictional-model',agentEnabled:true,agentMaxSeconds:30,agentMaxCalls:12,agentMaxTokens:200000}};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function ledger(){const d=C.blank();d.accounts.push({id:'cny',name:'虚构人民币',type:'微信',currency:'CNY',rate:1,opening:0,archived:false},{id:'usd',name:'虚构美元',type:'支付宝',currency:'USD',rate:7.2,opening:0,archived:false});return d;}
const entry=(d,extra={})=>C.newEntry(d,{id:'expense',date:'2024-02-10',title:'虚构火锅',amount:10000,category:'cat-0',account:'cny',...extra});
function vault(d=C.blank()){
 const files=new Map([[PATH,JSON.stringify(d)]]),folders=new Set([ROOT,ROOT+'/导出']);
 const v={files,writes:[],deleted:[],before:async()=>{},after:async()=>{},
  adapter:{exists:async p=>files.has(p)||folders.has(p),read:async p=>{assert.ok(files.has(p),'missing fixture file: '+p);const raw=files.get(p);await v.before('read',p);return raw;},list:async p=>({files:[...files.keys()].filter(x=>x.startsWith(p+'/')),folders:[]}),remove:async p=>{files.delete(p);v.deleted.push(p);}},
  createFolder:async p=>folders.add(p),getAbstractFileByPath:p=>files.has(p)?{path:p}:null,
  create:async(p,text)=>{await v.before('create',p);assert.ok(!files.has(p));files.set(p,text);v.writes.push(p);await v.after('create',p);return {path:p};},
  createBinary:async(p,bytes)=>{await v.before('binary',p);assert.ok(!files.has(p));files.set(p,bytes);v.writes.push(p);await v.after('binary',p);return {path:p};},
  modify:async(f,text)=>{await v.before('modify',f.path);files.set(f.path,text);v.writes.push(f.path);await v.after('modify',f.path);},
  process:async(f,fn)=>{await v.before('process',f.path);files.set(f.path,fn(files.get(f.path)));v.writes.push(f.path);await v.after('process',f.path);},
  delete:async f=>{await v.before('delete',f.path);files.delete(f.path);v.deleted.push(f.path);}
 };return v;
}
async function storeFor(d=ledger()){const v=vault(d),store=new Store(v);assert.equal(await store.load(),true);return {v,store};}
async function batchFor(d,currency='CNY'){
 const csv='交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,币种\n2024-02-10 12:00:00,餐饮美食,虚构商户,虚构午餐,支出,12.34,'+(currency==='CNY'?'微信':'支付宝')+',交易成功,fictional-order,'+currency;
 const parsed=I.parseReview(csv,'fixture.csv');return AI.analyze({name:'fixture.csv',records:parsed.records,files:[],skipped:[]},d,'daily');
}
test('foreign CSV requires an explicit rate; explicit parity remains a valid user choice',()=>{
 const d=ledger(),csv='日期,类型,金额,标题,币种,汇率\n2024-02-10,支出,12.34,虚构午餐,USD,';
 const missing=I.parse(csv,d,'daily','usd');assert.equal(missing.accepted.length,0);assert.match(missing.rejected[0].reason,/汇率/);
 const good=I.parse(csv+'7.2',d,'daily','usd').accepted[0];assert.equal(good.rate,7.2);assert.equal(C.base(good),8885);
 assert.equal(I.parse(csv+'1',d,'daily','usd').accepted[0].rate,1);
 for(const rate of ['0','-1','NaN'])assert.equal(I.parse(csv+rate,d,'daily','usd').accepted.length,0);
});
test('same-batch rows without an order get a suspect warning and remain selectable',()=>{
 const d=ledger(),row='2024-02-10,支出,12.34,虚构午餐',parsed=I.parse('日期,类型,金额,标题\n'+row+'\n'+row,d,'daily','cny'),p=I.plan(d,parsed.accepted);
 assert.equal(p.add.length,1);assert.equal(p.suspects.length,1);assert.equal(p.duplicates.length,0);
 assert.equal(I.confirmPlan(d,parsed.accepted,C.clone(p)).length,1);assert.equal(I.confirmPlan(d,parsed.accepted,C.clone(p),true).length,2);
});
test('foreign Notion dual amounts cannot bypass currency conversion through legacy statistics',()=>{
 const d=ledger(),parsed=I.parse('日期,标题,收入,支出,币种,汇率\n2024-02-10,虚构美元午餐,,12.34,USD,7.2',d,'daily','usd');
 assert.equal(parsed.accepted.length,0);assert.match(parsed.rejected[0].reason,/双金额格式仅支持人民币/);
 const cny=I.parse('日期,标题,收入,支出\n2024-02-10,虚构午餐,,12.34',d,'daily','cny');assert.equal(C.impact(cny.accepted[0]).expense,1234);
});
test('a changed import classification cannot silently grow the approved set',()=>{
 const d=ledger();d.entries.push(entry(d,{title:'虚构午餐',amount:1234}));
 const parsed=I.parse('日期,类型,金额,标题\n2024-02-10,支出,12.34,虚构午餐\n2024-02-11,支出,20.00,虚构新账目',d,'daily','cny'),preview=C.clone(I.plan(d,parsed.accepted));
 assert.equal(preview.add.length,1);assert.equal(preview.suspects.length,1);d.entries[0].title='已更正的虚构午餐';
 assert.equal(I.plan(d,parsed.accepted).add.length,2);assert.throws(()=>I.confirmPlan(d,parsed.accepted,preview),/预览后/);
});
test('foreign AI rows require explicit currency/rate review, then can post and survive draft reload',async()=>{
 const d=ledger(),batch=await batchFor(d,'USD'),row=batch.rows[0];assert.equal(row.entry.rate,null);assert.equal(AI.preflight(d,batch,[row.key]).ok,false);
 AI.edit(batch,row.key,{nature:'expense',title:row.entry.title,date:row.entry.date,amount:'12.34',account:'usd',category:'cat-0',currency:'USD',rate:'7.2'},d);
 assert.equal(AI.preflight(d,batch,[row.key]).ok,true);const packed=Drafts.pack('daily',{batch,group:'review'}),reopened=Drafts.parse(JSON.stringify({version:1,revision:0,drafts:[packed]})).drafts[0].batch;
 assert.equal(reopened.rows[0].fxReviewed,true);assert.equal(AI.preflight(d,reopened,[row.key]).ok,true);AI.post(d,reopened,[row.key]);assert.equal(C.base(d.entries[0]),8885);
});
test('changing currency without reviewing its rate invalidates an older FX approval',async()=>{
 const d=ledger(),batch=await batchFor(d),row=batch.rows[0];
 AI.edit(batch,row.key,{nature:'expense',amount:'12.34',currency:'CNY',rate:'1',account:'cny'},d);
 AI.edit(batch,row.key,{nature:'expense',amount:'12.34',currency:'USD',account:'usd'},d);
 assert.equal(row.fxReviewed,false);assert.equal(AI.preflight(d,batch,[row.key]).ok,false);
});
test('foreign refunds inherit the posted original exchange rate instead of a new rate',async()=>{
 const d=ledger();d.entries.push(entry(d,{id:'original',amount:5000,currency:'USD',rate:7.2,account:'usd'}));const batch=await batchFor(d,'USD'),row=batch.rows[0];
 AI.edit(batch,row.key,{nature:'refund',amount:'12.34',related:'original',account:'usd',currency:'CNY',rate:'1'},d);
 assert.equal(row.entry.currency,'USD');assert.equal(row.entry.rate,7.2);assert.equal(row.fxReviewed,true);assert.equal(AI.preflight(d,batch,[row.key]).ok,true);
});
test('choosing a foreign original supplies the refund rate even when its source CSV has none',async()=>{
 const d=ledger();d.entries.push(entry(d,{id:'original',amount:5000,currency:'USD',rate:7.2,account:'usd'}));const batch=await batchFor(d,'USD'),row=batch.rows[0];
 AI.edit(batch,row.key,{nature:'refund',amount:'12.34',related:'original',account:'usd',currency:'USD',rate:''},d);
 assert.equal(row.entry.rate,7.2);assert.equal(row.fxReviewed,true);assert.equal(AI.preflight(d,batch,[row.key]).ok,true);
});
test('refund exclusion rejects transfers on both automatic and manual paths',async()=>{
 const d=ledger(),batch=await batchFor(d),e=batch.rows[0],r=C.clone(e);e.entry.kind=e.nature='transfer';e.record.title='虚构同一订单';e.record.order='same';
 r.key='refund-row';r.entry.id=r.record.id='refund-id';r.record.key=r.key;r.entry.kind=r.nature='refund';r.record.direction='收入';r.record.status='退款成功';r.record.type='退款';r.record.title='退款虚构同一订单';r.record.order='same';batch.rows.push(r);
 assert.equal(Exclusions.pairs(batch.rows,d).length,0);assert.throws(()=>Exclusions.pair(batch,e.key,[r.key],d),/转账|真实支出/);assert.equal(e.state,'pending');assert.equal(r.state,'pending');
});
test('new category mismatches are rejected while unchanged historical data remains readable',async()=>{
 const d=ledger();d.entries.push(entry(d,{kind:'income',category:'cat-0'}));C.validate(d);const {store,v}=await storeFor(d);
 await store.change(x=>{x.settings.theme='dark';});assert.equal(store.data.entries[0].category,'cat-0');
 const before=v.files.get(PATH);await assert.rejects(store.change(x=>{x.entries.push(entry(x,{id:'new-income',kind:'income',category:'cat-0'}));}),/收支类型/);assert.equal(v.files.get(PATH),before);
 await store.change(x=>{x.entries[0].category='cat-9';});assert.equal(store.data.entries[0].category,'cat-9');
});
test('changing an in-use category type cannot invalidate existing entries or templates',async()=>{
 const d=ledger();d.entries.push(entry(d));d.templates.push({id:'template',name:'虚构模板',entry:entry(d,{id:'template-entry',amount:0})});const {store}=await storeFor(d);
 await assert.rejects(store.change(x=>{x.categories.find(c=>c.id==='cat-0').type='income';}),/收支类型/);
 await assert.rejects(store.change(x=>{x.rules.push({id:'rule',name:'虚构周期',next:'2024-03-01',frequency:'monthly',enabled:true,entry:entry(x,{id:'rule-entry',kind:'income',category:'cat-0'})});}),/收支类型/);
});
test('explicit full-ledger restore preserves historically accepted category data',async()=>{
 const {store}=await storeFor(),old=ledger();old.entries.push(entry(old,{kind:'income',category:'cat-0'}));await store.restore(JSON.stringify(old));assert.equal(store.data.entries[0].category,'cat-0');
});
function relatedLedger(kind='refund',location='entries'){
 const d=ledger();d.entries.push(entry(d,{reimbursable:true}));const r=entry(d,{id:'related',kind,related:'expense',date:'2024-03-10',amount:2000,title:'虚构关联记录'});
 if(location==='trash')r.deletedAt='2024-03-11T00:00:00.000Z';d[location].push(r);C.validate(d);return d;
}
test('deleting an expense previews linked active refunds and preserves a recoverable family',()=>{
 const d=relatedLedger(),plan=EntryTools.deletePlan(d,'expense');assert.deepEqual(plan.ids,['expense','related']);assert.equal(plan.related.length,1);
 EntryTools.deleteEntry(d,plan);C.validate(d);assert.equal(d.entries.length,0);assert.equal(d.trash.length,2);C.restoreEntries(d,plan.ids);assert.equal(d.entries.length,2);assert.equal(d.trash.length,0);
});
test('a changed deletion family cannot silently delete records outside its preview',()=>{
 const d=relatedLedger(),plan=EntryTools.deletePlan(d,'expense');d.entries.push(entry(d,{id:'later-refund',kind:'refund',related:'expense',amount:100}));const before=C.clone(d);
 assert.throws(()=>EntryTools.deleteEntry(d,plan),/变化/);assert.deepEqual(d,before);
});
const categoryRequest={intent:'action',action:'set_category',start:'2024-02-01',end:'2024-02-29',ids:['expense'],to:'cat-1'};
for(const kind of ['refund','reimbursement'])for(const location of ['entries','trash'])test('category preview includes '+kind+' in '+location+' outside the requested period and undo restores both',()=>{
 const d=relatedLedger(kind,location),before=C.clone(d),plan=Action.preview(d,'daily',categoryRequest);assert.equal(plan.count,2);assert.equal(plan.linkedCount,1);assert.ok(plan.ids.includes('related'));
 if(location==='trash'){assert.equal(plan.trashCount,1);assert.match(Action.allRows(d,plan).find(r=>r.id==='related').title,/回收站/);}
 assert.throws(()=>Action.withSelection(d,plan,['expense']),/一起选择/);const receipt=Action.apply(d,plan);C.validate(d);assert.equal(d[location].find(t=>t.id==='related').category,'cat-1');
 assert.equal(d.entries.some(t=>t.id==='related'),location==='entries');assert.deepEqual(Action.undo(d,receipt),{restored:2,skipped:0});C.validate(d);assert.deepEqual(d,before);
});
test('per-row category targets synchronize each original own refund',()=>{
 const d=relatedLedger();d.entries.push(entry(d,{id:'other'}),entry(d,{id:'other-refund',kind:'refund',related:'other',amount:500,date:'2024-03-12'}));
 const plan=Action.preview(d,'daily',{intent:'action',action:'set_categories',start:categoryRequest.start,end:categoryRequest.end,changes:[{id:'expense',to:'cat-1'},{id:'other',to:'cat-2'}]});Action.apply(d,plan);C.validate(d);
 assert.equal(d.entries.find(t=>t.id==='related').category,'cat-1');assert.equal(d.entries.find(t=>t.id==='other-refund').category,'cat-2');
});
test('newly related refunds make an old preview stale and an old undo skip the whole family',()=>{
 const d=relatedLedger(),plan=Action.preview(d,'daily',categoryRequest);d.entries.push(entry(d,{id:'later',kind:'refund',related:'expense',amount:100,date:'2024-02-12'}));assert.throws(()=>Action.apply(d,plan),/变化/);
 const fresh=Action.preview(d,'daily',categoryRequest),receipt=Action.apply(d,fresh);d.entries.push(entry(d,{id:'latest',kind:'refund',related:'expense',category:'cat-1',amount:100,date:'2024-02-13'}));
 const before=C.clone(d);assert.deepEqual(Action.undo(d,receipt),{restored:0,skipped:3});assert.deepEqual(d,before);C.validate(d);
});
test('moving a linked record between active and trash invalidates a prior selection',()=>{
 const d=relatedLedger(),plan=Action.preview(d,'daily',categoryRequest),related=d.entries.find(t=>t.id==='related');d.entries=d.entries.filter(t=>t.id!=='related');d.trash.push(related);
 assert.throws(()=>Action.withSelection(d,plan,plan.ids),/变化/);assert.throws(()=>Action.apply(d,plan),/变化/);
});
test('editing one original explicitly synchronizes related category while keeping trash in place',()=>{
 const d=relatedLedger('refund','trash'),updated=C.clone(d.entries[0]);updated.category='cat-1';C.putEntry(d,updated);C.validate(d);assert.equal(d.trash[0].category,'cat-1');assert.equal(d.trash[0].deletedAt,'2024-03-11T00:00:00.000Z');
});
test('manual batch category changes synchronize an unselected linked refund in trash',()=>{
 const d=relatedLedger('refund','trash');EntryTools.batchEntries(d,['expense'],{category:'cat-2',tags:'虚构标签'});C.validate(d);assert.equal(d.entries[0].category,'cat-2');assert.equal(d.trash[0].category,'cat-2');assert.deepEqual(d.entries[0].tags,['虚构标签']);assert.equal(d.trash[0].deletedAt,'2024-03-11T00:00:00.000Z');
});
test('manual batch rejects orphan refund classification and missing selected records before mutation',()=>{
 const d=relatedLedger(),before=C.clone(d);assert.throws(()=>EntryTools.batchEntries(d,['related'],{category:'cat-2'}),/同时选择原支出/);assert.deepEqual(d,before);assert.throws(()=>EntryTools.batchEntries(d,['expense','missing'],{tags:'虚构标签'}),/已变化/);assert.deepEqual(d,before);
});
test('adjusting a category preview through its linked trash refund retargets the complete family',()=>{
 const d=relatedLedger('refund','trash'),before=C.clone(d),plan=Action.preview(d,'daily',categoryRequest),next=Action.retarget(d,plan,'related','cat-2');
 assert.deepEqual(d,before);assert.deepEqual(Action.allRows(d,next).map(r=>r.categoryId),['cat-2','cat-2']);assert.equal(next.linkedCount,1);const receipt=Action.apply(d,next);C.validate(d);assert.equal(d.entries[0].category,'cat-2');assert.equal(d.trash[0].category,'cat-2');Action.undo(d,receipt);assert.deepEqual(d,before);
});
test('candidate-review workflow reaches a complete preview for purchases with refunds',async()=>{
 const d=relatedLedger();d.categories.push({id:'snack',name:'虚构小吃',type:'expense',icon:'🍘',parent:'',archived:false});
 const question='把名称包含火锅的支出的分类改成虚构小吃',job=Category.resolve(question,d,'daily');let calls=0;
 const result=await Candidate.run(question,{job,d,book:'daily',settings,cfg:Agent.config(settings),requestUrl:async req=>{calls++;const payload=JSON.parse(JSON.parse(req.body).messages.at(-1).content);return {status:200,json:{choices:[{message:{content:JSON.stringify({batchId:payload.batch.id,to:payload.target.id,ids:payload.batch.rows.map(t=>t.id),reason:'虚构核对'})},finish_reason:'stop'}]}};}});
 assert.equal(result.status,'preview');assert.equal(result.count,2);assert.equal(result.linkedCount,1);assert.equal(calls,1);assert.equal(d.entries[0].category,'cat-0');
});
test('cross-currency account changes fail before confirmation and same-currency changes remain reversible',()=>{
 const d=ledger();d.entries.push(entry(d,{currency:'USD',rate:7.2,account:'usd'}));
 for(const request of [{action:'set_account',account:'cny'},{action:'set_method',method:'微信',targetAccountId:'cny'}])assert.throws(()=>Action.preview(d,'daily',{intent:'action',start:categoryRequest.start,end:categoryRequest.end,ids:['expense'],...request}),/币种/);
 d.accounts.push({...d.accounts[1],id:'usd-2',name:'虚构第二美元账户'});const plan=Action.preview(d,'daily',{intent:'action',action:'set_account',start:'2024-02-01',end:'2024-02-29',ids:['expense'],account:'usd-2'}),receipt=Action.apply(d,plan);C.validate(d);assert.equal(d.entries[0].account,'usd-2');Action.undo(d,receipt);assert.equal(d.entries[0].account,'usd');
});
test('ambiguous payment methods require an explicit matching active account',()=>{
 const d=ledger();d.accounts.push({id:'cc-a',name:'虚构信用卡甲',type:'信用卡',currency:'CNY',rate:1,opening:0},{id:'cc-b',name:'虚构信用卡乙',type:'信用卡',currency:'CNY',rate:1,opening:0});d.entries.push(entry(d));
 const request={intent:'action',action:'set_method',start:'2024-02-01',end:'2024-02-29',ids:['expense'],method:'信用卡'};
 assert.throws(()=>Action.preview(d,'daily',request),/多个账户/);assert.equal(Action.preview(d,'daily',{...request,targetAccountId:'cc-b'}).task.targetAccountId,'cc-b');
 assert.throws(()=>Action.preview(d,'daily',{...request,targetAccountId:'cny'}),/多个账户|找不到/);d.accounts.find(a=>a.id==='cc-b').archived=true;assert.equal(Action.preview(d,'daily',request).task.targetAccountId,'cc-a');
});
test('public load and save share one queue, preventing a late old read from reverting memory',async()=>{
 const {v,store}=await storeFor(),entered=gate(),release=gate();let pause=true;
 v.before=async(op,p)=>{if(op==='read'&&p===PATH&&pause){pause=false;entered.resolve();await release.promise;}};
 const loading=store.load();await entered.promise;const changing=store.change(d=>{d.entries.push(entry(d));});await new Promise(setImmediate);assert.equal(JSON.parse(v.files.get(PATH)).revision,0);
 release.resolve();await Promise.all([loading,changing]);assert.equal(store.data.revision,1);assert.equal(store.data.entries.length,1);assert.equal(store.raw,v.files.get(PATH));
});
test('external-update reload runs inside its current write job without a queue deadlock',async()=>{
 const {v,store}=await storeFor(),updated=C.clone(store.data);updated.revision=1;updated.settings.theme='dark';v.files.set(PATH,JSON.stringify(updated));
 await assert.rejects(store.change(()=>{}),/别处更新/);assert.equal(store.data.revision,1);await store.change(d=>{d.settings.theme='light';});assert.equal(store.data.revision,2);
});
function node(){return {dataset:{},isConnected:true,addClass(){},closest(){return null;},classList:{toggle(){}},style:{removeProperty(){},setProperty(){}},setAttribute(){},empty(){}};}
async function categoryModal(d,mode,id){
 const x=await storeFor(d),buttons=[],p={store:x.store,drafts:{states:new Map(),raw:'',queue:Promise.resolve()},get data(){return x.store.data;},app:{vault:x.v},change:(fn,options)=>x.store.change(fn,options)};
 class Modal{constructor(){this.contentEl=node();}open(){this.onOpen();}close(){}}
 const view={p,get d(){return p.data;},app:p.app,render(){}};
 await CategoryUI.open(view,mode,[id],{Modal,el:()=>node(),btn:(parent,text,fn)=>{const b={text,fn};buttons.push(b);return b;}});
 return {...x,p,confirm:buttons.find(b=>b.text.startsWith('创建快照'))};
}
for(const mode of ['delete','icons'])test('category '+mode+' uses asynchronous preflight with a synchronous commit guard',async()=>{
 const d=ledger();d.categories.push({id:'unused',name:mode==='icons'?'正餐':'虚构无引用分类',type:'expense',parent:'',icon:'',archived:false});const x=await categoryModal(d,mode,'unused');
 await x.confirm.fn();assert.equal(x.confirm.hidden,true);assert.equal(x.store.data.categories.some(c=>c.id==='unused'),mode!=='delete');if(mode==='icons')assert.ok(x.store.data.categories.find(c=>c.id==='unused').icon);
 assert.ok([...x.v.files.keys()].some(p=>p.includes('/备份/手动-')));
});
test('a saved AI draft changed during backup blocks category deletion',async()=>{
 const d=ledger();d.categories.push({id:'unused',name:'虚构无引用分类',type:'expense',parent:'',icon:'',archived:false});const x=await categoryModal(d,'delete','unused'),batch=await batchFor(d);batch.rows[0].entry.category='unused';
 const packed=Drafts.pack('daily',{batch,group:'review'});x.store.backup=async()=>{x.v.files.set(Drafts.PATH,JSON.stringify({version:1,revision:1,drafts:[packed]}));return 'fixture';};
 const before=x.v.files.get(PATH);await x.confirm.fn();assert.equal(x.v.files.get(PATH),before);assert.equal(x.confirm.hidden,undefined);
});
test('an unsaved draft changed at the final process boundary blocks category deletion',async()=>{
 const d=ledger();d.categories.push({id:'unused',name:'虚构无引用分类',type:'expense',parent:'',icon:'',archived:false});const x=await categoryModal(d,'delete','unused'),batch=await batchFor(d);batch.rows[0].entry.category='unused';
 x.v.before=async(op,p)=>{if(op==='process'&&p===PATH)x.p.drafts.states.set('review',{batch});};const before=x.v.files.get(PATH);await x.confirm.fn();assert.equal(x.v.files.get(PATH),before);
});
test('editing draft arrays never mutates the loaded entry before a save',()=>{
 const d=ledger(),original=entry(d,{attachments:[ROOT+'/附件/original.png'],tags:['旧标签'],splits:[{account:'cny',amount:10000}]});d.entries.push(original);const draft=C.newEntry(d,{...original});
 draft.attachments.push(ROOT+'/附件/new.png');draft.tags.push('新标签');draft.splits[0].amount=1;
 assert.deepEqual(original.attachments,[ROOT+'/附件/original.png']);assert.deepEqual(original.tags,['旧标签']);assert.equal(original.splits[0].amount,10000);
});
const imageFile=(extra={})=>({size:3,type:'image/png',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer,...extra});
test('attachment failure removes only this attempt files and leaves original arrays and images intact',async()=>{
 const d=ledger();d.entries.push(entry(d,{attachments:[ROOT+'/附件/original.png']}));const {v,store}=await storeFor(d);v.files.set(ROOT+'/附件/original.png',new Uint8Array([9]).buffer);const draft=C.newEntry(store.data,{...store.data.entries[0]});
 await assert.rejects(Attachments.save(store,draft,[imageFile()],async()=>{throw Error('fixture commit failure');}),/fixture/);
 assert.equal(v.files.has(ROOT+'/附件/original.png'),true);assert.equal(v.deleted.length,1);assert.deepEqual(store.data.entries[0].attachments,[ROOT+'/附件/original.png']);assert.deepEqual(draft.attachments,[ROOT+'/附件/original.png']);
});
test('all attachment file types are checked before creating the first image',async()=>{
 const {v,store}=await storeFor();await assert.rejects(Attachments.save(store,entry(store.data),[imageFile(),imageFile({type:'text/plain'})],async()=>{}),/仅支持/);assert.equal(v.writes.length,0);
});
test('a later image read failure rolls back earlier new images',async()=>{
 const {v,store}=await storeFor();await assert.rejects(Attachments.save(store,entry(store.data),[imageFile(),imageFile({arrayBuffer:async()=>{throw Error('fixture image read failure');}})],async()=>{}),/image read/);assert.equal(v.deleted.length,1);assert.equal([...v.files.keys()].filter(x=>x.startsWith(ROOT+'/附件/')).length,0);
});
test('a ledger commit followed by an error never deletes its referenced image',async()=>{
 const {v,store}=await storeFor();v.after=async(op,p)=>{if(op==='process'&&p===PATH)throw Error('fixture after-commit failure');};
 await assert.rejects(Attachments.save(store,entry(store.data),[imageFile()],draft=>store.change(d=>{C.putEntry(d,draft);})),/after-commit/);
 const persisted=JSON.parse(v.files.get(PATH)),path=persisted.entries[0].attachments[0];assert.ok(v.files.has(path));assert.equal(v.deleted.length,0);
});
test('a successful attachment save returns its persisted paths without mutating the input draft',async()=>{
 const {v,store}=await storeFor(),draft=entry(store.data),saved=await Attachments.save(store,draft,[imageFile()],next=>store.change(d=>{C.putEntry(d,next);}));
 assert.equal(saved.attachments.length,1);assert.deepEqual(draft.attachments,[]);assert.deepEqual(store.data.entries[0].attachments,saved.attachments);assert.ok(v.files.has(saved.attachments[0]));
});
for(const title of ['2024','月度报告'])test('generic monthly report filenames tolerate ledger text '+title+' without bypassing custom-name privacy',async()=>{
 const d=ledger();d.entries.push(entry(d,{title,payee:'虚构敏感商户'}));const v=vault(d);v.files.set(Tools.SPEC,'| 1 | 本月总览 | 说明 |');let calls=0;
 const answer=await Report.run('生成2024-02分析报告',{d,book:'daily',vault:v,settings,cfg:Agent.config(settings),job:{month:'2024-02',resume:false},requestUrl:async()=>{calls++;return {status:200,json:{choices:[{message:{content:JSON.stringify({markdown:'## 本月总览\n\n虚构报告说明。'})},finish_reason:'stop'}]}};}});
 assert.equal(answer.status,'done');assert.equal(calls,1);assert.ok(v.files.has(answer.path));assert.ok(v.files.has(answer.path.replace(/\.html$/,'.md')));
 await assert.rejects(Tools.writeReport(v,{path:'虚构敏感商户报告.html',mode:'create',markdown:'# 虚构报告\n\n## 总览\n\n说明。'},d,Tools.evidence(),undefined,'daily'),/文件名包含账目字段/);
});
