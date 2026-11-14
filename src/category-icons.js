'use strict';
const C=require('./core');
// Exact names take precedence; a name contained within a longer match is ignored.
// Independent matches with different icons are ambiguous and need manual review.
const icons=Object.freeze({正餐:'🍚',喝滴:'🧋',夜宵:'🌙',零食:'🍪',水果:'🍎',日用滴:'🧴',交通:'🚇',住:'🏠',医疗:'💊',运动:'🏃',宠物:'🐱',旅游:'✈️',摄影:'📷',汽车:'🚗',电子产品:'💻',虚拟产品:'🎮',软件:'📦',快递:'📮',金融:'💰',社交:'💬',娱乐:'🎬',知识:'📚',学习:'📖',礼品:'🎁',饰品:'💍',影视:'🍿',生活乐趣:'✨',音乐:'🎵',卖二手:'💱',找猫:'🐈',友情支持:'🤝',穿滴:'👕',丑丑子:'🧚',树树子:'🌲',其他:'🧾'});
const normalize=name=>String(name||'').normalize('NFKC').replace(/\s+/g,'').trim();
const aliases=Object.freeze({喝:'🧋',饮品:'🧋',住房:'🏠'});
function match(name){const key=normalize(name);if(Object.hasOwn(icons,key))return {icon:icons[key],reason:'名称匹配：'+key};const candidates={...Object.fromEntries(Object.entries(icons).filter(([x])=>x.length>1)),...aliases},hits=Object.keys(candidates).filter(x=>key.includes(x)).sort((a,b)=>b.length-a.length),best=hits.filter(x=>!hits.some(y=>y!==x&&y.includes(x)));if(new Set(best.map(x=>candidates[x])).size===1)return {icon:candidates[best[0]],reason:'名称包含：'+best.join(' / ')};return {icon:'',reason:best.length?'名称有多个图标候选，请手动设置':'未匹配名称，请手动设置'};}
function missing(icon){return icon==null||String(icon).trim()===''||String(icon).trim()==='🧾';}
function display(c){return c&&!missing(c.icon)?c.icon:match(c?.name).icon||c?.icon||'🧾';}
function label(d,id){return display(d.categories.find(c=>c.id===id))+' '+C.categoryName(d,id);}
module.exports={icons,match,missing,display,label};
