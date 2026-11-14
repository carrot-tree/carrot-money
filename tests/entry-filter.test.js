'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core'),Entries=require('../src/entry-tools');
function fixture(){const d=C.blank();d.entries=[C.newEntry(d,{id:'fake-income',date:'2026-10-01',kind:'income',amount:1000,category:'cat-9'}),C.newEntry(d,{id:'fake-expense',date:'2026-10-02',kind:'expense',amount:500,category:'cat-0'}),C.newEntry(d,{id:'fake-previous',date:'2026-09-01',kind:'expense',amount:300,category:'cat-0'})];return d;}
test('从收入图表明细切换月份后恢复该月全部类型，不遗留不可见metric条件',()=>{
 const d=fixture(),filters={start:'2026-09-01',end:'2026-09-30',ids:['fake-previous'],metric:'income'},v={filters,drillLabel:'收入明细',reportBack:{tab:'reports',month:'2026-09'},month:'',page:4,selected:new Set(['fake-previous'])};Entries.changeMonth(v,'2026-10');assert.deepEqual(C.filter(d,{period:v.month,...v.filters}).map(t=>t.id),['fake-income','fake-expense']);assert.equal(v.drillLabel,'');assert.equal(v.reportBack,null);assert.equal(v.page,0);assert.equal(v.selected.size,0);assert.deepEqual(filters,{start:'2026-09-01',end:'2026-09-30',ids:['fake-previous'],metric:'income'});
});
test('换月保留用户的搜索与类别等显式条件，只清除原图表时间和结果约束',()=>{
 const d=fixture(),v={filters:{kind:'expense',category:'cat-0',min:400,query:'',metric:'net',ids:['fake-previous'],start:'2026-09-01',end:'2026-09-30'},drillLabel:'结余明细',reportBack:{tab:'reports'},selected:new Set(),page:2};Entries.changeMonth(v,'2026-10');assert.deepEqual(C.filter(d,{period:v.month,...v.filters}).map(t=>t.id),['fake-expense']);assert.equal(v.filters.kind,'expense');assert.equal(v.filters.min,400);assert.ok(Entries.chips(d,v.filters).every(x=>!['start','end'].includes(x.key)));
});
test('切回全部月份不会保留图表的收支或日期范围',()=>{
 const d=fixture(),v={filters:{metric:'expense',ids:['fake-expense'],start:'2026-10-01',end:'2026-10-31'},selected:new Set(),page:0};Entries.changeMonth(v,'');assert.equal(C.filter(d,{period:v.month,...v.filters}).length,3);assert.equal(v.reportBack,null);assert.equal(v.drillLabel,'');
});
