'use strict';
const C=require('./core'),Ask=require('./ai-ask');
// Only explicit field rules and a single literal description qualify. Semantic
// requests such as “和买菜相关的” continue to use complete-period AI review.
const quotePairs={'“':'”','「':'」','『':'』','【':'】','"':'"',"'":"'",'‘':'’'};
function quoted(text){
 if(/[\uE000\uE001]/.test(text))return null;
 const values=[];let masked='';
 for(let i=0;i<text.length;i++){
  const end=quotePairs[text[i]];
  if(end){const at=text.indexOf(end,i+1);if(at<0)return null;values.push(text.slice(i+1,at));masked+='\uE000'+(values.length-1)+'\uE001';i=at;}
  else{if(/[”」』】’]/.test(text[i]))return null;masked+=text[i];}
 }
 return {text:masked,value(raw){const token=raw.trim().match(/^\uE000(\d+)\uE001$/);if(token)return {text:values[Number(token[1])],quoted:true};if(/[\uE000\uE001]/.test(raw))return null;return {text:raw.trim(),quoted:false};}};
}
// Consume grammar only before the field/keyword. Dates and words such as
// “当前账本” inside a quoted or explicit keyword are never rewritten.
function prefix(raw,now,{scope=false,partial=false}={}){
 let rest=raw.trim(),parsed=null,action=false,bookScope=false;
 while(rest){
  const polite=!action&&!parsed&&!bookScope&&rest.match(/^(?:请帮我|帮我|请)\s*/);if(polite){rest=rest.slice(polite[0].length);continue;}
  const verb=rest.match(/^(?:把|将)\s*/);if(verb){if(action)return null;action=true;rest=rest.slice(verb[0].length);continue;}
  const book=scope&&rest.match(/^(?:当前账本|这个账本|本账本)(?:中|里|内)?(?:的)?\s*/);if(book){if(bookScope)return null;bookScope=true;rest=rest.slice(book[0].length);continue;}
  const date=rest.match(/^(?:\d{4}\s*(?:年|[-/])\s*\d{1,2}\s*月?|本月|这个月|当月|上个月|上月|\d{1,2}\s*月)(?:的)?\s*/);
  if(date){if(parsed)return null;parsed=Ask.parseMonth(date[0],now);if(!parsed)return null;rest=rest.slice(date[0].length);continue;}
  if(partial)break;return null;
 }
 return {rest,parsed,action};
}
function resolve(question,d,book,now=C.today()){
 const source=String(question).trim();if(!source||source.length>1000)return null;
 const tokens=quoted(source);if(!tokens)return null;
 let text=tokens.text.replace(/[。！!？?]\s*$/,'').trim();
 // Only this separate presentation request is optional; other trailing actions
 // remain unparsed so a compound instruction cannot become a partial operation.
 text=text.replace(/[。；;，,\n]\s*(?:请)?(?:生成|提供|列出)(?:全部匹配记录的)?逐笔预览\s*$/,'').trim();
 const command=text.match(/^(.+?)\s*的支出\s*(?:的)?\s*[，,]?\s*(?:分类|类别)\s*(?:改为|改成|换成)\s*(.+)$/);if(!command)return null;
 const selector=command[1],explicit=selector.match(/^(.*?)(名称|标题|商户|交易对方|备注)\s*包含\s*(.+)$/);
 const head=explicit?prefix(explicit[1],now,{scope:true}):prefix(selector,now,{partial:true});
 if(!head||!explicit&&!head.action)return null;
 const term=tokens.value(explicit?explicit[3]:head.rest),category=tokens.value(command[2]);if(!term||!category)return null;
 const keyword=term.text,target=category.text;
 if(!keyword?.trim()||!target?.trim())return null;
 const ambiguous=/相关|有关|用途|用于|以及|或者|还是|所有|全部|不包含|不含|并且|同时|然后|再把|再将|且|但|排除|除了|和|或|与|[、，,;；。\n]|(?:名称|标题|商户|交易对方|备注)\s*包含/;
 if(!term.quoted&&ambiguous.test(keyword)||!category.quoted&&/请|然后|再把|再将|并且|同时|以及|或者|和|或|与|[、，,。；;\n]|改为|改成|换成/.test(target))return null;
 if(!explicit&&!term.quoted&&/当前账本|这个账本|本账本|名称|标题|商户|交易对方|备注|包含|\d{4}[年/-]|\d{1,2}月/.test(keyword))return null;
 const parsed=head.parsed,field=explicit?explicit[2]:'名称或商户',fields=field==='备注'?['note']:['商户','交易对方'].includes(field)?['payee']:field==='名称或商户'?['title','payee']:['title'];
 const entries=d.entries.filter(t=>t.book===book&&C.validDate(t.date));
 const dates=entries.map(t=>t.date).sort(),range=parsed?{start:parsed.range.start,end:parsed.range.end}:{start:dates[0]||now,end:dates.at(-1)||now};
 const rows=entries.filter(t=>t.date>=range.start&&t.date<=range.end&&(t.kind==='expense'||t.kind==='legacy'&&t.legacyExpense>0&&!(t.legacyIncome>0))&&fields.some(f=>String(t[f]||'').includes(keyword)));
 const cats=d.categories.filter(c=>!c.archived&&c.type==='expense'&&(c.name===target||C.categoryName(d,c.id)===target));
 return {explicit:!!explicit,keyword,target,field,fields,range,rows,to:cats.length===1?cats[0].id:null,error:cats.length===1?'':cats.length>1?'目标分类名称不唯一，请指定完整分类名称。':'找不到可用的支出分类“'+target+'”，请先新建或选择已有分类。'};
}
function candidates(job,d){return {summary:'本轮读取：'+job.field+'包含“'+job.keyword+'”的支出，共 '+job.rows.length+' 笔；交给 AI 核对并提出建议。',data:{start:job.range.start,end:job.range.end,to:job.to,condition:{field:job.field,keyword:job.keyword,target:job.target,exact:job.explicit},error:job.error||undefined,rows:job.rows.map(t=>({id:t.id,date:t.date,title:t.title,payee:t.payee,categoryId:t.category,category:C.categoryName(d,t.category),amount:t.amount,currency:t.currency}))}};}
module.exports={resolve,candidates};
