'use strict';
const Icons=require('./category-icons');
const PAGE_SIZE=12,normalize=x=>String(x||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();let sequence=0;
function options(d,categories=d.categories,empty='未分类'){
 const counts=new Map(),recent=new Map();for(const t of d.entries){counts.set(t.category,(counts.get(t.category)||0)+1);if((t.date||'')>(recent.get(t.category)||''))recent.set(t.category,t.date);}
 return [['',empty],...categories.map((c,index)=>({c,index})).sort((a,b)=>(counts.get(b.c.id)||0)-(counts.get(a.c.id)||0)||(recent.get(b.c.id)||'').localeCompare(recent.get(a.c.id)||'')||a.index-b.index).map(({c})=>[c.id,Icons.label(d,c.id)])];
}
function search(items,query){const q=normalize(query);return items.filter(x=>normalize(x[1]).includes(q));}
function create(parent,name,value,choices){
 // Keep sentinel choices first without changing the caller's ranking or array.
 choices=[...choices.filter(x=>x[0]===''),...choices.filter(x=>x[0]!=='')];
 const el=(p,tag,cls='',text='')=>p.createEl(tag,{cls,text}),box=el(parent,'div','cm-category-picker'),field=el(box,'input','cm-category-value');field.type='hidden';
 const trigger=el(box,'button','cm-category-trigger');trigger.type='button';trigger.setAttribute('aria-label',name);trigger.setAttribute('aria-haspopup','dialog');
 const popup=el(box,'div','cm-category-popup');popup.hidden=true;popup.id='cm-category-popup-'+(++sequence);popup.setAttribute('role','dialog');popup.setAttribute('aria-label','选择'+name);trigger.setAttribute('aria-controls',popup.id);
 const input=el(popup,'input','cm-category-search');input.type='search';input.placeholder='搜索分类名称';input.setAttribute('aria-label','搜索'+name);input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.autocomplete='off';
 const current=el(popup,'button','cm-category-current');current.type='button';current.hidden=true;
 const list=el(popup,'div','cm-category-options');list.id='cm-category-list-'+sequence;list.setAttribute('role','listbox');list.setAttribute('aria-label',name+'选项');input.setAttribute('aria-controls',list.id);
 const footer=el(popup,'div','cm-category-pages'),status=el(footer,'span');status.setAttribute('role','status');
 const button=(text,action)=>{const b=el(footer,'button','',text);b.type='button';b.addEventListener('click',action);return b;};
 let selected=String(value||''),disabled=false,opened=false,active=0,items=choices.slice(),composing=false;
 const doc=box.ownerDocument,close=focus=>{opened=false;popup.hidden=true;trigger.setAttribute('aria-expanded','false');input.setAttribute('aria-expanded','false');input.removeAttribute?.('aria-activedescendant');doc?.removeEventListener('pointerdown',outside,true);if(focus)trigger.focus({preventScroll:true});};
 const outside=e=>{if(!box.contains(e.target))close(false);};
 const caption=()=>{const label=choices.find(x=>x[0]===selected)?.[1]||'请选择分类';trigger.textContent=label+' ⌄';trigger.setAttribute('aria-label',name+'：'+label);};
 const choose=id=>{if(disabled||!choices.some(x=>x[0]===id))return;field.value=id;close(true);const E=doc?.defaultView?.Event||globalThis.Event;if(E)field.dispatchEvent?.(new E('change',{bubbles:true}));};
 current.addEventListener('click',()=>choose(selected));
 const render=()=>{list.empty();const page=Math.floor(active/PAGE_SIZE),start=page*PAGE_SIZE,currentIndex=choices.findIndex(x=>x[0]===selected);current.hidden=!!normalize(input.value)||page!==0||currentIndex<PAGE_SIZE;current.textContent=current.hidden?'':'当前：'+choices[currentIndex][1];for(const [offset,item]of items.slice(start,start+PAGE_SIZE).entries()){const index=start+offset,b=el(list,'button','cm-category-option',item[1]);b.type='button';b.tabIndex=-1;b.id=list.id+'-'+index;b.setAttribute('role','option');b.setAttribute('aria-selected',String(item[0]===selected));b.classList.toggle('active',index===active);b.dataset.value=item[0];b.addEventListener('click',()=>choose(item[0]));if(index===active)input.setAttribute('aria-activedescendant',b.id);}
  if(!items.length){el(list,'p','cm-muted','没有匹配分类');input.removeAttribute?.('aria-activedescendant');}status.textContent=`${items.length} 项 · ${page+1} / ${Math.max(1,Math.ceil(items.length/PAGE_SIZE))} 页`;prev.disabled=page===0;next.disabled=start+PAGE_SIZE>=items.length;
 };
 const prev=button('上一页',()=>{active=Math.max(0,active-PAGE_SIZE);render();input.focus();}),next=button('下一页',()=>{active=Math.min(items.length-1,(Math.floor(active/PAGE_SIZE)+1)*PAGE_SIZE);render();input.focus();});
 const open=()=>{if(disabled)return;opened=true;input.value='';items=choices.slice();const currentIndex=items.findIndex(x=>x[0]===selected);active=currentIndex>=0&&currentIndex<PAGE_SIZE?currentIndex:0;popup.hidden=false;trigger.setAttribute('aria-expanded','true');input.setAttribute('aria-expanded','true');doc?.addEventListener('pointerdown',outside,true);render();input.focus({preventScroll:true});};
 trigger.addEventListener('click',()=>opened?close(true):open());trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}});
 input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;items=search(choices,input.value);active=0;render();});
 input.addEventListener('input',()=>{if(!composing){items=search(choices,input.value);active=0;render();}});
 box.addEventListener('keydown',e=>{if(!opened||composing||e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.target===input&&['ArrowDown','ArrowUp','Enter'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='Enter'){if(items[active])choose(items[active][0]);}else{active=Math.max(0,Math.min(items.length-1,active+(e.key==='ArrowDown'?1:-1)));render();}}});
 box.addEventListener('focusout',e=>{if(opened&&!box.contains(e.relatedTarget))close(false);});
 Object.defineProperties(field,{value:{get:()=>selected,set:x=>{selected=String(x??'');caption();}},disabled:{get:()=>disabled,set:x=>{disabled=!!x;trigger.disabled=input.disabled=disabled;if(disabled)close(false);}}});
 field.setChoices=next=>{close(false);choices=[...next.filter(x=>x[0]===''),...next.filter(x=>x[0]!=='')];if(!choices.some(x=>x[0]===selected))selected='';items=choices.slice();active=0;caption();};
 field.focus=()=>trigger.focus();field.choose=choose;field.picker={box,trigger,input,list,popup,current,open,close,dispose:()=>close(false),get opened(){return opened;}};box.categoryPicker=field.picker;
 close(false);caption();return field;
}
function dispose(root){for(const box of root.querySelectorAll('.cm-category-picker'))box.categoryPicker?.dispose();}
function closeOpen(root){for(const box of root.querySelectorAll('.cm-category-picker'))if(box.categoryPicker?.opened){box.categoryPicker.close(true);return true;}return false;}
function emojiChoices(input,parent){const row=parent.createEl('div',{cls:'cm-emoji-choices'});row.setAttribute('role','group');row.setAttribute('aria-label','常用分类图标');for(const emoji of new Set(Object.values(Icons.icons))){const b=row.createEl('button',{text:emoji});b.type='button';b.setAttribute('aria-label','使用图标 '+emoji);b.addEventListener('click',()=>{input.value=emoji;input.focus();});}return row;}
module.exports={PAGE_SIZE,options,search,create,dispose,closeOpen,emojiChoices};
