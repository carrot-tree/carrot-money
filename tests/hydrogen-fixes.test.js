'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),Prefs=require('../src/report-preferences'),Insights=require('../src/insights');
const account=(id,currency='CNY',rate=1)=>({id,name:id,type:'现金',currency,rate,opening:0,archived:false});

test('new and changed CNY accounts reject non-parity rates before a normal write',()=>{
 const before=C.blank(),after=C.clone(before);after.accounts.push(account('new','CNY',7.2));
 assert.throws(()=>C.validateChanges(before,after),e=>e.field==='rate'&&/人民币/.test(e.message));
 after.accounts[0].rate=1;assert.doesNotThrow(()=>C.validateChanges(before,after));
 const changed=C.clone(after);changed.accounts[0].rate=2;
 assert.throws(()=>C.validateChanges(after,changed),/人民币/);
});

test('historical non-parity CNY accounts stay readable and do not block unrelated edits',()=>{
 const before=C.blank();before.accounts.push(account('old','CNY',7.2));const raw=JSON.stringify(before);
 C.validate(before);assert.equal(JSON.stringify(before),raw);
 const after=C.clone(before);after.entries.push(C.newEntry(after,{account:'old',amount:1200,rate:1}));
 assert.doesNotThrow(()=>{C.validate(after);C.validateChanges(before,after);});
 assert.equal(after.accounts[0].rate,7.2);
 const repaired=C.clone(before);repaired.accounts[0].rate=1;
 assert.doesNotThrow(()=>C.validateChanges(before,repaired));
 const changed=C.clone(before);changed.accounts[0].rate=6;
 assert.throws(()=>C.validateChanges(before,changed),/人民币/);
});

test('foreign rates remain supported and changing an account currency enforces CNY parity',()=>{
 const before=C.blank(),after=C.clone(before);after.accounts.push(account('usd','USD',7.2));
 assert.doesNotThrow(()=>{C.validate(after);C.validateChanges(before,after);});
 const cny=C.clone(after);cny.accounts[0].currency='CNY';
 assert.throws(()=>C.validateChanges(after,cny),/人民币/);
 cny.accounts[0].rate=1;assert.doesNotThrow(()=>C.validateChanges(after,cny));
});

test('chart defaults preserve full-period choice across serialization without persisting fixed dates',()=>{
 const d=C.blank();Prefs.save(d,'daily','reports',{chart:'line',toDate:false,start:'2026-11-01',end:'2026-11-30'});
 const loaded=C.validate(JSON.parse(JSON.stringify(d))),value=Prefs.get(loaded,'daily','reports');
 assert.equal(value.toDate,false);assert.equal(value.chart,'line');assert.equal(value.start,undefined);assert.equal(value.end,undefined);
 assert.deepEqual(Prefs.get(loaded,'daily','home'),{});
});

test('chart cutoff preferences accept only booleans, including explicit false',()=>{
 for(const toDate of [true,false]){const d=C.blank();Prefs.save(d,'daily','reports',{toDate});assert.equal(Prefs.get(d,'daily','reports').toDate,toDate);}
 for(const toDate of ['false',0,null]){const d=C.blank();assert.throws(()=>Prefs.save(d,'daily','reports',{toDate}),/统计截止/);assert.equal(d.settings.chartDefaults,undefined);}
});

test('saved analysis presets retain cutoff choice and restore independent state',()=>{
 const d=C.blank(),state={mode:'month',chart:'bar',visible:['expense'],toDate:false};
 const item=Insights.saveReport(d,'daily','2026-11',state,'整月消费');state.toDate=true;state.visible.push('income');
 assert.equal(item.state.toDate,false);assert.deepEqual(item.state.visible,['expense']);
 assert.equal(C.validate(JSON.parse(JSON.stringify(d))).settings.savedReports[0].state.toDate,false);
});
