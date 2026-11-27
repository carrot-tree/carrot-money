'use strict';
const IO=require('./vault-io'),C=require('./core'),Presets=require('./ai-presets');
const ROOT='Carrot记账',PATH=ROOT+'/data.json';
const RECOVERY=ROOT+'/恢复副本.json',IN_QUEUE=Symbol();
const withoutKeys=(name,value)=>name==='apiKey'?undefined:value;
const ledgerJSON=(data,space)=>JSON.stringify(data,withoutKeys,space);

function credentials(data,previous={},migrate=false){
 const saved=data.settings?.aiEnhancement;
 if(!saved)return previous;
 const {profiles}=Presets.restore(saved),next={...previous};
 for(const [id,{baseUrl,apiKey}] of Object.entries(profiles)){
  if(migrate&&(Object.hasOwn(next,id)||!apiKey))continue;
  next[id]={baseUrl:Presets.catalogUrl(baseUrl),value:apiKey||''};
 }
 return next;
}
function hydrate(data,store){
 const saved=data.settings?.aiEnhancement;
 if(!saved)return data;
 const {presetId,profiles}=Presets.restore(saved);
 // Older runtime ledger snapshots can outlive a save. Resolve their keys
 // against the same live keyring so a clear revokes those references as well.
 const expose=(target,id,baseUrl)=>Object.defineProperty(target,'apiKey',{
  enumerable:true,
  get(){
   const key=store.activeKeys[id];
   return typeof key?.value==='string'&&key.baseUrl===Presets.catalogUrl(baseUrl)?key.value:'';
  }
 });
 for(const [id,profile] of Object.entries(profiles))expose(profile,id,profile.baseUrl);
 data.settings.aiEnhancement=expose({...saved,presetId,profiles},presetId,profiles[presetId].baseUrl);
 return data;
}
class Store{
 constructor(vault,plugin){this.vault=vault;this.plugin=plugin;this.data=C.blank();this.raw='';this.error='';this.queue=Promise.resolve();this.privateData={};this.activeKeys={};}
 mkdir(path){return IO.mkdir(this.vault,path);}
 async write(path,text){await IO.write(this.vault,path,text,await IO.read(this.vault,path));}
 load(){const job=this.queue.then(()=>this.read());this.queue=job.catch(()=>{});return job;}
 async saveKeys(aiKeys){
  const next={...this.privateData,aiKeys};
  if(this.plugin)await this.plugin.saveData(next);
  this.privateData=next;
 }
 async scrub(path,raw){
  if(!/(?:"apiKey"|\\u)/.test(raw))return raw;
  let data;try{data=JSON.parse(raw);}catch{return raw;}
  const text=ledgerJSON(data);
  if(text===JSON.stringify(data))return raw;
  await IO.write(this.vault,path,text,raw);
  return text;
 }
 async scrubCopies(){
  const dir=ROOT+'/导出';
  const exports=await this.vault.adapter.exists(dir)?(await this.vault.adapter.list(dir)).files.filter(p=>/^Carrot记账\/导出\/完整账本-\d+\.json$/.test(p)):[];
  for(const path of [RECOVERY,...await this.backups(),...exports]){
   if(await this.vault.adapter.exists(path))await this.scrub(path,await this.vault.adapter.read(path));
  }
 }
 async read(){
  try{
   await this.mkdir(ROOT);
   const raw=await IO.read(this.vault,PATH);
   this.raw=raw??'';
   if(raw!==null){
    const parsed=JSON.parse(this.raw,withoutKeys);
    this.backupText=!this.plugin&&/(?:(?:"apiKey")|\\u)/.test(this.raw)?ledgerJSON(parsed):null;
    this.data=C.validate(parsed);
    if(this.plugin){
     this.privateData=await this.plugin.loadData()||{};
     const before=this.privateData.aiKeys||{},next=credentials(JSON.parse(this.raw),before,true);
     // Persist migrated credentials before modifying the only legacy source.
     if(JSON.stringify(next)!==JSON.stringify(before))await this.saveKeys(next);
     this.raw=await this.scrub(PATH,this.raw);
     await this.scrubCopies();
    }
   }else{
    if(this.plugin)this.privateData=await this.plugin.loadData()||{};
    this.backupText=null;this.data=C.blank();this.raw=ledgerJSON(this.data);
    await IO.write(this.vault,PATH,this.raw,null);
    if(this.plugin)await this.scrubCopies();
   }
   this.activeKeys=this.privateData.aiKeys||{};
   hydrate(this.data,this);
   this.error='';
  }catch(e){this.error='读取失败，已停止写入：'+e.message;}
  return !this.error;
 }
 backup(raw,manual=false,scope){
  if(scope===IN_QUEUE)return this.writeBackup(this.backupText||raw,manual);
  return IO.enqueue(this,async()=>{
   if(this.error)throw Error(this.error);
   const current=await IO.read(this.vault,PATH);
   if(current!==this.raw){await this.read();throw Error('账本已在别处更新，已重新读取；请重试备份');}
   if(raw!==undefined&&raw!==current)throw Error('仅可备份当前账本');
   return this.writeBackup(this.backupText||current,manual);
  });
 }
 async writeBackup(text,manual){
  await this.mkdir(ROOT+'/备份');
  // Bytes come from the validated, synchronized primary.
  const name=manual?'手动-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+C.uid().slice(0,6):C.today();
  const path=ROOT+'/备份/'+name+'.json',existing=await IO.read(this.vault,path);
  if(existing===null)await IO.write(this.vault,path,text,null);
  else await this.scrub(path,existing);
  await this.write(RECOVERY,text);
  if(existing===null)await this.rotateBackups();
  return path;
 }
 async rotateBackups(){
  try{
   const paths=await this.backups(),today=C.today();
   const cutoff=new Date(Date.parse(today+'T12:00:00Z')-29*86400000).toISOString().slice(0,10);
   const manual=/^Carrot记账\/备份\/手动-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-z0-9-]{1,6}\.json$/i;
   const expired=paths.filter(path=>{
    const date=/^Carrot记账\/备份\/(\d{4}-\d{2}-\d{2})\.json$/.exec(path)?.[1];
    return C.validDate(date)&&date<cutoff;
   });
   expired.push(...paths.filter(path=>manual.test(path)).slice(20));
   for(const path of expired){
    const file=this.vault.getAbstractFileByPath(path);
    if(file&&typeof this.vault.trash==='function')await this.vault.trash(file,true);
    else if(file&&typeof this.vault.delete==='function')await this.vault.delete(file);
   }
  }catch(error){this.backupWarning='快照轮转未完成：'+error.message;return;}
  this.backupWarning='';
 }
 clearKeys(id,{check}={}){
  const job=this.queue.then(async()=>{
   check?.();
   if(this.error)throw Error(this.error);
   const raw=await this.vault.adapter.read(PATH);
   if(raw!==this.raw){await this.read();throw Error('账本已在别处更新，请重试清除');}
   await this.scrubCopies();
   check?.();
   const next={...this.privateData.aiKeys};
   for(const provider of id?[id]:Presets.presets.map(p=>p.id)){
    // An empty credential also prevents old synced ledger bytes from restoring it.
    next[provider]={baseUrl:'',value:''};
   }
   await this.saveKeys(next);
   this.activeKeys=next;
  });
  this.queue=job.catch(()=>{});
  return job;
 }
 change(fn,{snapshot=false,check,beforeCommit,preserveCategories=false,saveAIKeys=false}={}){
  // Obsidian process callbacks are synchronous. The final lifecycle check belongs
  // inside that callback, after any queued file operation has actually started.
  const verify=()=>{const result=check?.();if(result&&typeof result.then==='function')throw Error('提交检查必须同步');};
  const job=this.queue.then(async()=>{
   verify();if(this.error)throw Error(this.error);if(beforeCommit)await beforeCommit();verify();
   const raw=await this.vault.adapter.read(PATH);
   if(raw!==this.raw){await this.read();throw Error('账本已在别处更新，已重新读取；请重试本次操作');}
   verify();
   const draft=C.clone(this.data),result=fn(draft);
   if(result&&typeof result.then==='function')throw Error('保存操作必须同步');
   const next=C.validate(result||draft);
   if(!preserveCategories)C.validateChanges(this.data,next);
   next.revision=this.data.revision+1;next.updatedAt=new Date().toISOString();
   const text=ledgerJSON(next),backup=await this.backup(raw,snapshot,IN_QUEUE);
   if(beforeCommit)await beforeCommit();verify();
   const f=IO.file(this.vault,PATH);
   const oldKeys=this.privateData.aiKeys||{},newKeys=saveAIKeys?credentials(next,oldKeys):oldKeys;
   const keysChanged=JSON.stringify(newKeys)!==JSON.stringify(oldKeys);
   if(keysChanged)await this.saveKeys(newKeys);
   try{
    await this.vault.process(f,current=>{
     verify();if(current!==raw)throw Error('保存时检测到外部更新，已取消写入');
     return text;
    });
   }catch(error){
    if(keysChanged)try{await this.saveKeys(oldKeys);}catch{
     this.error='账本保存与私有 Key 回退失败，请重新读取并核对 AI 设置';
     throw Error(this.error);
    }
    throw error;
   }
   this.activeKeys=newKeys;
   this.data=hydrate(JSON.parse(text),this);this.raw=text;this.backupText=null;
   return snapshot?{data:this.data,snapshot:backup}:this.data;
  });this.queue=job.catch(()=>{});return job;
 }
 async backups(){if(!await this.vault.adapter.exists(ROOT+'/备份'))return [];return (await this.vault.adapter.list(ROOT+'/备份')).files.filter(p=>p.endsWith('.json')).sort().reverse();}
 async restore(text){const next=C.validate(JSON.parse(text,withoutKeys));if(!this.error)return this.change(()=>next,{preserveCategories:true});const job=this.queue.then(async()=>{if(!this.error)throw Error('恢复状态已变化，请重新预览');const f=this.vault.getAbstractFileByPath(PATH);if(!f)throw Error('原文件已变化，请重新读取后恢复');const raw=await this.vault.adapter.read(PATH);if(raw!==this.raw){await this.read();throw Error('恢复前检测到外部更新，请重新预览');}await this.mkdir(ROOT+'/备份');await this.vault.create(ROOT+'/备份/损坏原件-'+Date.now()+'-'+C.uid().slice(0,6)+'.txt',raw);await this.vault.process(f,current=>{if(current!==raw)throw Error('恢复时检测到外部更新，已取消写入');return ledgerJSON(next);});await this.read();if(this.error)throw Error(this.error);});this.queue=job.catch(()=>{});return job;}
 async export(text,name,ext){await this.mkdir(ROOT+'/导出');const p=ROOT+'/导出/'+name+'-'+Date.now()+'.'+ext;await this.vault.create(p,text);return p;}
 exportJSON(){return this.export(ledgerJSON(this.data,2),'完整账本','json');}
}
module.exports={Store,ROOT,PATH};
