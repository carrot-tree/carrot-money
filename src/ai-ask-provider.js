'use strict';
const C=require('./core'),Ask=require('./ai-ask'),Tasks=require('./ai-ask-tasks'),Action=require('./ai-ask-action'),Remote=require('./ai-provider');
const failure=message=>({ok:false,message,facts:[]});
async function answer(question,d,book,settings,{now=C.today()}={}){
 if(typeof question!=='string'||!question.trim()||question.length>500)return failure('请输入完整问题，长度不超过五百字。');
 const task=Tasks.parseLocal(question,d,book,now);
 if(task)return task.intent==='duplicates'?{...Tasks.duplicates(d,book,task),engine:'本地规则'}:{ok:true,intent:'report',month:task.month,book,message:'已识别月度报告，将从本地已入账记录生成。',facts:[],engine:'本地规则'};
 const action=Action.parseLocal(question,d,book,now);
 if(action){try{return {...Action.preview(d,book,action),engine:'本地规则'};}catch(e){return failure(e.message);}}
 const local=Ask.parseLocal(question,d,book,now);
 if(local)return {...Ask.compute(local,d,book),engine:'本地规则'};
 const config=Remote.config(settings);
 return failure(config.enabled?'本地规则未识别。可以换个说法，或打开 AI 管账。':Ask.NEEDS_AI+'，也可以按示例换个说法。');
}
module.exports={answer};
