'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const notices=[],originalLoad=Module._load;
Module._load=function(id,...args){if(id==='obsidian')return {Notice:class{constructor(message){notices.push(message);}}};return originalLoad.call(this,id,...args);};
const UI=require('../src/ai-settings');Module._load=originalLoad;
const Remote=require('../src/ai-provider'),Models=require('../src/ai-models'),C=require('../src/core'),{Store}=require('../src/storage');
class Element{
 constructor(tag='div',options={}){this.tag=tag;this.children=[];this.textContent=options.text||'';this.classes=new Set((options.cls||'').split(' ').filter(Boolean));this.isConnected=true;this.attributes={};this.classList={add:(...names)=>names.forEach(name=>this.classes.add(name)),toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);}};}
 createEl(tag,options={}){const child=new Element(tag,options);child.parent=this;this.children.push(child);return child;}
 setAttribute(key,value){this.attributes[key]=value;}
 empty(){this.children=[];}
 all(){return [this,...this.children.flatMap(child=>child.all())];}
}
class Control{
 constructor(kind,setting){this.kind=kind;this.setting=setting;this.inputEl=new Element('input');this.selectEl=new Element('select');this.options=[];this.disabled=false;}
 setValue(value){this.value=value;return this;}
 setDisabled(value){this.disabled=value;return this;}
 addOption(value,label){this.options.push({value,label});return this;}
 setButtonText(text){this.text=text;return this;}
 setCta(){return this;}
 onClick(fn){this.click=fn;return this;}
 onChange(fn){this.change=value=>{this.value=value;return fn(value);};return this;}
}
const rows=[];
class Setting{
 constructor(parent){this.parent=parent;this.controls=[];rows.push(this);this.settingEl=parent.createEl('div',{cls:'setting-item'});this.settingEl.createEl('div',{cls:'setting-item-info'});this.settingEl.createEl('div',{cls:'setting-item-control'});}
 setName(name){this.name=name;return this;}
 setDesc(desc){this.desc=desc;return this;}
 add(kind,fn){const control=new Control(kind,this);this.controls.push(control);fn(control);return this;}
 addToggle(fn){return this.add('toggle',fn);}addDropdown(fn){return this.add('dropdown',fn);}addText(fn){return this.add('text',fn);}addButton(fn){return this.add('button',fn);}
}
function setup(extra={}){
 rows.length=0;notices.length=0;
 const p={data:{settings:{aiEnhancement:Remote.validateConfig(Remote.config({aiEnhancement:{enabled:true,presetId:'custom',baseUrl:'https://fictional.invalid/v1',apiKey:'fictional-key-for-tests',model:'fictional-model',agentEnabled:true,...extra}}))}},writes:0};
 p.change=async fn=>{const next=JSON.parse(JSON.stringify(p.data));fn(next);p.data=next;p.writes++;};
 const root=new Element(),controller=UI.render(root,p,{Setting});
 return {p,root,controller,row:name=>rows.find(row=>row.name===name),button:text=>rows.flatMap(row=>row.controls).find(control=>control.text===text),input:name=>rows.find(row=>row.name===name)?.controls.find(control=>control.kind==='text'),draft:()=>root.all().find(el=>el.classes.has('cm-ai-settings-draft')).textContent,result:()=>root.all().find(el=>el.classes.has('cm-ai-settings-result')).textContent};
}
function stub(t,owner,key,fn){const old=owner[key];owner[key]=fn;t.after(()=>{if(old===undefined)delete owner[key];else owner[key]=old;});}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function storagePausedAtBackup(view){
 const data=C.blank();data.settings={...data.settings,...view.p.data.settings};
 let disk=JSON.stringify(data),writes=0;const before=disk,entered=deferred(),release=deferred();
 const store=new Store({adapter:{read:async()=>disk},getAbstractFileByPath:path=>({path}),process:async(_file,fn)=>{disk=fn(disk);writes++;}});
 store.data=data;store.raw=disk;
 // Exercise the real transaction order while keeping every byte in memory.
 store.backup=async()=>{entered.resolve();await release.promise;return 'fictional-backup';};
 Object.defineProperty(view.p,'data',{get:()=>store.data});view.p.change=(fn,options)=>store.change(fn,options);
 return {entered,release,before,disk:()=>disk,writes:()=>writes};
}

