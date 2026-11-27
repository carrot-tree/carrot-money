'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Module=require('node:module'),{createRequire}=Module;
const C=require('../src/core'),Drafts=require('../src/entry-drafts');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.isConnected=false;this.disabled=false;}
 createEl(tag){const e=new Element(tag);this.children.push(e);return e;}
 addClass(){}setAttribute(){}empty(){this.children=[];}
 addEventListener(name,fn){this.events[name]=fn;}
 all(){return [this,...this.children.flatMap(e=>e.all())];}
 querySelectorAll(tag){return this.all().filter(e=>e.tag===tag);}
}
class Modal{
 constructor(app){this.app=app;this.contentEl=new Element();this.closed=0;}
 open(){this.onOpen?.();}
 close(){this.closed++;this.onClose?.();}
}
// Run the production dialog code with only the Obsidian host/DOM replaced.
// No provider requests, vault writes or user interface actions are involved.
const host={Plugin:class{},ItemView:class{},Modal,Scope:class{register(){}},Notice:class{},PluginSettingTab:class{}},file=require.resolve('../src/plugin'),localRequire=createRequire(file),context={module:{exports:{}},queueMicrotask,require:id=>id==='obsidian'?host:id==='./appearance'?{apply(){}}:localRequire(id)};
const originalLoad=Module._load;Module._load=function(id,...args){return id==='obsidian'?host:originalLoad.call(this,id,...args);};
try{vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.EntryModalForTest=EntryModal;',context,{filename:file});}finally{Module._load=originalLoad;}
const EntryModal=context.module.exports.EntryModalForTest;
function setup(store){const entry=new EntryModal({app:{},data:C.blank(),entryDrafts:store});entry.fields={amount:{value:'',type:'text'}};entry.cleanSnapshot=Drafts.signature(Drafts.capture(entry));entry.fields.amount.value='12 +';entry.dismiss=()=>entry.dismissed=(entry.dismissed||0)+1;entry.close();const prompt=entry.closePrompt,buttons=prompt.contentEl.querySelectorAll('button');return {entry,prompt,buttons,click:label=>buttons.find(b=>b.textContent===label).events.click()};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test('draft write locks all close choices until persistence succeeds',async()=>{
 const pending=deferred();let writes=0;const x=setup({get:()=>null,save:()=>{writes++;return pending.promise;}});
 const saving=x.click('暂存并关闭');assert.equal(writes,1);assert.ok(x.buttons.every(b=>b.disabled));x.prompt.close();await x.click('放弃本次输入');assert.equal(x.prompt.closed,0);assert.equal(x.entry.dismissed,undefined);
 pending.resolve();await saving;assert.equal(x.prompt.closed,1);assert.equal(x.entry.dismissed,1);assert.equal(writes,1);
});
test('failed draft write leaves raw input and usable choices in the open dialog',async()=>{
 const x=setup({get:()=>null,save:async()=>{throw Error('disk full');}});await x.click('暂存并关闭');assert.equal(x.prompt.closed,0);assert.equal(x.entry.fields.amount.value,'12 +');assert.equal(x.entry.dismissed,undefined);assert.ok(x.buttons.every(b=>!b.disabled));assert.ok(x.prompt.contentEl.all().some(e=>e.textContent==='disk full'));await x.click('继续编辑');assert.equal(x.prompt.closed,1);assert.equal(x.entry.dismissed,undefined);
});
test('an unrelated unavailable draft file cannot trap a user who discards current input',async()=>{
 const x=setup({error:'读取失败',get:()=>null,remove:async()=>{throw Error('must not write');}});await x.click('放弃本次输入');assert.equal(x.entry.dismissed,1);assert.equal(x.prompt.closed,1);
});
