'use strict';
// User-supplied endpoints and suggested model IDs. This is the only preset
// catalogue; suggestions are editable and do not imply live availability.
const presets=Object.freeze([
 {id:'opencode-go',name:'OpenCode Go',baseUrl:'https://opencode.ai/zen/go/v1',models:['deepseek-v4.1-flash','glm-5.3-flash','kimi-k3','minimax-m3']},
 {id:'opencode-zen',name:'OpenCode Zen',baseUrl:'https://opencode.ai/zen/v1',models:['deepseek-v4.1-flash','glm-5.3','kimi-k3','qwen3.8-max']},
 {id:'deepseek',name:'DeepSeek 官方',baseUrl:'https://api.deepseek.com/v1',models:['deepseek-chat','deepseek-reasoner']},
 {id:'kimi',name:'月之暗面 Kimi',baseUrl:'https://api.moonshot.cn/v1',models:['kimi-k2.7-code']},
 {id:'glm',name:'智谱 GLM',baseUrl:'https://open.bigmodel.cn/api/paas/v4',models:['glm-4.6']},
 {id:'bailian',name:'阿里百炼（通义）',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',models:['qwen-plus']},
 {id:'siliconflow',name:'硅基流动',baseUrl:'https://api.siliconflow.cn/v1',models:[]},
 {id:'openrouter',name:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1',models:[]},
 {id:'openai',name:'OpenAI 官方',baseUrl:'https://api.openai.com/v1',models:[]},
 {id:'mimo',name:'小米 MiMo',baseUrl:'https://api.xiaomimimo.com/v1',models:['mimo-v2.6-pro','mimo-v2.6-flash','mimo-v2.5-pro']},
 {id:'mimo-token',name:'小米 MiMo Token Plan',baseUrl:'https://token-plan-cn.xiaomimimo.com/v1',models:['mimo-v2.6-pro','mimo-v2.6-flash']},
 {id:'gemini',name:'Google Gemini（兼容接口）',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',models:['gemini-3.8-flash','gemini-3.1-pro-preview']},
 {id:'minimax',name:'MiniMax',baseUrl:'https://api.minimax.io/v1',models:['MiniMax-M3','MiniMax-M2.7'],example:'以服务商模型列表为准'},
 {id:'volcengine',name:'火山方舟（豆包）',baseUrl:'https://ark.cn-beijing.volces.com/api/v3',models:[],example:'模型 ID 或 ep- 接入点 ID'},
 {id:'hunyuan',name:'腾讯混元',baseUrl:'https://api.hunyuan.cloud.tencent.com/v1',models:['hunyuan-turbos-latest']},
 {id:'groq',name:'Groq',baseUrl:'https://api.groq.com/openai/v1',models:['openai/gpt-oss-120b','openai/gpt-oss-20b']},
 {id:'ollama',name:'本地 Ollama',baseUrl:'http://localhost:11434/v1',models:[],example:'qwen3'},
 {id:'custom',name:'自定义',baseUrl:'',models:[]}
].map(p=>Object.freeze({...p,models:Object.freeze(p.models)})));
const DEFAULT=presets[0],get=id=>presets.find(p=>p.id===id);
const fields=['baseUrl','model','apiKey','reasoningEffort'];
const profile=x=>Object.fromEntries(fields.filter(k=>typeof x?.[k]==='string').map(k=>[k,x[k]]));
function infer(baseUrl){if(baseUrl===undefined)return DEFAULT.id;const url=String(baseUrl).trim().replace(/\/+$/,'').replace(/\/chat\/completions$/,'');return presets.find(p=>p.id!=='custom'&&p.baseUrl===url)?.id||'custom';}
function restore(value={}){
 const presetId=get(value.presetId)?.id||infer(value.baseUrl),preset=get(presetId),profiles={};
 for(const p of presets)if(value.profiles&&Object.hasOwn(value.profiles,p.id))profiles[p.id]=profile(value.profiles[p.id]);
 const active={baseUrl:preset.baseUrl,model:preset.models[0]||'',apiKey:'',reasoningEffort:'',...profiles[presetId],...profile(value)};
 profiles[presetId]={...active};return {presetId,...active,profiles,modelCatalog:sanitizeCatalog(value.modelCatalog)};
}
function remember(draft){draft.profiles||={};draft.profiles[draft.presetId]=profile(draft);}
function select(draft,id){
 const p=get(id);if(!p)throw Error('服务商预设不存在');if(id===draft.presetId)return;
 remember(draft);
 const custom=p.id==='custom',saved=draft.profiles[id];
 const next=saved||{baseUrl:custom?draft.baseUrl:p.baseUrl,model:custom?draft.model:p.models[0]||'',apiKey:''};
 // Restore a saved custom connection as one unit; never pair its Key with another provider's URL.
 const active=next;
 Object.assign(draft,{presetId:id,baseUrl:active.baseUrl??p.baseUrl,model:active.model??p.models[0]??'',apiKey:active.apiKey||'',reasoningEffort:active.reasoningEffort||''});remember(draft);
}
function clearKeys(draft,id){
 remember(draft);for(const [key,p]of Object.entries(draft.profiles))if(!id||key===id)p.apiKey='';
 if(!id||draft.presetId===id)draft.apiKey='';
}
function localHost(host){
 const h=host.toLowerCase().replace(/^\[|\]$/g,'');if(h==='localhost'||h==='::1')return 'loopback';
 const parts=h.split('.');if(parts.length===4&&parts.every(x=>/^\d+$/.test(x)&&Number(x)<=255)){
  const [a,b]=parts.map(Number);if(a===127)return 'loopback';if(a===10||a===192&&b===168||a===172&&b>=16&&b<=31||a===169&&b===254)return 'lan';
 }
 if(/^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(h))return 'lan';return '';
}
function target(baseUrl){
 try{const u=new URL(String(baseUrl).trim());if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error();const scope=localHost(u.hostname);return {host:u.host,scope,text:'请求会发送到该地址：'+u.host+(scope?' · '+(scope==='loopback'?'本机':'局域网')+'直连目标，请求不会离开本机网络；目标服务的转发 / 重定向另计。':' · 外部服务')};}
 catch{return {host:'',scope:'',text:'请求地址无效，请填写完整 Base URL（不含账号、密码、查询参数或片段）'};}
}
const CATALOG_LIMIT=500;
// Model lists read from a provider are cached per provider id together with the
// Base URL they came from; a changed URL invalidates the cache instead of
// showing a stale catalogue.
function sanitizeCatalog(value){
 const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;
 for(const [id,entry]of Object.entries(value)){
  if(typeof id!=='string'||!id||id.length>64||!entry||typeof entry!=='object'||Array.isArray(entry))continue;
  const models=Array.isArray(entry.models)?entry.models.filter(m=>typeof m==='string'&&m.trim()&&m.length<=200&&!/[\u0000-\u001f\u007f]/.test(m)).slice(0,CATALOG_LIMIT):[];
  if(!models.length)continue;
  out[id]={...(entry.reasoning?{reasoning:require('./ai-reasoning').sanitize(entry.reasoning)}:{}),baseUrl:typeof entry.baseUrl==='string'?entry.baseUrl.slice(0,300):'',models,at:typeof entry.at==='string'?entry.at.slice(0,40):''};
 }
 return out;
}
const catalogUrl=value=>String(value||'').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
function catalogFor(catalog,presetId,baseUrl){
 const entry=sanitizeCatalog(catalog)[presetId];
 if(!entry||!entry.models.length)return null;
 return catalogUrl(entry.baseUrl)===catalogUrl(baseUrl)?entry:null;
}
function rememberCatalog(catalog,presetId,{baseUrl,models,at,reasoning}={}){
 const list=Array.isArray(models)?models:[].concat(models??[]);
 return {...sanitizeCatalog(catalog),[presetId]:{...(reasoning?{reasoning:require('./ai-reasoning').sanitize(reasoning)}:{}),baseUrl:String(baseUrl||'').trim(),models:list,at:String(at||'')}};
}
function isGo(url){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='opencode.ai'&&/^\/(?:zen|inference)\/go(?:\/|$)/.test(u.pathname);}catch{return false;}}
const sessionId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value)?value:require('./core').uid();
function goHeaders(url,id){return isGo(url)?{'User-Agent':'carrot-money/0.54.1','x-opencode-session':sessionId(id)}:{};}
function headers(c,{sessionId}={}){let host='';try{host=new URL(c.baseUrl).hostname;}catch{}return {...(['api.xiaomimimo.com','token-plan-cn.xiaomimimo.com'].includes(host)?{'api-key':c.apiKey}:{Authorization:'Bearer '+c.apiKey}),...goHeaders(c.baseUrl,sessionId)};}
module.exports={headers,isGo,sessionId,goHeaders,presets,DEFAULT,get,infer,restore,remember,select,clearKeys,localHost,target,sanitizeCatalog,catalogFor,rememberCatalog,catalogUrl};
