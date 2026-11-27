'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const C=require('../src/core'),Category=require('../src/category-picker'),Charts=require('../src/charts'),Audit=require('../src/audit'),Insights=require('../src/insights');
const sourceLoader=Module._load;
class HostPlugin{
 registerView(id,factory){this.events.push('view');this.factory=factory;}
 addSettingTab(){this.events.push('settings');}
 addRibbonIcon(){}
 addCommand(){}
}
const host={Plugin:HostPlugin,ItemView:class{},Modal:class{constructor(app){this.app=app;this.contentEl=fixture();this.modalEl=this.contentEl;}},Scope:class{},Notice:class{},TFile:class{},PluginSettingTab:class{},Setting:class{},setIcon(){}};
Module._load=function(id,...args){return id==='obsidian'?host:sourceLoader.call(this,id,...args);};
const Controls=require('../src/controls'),Bundle=require('../main');
test.after(()=>{Module._load=sourceLoader;});

class Element {
 constructor(document,tag,parent=null,opts={}){
  this.ownerDocument=document;this.tagName=tag;this.parentElement=parent;this.children=[];this.handlers=new Map();this.attrs={};this.dataset={};this.textContent=opts.text||'';this.disabled=false;this.style={setProperty(){},removeProperty(){}};
  this.classes=new Set((opts.cls||'').split(/\s+/));this.classList={add:x=>this.classes.add(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x),remove:x=>this.classes.delete(x)};
 }
 get isConnected(){return this.parentElement?.isConnected??this.ownerDocument.root===this;}
 createEl(tag,opts={}){const child=new Element(this.ownerDocument,tag,this,opts);this.children.push(child);return child;}
 appendChild(node){this.children.push(node);node.parentElement=this;}
 addClass(name){this.classes.add(name);}
 empty(){for(const child of this.children)child.parentElement=null;this.children=[];}
 setAttribute(k,v){this.attrs[k]=String(v);}
 getAttribute(k){return this.attrs[k]??null;}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(event,fn){if(!this.handlers.has(event))this.handlers.set(event,new Set());this.handlers.get(event).add(fn);}
 removeEventListener(event,fn){this.handlers.get(event)?.delete(fn);}
 fire(event,extra={}){for(const fn of [...this.handlers.get(event)||[]])fn({target:this,preventDefault(){},stopPropagation(){},...extra});}
 focus(){this.ownerDocument.activeElement=this;this.fire('focus');}
 contains(n){return n===this||this.children.some(child=>child.contains(n));}
 getBoundingClientRect(){return {x:0,y:0,left:0,top:0,right:300,bottom:200,width:300,height:200};}
 closest(){return null;}
 querySelectorAll(selector){
  const matches=(node,s)=>s==='[aria-label]'?node.getAttribute('aria-label')!==null:s.startsWith('.')?node.classes.has(s.slice(1)):node.tagName===s;
  return this.children.flatMap(node=>[...(selector.split(',').some(s=>matches(node,s.trim()))?[node]:[]),...node.querySelectorAll(selector)]);
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 dispatchEvent(event){this.fire(event.type);}
}
function fixture(){
 const document=new Element(null,'document');
 document.defaultView={Event,innerWidth:800,innerHeight:600};
 document.createElementNS=(_,tag)=>new Element(document,tag);
 const root=new Element(document,'root');
 document.root=root;
 return root;
}
const H={el:(p,tag,cls,text)=>p.createEl(tag,{cls,text}),btn:(p,text)=>p.createEl('button',{text}),field:(p)=>p.createEl('input'),drill(){}};
const byLabel=(root,label)=>root.querySelectorAll('[aria-label]').find(x=>x.getAttribute('aria-label')===label);

test('category touch selection survives focusout and outside pointerdown dismisses it',()=>{
 const root=fixture(),field=Category.create(root,'分类','x',[['','全部'],['x','原分类'],['y','目标分类']]);
 field.picker.open();field.picker.box.fire('focusout',{relatedTarget:null});
 assert.equal(field.picker.opened,true);
 field.picker.list.querySelectorAll('button').find(b=>b.dataset.value==='y').fire('click');
 assert.equal(field.value,'y');assert.equal(root.ownerDocument.activeElement,field.picker.trigger);
 field.picker.open();root.ownerDocument.fire('pointerdown',{target:root});
 assert.equal(field.picker.opened,false);
});

test('date and month controls retain focus on navigation and release outside listeners',()=>{
 const root=fixture(),date=Controls.dateInput(root,'记账日期','2026-10-01');
 const details=root.querySelector('.cm-day-picker');
 details.open=true;details.fire('toggle');details.fire('focusout',{relatedTarget:null});
 byLabel(root,'日历下个月').fire('click');
 assert.equal(root.ownerDocument.activeElement.getAttribute('aria-label'),'日历下个月');
 byLabel(root,'2026-11-01').fire('click');
 assert.equal(date.value,'2026-11-01');assert.equal(root.ownerDocument.activeElement,date);
 const month=Controls.monthPicker(root,'2026-10',()=>{});
 const picker=month.querySelector('.cm-month-picker');
 picker.open=true;picker.fire('toggle');
 byLabel(month,'选月弹层下一年').fire('click');
 assert.equal(root.ownerDocument.activeElement.getAttribute('aria-label'),'选月弹层下一年');
 root.ownerDocument.fire('pointerdown',{target:root});
 assert.equal(picker.open,false);Controls.dispose(root);
 assert.equal(root.ownerDocument.handlers.get('pointerdown').size,0);
 assert.equal(Controls.shiftMonth('0099-12',1),'0100-01');
});

test('chart has one Tab stop, arrows move focus, and touch opens details on a second tap',()=>{
 const root=fixture(),a=root.createEl('rect'),b=root.createEl('rect'),tip=root.createEl('div');tip.hidden=true;
 let hits=0;Charts.target(a,tip,'第一项',()=>hits++);Charts.target(b,tip,'第二项',()=>hits++);
 assert.deepEqual([a.getAttribute('tabindex'),b.getAttribute('tabindex')],['0','-1']);
 a.fire('keydown',{key:'ArrowRight'});
 assert.deepEqual([a.getAttribute('tabindex'),b.getAttribute('tabindex')],['-1','0']);
 b.fire('pointerdown',{pointerType:'touch'});b.fire('click',{pointerType:'touch'});
 assert.equal(hits,0);assert.equal(tip.textContent,'第二项');assert.equal(tip.hidden,false);
 b.fire('pointerdown',{pointerType:'touch'});b.fire('click',{pointerType:'touch'});
 assert.equal(hits,1);
});

test('audit and monthly review calculate only on first expansion',t=>{
 const root=fixture(),v={d:C.blank(),book:'daily',month:'2026-10',report:{},render(){},p:{}};
 const scan=t.mock.method(Audit,'scan',()=>[]);
 const review=t.mock.method(Insights,'monthly',()=>({month:v.month,current:{income:0,expense:0,net:0},prior:{income:0,expense:0,net:0},changes:[],rows:[],undated:0}));
 require('../src/audit-view').render(v,root,H);require('../src/review-view').render(v,root,H);
 assert.equal(scan.mock.callCount(),0);assert.equal(review.mock.callCount(),0);
 for(const details of [root.querySelector('.cm-audit'),root.querySelector('.cm-month-review')]){
  details.open=true;details.fire('toggle');details.open=false;details.fire('toggle');details.open=true;details.fire('toggle');
 }
 assert.equal(scan.mock.callCount(),1);assert.equal(review.mock.callCount(),1);
});

test('packaged main registers before storage and supports 100-row native entry point pagination',async()=>{
 const plugin=new Bundle();plugin.events=[];
 const files=new Map(),folders=new Set(),today=C.today();
 const d=C.blank();d.accounts.push({id:'a',name:'钱包',opening:0,currency:'CNY',rate:1});
 for(let i=0;i<500;i++)d.entries.push(C.newEntry(d,{id:'e'+i,title:'示例 '+i,amount:100,account:'a',date:today}));
 files.set('Carrot记账/data.json',JSON.stringify(d));
 const vault={
  adapter:{exists:async path=>files.has(path)||folders.has(path),read:async path=>files.get(path),list:async()=>({files:[]})},
  createFolder:async path=>folders.add(path)
 };
 plugin.app={vault,workspace:{getLeavesOfType:()=>[]}};
 plugin.loadData=async()=>null;
 const loading=plugin.onload();assert.deepEqual(plugin.events,['view']);
 await loading;assert.deepEqual(plugin.events,['view','settings']);assert.equal(plugin.data.entries.length,500);
 const view={app:plugin.app,p:plugin,month:today.slice(0,7),pager:plugin._ui.MoneyView.prototype.pager};
 const account=new plugin._ui.AccountModal(view,plugin.data.accounts[0]);account.onOpen();
 assert.equal(account.contentEl.querySelectorAll('tr').length,101);
 assert.equal(account.contentEl.querySelectorAll('input').some(el=>el.type==='month'),false);
 await [...byLabel(account.contentEl,'下一页').handlers.get('click')][0]();
 assert.equal(account.page,1);assert.equal(account.contentEl.querySelectorAll('tr').length,101);
 assert.equal(account.contentEl.ownerDocument.activeElement?.getAttribute('aria-label'),'下一页');
 plugin.onunload();assert.equal(plugin.aiUnloaded,true);
});

test('XLSX date helpers cover fractional days and mobile image input accepts extension aliases',async()=>{
 const X=require('../src/ai-xlsx'),Attachments=require('../src/entry-attachments');
 assert.equal(X.serial('61.5',false),'1900-03-01 12:00:00');
 assert.equal(X.serial('0',false),'0');
 const draft=C.newEntry(C.blank()),created=[];
 const vault={adapter:{exists:async()=>false},createBinary:async(path)=>{created.push(path);}};
 const store={vault,mkdir:async()=>{}};
 const bytes=async()=>new ArrayBuffer(1);
 await Attachments.save(store,draft,[{name:'receipt.JPEG',type:'',size:1,arrayBuffer:bytes},{name:'receipt',type:'image/jpg',size:1,arrayBuffer:bytes}],async row=>assert.equal(row.attachments.length,2));
 assert.ok(created.every(path=>path.endsWith('.jpg')));
});

test('unload during initialization does not register settings or detach any leaves',async()=>{
 const plugin=new Bundle();plugin.events=[];
 const vault={adapter:{exists:async()=>true,read:async()=>JSON.stringify(C.blank()),list:async()=>({files:[]})}};
 let complete;plugin.loadData=()=>new Promise(resolve=>{complete=resolve;});
 plugin.app={vault,workspace:{getLeavesOfType:()=>[],detachLeavesOfType:()=>assert.fail('unload must preserve workspace leaves')}};
 const loading=plugin.onload();
 await new Promise(resolve=>setImmediate(resolve));plugin.onunload();complete(null);
 await loading;assert.deepEqual(plugin.events,['view']);
});

test('touch target and selected calendar CSS outrank the compact defaults',()=>{
 const css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../styles.css'),'utf8');
 const removed=['ai-banner','home-row','month-symbol','nav-icon','period','quick-grid','report-extra','report-filters','report-guide','static-legend'];
 for(const name of removed)assert.doesNotMatch(css,new RegExp('\\.cm-'+name+'(?![\\w-])'));
 assert.match(css,/\.cm-chat-input\{[^}]*font-size:14px/);
 assert.doesNotMatch(css,/\.cm-chat-input\{[^}]*font-size:13px!important/);
 assert.match(css,/@media\(pointer:coarse\)\{\s*[^}]*\.cm-import-preview-actions[^}]*min-height:44px!important/);
 for(const name of ['month','day'])assert.match(css,new RegExp('\\.cm-'+name+'-grid button\\.active\\{background:var\\(--cm-button-bg\\);color:var\\(--cm-on-button\\)'));
});
