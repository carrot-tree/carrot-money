'use strict';
const R=require('./ai-provider'),Presets=require('./ai-presets'),Reasoning=require('./ai-reasoning');
// Reading the provider's model list is a read-only GET on the same Base URL as
// chat_completions. It only runs after an explicit user action (clicking
// 「读取模型列表」, saving the AI settings, or a successful connection test):
// nothing here fires implicitly, so an unconfigured plugin still makes zero
// network calls.
const MAX_MODELS=500,MAX_ID=200;
function modelsEndpoint(baseUrl){
 let url;try{url=new URL(String(baseUrl).trim());}catch{throw Error('服务地址无效，请填写 HTTPS Base URL');}
 const base=url.href.replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
 return base+'/models';
}
function pickId(item){
 if(typeof item==='string')return item;
 if(!item||typeof item!=='object'||Array.isArray(item))return '';
 const value=item.id??item.name??item.model;
 return typeof value==='string'?value:'';
}
function parseModels(payload){
 const list=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.models)?payload.models:null;
 if(!list)throw Error('服务返回的响应不是模型列表格式');
 const ids=[];
 for(const item of list){
  const id=pickId(item).trim();
  if(!id||id.length>MAX_ID||/[\u0000-\u001f\u007f]/.test(id)||ids.includes(id))continue;
  ids.push(id);
  if(ids.length>=MAX_MODELS)break;
 }
 if(!ids.length)throw Error('服务返回的模型列表为空');
 return ids.sort((a,b)=>a.localeCompare(b,'en'));
}
async function readModels(settings,{requestUrl,userInitiated=false}={}){
 const current=R.config(settings);
 // GET /models does not require a selected model. A provider with no built-in
 // suggestions must be discoverable before its first model can be selected.
 settings={...settings,aiEnhancement:{...current,model:current.model||'model-catalog-read',reasoningEffort:''}};
 const blocked=R.unavailable(settings,userInitiated);if(blocked)return {ok:false,models:[],message:blocked};
 let c;try{c=R.validateConfig(R.config(settings));}catch(e){return {ok:false,models:[],message:e.message};}
 let url;try{url=modelsEndpoint(c.baseUrl);}catch(e){return {ok:false,models:[],message:e.message};}
 let timer;
 try{
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new R.ProviderError(`读取模型列表超时（${c.timeoutSeconds} 秒）`)),c.timeoutSeconds*1000);});
  const pending=Promise.resolve().then(()=>{
   const request=requestUrl||require('obsidian').requestUrl;
   return request({url,method:'GET',headers:Presets.headers(c),throw:false});
  });
  pending.catch(()=>{});
  const response=await Promise.race([pending,timeout]);
  if(!Number.isInteger(response?.status))throw new R.ProviderError('服务未返回有效 HTTP 状态');
  if(response.status<200||response.status>=300)throw R.responseError(response);
  let payload;try{payload=response.json??JSON.parse(response.text);}catch{throw new R.ProviderError('服务返回的响应不是有效 JSON');}
  let models;try{models=parseModels(payload);}catch(e){throw new R.ProviderError(e.message);}
  return {ok:true,models,reasoning:Reasoning.parse(payload),message:'已从服务商读取 '+models.length+' 个模型'};
 }catch(e){return {ok:false,models:[],message:R.transportReason(e)};}
 finally{clearTimeout(timer);}
}
// Cached list for the provider that is currently configured; null when the user
// changed the address since the last read, so a stale list is never shown.
function cachedModels(settings){
 const c=R.config(settings);
 return Presets.catalogFor(c.modelCatalog,c.presetId,c.baseUrl);
}
module.exports={modelsEndpoint,pickId,parseModels,readModels,cachedModels,MAX_MODELS};
