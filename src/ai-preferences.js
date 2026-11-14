'use strict';
const C=require('./core');
const ROOT='Carrot记账',PATH=ROOT+'/AI记账偏好.json';
function validate(value){if(!value||value.version!==1||!value.books||typeof value.books!=='object'||Array.isArray(value.books))throw Error('记账偏好文件格式无效');for(const list of Object.values(value.books)){if(!Array.isArray(list)||list.length>100||new Set(list.map(x=>x?.id)).size!==list.length||list.some(x=>!x||typeof x.id!=='string'||!x.id||typeof x.text!=='string'||!x.text.trim()||x.text.length>500||typeof x.enabled!=='boolean'))throw Error('记账偏好内容无效');}return value;}
class PreferenceStore{
 constructor(vault){this.vault=vault;this.data={version:1,books:{}};this.raw=null;this.error='';this.queue=Promise.resolve();}
 async load(){try{if(await this.vault.adapter.exists(PATH)){this.raw=await this.vault.adapter.read(PATH);this.data=validate(JSON.parse(this.raw));}this.error='';}catch(e){this.error='读取记账偏好失败：'+e.message;}return this.data;}
 get(book){return C.clone(this.data.books[book]||[]);}
 save(book,list){const copy=C.clone(list);const job=this.queue.then(async()=>{if(this.error)throw Error(this.error);const draft=C.clone(this.data);draft.books[book]=copy;validate(draft);const exists=await this.vault.adapter.exists(PATH),raw=exists?await this.vault.adapter.read(PATH):null;if(raw!==this.raw)throw Error('记账偏好已在其他窗口更新，请重开插件后继续');const text=JSON.stringify(draft);if(!await this.vault.adapter.exists(ROOT))await this.vault.createFolder(ROOT);if(exists)await this.vault.process(this.vault.getAbstractFileByPath(PATH),current=>{if(current!==raw)throw Error('记账偏好保存时出现外部更新');return text;});else await this.vault.create(PATH,text);this.data=draft;this.raw=text;});this.queue=job.catch(()=>{});return job;}
}
module.exports={PreferenceStore,PATH,validate};
