'use strict';

async function read(vault,path){
 if(!await vault.adapter.exists(path))return null;
 try{return await vault.adapter.read(path);}
 catch(error){if(!await vault.adapter.exists(path))return null;throw error;}
}

async function mkdir(vault,path){
 if(await vault.adapter.exists(path))return;
 try{await vault.createFolder(path);}
 catch(error){if(!await vault.adapter.exists(path))throw error;}
}

function file(vault,path){
 const entry=vault.getAbstractFileByPath(path);
 if(!entry||Array.isArray(entry.children))throw Error('文件尚未同步到 Obsidian，请重新读取后重试：'+path);
 return entry;
}

async function write(vault,path,text,expected,check){
 const conflict=()=>Error('文件已在其他窗口更新，请重新读取后重试：'+path);
 if(expected===null){
  if(await vault.adapter.exists(path))throw conflict();
  try{check?.();await vault.create(path,text);}
  catch(error){if(await vault.adapter.exists(path))throw conflict();throw error;}
  return;
 }
 await vault.process(file(vault,path),current=>{
  check?.();
  if(current!==expected)throw conflict();
  return text;
 });
}

function enqueue(store,run){
 const job=store.queue.then(run);
 store.queue=job.catch(()=>{});
 return job;
}

function load(store,path,blank,parse,label){
 return enqueue(store,async()=>{
  try{
   const raw=await read(store.vault,path);
   store.data=raw===null?blank():parse(raw);
   store.raw=raw;
   store.error='';
  }catch(error){store.error='读取'+label+'失败：'+error.message;}
  return store.data;
 });
}
module.exports={read,mkdir,file,write,enqueue,load};
