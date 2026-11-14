'use strict';
const C=require('./core');
const keys=['chart','grain','visible','barGroup','barLevel','barHidden','category','account','person','tag','legendMetric'];
function validate(value,d){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('默认图表筛选无效');
 for(const [book,surfaces]of Object.entries(value)){
  if(!d.books.some(b=>b.id===book)||!surfaces||typeof surfaces!=='object'||Array.isArray(surfaces))throw Error('默认图表筛选账本无效');
  for(const [surface,q]of Object.entries(surfaces)){
   if(!['reports','home'].includes(surface)||!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!keys.includes(k)))throw Error('默认图表筛选字段无效');
   for(const [k,options]of [['chart',['bar','line']],['grain',['auto','day','week','month']],['barGroup',['date','category','account','person','payee','tag']],['barLevel',['leaf','parent']],['legendMetric',['income','expense','net']]])if(q[k]!==undefined&&!options.includes(q[k]))throw Error('默认图表筛选选项无效');
   if(q.visible&&(!Array.isArray(q.visible)||!q.visible.length||new Set(q.visible).size!==q.visible.length||q.visible.some(k=>!['income','expense','net'].includes(k))))throw Error('默认图表指标无效');
   for(const k of ['category','account','person','tag'])if(q[k]!==undefined&&(typeof q[k]!=='string'||q[k].length>500))throw Error('默认图表条件无效');
   if(q.barHidden!==undefined&&(typeof q.barHidden!=='object'||!q.barHidden||Array.isArray(q.barHidden)||Object.entries(q.barHidden).some(([k,ids])=>!['category:leaf','category:parent','account','person','payee','tag'].includes(k)||!Array.isArray(ids)||ids.length>5000||ids.some(id=>typeof id!=='string'||id.length>500)||new Set(ids).size!==ids.length)))throw Error('默认图例显隐无效');
  }
 }
 return value;
}
function pick(state){return C.clone(Object.fromEntries(keys.filter(k=>state[k]!==undefined).map(k=>[k,state[k]])));}
function get(d,book,surface){const state=C.clone(d.settings.chartDefaults?.[book]?.[surface]||{});for(const [key,collection]of [['category','categories'],['account','accounts']])if(state[key]&&!d[collection].some(x=>x.id===state[key]&&!x.archived))state[key]='';return state;}
function save(d,book,surface,state){const value=C.clone(d.settings.chartDefaults||{});value[book]={...value[book],[surface]:pick(state)};validate(value,d);d.settings.chartDefaults=value;}
function init(v,key,surface){const flag='_chartDefaultBook_'+surface;if(v[flag]===v.book)return;const previous=v[flag];v[flag]=v.book;v[key]={...get(v.d,v.book,surface),...(previous?{}:v[key]||{})};}
module.exports={validate,pick,get,save,init};
