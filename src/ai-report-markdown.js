'use strict';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean=s=>{const raw=String(s||'').trim();const out=raw.replace(/^第\s*(?:[一二三四五六七八九十百]{1,4}|\d{1,2})\s*(?:部分|章|节|板块|条)?\s*[、．.：:]?\s*/u,'').replace(/^(?:[一二三四五六七八九十百]{1,4}|\d{1,2})\s*[、．.：:]\s*/u,'').trim();return out||raw;};
const chineseNumber=n=>n<=10?'一二三四五六七八九十'[n-1]:String(n);
function parse(markdown,{title,requireTitle=false,maxSections=3}={}){
 if(typeof markdown!=='string'||!markdown.trim()||markdown.length>200000)throw Error('Markdown 为空或过长');
 const lines=markdown.replace(/\r\n?/g,'\n').split('\n'),sections=[];let docTitle='',current=null;
 for(const line of lines){const h1=/^# (.+?)\s*$/.exec(line),h2=/^## (.+?)\s*$/.exec(line);
  if(h1){if(docTitle||sections.length)throw Error('文档标题只能出现在开头');docTitle=clean(h1[1]);continue;}
  if(h2){const name=clean(h2[1]);if(!name)throw Error('板块标题为空');current={title:name,lines:[]};sections.push(current);continue;}
  if(!current){if(line.trim())throw Error('正文必须放在二级板块内');}else current.lines.push(line);
 }
 if(title&&docTitle&&clean(title)!==docTitle)throw Error('文档标题不一致');docTitle=docTitle||clean(title);
 if(requireTitle&&!docTitle)throw Error('create 须提供一级文档标题');
 if(!sections.length||sections.length>maxSections)throw Error(`每次须写入 1 至 ${maxSections} 个二级板块`);
 if(new Set(sections.map(s=>s.title)).size!==sections.length)throw Error('报告板块标题重复');
 return {title:docTitle,sections:sections.map(s=>({title:s.title,body:s.lines.join('\n').trim()}))};
}
const serialize=doc=>'# '+doc.title+'\n\n'+doc.sections.map(s=>'## '+s.title+(s.body?'\n\n'+s.body:'')).join('\n\n')+'\n';
function inline(value){return escape(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`\n]+)`/g,'<code>$1</code>');}
function renderBody(body,chart){const lines=body.split('\n'),out=[];let i=0;
 const tableRow=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
 while(i<lines.length){const line=lines[i],trim=line.trim();if(!trim){i++;continue;}
  const marker=/^::chart\s+(trend|share)(?:\s+(\d{4}-\d{2}))?\s*$/.exec(trim);
  if(marker){out.push(chart(marker[1],marker[2]));i++;continue;}
  const card=/^>\s*数字[：:]\s*(.+?)\s*\|\s*(.+)\s*$/.exec(trim);
  if(card){const cards=[];while(i<lines.length){const m=/^>\s*数字[：:]\s*(.+?)\s*\|\s*(.+)\s*$/.exec(lines[i].trim());if(!m)break;cards.push('<div class="stat"><span>'+inline(m[1])+'</span><strong>'+inline(m[2])+'</strong></div>');i++;}out.push('<div class="grid">'+cards.join('')+'</div>');continue;}
  if(/^\|/.test(trim)&&i+1<lines.length&&/^\|?\s*:?-{3,}/.test(lines[i+1].trim())){const head=tableRow(trim),rows=[];i+=2;while(i<lines.length&&/^\|/.test(lines[i].trim())){rows.push(tableRow(lines[i]));i++;}out.push('<div class="table-wrap"><table><thead><tr>'+head.map(x=>'<th>'+inline(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+head.map((_,j)=>'<td>'+inline(r[j]||'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;}
  if(/^[-*] /.test(trim)||/^\d+\. /.test(trim)){const ordered=/^\d+\. /.test(trim),items=[];while(i<lines.length&&(ordered?/^\d+\. /:/^[-*] /).test(lines[i].trim())){items.push('<li>'+inline(lines[i].trim().replace(ordered?/^\d+\. /:/^[-*] /,''))+'</li>');i++;}const tag=ordered?'ol':'ul';out.push('<'+tag+'>'+items.join('')+'</'+tag+'>');continue;}
  if(/^> /.test(trim)&&!card){const quote=[];while(i<lines.length&&/^> /.test(lines[i].trim()))quote.push(inline(lines[i++].trim().slice(2)));out.push('<blockquote>'+quote.join('<br>')+'</blockquote>');continue;}
  if(/^### /.test(trim)){out.push('<h3>'+inline(clean(trim.slice(4)))+'</h3>');i++;continue;}
  const p=[];while(i<lines.length&&lines[i].trim()&&!/^(?:\| |> |[-*] |\d+\. |### |::chart )/.test(lines[i].trim()))p.push(inline(lines[i++].trim()));if(p.length)out.push('<p>'+p.join('<br>')+'</p>');else{out.push('<p>'+inline(lines[i].trim())+'</p>');i++;}
 }
 return out.join('');}
function render(doc,{style,chart=()=>''}={}){const sections=doc.sections.map((s,i)=>'<section id="sec-'+(i+1)+'"><h2>'+chineseNumber(i+1)+'、'+escape(s.title)+'</h2>'+renderBody(s.body,chart)+'</section>').join('');return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(doc.title)+'</title><style>'+style+'</style></head><body><header><h1>'+escape(doc.title)+'</h1></header><main id="report-main">'+sections+'</main><footer>Carrot 记账 · 本地报告</footer></body></html>';}
module.exports={escape,clean,chineseNumber,parse,serialize,render,renderBody,inline};
