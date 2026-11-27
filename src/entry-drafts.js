'use strict';
const IO=require('./vault-io');
const C=require('./core');
const ROOT='Carrot记账',PATH=ROOT+'/手动记账草稿.json';
const key=(book,id='')=>JSON.stringify([book,id||'new']);
function validate(data){
 if(!data||data.version!==1||!data.items||typeof data.items!=='object'||Array.isArray(data.items))throw Error('记账草稿格式无效');
 for(const [slot,draft] of Object.entries(data.items)){
  if(!draft||!draft.entry||typeof draft.entry.book!=='string'||typeof draft.entry.id!=='string'||slot!==key(draft.entry.book,draft.edit?draft.entry.id:'')||!draft.values||typeof draft.values!=='object'||Array.isArray(draft.values)||Object.values(draft.values).some(v=>typeof v!=='string'&&typeof v!=='boolean')||!Array.isArray(draft.splits)||!Array.isArray(draft.fileNames))throw Error('记账草稿内容无效');
 }
 return data;
}
function capture(modal){
 return {entry:C.clone(modal.entry),edit:!!modal.edit,original:modal.originalEntry,
  values:Object.fromEntries(Object.entries(modal.fields||{}).filter(([,f])=>f.type!=='file').map(([name,f])=>[name,f.type==='checkbox'?!!f.checked:String(f.value??'')])),
  splits:(modal.splitFields||[]).map(f=>({account:f.account.value,amount:0,rawAmount:f.amount.value})),
  fileNames:(modal.files||[]).map(f=>f.name)};
}
// Compare user-editable values only. Validation and rerenders may normalize the
// entry object; those changes alone must not make an untouched form dirty.
const signature=draft=>JSON.stringify([draft.entry.kind,draft.values,draft.splits,draft.fileNames]);
function restoreError(d,draft){
 const existing=d.entries.find(t=>t.id===draft.entry.id);
 if(!d.books.some(b=>b.id===draft.entry.book&&!b.archived))return '草稿所属账本已不存在或已归档。';
 if(draft.edit&&(!existing||JSON.stringify(existing)!==draft.original))return '原账目已变化，不能覆盖恢复这份编辑草稿。请保留草稿内容后重新编辑。';
 if(!draft.edit&&(existing||d.trash.some(t=>t.id===draft.entry.id)))return '这份草稿对应的账目已保存过，请在流水或回收站查看。';
 return '';
}
class EntryDraftStore{
 constructor(vault){this.vault=vault;this.data={version:1,items:{}};this.raw=null;this.error='';this.queue=Promise.resolve();}
 load(){return IO.load(this,PATH,()=>({version:1,items:{}}),raw=>validate(JSON.parse(raw)),'记账草稿');}
 get(book,id=''){return C.clone(this.data.items[key(book,id)]||null);}
 change(fn){const job=this.queue.then(async()=>{
  if(this.error)throw Error(this.error);
  const draft=C.clone(this.data);fn(draft.items);validate(draft);const text=JSON.stringify(draft);
  if(text===JSON.stringify(this.data))return;
  const raw=await IO.read(this.vault,PATH);
  if(raw!==this.raw)throw Error('记账草稿已在其他窗口更新，请重新读取本地设置后继续；当前输入仍保留。');
  await IO.mkdir(this.vault,ROOT);await IO.write(this.vault,PATH,text,raw);
  this.data=draft;this.raw=text;
 });this.queue=job.catch(()=>{});return job;}
 save(draft){const copy=C.clone(draft);copy.savedAt=new Date().toISOString();return this.change(items=>{items[key(copy.entry.book,copy.edit?copy.entry.id:'')]=copy;});}
 remove(book,id='',entryId){return this.change(items=>{const slot=key(book,id);if(!entryId||items[slot]?.entry.id===entryId)delete items[slot];});}
}
module.exports={EntryDraftStore,PATH,key,validate,capture,signature,restoreError};
