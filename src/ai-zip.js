'use strict';
// ZIP container reader, in memory only. No paths are ever extracted to disk.
// Central-directory sizes also support exports that use data descriptors.
const LIMIT=32*1024*1024,MAX_FILES=256;
const crcTable=Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
async function inflate(bytes,max){
 // Browser path works on mobile too. Lazy Node fallback is for older Desktop.
 let stream;
 try{if(typeof DecompressionStream!=='undefined')stream=new DecompressionStream('deflate-raw');}catch{}
 if(stream){const reader=new Blob([bytes]).stream().pipeThrough(stream).getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('ZIP 解压大小超出限制');parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}const out=new Uint8Array(size);let pos=0;for(const part of parts){out.set(part,pos);pos+=part.length;}return out;}
 let zlib;try{zlib=require('node:zlib');}catch{throw Error('当前设备不支持 ZIP 解压，请先在本地解压后选择 CSV');}
 return new Uint8Array(zlib.inflateRawSync(bytes,{maxOutputLength:Math.max(1,max)}));
}
async function files(buffer,onProgress=()=>{},kind='bill'){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
 if(bytes.length>LIMIT)throw Error('文件请小于 32 MB');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const need=(p,n)=>{if(p<0||p+n>bytes.length)throw Error('ZIP 文件不完整');};
 const u16=p=>{need(p,2);return view.getUint16(p,true);},u32=p=>{need(p,4);return view.getUint32(p,true);};
 let end=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
 if(end<0)throw Error('不是完整的 ZIP 文件');
 const count=u16(end+10),centralSize=u32(end+12),central=u32(end+16);
 if(u16(end+4)||u16(end+6)||u16(end+8)!==count||count===65535||central===0xffffffff)throw Error('暂不支持分卷或 ZIP64，请本地解压后选择 CSV');
 if(count>MAX_FILES)throw Error('ZIP 内文件过多（最多 256 个）');
 if(central+centralSize!==end)throw Error('ZIP 目录不完整');
 const candidates=[];let p=central,total=0,oldExcel=false;
 for(let i=0;i<count;i++){
  need(p,46);if(u32(p)!==0x02014b50)throw Error('ZIP 目录损坏');
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),size=u32(p+24),len=u16(p+28),extra=u16(p+30),comment=u16(p+32),offset=u32(p+42);
  need(p+46,len+extra+comment);if(p+46+len+extra+comment>end)throw Error('ZIP 目录越界');
  const nameBytes=bytes.subarray(p+46,p+46+len),name=new TextDecoder(flags&2048?'utf-8':'gb18030').decode(nameBytes);
  p+=46+len+extra+comment;
  if(kind==='bill'&&/\.xls$/i.test(name))oldExcel=true;
  if((kind==='xlsx'?!/^(?:\[Content_Types\]\.xml|xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml))$/i.test(name):!/\.(csv|xlsx)$/i.test(name))||name.split(/[\\/]/).some(x=>x.startsWith('.')||x==='__MACOSX'))continue;
  if(flags&1)throw Error('ZIP 已加密，请用账单密码在本地解压后选择 CSV');
  if(![0,8].includes(method))throw Error('ZIP 压缩方式不支持，请本地解压后选择 CSV');
  total+=size;if(total>LIMIT)throw Error('ZIP 解压后合计请小于 32 MB');
  candidates.push({name,flags,method,crc,compressed,size,offset});
 }
 if(p!==end)throw Error('ZIP 目录长度不一致');
 if(!candidates.length)throw Error(kind==='xlsx'?'Excel 文件缺少工作表':oldExcel?'旧版 .xls 暂不支持，请另存为 .xlsx 或 CSV':'ZIP 内没有找到 CSV / XLSX，请确认选择了账单压缩包');
 if(kind==='bill')candidates.sort((a,b)=>Number(/支付宝|微信|alipay|wechat|bill/i.test(b.name))-Number(/支付宝|微信|alipay|wechat|bill/i.test(a.name))||a.name.localeCompare(b.name));
 const files=[];
 for(const [i,c]of candidates.entries()){
  const {offset,compressed,size,method}=c;need(offset,30);
  if(u32(offset)!==0x04034b50||u16(offset+8)!==method||(u16(offset+6)&1))throw Error('ZIP 文件头不一致');
  const start=offset+30+u16(offset+26)+u16(offset+28);need(start,compressed);
  if(start+compressed>central)throw Error('ZIP 文件内容越界');
  const data=bytes.subarray(start,start+compressed),out=method===0?data:await inflate(data,size);
  if(out.length!==size||crc32(out)!==c.crc)throw Error('ZIP 校验失败，文件可能已损坏');
  files.push({name:c.name,bytes:out});onProgress(i+1,candidates.length);
 }
 return files;
}
async function csvFiles(buffer,onProgress=()=>{}){return files(buffer,onProgress,'bill');}
module.exports={csvFiles,files,crc32,LIMIT};
