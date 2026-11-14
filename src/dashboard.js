'use strict';
const C=require('./core'),A=require('./analytics');
const cardNames={summary:'收支总览',trend:'收支趋势',budget:'预算余量',categories:'消费分布',subscriptions:'订阅扣费',goals:'心愿存钱罐',recent:'最近流水'};
function cards(d){const list=[...new Set(d.settings.cards.filter(k=>Object.hasOwn(cardNames,k)))];for(const k of ['subscriptions','goals'])if(!list.includes(k)){const i=list.indexOf('recent');list.splice(i<0?list.length:i,0,k);}return list;}
// Full-width cards remain order barriers. Categories occupy the right column
// of each contiguous widget run; the source order is retained for narrow screens.
function layout(d){const groups=[];for(const key of cards(d).filter(k=>!d.settings.hiddenCards.includes(k))){if(['summary','trend','recent'].includes(key))groups.push({kind:'wide',keys:[key]});else{const last=groups.at(-1);if(last?.kind==='widgets')last.keys.push(key);else groups.push({kind:'widgets',keys:[key]});}}return groups;}
function columns(keys,narrow=false){const left=keys.filter(k=>k!=='categories'),split=!narrow&&keys.includes('categories')&&left.length>0;return {split,items:keys.map(key=>({key,column:split&&key==='categories'?2:1,row:split?(key==='categories'?1:left.indexOf(key)+1):keys.indexOf(key)+1,span:split&&key==='categories'?left.length:1}))};}
function categoryLimit(height,total,natural=false){return Math.max(0,Math.min(total,16,natural?16:Math.floor(Math.max(0,height)/44)));}
function trendRange(mode,month){const r=A.period(mode==='last6'?'last12':mode,month);if(mode==='last6'){r.start=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-6,1,12)).toISOString().slice(0,10);r.days=A.days(r.start,r.end);}return r;}
function subscriptions(d,book){return d.rules.filter(r=>r.subscription&&r.enabled&&!r.total&&r.entry.kind==='expense'&&r.entry.book===book&&(r.remaining==null||r.remaining>0)).sort((a,b)=>a.next.localeCompare(b.next));}
function goalProgress(g){const saved=g.opening+g.contributions.reduce((n,x)=>n+x.amount,0);return {saved,left:Math.max(0,g.target-saved),ratio:g.target?saved/g.target:0,complete:g.target>0&&saved>=g.target};}
module.exports={cardNames,cards,layout,columns,categoryLimit,trendRange,subscriptions,goalProgress};
