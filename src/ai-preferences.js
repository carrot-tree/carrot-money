'use strict';
const IO=require('./vault-io');
const C=require('./core');
const ROOT='Carrot记账',PATH=ROOT+'/AI记账偏好.json';
function validate(value){if(!value||value.version!==1||!value.books||typeof value.books!=='object'||Array.isArray(value.books))throw Error('记账偏好文件格式无效');for(const list of Object.values(value.books)){if(!Array.isArray(list)||list.length>100||new Set(list.map(x=>x?.id)).size!==list.length||list.some(x=>!x||typeof x.id!=='string'||!x.id||typeof x.text!=='string'||!x.text.trim()||x.text.length>500||typeof x.enabled!=='boolean'))throw Error('记账偏好内容无效');}return value;}
class PreferenceStore{
 constructor(vault){this.vault=vault;this.data={version:1,books:{}};this.raw=null;this.error='';this.queue=Promise.resolve();}
 load(){return IO.load(this,PATH,()=>({version:1,books:{}}),raw=>validate(JSON.parse(raw)),'记账偏好');}
 get(book){return C.clone(this.data.books[book]||[]);}
 save(book,list){const copy=C.clone(list);const job=this.queue.then(async()=>{if(this.error)throw Error(this.error);const draft=C.clone(this.data);draft.books[book]=copy;validate(draft);const raw=await IO.read(this.vault,PATH);if(raw!==this.raw)throw Error('记账偏好已在其他窗口更新，请重新读取本地设置后继续');const text=JSON.stringify(draft);await IO.mkdir(this.vault,ROOT);await IO.write(this.vault,PATH,text,raw);this.data=draft;this.raw=text;});this.queue=job.catch(()=>{});return job;}
}
module.exports={PreferenceStore,PATH,validate};
