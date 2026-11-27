'use strict';
// Two files cannot be committed atomically by the Vault API. A durable intent
// records both old and new bytes before either report file is changed.
const C=require('./core');
const queues=new WeakMap(),ROOT='Carrot记账/导出/';
class SaveError extends Error{
 constructor(path,message='报告保存未完成，已生成内容可继续保存。'){super(message);this.name='ReportSaveError';this.code='report_save';this.path=path;}
}
class OwnershipError extends Error{}
function paths(path){
 if(typeof path!=='string'||!path.startsWith(ROOT)||!path.endsWith('.html')||/[\/\\\x00-\x1f]/.test(path.slice(ROOT.length))||path.includes('..'))throw Error('报告恢复路径无效');
 return {html:path,md:path.replace(/\.html$/,'.md'),journal:path.replace(/\.html$/,'.report-state.json')};
}
const verify=check=>{const result=check?.();if(result&&typeof result.then==='function')throw Error('报告提交检查必须同步');};
async function read(vault,path){return await vault.adapter.exists(path)?vault.adapter.read(path):null;}
async function snapshot(vault,path){const p=paths(path);return {md:await read(vault,p.md),html:await read(vault,p.html)};}
function locked(vault,path,fn){
 let entries=queues.get(vault);if(!entries){entries=new Map();queues.set(vault,entries);}
 path=path.normalize('NFC').toLowerCase();
 const job=(entries.get(path)||Promise.resolve()).catch(()=>{}).then(fn);entries.set(path,job);
 return job.finally(()=>{if(entries.get(path)===job)entries.delete(path);});
}
function conflict(path){return new SaveError(path,'报告文件已在别处修改，已停止覆盖。请保留现有文件，核对冲突后重试或重新生成报告。');}
async function replace(vault,path,before,after,check,reportPath){
 verify(check);
 if(before===null){
  if(await vault.adapter.exists(path))throw conflict(reportPath);
  verify(check);await vault.create(path,after);
 }else{
  const file=vault.getAbstractFileByPath(path);if(!file||typeof vault.process!=='function')throw conflict(reportPath);
  await vault.process(file,current=>{verify(check);if(current!==before)throw conflict(reportPath);return after;});
 }
}
function record(raw,path,book){
 if(raw===null)return null;
 let value;try{value=JSON.parse(raw);}catch{throw new OwnershipError('报告恢复记录损坏，已保留文件并停止访问。');}
 if(!value||value.version!==1||value.path!==path||typeof value.id!=='string'||!['pending','committed'].includes(value.status)||typeof value.book!=='string'||book&&value.book!==book)throw new OwnershipError('报告恢复记录与当前账本不一致，已停止访问。');
 for(const key of value.status==='pending'?['before','after']:['after'])for(const ext of ['md','html']){
  const text=value[key]?.[ext];if(!(key==='before'&&text===null)&&(typeof text!=='string'||text.length>2e6))throw new OwnershipError('报告恢复内容无效，已停止访问。');
 }
 return value;
}
function legacyReport(){
 return new OwnershipError('旧报告缺少账本归属；可在导出目录手动核对，或在当前账本重新生成。');
}
async function owner(vault,path,book){
 if(typeof book!=='string'||!book)throw Error('缺少报告所属账本');
 return record(await read(vault,paths(path).journal),path,book);
}
async function readOwned(vault,path,book){
 const value=await owner(vault,path,book);
 const pair=await snapshot(vault,path);
 if(pair.md===null&&pair.html===null&&!value)throw Error('报告不存在');
 if(!value)throw legacyReport();
 if(value.status!=='committed')throw Error('报告仍有待恢复的保存，请先继续保存。');
 if(pair.md!==value.after.md||pair.html!==value.after.html)throw conflict(path);
 return pair;
}
async function complete(vault,path,value,raw,check){
 const p=paths(path),current=await snapshot(vault,path);verify(check);
 // Check the entire pair before changing either member. Never repair over edits.
 for(const ext of ['md','html'])if(current[ext]!==value.before[ext]&&current[ext]!==value.after[ext])throw conflict(path);
 for(const ext of ['md','html']){
  verify(check);if(current[ext]===value.after[ext])continue;
  await replace(vault,p[ext],value.before[ext],value.after[ext],check,path);
 }
 const saved=await snapshot(vault,path);verify(check);
 if(saved.md!==value.after.md||saved.html!==value.after.html)throw conflict(path);
 const committed=JSON.stringify({version:1,id:value.id,path,book:value.book,status:'committed',after:value.after});
 await replace(vault,p.journal,raw,committed,check,path);
 const final=await snapshot(vault,path);verify(check);if(final.md!==value.after.md||final.html!==value.after.html)throw conflict(path);
 return {path,recovered:true};
}
function safeError(error,path){return error instanceof SaveError||error instanceof OwnershipError?error:new SaveError(path);}
async function save(vault,path,before,after,{check,book}={}){
 return locked(vault,path,async()=>{
  try{
   verify(check);
   if(typeof book!=='string'||!book)throw Error('缺少报告所属账本');
   const p=paths(path),raw=await read(vault,p.journal),previous=record(raw,path,book);
   if(previous?.status==='pending')throw new SaveError(path,'这份报告仍有待恢复的保存，请先继续保存。');
   const current=await snapshot(vault,path);verify(check);
   if(!previous&&(current.md!==null||current.html!==null))throw legacyReport();
   if(previous&&(current.md!==previous.after.md||current.html!==previous.after.html))throw conflict(path);
   if(current.md!==before.md||current.html!==before.html)throw conflict(path);
   const value={version:1,id:C.uid(),path,book,status:'pending',before,after},text=JSON.stringify(value);
   await replace(vault,p.journal,raw,text,check,path);
   return await complete(vault,path,value,text,check);
  }catch(e){throw safeError(e,path);}
 });
}
async function recover(vault,path,{check,book,validate}={}){
 return locked(vault,path,async()=>{
  try{
   verify(check);
   if(typeof book!=='string'||!book)throw Error('缺少报告所属账本');
   const raw=await read(vault,paths(path).journal),value=record(raw,path,book);verify(check);
   if(!value){
    const pair=await snapshot(vault,path);verify(check);
    if(pair.md!==null||pair.html!==null)throw legacyReport();
    return {path,recovered:false};
   }
   if(validate)validate(value.after);
   if(value.status==='committed'){const current=await snapshot(vault,path);verify(check);if(current.md!==value.after.md||current.html!==value.after.html)throw conflict(path);return {path,recovered:false};}
   return await complete(vault,path,value,raw,check);
  }catch(e){throw safeError(e,path);}
 });
}
module.exports={SaveError,legacyReport,paths,snapshot,owner,readOwned,save,recover};
