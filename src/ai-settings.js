'use strict';
const Remote=require('./ai-provider'),Presets=require('./ai-presets'),Models=require('./ai-models'),Reasoning=require('./ai-reasoning'),Agent=require('./ai-agent'),{Notice}=require('obsidian');
const numericFields=['batchSize','importConcurrency','timeoutSeconds','agentMaxCalls','agentMaxOutputTokens','agentMaxSeconds','agentMaxTokens'];
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
function fingerprint(value){const normalized=JSON.parse(JSON.stringify(value));for(const key of numericFields)if(normalized[key]!==undefined&&String(normalized[key]).trim()!==''&&Number.isFinite(Number(normalized[key])))normalized[key]=Number(normalized[key]);return JSON.stringify(stable(normalized));}
function render(root,p,{Setting}){
 const draft=Remote.config(p.data.settings),inputs=[],fields={};
 let baseline=fingerprint(Remote.config(p.data.settings)),busy=false,disposed=false,modelChoice,showKey,sourceNote,effortChoice,effortNote,readButton,effortRead,saveButton,testButton,agentButton;
 const checks={};root.classList.add('cm-ai-settings');
 const live=()=>!disposed&&root.isConnected!==false;
 const changed=()=>fingerprint(draft)!==baseline;
 const canRead=()=>Boolean(draft.enabled&&String(draft.baseUrl||'').trim()&&Remote.hasCredentials(draft));
 const snapshot=()=>JSON.parse(JSON.stringify(draft));
 const rememberSaved=()=>{baseline=fingerprint(Remote.config(p.data.settings));};
 const group=(title,description,{collapsed=false}={})=>{const box=root.createEl(collapsed?'details':'section',{cls:'cm-ai-settings-group'});box.createEl(collapsed?'summary':'h4',{text:title});if(description)box.createEl('p',{cls:'cm-ai-settings-help',text:description});return box;};
 root.createEl('h3',{text:'AI 服务设置'});
 const bar=root.createEl('div',{cls:'cm-ai-settings-savebar'}),draftState=bar.createEl('p',{cls:'cm-ai-settings-draft'});
 draftState.setAttribute('role','status');draftState.setAttribute('aria-live','polite');
 const saveRow=new Setting(bar).setName('AI 设置');
 const status=bar.createEl('p',{cls:'cm-ai-settings-result',text:'先配置服务与模型，再保存。检测使用当前输入，不会自动保存，也不读取账本。'});
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const refreshState=()=>{if(!live())return;const dirty=changed();draftState.textContent=busy?'正在处理，请稍候…'+(dirty?' · 当前输入尚未保存':''):dirty?'有未保存的 AI 设置 · 管账和账单识别仍使用已保存配置':'AI 设置已保存 · 与当前输入一致';bar.classList.toggle('is-dirty',dirty);saveButton?.setDisabled(busy||!dirty);};
 const say=(message,notice=false)=>{if(!live())return;status.textContent=message;refreshState();if(notice)new Notice(message+(changed()?' 当前输入尚未保存。':''));};
 const resetChecks=()=>{for(const value of Object.values(checks))value.setDesc('输入已变化，请重新检测。');};
 const stamp=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0'):'';};
 const catalog=()=>Presets.catalogFor(draft.modelCatalog,draft.presetId,draft.baseUrl);
 const source=()=>{const hit=catalog();if(hit)return {models:hit.models,text:'来自服务商：'+hit.models.length+' 个'+(hit.at?'（'+stamp(hit.at)+' 读取）':'')+'；可重新读取，也可直接手填模型名。'};const models=Presets.get(draft.presetId)?.models||[];return {models,text:'内置建议：'+models.length+' 个；填好地址与 Key 后，点「读取模型列表」获取当前服务商清单。'};};
 const syncControls=()=>{if(!live())return;for(const input of inputs)input.setDisabled(busy);testButton?.setDisabled(busy||!canRead());agentButton?.setDisabled(busy||!canRead()||!draft.agentEnabled||typeof Remote.testAgent!=='function');readButton?.setDisabled(busy||!canRead());effortRead?.setDisabled(busy||!canRead());effortChoice?.setDisabled(busy||!Reasoning.support(draft).levels.length);refreshState();};
 const setBusy=value=>{busy=value;syncControls();};
 const fillEfforts=()=>{const cap=Reasoning.support(draft);if(draft.reasoningEffort&&!cap.levels.includes(draft.reasoningEffort))draft.reasoningEffort='';if(effortChoice){effortChoice.selectEl.empty();effortChoice.addOption('',Reasoning.labels['']);for(const level of cap.levels)effortChoice.addOption(level,Reasoning.labels[level]||level);effortChoice.setValue(draft.reasoningEffort||'');}effortNote?.setDesc(cap.source+(cap.levels.length?' · '+cap.levels.map(x=>Reasoning.labels[x]||x).join(' / '):''));};
 const fillModels=()=>{const list=source();if(modelChoice){modelChoice.selectEl.empty();modelChoice.addOption('','手动输入模型名');for(const model of list.models)modelChoice.addOption(model,model);modelChoice.setValue(list.models.includes(draft.model)?draft.model:'');}sourceNote?.setDesc(list.text);fillEfforts();syncControls();};
 const hide=()=>{if(fields.apiKey)fields.apiKey.inputEl.type='password';showKey?.setValue(false);};
 const dirty=()=>{fillEfforts();Presets.remember(draft);resetChecks();destination.textContent=Presets.target(draft.baseUrl).text;fillModels();say('输入已更新。检测成功仅代表当前输入可用，需保存后才会用于管账。');};
 const assertUnchanged=expected=>{if(!live())throw Error('设置页已关闭');if(fingerprint(Remote.config(p.data.settings))!==expected)throw Error('设置已在其他位置更新');};
 const validate=()=>{Agent.config({aiEnhancement:draft});return Remote.validateConfig(draft);};
 const save=async()=>{
  if(busy||!live())return;let next;try{next=validate();assertUnchanged(baseline);}catch(e){say('暂不能保存：'+e.message,true);return;}
  const expected=baseline;setBusy(true);
  try{await p.change(d=>{assertUnchanged(expected);if(fingerprint(Remote.config(d.settings))!==expected)throw Error('设置已更新');d.settings.aiEnhancement=next;},{check:()=>assertUnchanged(expected),saveAIKeys:true});if(!live())return;Object.assign(draft,next);rememberSaved();for(const key of ['baseUrl','model','apiKey'])fields[key].setValue(draft[key]);hide();fillModels();say('AI 设置已保存，管账将使用这份配置。',true);}
  catch{say('保存失败，输入已保留。请检查写入权限；若设置已在其他位置更新，请重新打开设置后核对。',true);}
  finally{setBusy(false);}
 };
 saveRow.addButton(button=>{saveButton=button;button.setButtonText('保存 AI 设置').setCta().onClick(save);});
 const connection=group('1 · 基本连接','选择服务、粘贴 Key，再选择模型。测试与保存是独立操作。');
 new Setting(connection).setName('启用 AI 服务').setDesc('启用后仍由你主动发起 AI 识别或管账。普通导入只使用本地规则。').addToggle(toggle=>{inputs.push(toggle);toggle.setValue(draft.enabled).onChange(value=>{if(busy)return;draft.enabled=value;dirty();});});
 new Setting(connection).setName('服务商 / 接口').setDesc('切回服务商会恢复其设置；自定义用于手动配置。').addDropdown(drop=>{inputs.push(drop);for(const option of Presets.presets)drop.addOption(option.id,option.name);drop.setValue(draft.presetId);drop.selectEl.setAttribute('aria-label','服务商 / 接口');drop.onChange(id=>{if(busy)return;Presets.select(draft,id);for(const key of ['baseUrl','model','apiKey'])fields[key].setValue(draft[key]);hide();dirty();});});
 const text=(parent,key,name,description,{password=false,max}={})=>new Setting(parent).setName(name).setDesc(description).addText(input=>{fields[key]=input;inputs.push(input);input.inputEl.type=password?'password':max?'number':'text';input.inputEl.setAttribute('aria-label',name);if(password){input.inputEl.autocomplete='off';input.inputEl.spellcheck=false;}if(max){input.inputEl.min='1';input.inputEl.max=String(max);input.inputEl.step='1';}input.setValue(String(draft[key]??''));input.onChange(value=>{if(busy)return;if(['apiKey','baseUrl'].includes(key)&&value!==draft[key])delete draft.modelCatalog[draft.presetId];draft[key]=value;dirty();});});
 text(connection,'baseUrl','服务地址','填写服务商提供的兼容接口地址。公网须为 HTTPS，本机和私网可用 HTTP。');
 const destination=connection.createEl('p',{cls:'cm-ai-destination'});destination.setAttribute('aria-live','polite');destination.textContent=Presets.target(draft.baseUrl).text;
 text(connection,'apiKey','API Key','按服务商记在 Obsidian 插件私有数据中。账本文件、快照与完整 JSON 导出均不包含 Key。本机 loopback 服务可留空。',{password:true});
 new Setting(connection).setName('显示 API Key').setDesc('默认隐藏；切换服务商或重新打开设置会隐藏。').addToggle(toggle=>{showKey=toggle;inputs.push(toggle);toggle.setValue(false).onChange(value=>{if(!busy)fields.apiKey.inputEl.type=value?'text':'password';});});
 const candidate=new Setting(connection).setName('候选模型').setDesc('候选列表方便选择；也可直接填写服务商提供的模型名。');
 candidate.addDropdown(drop=>{modelChoice=drop;inputs.push(drop);drop.selectEl.setAttribute('aria-label','候选模型');drop.onChange(value=>{if(!busy&&value){draft.model=value;fields.model.setValue(value);dirty();}});});
 const persistCatalog=async()=>{
  const expected=fingerprint(Remote.config(p.data.settings)),saved=Remote.config(p.data.settings),identity=c=>[c.presetId,c.baseUrl,c.apiKey].join('\n');
  if(identity(saved)!==identity(draft)||expected!==baseline||!live())return false;
  await p.change(d=>{assertUnchanged(expected);const current=Remote.config(d.settings);if(fingerprint(current)!==expected||identity(current)!==identity(draft))throw Error('配置已变化');d.settings.aiEnhancement=Remote.validateConfig({...current,modelCatalog:{...current.modelCatalog,[draft.presetId]:draft.modelCatalog[draft.presetId]}});},{check:()=>assertUnchanged(expected)});
  rememberSaved();return true;
 };
 const readModels=async()=>{
  if(busy||!live())return;if(!canRead()){say('请先启用 AI 服务，并填写地址与 API Key。',true);return;}
  setBusy(true);say('正在读取服务商模型列表…');let result;
  try{result=await Models.readModels({aiEnhancement:snapshot()},{userInitiated:true});if(!live())return result;if(!result.ok){say('读取模型列表失败：'+result.message+'；可继续手填模型名。',true);return result;}
   draft.modelCatalog=Presets.rememberCatalog(draft.modelCatalog,draft.presetId,{baseUrl:draft.baseUrl,models:result.models,reasoning:result.reasoning,at:new Date().toISOString()});fillModels();Presets.remember(draft);let kept=false;try{kept=await persistCatalog();}catch{}
   say('已读取 '+result.models.length+' 个模型'+(kept?'，模型列表已保存。':'，点「保存 AI 设置」后保留此列表。'),true);return result;
  }catch{say('读取模型列表失败，请检查服务地址与网络。输入和已有候选列表已保留。',true);return {ok:false};}
  finally{setBusy(false);}
 };
 candidate.addButton(button=>{readButton=button;inputs.push(button);button.setButtonText('读取模型列表').onClick(readModels);});
 sourceNote=new Setting(connection).setName('候选模型来源');
 text(connection,'model','模型名','以服务商提供的模型 ID 为准。切换模型后建议重新检测。');
 const diagnostics=group('2 · 检查与检测','本地检查不联网。连接检测发送固定问候；Agent 检测使用虚构工具数据。两项网络检测均不发送账单，也不修改账本。');
 checks.local=new Setting(diagnostics).setName('本地配置检查').setDesc('尚未检查；检查地址、必填项和参数范围。');
 checks.local.addButton(button=>{inputs.push(button);button.setButtonText('检查配置（不联网）').onClick(()=>{if(busy)return;try{validate();const missing=[];if(!draft.enabled)missing.push('AI 服务尚未启用');if(!Remote.hasCredentials(draft))missing.push('尚未填写 API Key');const message=missing.length?'参数格式通过；'+missing.join('；')+'。':'本地配置检查通过；地址、Key 与模型的实际可用性还需联网检测。';checks.local.setDesc(message);say(message,true);}catch(e){const message='本地配置检查未通过：'+e.message;checks.local.setDesc(message);say(message,true);}});});
 const runCheck=async kind=>{
  if(busy||!live()||!canRead()||kind==='agent'&&!draft.agentEnabled)return;const fn=kind==='agent'?Remote.testAgent:Remote.testConnection;if(typeof fn!=='function')return;
  const label=kind==='agent'?'Agent 检测':'连接检测';setBusy(true);checks[kind].setDesc('正在检测…');say('正在进行'+label+'…');
  try{const result=await fn({aiEnhancement:snapshot()},{userInitiated:true});if(!live())return;const message=label+(result.ok?'通过：':'未通过：')+(result.message||'服务没有返回说明')+(Number.isFinite(result.elapsedMs)?'（'+(result.elapsedMs/1000).toFixed(1)+' 秒）':'');checks[kind].setDesc(message);say(message,true);}
  catch{const message=label+'失败，请检查服务地址与网络。';if(live())checks[kind].setDesc(message);say(message,true);}
  finally{setBusy(false);}
 };
 checks.connection=new Setting(diagnostics).setName('连接检测').setDesc('尚未检测；确认地址、认证和模型回复。');
 checks.connection.addButton(button=>{testButton=button;inputs.push(button);button.setButtonText('测试连接').onClick(()=>runCheck('connection'));});
 checks.agent=new Setting(diagnostics).setName('Agent 检测').setDesc('尚未检测；确认模型能按管账工具协议执行并结束。');
 checks.agent.addButton(button=>{agentButton=button;inputs.push(button);button.setButtonText('检测 Agent 能力').onClick(()=>runCheck('agent'));});
 const usage=group('3 · Agent 与使用','保存连接配置后，在 AI 管账页面同意发送范围并开启会话。模型提出的修改须预览确认，报告仅写入导出目录。');
 new Setting(usage).setName('启用 AI 管账').setDesc('允许使用 Agent 工具查询和分析。关闭后仍可使用本地功能。').addToggle(toggle=>{inputs.push(toggle);toggle.setValue(draft.agentEnabled).onChange(value=>{if(busy)return;draft.agentEnabled=value;dirty();});});
 const thinking=new Setting(usage).setName('思考强度 / 模式').setDesc('只显示当前模型已声明的选项。默认不额外传参，快速账单识别会单独降低或关闭思考。');
 thinking.addDropdown(drop=>{effortChoice=drop;inputs.push(drop);drop.selectEl.setAttribute('aria-label','思考强度 / 模式');drop.onChange(value=>{if(busy)return;draft.reasoningEffort=value;dirty();});});
 thinking.addButton(button=>{effortRead=button;inputs.push(button);button.setButtonText('读取思考选项').onClick(readModels);});
 effortNote=new Setting(usage).setName('思考选项来源');
 new Setting(usage).setName('账单识别模式').setDesc('快速识别精简输出并在支持时降低思考；疑难账单可选择按模型设置。只影响导入识别。').addDropdown(drop=>{inputs.push(drop);drop.addOption('fast','快速识别').addOption('model','按模型设置').setValue(draft.importSpeed).onChange(value=>{if(busy)return;draft.importSpeed=value;dirty();});});
 new Setting(usage).setName('显示发送字段记录').setDesc('每轮 Agent 完成后显示本次发送给模型的字段类别。').addToggle(toggle=>{inputs.push(toggle);toggle.setValue(draft.agentShowSentFields).onChange(value=>{if(busy)return;draft.agentShowSentFields=value;dirty();});});
 const privacy=usage.createEl('details',{cls:'cm-ai-settings-privacy'});privacy.createEl('summary',{text:'查看发送范围与本地保存说明'});privacy.createEl('p',{text:'AI 识别会发送所选账单的识别字段；Agent 按问题查询账本并发送必要的汇总和逐笔展示字段。按期间归类可能发送整个期间账单的日期、商户、标题、备注、现有分类和金额。Key 保存在 Obsidian 插件私有数据中。搬迁账本后可按服务商重新填写 Key。'});
 const advanced=group('高级参数与 Key 管理','通常保留默认即可。服务限流时可减少识别并发；慢模型可适当增加超时和输出上限。',{collapsed:true});
 text(advanced,'batchSize','每批账单条数','默认 20，范围 1–100。',{max:100});
 text(advanced,'importConcurrency','识别并发批数','默认 2，范围 1–3；限流时建议设为 1。',{max:3});
 text(advanced,'timeoutSeconds','单次请求超时（秒）','默认 60，范围 1–120；慢服务商可设为 90–120。超时后迟到结果不会采用。',{max:120});
 text(advanced,'agentMaxCalls','Agent 最多工具调用次数','默认 24，范围 1–40。',{max:40});
 text(advanced,'agentMaxOutputTokens','Agent 单次输出上限','默认 16384，范围 1–32768。',{max:32768});
 text(advanced,'agentMaxTokens','Agent 每轮累计 token 上限','默认 200000，范围 10000–1000000。包括本轮各次请求的输入和输出。',{max:1000000});fields.agentMaxTokens.inputEl.min='10000';
 text(advanced,'agentMaxSeconds','Agent 总时长上限（秒）','默认 300，范围 1–3600。',{max:3600});
 const clear=async all=>{
  if(busy||!live())return;const expected=baseline,id=all?undefined:draft.presetId;setBusy(true);
  try{
   await p.clearAIKeys(id,{check:()=>assertUnchanged(expected)});
   if(!live())return;
   Presets.clearKeys(draft,id);rememberSaved();fields.apiKey.setValue(draft.apiKey);hide();resetChecks();fillModels();
   say((all?'全部服务商 Key':'当前服务商 Key')+'已从插件私有数据清除。其他输入仍按顶部保存状态处理；已导出到别处的旧副本需单独处理。',true);
  }
  catch{say('清除失败，当前输入已保留。设置可能有外部更新或写入失败，请重新核对。',true);}
  finally{setBusy(false);}
 };
 const removal=new Setting(advanced).setName('清除已保存 Key').setDesc('立即从插件私有数据清除 Key。已导出到别处的旧副本和同步历史需单独处理。');
 for(const [label,all]of [['清除当前 Key',false],['清除全部 Key',true]])removal.addButton(button=>{inputs.push(button);button.setButtonText(label).onClick(()=>clear(all));});
 fillModels();refreshState();
 return {dispose(){disposed=true;hide();}};
}
module.exports={render};
