'use strict';
const C=require('./core');
const ROOT='Carrot记账',PATH=ROOT+'/data.json';
class Store{
 constructor(vault){this.vault=vault;this.data=C.blank();this.raw='';this.error='';this.queue=Promise.resolve();}
 async mkdir(path){if(!await this.vault.adapter.exists(path))await this.vault.createFolder(path);}
 async write(path,text){const f=this.vault.getAbstractFileByPath(path);if(f)await this.vault.modify(f,text);else await this.vault.create(path,text);}
 load(){const job=this.queue.then(()=>this.read());this.queue=job.catch(()=>{});return job;}
 async read(){try{await this.mkdir(ROOT);if(await this.vault.adapter.exists(PATH)){this.raw=await this.vault.adapter.read(PATH);this.data=C.validate(JSON.parse(this.raw));}else{this.data=C.blank();this.raw=JSON.stringify(this.data);await this.vault.create(PATH,this.raw);}this.error='';}catch(e){this.error='读取失败，已停止写入：'+e.message;}return !this.error;}
 async backup(raw=this.raw,manual=false){await this.mkdir(ROOT+'/备份');C.validate(JSON.parse(raw));const name=manual?'手动-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+C.uid().slice(0,6):C.today();const path=ROOT+'/备份/'+name+'.json';if(manual||!await this.vault.adapter.exists(path))await this.vault.create(path,raw);await this.write(ROOT+'/恢复副本.json',raw);return path;}
 change(fn,{snapshot=false,check,beforeCommit,preserveCategories=false}={}){
  // Obsidian process callbacks are synchronous. The final lifecycle check belongs
  // inside that callback, after any queued file operation has actually started.
  const verify=()=>{const result=check?.();if(result&&typeof result.then==='function')throw Error('提交检查必须同步');};
  const job=this.queue.then(async()=>{verify();if(this.error)throw Error(this.error);if(beforeCommit)await beforeCommit();verify();const raw=await this.vault.adapter.read(PATH);if(raw!==this.raw){await this.read();throw Error('账本已在别处更新，已重新读取；请重试本次操作');}verify();const draft=C.clone(this.data);const result=fn(draft);if(result&&typeof result.then==='function')throw Error('保存操作必须同步');const next=C.validate(result||draft);if(!preserveCategories)C.validateChanges(this.data,next);next.revision=this.data.revision+1;next.updatedAt=new Date().toISOString();const text=JSON.stringify(next);const backup=await this.backup(raw,snapshot);if(beforeCommit)await beforeCommit();verify();const f=this.vault.getAbstractFileByPath(PATH);if(!f)throw Error('账本文件尚未准备好');await this.vault.process(f,current=>{verify();if(current!==raw)throw Error('保存时检测到外部更新，已取消写入');return text;});this.data=next;this.raw=text;return snapshot?{data:next,snapshot:backup}:next;});this.queue=job.catch(()=>{});return job;
 }
 async backups(){if(!await this.vault.adapter.exists(ROOT+'/备份'))return [];return (await this.vault.adapter.list(ROOT+'/备份')).files.filter(p=>p.endsWith('.json')).sort().reverse();}
 async restore(text){const next=C.validate(JSON.parse(text));if(!this.error)return this.change(()=>next,{preserveCategories:true});const job=this.queue.then(async()=>{if(!this.error)throw Error('恢复状态已变化，请重新预览');const f=this.vault.getAbstractFileByPath(PATH);if(!f)throw Error('原文件已变化，请重新读取后恢复');const raw=await this.vault.adapter.read(PATH);if(raw!==this.raw){await this.read();throw Error('恢复前检测到外部更新，请重新预览');}await this.mkdir(ROOT+'/备份');await this.vault.create(ROOT+'/备份/损坏原件-'+Date.now()+'-'+C.uid().slice(0,6)+'.txt',raw);await this.vault.process(f,current=>{if(current!==raw)throw Error('恢复时检测到外部更新，已取消写入');return JSON.stringify(next);});await this.read();if(this.error)throw Error(this.error);});this.queue=job.catch(()=>{});return job;}
 async export(text,name,ext){await this.mkdir(ROOT+'/导出');const p=ROOT+'/导出/'+name+'-'+Date.now()+'.'+ext;await this.vault.create(p,text);return p;}
}
module.exports={Store,ROOT,PATH};
