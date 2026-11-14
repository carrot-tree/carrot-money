'use strict';
const P=require('./ai-presets');
const labels={'':'服务商默认（不额外传参）',none:'关闭思考',disabled:'关闭思考',enabled:'开启思考',default:'开启（默认强度）',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高'};
const formats=['effort','thinking','deepseek','boolean'];
function sanitize(value){
 const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;
 for(const [id,cap]of Object.entries(value).slice(0,500)){
  if(!id||id.length>200||/[\u0000-\u001f\u007f]/.test(id)||!formats.includes(cap?.format))continue;
  const allowed=cap.format==='thinking'?['enabled','disabled']:cap.format==='boolean'?['enabled','disabled']:Object.keys(labels).filter(x=>x&&!['enabled','disabled'].includes(x));
  const levels=[...new Set(Array.isArray(cap.levels)?cap.levels:[])].filter(x=>allowed.includes(x));
  if(levels.length)out[id]={format:cap.format,levels};
 }return out;
}
function parse(payload){
 const list=Array.isArray(payload)?payload:payload?.data||payload?.models||[],caps={};if(!Array.isArray(list))return caps;
 for(const m of list.slice(0,500)){
  const id=m?.id??m?.name??m?.model;if(typeof id!=='string')continue;
  const efforts=m.effort?.supported_levels??m.reasoning_effort?.enum??m.reasoning_effort??m.capabilities?.reasoning_effort??m.parameters?.reasoning_effort?.enum;
  const thinking=m.thinking?.type?.enum??m.parameters?.thinking?.properties?.type?.enum;
  if(Array.isArray(efforts))caps[id]={format:'effort',levels:efforts};
  else if(Array.isArray(thinking))caps[id]={format:'thinking',levels:thinking};
 }
 return sanitize(caps);
}
function support(c){
 const entry=P.catalogFor(c.modelCatalog,c.presetId,c.baseUrl),hit=sanitize(entry?.reasoning)[c.model];
 let host='';try{host=new URL(c.baseUrl).hostname;}catch{}
 const model=String(c.model||'').toLowerCase();
 const deep=host==='api.deepseek.com';
 if(hit)return {...hit,format:deep&&hit.format==='effort'?'deepseek':hit.format,levels:deep&&hit.format==='effort'?['none',...hit.levels.filter(x=>x!=='none')]:hit.levels,source:'服务商模型列表'};
 const info=(format,levels)=>({format,levels,source:'内置官方说明（2026-09-30）'});
 if(['api.xiaomimimo.com','token-plan-cn.xiaomimimo.com'].includes(host)&&/^mimo-v2\.(?:6-(?:flash|pro|pro-ultraspeed)|5(?:-pro)?)$/.test(model))return info('thinking',['enabled','disabled']);
 if(host==='api.deepseek.com'&&/^(deepseek-flash|deepseek-v4(?:\.1)?-(?:flash|pro))$/.test(model))return info('deepseek',['none','low','high','max']);
 if(host==='generativelanguage.googleapis.com'&&/^gemini-3\.(?:8|7)-flash$/.test(model))return info('effort',['low','medium','high']);
 if(host==='generativelanguage.googleapis.com'&&/^gemini-3-pro-preview$/.test(model))return info('effort',['low','high']);
 if(host==='generativelanguage.googleapis.com'&&/^gemini-(?:3\.1-pro-preview|3\.1-flash-lite|3-flash-preview|2\.5-(?:pro|flash|flash-lite))$/.test(model)){
  const levels=['minimal','low','medium','high'];if(/^gemini-2\.5-flash/.test(model))levels.unshift('none');return info('effort',levels);
 }
 if(host==='api.groq.com'){
  if(/^openai\/gpt-oss-(?:20b|120b)$/.test(model))return info('effort',['low','medium','high']);
  if(model==='qwen/qwen3.8-27b')return info('effort',['none','default','low','medium','high']);
 }
 if(host==='api.minimax.io'&&model==='minimax-m3.1-flash-preview')return info('effort',['low','medium','high','xhigh','max']);
 return {format:'',levels:[],source:'服务商尚未声明此模型的思考选项；保留默认，不猜测支持的档位'};
}
function validate(c){const effort=c.reasoningEffort||'';if(effort&&!support(c).levels.includes(effort))throw Error('当前模型未声明该思考选项，请读取思考选项或选择服务商默认');return c;}
function body(c,value){
 const out={...value},effort=c.reasoningEffort||'',cap=support(c);validate(c);
 if(effort){if(cap.format==='thinking')out.thinking={type:effort};else if(cap.format==='boolean')out.enable_thinking=effort==='enabled';else if(cap.format==='deepseek'){out.thinking={type:effort==='none'?'disabled':'enabled'};if(effort!=='none')out.reasoning_effort=effort;}else out.reasoning_effort=effort;}
 // MiMo's compatible API uses the completion budget for thinking + final text.
 let host='';try{host=new URL(c.baseUrl).hostname;}catch{}
 if(['api.xiaomimimo.com','token-plan-cn.xiaomimimo.com','api.minimax.io'].includes(host)&&out.max_tokens!==undefined){out.max_completion_tokens=out.max_tokens;delete out.max_tokens;}
 if(effort&&effort!=='none'&&effort!=='disabled'){delete out.temperature;delete out.top_p;}
 return out;
}
module.exports={labels,sanitize,parse,support,validate,body};
