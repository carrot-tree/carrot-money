'use strict';
const C=require('./core'),{ROOT,PATH}=require('./storage');
const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
function references(d,path){return [...d.entries,...d.trash,...d.templates.map(x=>x.entry),...d.rules.map(x=>x.entry)].some(t=>t.attachments?.includes(path));}
async function save(store,entry,files,commit){
 const draft=C.clone(entry),created=[],vault=store.vault;
 for(const file of files){if(file.size>20*1024*1024)throw Error('单张图片请小于 20 MB');if(!Object.hasOwn(types,file.type))throw Error('仅支持 PNG、JPEG、WebP、GIF 图片');}
 try{
  for(const file of files){
   await store.mkdir(ROOT+'/附件');const path=ROOT+'/附件/'+C.uid()+'.'+types[file.type];
   if(await vault.adapter.exists(path))throw Error('图片文件名冲突，请重试');
   const bytes=await file.arrayBuffer();created.push(path);await vault.createBinary(path,bytes);draft.attachments.push(path);
  }
  await commit(draft);return draft;
 }catch(error){
  // A provider may reject after the ledger write actually committed. Confirm
  // persisted references before deleting only files owned by this attempt.
  let persisted;try{persisted=C.validate(JSON.parse(await vault.adapter.read(PATH)));}catch{}
  if(persisted)for(const path of created){
   if(references(persisted,path)||references(store.data,path))continue;
   try{const file=vault.getAbstractFileByPath(path);if(file)await vault.delete(file);else if(await vault.adapter.exists(path))await vault.adapter.remove(path);}catch{}
  }
  throw error;
 }
}
module.exports={save};
