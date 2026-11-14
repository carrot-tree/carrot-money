'use strict';
// Read only the OOXML parts needed for a tabular bill. ZIP limits and CRC checks
// are supplied by ai-zip; XML is treated as data, never as executable markup.
const Z=require('./ai-zip'),I=require('./imports');
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const entity=s=>String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi,(_,code)=>{
 if(code[0]==='#'){const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):parseInt(code.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
 return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[code.toLowerCase()];
});
const attr=(tag,name)=>{const match=tag.match(new RegExp('(?:^|\\s)'+name.replace(':','\\:')+'\\s*=\\s*(["\'])(.*?)\\1','i'));return match?entity(match[2]):'';};
const blocks=(xml,name)=>[...xml.matchAll(new RegExp('<(?:[\\w.-]+:)?'+name+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'>','gi'))].map(x=>x[1]);
const texts=xml=>[...xml.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/gi)].map(x=>entity(x[1])).join('');
const serial=value=>{
 const n=Number(value);if(!Number.isFinite(n)||n<1||n>2958465||Math.floor(n)===60)return value;
 const whole=Math.floor(n),date=new Date(Date.UTC(1899,11,30)+(whole+(whole<60?1:0))*86400000);
 const seconds=Math.round((n-whole)*86400);if(seconds>=86400)return new Date(date.getTime()+86400000).toISOString().slice(0,10);
 const day=date.toISOString().slice(0,10);
 return seconds?day+' '+String(Math.floor(seconds/3600)).padStart(2,'0')+':'+String(Math.floor(seconds%3600/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):day;
};
function sheetRows(xml,shared){
 const rows=[];let nextRow=1;
 for(const match of xml.matchAll(/<(?:[\w.-]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?row>|<(?:[\w.-]+:)?row\b([^>]*)\/>/gi)){
  const index=Number(attr(match[1]||match[3]||'','r'))||nextRow;while(rows.length<index-1&&rows.length<40)rows.push([]);
  const values=[],body=match[2]||'';let nextColumn=0;
  for(const cell of body.matchAll(/<(?:[\w.-]+:)?c\b([^>]*?)(?:>([\s\S]*?)<\/(?:[\w.-]+:)?c>|\s*\/>)/gi)){
   const tag=cell[1],address=attr(tag,'r'),letters=/^[A-Z]+/i.exec(address)?.[0]||'';
   let column=letters?0:nextColumn;for(const ch of letters.toUpperCase())column=column*26+ch.charCodeAt(0)-64;if(letters)column--;
   if(column>1023)throw Error('Excel 工作表列数过多');nextColumn=column+1;
   const type=attr(tag,'t'),content=cell[2]||'',v=/<(?:[\w.-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?v>/i.exec(content)?.[1]||'';
   values[column]=type==='s'&&v!==''?shared[Number(v)]??'':type==='inlineStr'?texts(content):entity(v);
  }
  rows.push(values);nextRow=index+1;
  if(rows.length>20040)throw Error('Excel 工作表行数过多');
 }
 return rows;
}
function sheetPaths(workbook,rels,parts){
 const byId=new Map();for(const tag of rels.match(/<(?:[\w.-]+:)?Relationship\b[^>]*\/?>/gi)||[]){const id=attr(tag,'Id'),target=attr(tag,'Target');if(!id||!target||target.includes('..')||/^\w+:/.test(target))continue;const path=target.replace(/^\/?\.\//,'').replace(/^\//,'');byId.set(id,path.startsWith('xl/')?path:'xl/'+path);}
 const paths=[];for(const tag of workbook.match(/<(?:[\w.-]+:)?sheet\b[^>]*\/?>/gi)||[]){const id=attr(tag,'r:id'),path=byId.get(id);if(path&&parts.has(path))paths.push(path);}
 if(!paths.length)paths.push(...[...parts.keys()].filter(x=>/^xl\/worksheets\/[^/]+\.xml$/.test(x)).sort());return paths;
}
async function parse(buffer,file=''){
 const entries=await Z.files(buffer,()=>{},'xlsx'),parts=new Map(entries.map(x=>[x.name,utf8(x.bytes)]));
 if(!parts.has('[Content_Types].xml')||!parts.has('xl/workbook.xml'))throw Error('不是有效的 .xlsx 文件（缺少工作簿结构）');
 const shared=parts.has('xl/sharedStrings.xml')?blocks(parts.get('xl/sharedStrings.xml'),'si').map(texts):[];
 const paths=sheetPaths(parts.get('xl/workbook.xml'),parts.get('xl/_rels/workbook.xml.rels')||'',parts);
 let last='';for(const path of paths){const rows=sheetRows(parts.get(path),shared);try{
  const header=rows.slice(0,40).find(r=>r.some(x=>I.dateHeaders.includes(String(x||'').trim()))&&(r.some(x=>I.amountHeaders.includes(String(x||'').trim()))||r.includes('收入')||r.includes('支出')));
  if(!header){I.parseSheetRows(rows,file);continue;}
  const dateColumn=header.findIndex(x=>I.dateHeaders.includes(String(x||'').trim()));const headerIndex=rows.indexOf(header);
  for(const row of rows.slice(headerIndex+1))if(/^\d+(?:\.\d+)?$/.test(String(row[dateColumn]||'')))row[dateColumn]=serial(row[dateColumn]);
  return I.parseSheetRows(rows,file);
 }catch(e){last=e.message;}}
 throw Error(last||'Excel 中没有含日期列和金额列的工作表');
}
module.exports={parse,serial,sheetRows};