test('save remains above grouped controls, advanced values collapse and concurrency is bounded',()=>{
 const x=setup(),bar=x.root.children.findIndex(el=>el.classes.has('cm-ai-settings-savebar')),firstGroup=x.root.children.findIndex(el=>el.classes.has('cm-ai-settings-group'));
 assert.ok(bar<firstGroup);assert.match(x.draft(),/已保存/);assert.equal(x.button('保存 AI 设置').disabled,true);
 const advanced=x.root.children.find(el=>el.tag==='details');assert.ok(advanced);assert.notEqual(advanced.open,true);assert.equal(x.input('识别并发批数').inputEl.max,'3');
 assert.equal(x.row('模型名').parent.children.some(el=>el.tag==='p'&&el.classes.has('cm-ai-destination')),true);
});

test('local configuration check never calls a provider or saves the draft',async t=>{
 let requests=0;stub(t,Remote,'testConnection',async()=>{requests++;});stub(t,Models,'readModels',async()=>{requests++;});
 const x=setup();x.input('模型名').change('different-fictional-model');await x.button('检查配置（不联网）').click();
 assert.equal(requests,0);assert.equal(x.p.writes,0);assert.match(x.result(),/本地配置检查通过/);assert.match(x.draft(),/未保存/);assert.match(notices.at(-1),/尚未保存/);
 x.input('识别并发批数').change('4');await x.button('检查配置（不联网）').click();assert.match(x.result(),/未通过/);assert.match(x.result(),/1 至 3/);
});

test('successful and failed connection checks retain an explicit unsaved state',async t=>{
 let ok=true,reads=0;stub(t,Remote,'testConnection',async()=>({ok,message:ok?'固定问候通过':'虚构连接失败'}));stub(t,Models,'readModels',async()=>{reads++;return {ok:true,models:['fictional-model']};});
 const x=setup();x.input('API Key').change('another-fictional-key');await x.button('测试连接').click();
 assert.match(x.row('连接检测').desc,/通过/);assert.match(x.draft(),/未保存/);assert.equal(x.p.writes,0);assert.equal(reads,0,'connectivity does not silently fetch models');
 ok=false;await x.button('测试连接').click();assert.match(x.row('连接检测').desc,/未通过/);assert.match(x.draft(),/未保存/);assert.equal(x.input('API Key').value,'another-fictional-key');
});

test('save clears draft state only after persistence and hides the key',async()=>{
 const x=setup(),gate=deferred();x.input('模型名').change('saved-fictional-model');x.row('显示 API Key').controls[0].change(true);
 const change=x.p.change;x.p.change=async fn=>{await gate.promise;return change(fn);};const work=x.button('保存 AI 设置').click();
 assert.equal(x.button('保存 AI 设置').disabled,true);assert.match(x.draft(),/尚未保存/);gate.resolve();await work;
 assert.equal(x.p.data.settings.aiEnhancement.model,'saved-fictional-model');assert.match(x.draft(),/已保存/);assert.doesNotMatch(x.draft(),/未保存/);assert.equal(x.input('API Key').inputEl.type,'password');assert.equal(x.button('保存 AI 设置').disabled,true);
});

test('failed save preserves editable input and does not report success',async()=>{
 const x=setup();x.input('模型名').change('unsaved-fictional-model');x.p.change=async()=>{throw Error('simulated disk failure');};await x.button('保存 AI 设置').click();
 assert.equal(x.p.data.settings.aiEnhancement.model,'fictional-model');assert.match(x.draft(),/未保存/);assert.match(x.result(),/保存失败/);assert.equal(x.button('保存 AI 设置').disabled,false);
});

test('clearing a key removes stale check results and disables unavailable model actions',async t=>{
 stub(t,Remote,'testConnection',async()=>({ok:true,message:'fictional success'}));const x=setup();await x.button('测试连接').click();x.input('模型名').change('keep-this-draft');await x.button('清除当前 Key').click();
 assert.equal(x.p.data.settings.aiEnhancement.apiKey,'');assert.equal(x.input('API Key').value,'');assert.match(x.row('连接检测').desc,/重新检测/);assert.equal(x.button('读取模型列表').disabled,true);assert.equal(x.button('读取思考选项').disabled,true);assert.equal(x.row('思考强度 / 模式').controls[0].disabled,true);assert.equal(x.button('测试连接').disabled,true);assert.match(x.draft(),/未保存/);assert.equal(x.p.data.settings.aiEnhancement.model,'fictional-model');
});

