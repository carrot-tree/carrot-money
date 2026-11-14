'use strict';
const D=require('./dashboard');
function group(parent,keys,el){
 const plan=D.columns(keys),box=el(parent,'div','cm-home-widgets'+(plan.split?' cm-home-split':''));
 box.dataset.cards=keys.join(' ');box.style.setProperty('--home-rows',String(plan.split?keys.length-1:1));
 return {box,place(card,key){const item=plan.items.find(x=>x.key===key);card.dataset.homeCard=key;card.style.setProperty('--home-row',String(item.row));card.style.setProperty('--home-span',String(item.span));card.style.setProperty('--home-column',String(item.column));}};
}
// The category card contributes no intrinsic row height in a split. Observe
// its allocated body, hide whole rows that cannot fit, and never add scrolling.
function fitCategories(view,card,body,status){
 const rows=Array.from(body.children).filter(x=>x.classList?.contains?.('cm-bar-row')||String(x.cls||'').split(' ').includes('cm-bar-row'));
 const win=body.ownerDocument?.defaultView,Observer=win?.ResizeObserver;
 const fit=()=>{const contained=String(win?.getComputedStyle(card).contain||'').includes('size'),count=D.categoryLimit(body.clientHeight||0,rows.length,!contained||!Observer);rows.forEach((row,i)=>row.hidden=i>=count);for(const child of Array.from(body.children).filter(x=>!rows.includes(x)))child.hidden=!!contained&&!!Observer&&body.clientHeight<100;status.textContent=rows.length?`显示 ${count} 项分类`:'暂无消费记录';};
 fit();if(Observer){const observer=new Observer(fit);observer.observe(body);(view.homeObservers ||= []).push(observer);}
 else card.style.setProperty('contain','none');
}
function dispose(view){for(const observer of view.homeObservers||[])observer.disconnect();view.homeObservers=[];}
module.exports={group,fitCategories,dispose};
