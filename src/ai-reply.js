'use strict';
const Markdown=require('./ai-report-markdown');
// Only escaped text and local formatting tags: replies never create embeds,
// executable HTML or automatic network requests.
function html(value){
 const lines=String(value||'').replace(/\r\n?/g,'\n').split('\n'),out=[];let body=[];
 const flush=()=>{if(body.length){out.push(Markdown.renderBody(body.join('\n'),()=>''));body=[];}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i],fence=/^\s*(`{3,}|~{3,})(.*)$/.exec(line),heading=/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  if(fence){flush();const code=[],marker=fence[1][0],length=fence[1].length;while(++i<lines.length){if(new RegExp('^\\s*'+marker+'{'+length+',}\\s*$').test(lines[i]))break;code.push(lines[i]);}out.push('<pre><code>'+Markdown.escape(code.join('\n'))+'</code></pre>');}
  else if(heading){flush();const level=Math.max(3,Math.min(6,heading[1].length+2));out.push('<h'+level+'>'+Markdown.inline(heading[2])+'</h'+level+'>');}
  else body.push(line);
 }
 flush();return out.join('');
}
async function copy(value,clipboard){
 const text=String(value||'');if(clipboard)return await clipboard.writeText(text);
 try{if(globalThis.navigator?.clipboard){await globalThis.navigator.clipboard.writeText(text);return;}}catch{}
 try{const desktop=require('electron').clipboard;if(desktop?.writeText){desktop.writeText(text);return;}}catch{}
 throw Error('当前设备无法直接复制，请选中文字后手动复制。');
}
module.exports={html,copy};