test('busy model reads reject double actions and late results after dispose never save',async t=>{
 const gate=deferred();let reads=0;stub(t,Models,'readModels',async()=>{reads++;await gate.promise;return {ok:true,models:['fictional-read-model']};});
 const x=setup(),work=x.button('读取模型列表').click();await x.button('读取模型列表').click();await x.button('保存 AI 设置').click();assert.equal(reads,1);assert.equal(x.button('清除当前 Key').disabled,true);
 x.controller.dispose();const count=notices.length;gate.resolve();await work;assert.equal(x.p.writes,0);assert.equal(notices.length,count);assert.deepEqual(x.p.data.settings.aiEnhancement.modelCatalog,{});
});

for(const action of ['保存 AI 设置','清除当前 Key','清除全部 Key','读取模型列表']){
 test(`${action} rechecks a disposed settings view after the backup await`,async t=>{
  if(action==='读取模型列表')stub(t,Models,'readModels',async()=>({ok:true,models:['fictional-read-model']}));
  const x=setup(),disk=storagePausedAtBackup(x);
  if(action==='保存 AI 设置')x.input('模型名').change('edited-before-close');
  const work=x.button(action).click();await disk.entered.promise;
  x.controller.dispose();const noticeCount=notices.length;disk.release.resolve();await work;
  assert.equal(disk.writes(),0,'closing the settings view must prevent a late settings commit');
  assert.equal(disk.disk(),disk.before);assert.equal(notices.length,noticeCount);
 });
}

test('model catalog persistence retains separate dirty controls',async t=>{
 stub(t,Models,'readModels',async()=>({ok:true,models:['fictional-model','fictional-new-model']}));const x=setup();x.input('Agent 总时长上限（秒）').change('400');await x.button('读取模型列表').click();
 assert.equal(x.p.writes,1);assert.deepEqual(x.p.data.settings.aiEnhancement.modelCatalog.custom.models,['fictional-model','fictional-new-model']);assert.equal(x.p.data.settings.aiEnhancement.agentMaxSeconds,300);assert.match(x.draft(),/未保存/);
});

test('queued save cannot overwrite a concurrent external configuration update',async()=>{
 const x=setup();x.input('模型名').change('draft-model');x.p.change=async fn=>{x.p.data.settings.aiEnhancement.model='external-model';const next=JSON.parse(JSON.stringify(x.p.data));fn(next);x.p.data=next;x.p.writes++;};await x.button('保存 AI 设置').click();
 assert.equal(x.p.writes,0);assert.equal(x.p.data.settings.aiEnhancement.model,'external-model');assert.match(x.result(),/保存失败/);assert.match(x.draft(),/未保存/);
});

test('queued model catalog writes recheck provider identity inside the transaction',async t=>{
 stub(t,Models,'readModels',async()=>({ok:true,models:['fictional-model']}));const x=setup();x.p.change=async fn=>{x.p.data.settings.aiEnhancement.apiKey='external-fictional-key';const next=JSON.parse(JSON.stringify(x.p.data));fn(next);x.p.data=next;x.p.writes++;};await x.button('读取模型列表').click();
 assert.equal(x.p.writes,0);assert.deepEqual(x.p.data.settings.aiEnhancement.modelCatalog,{});assert.match(x.result(),/保存 AI 设置/);assert.match(x.draft(),/未保存/);
});

test('Agent detection uses its own explicit action and respects the Agent toggle',async t=>{
 let calls=0;stub(t,Remote,'testAgent',async(settings,options)=>{calls++;assert.equal(options.userInitiated,true);assert.equal(Object.keys(settings).join(','),'aiEnhancement');return {ok:true,message:'虚构工具协议检查通过'};});
 const x=setup();await x.button('检测 Agent 能力').click();assert.equal(calls,1);assert.match(x.row('Agent 检测').desc,/通过/);assert.equal(x.p.writes,0);
 x.row('启用 AI 管账').controls[0].change(false);assert.equal(x.button('检测 Agent 能力').disabled,true);await x.button('检测 Agent 能力').click();assert.equal(calls,1);
});

test('changing API key or destination invalidates account-specific model candidates',()=>{
 for(const field of ['API Key','服务地址']){
  const x=setup({modelCatalog:{custom:{baseUrl:'https://fictional.invalid/v1',models:['account-specific-model'],at:'2026-01-01T00:00:00Z'}}});
  assert.match(x.row('候选模型来源').desc,/来自服务商/);x.input(field).change(field==='API Key'?'different-fictional-key':'https://other-fictional.invalid/v1');
  assert.match(x.row('候选模型来源').desc,/内置建议/);assert.match(x.draft(),/未保存/);assert.equal(x.p.writes,0);
 }
});
