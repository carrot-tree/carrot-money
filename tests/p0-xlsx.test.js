'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),I=require('../src/imports'),AI=require('../src/ai-import');
const X=require('../src/ai-xlsx'),Z=require('../src/ai-zip');

// Build stored ZIP members in memory so the production ZIP/CRC path runs.
function zip(parts){
 const members=[],directory=[];
 let offset=0;
 for(const [name,xml] of Object.entries(parts)){
  const filename=Buffer.from(name),data=Buffer.from(xml),checksum=Z.crc32(data);
  const local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt32LE(checksum,14);
  local.writeUInt32LE(data.length,18);
  local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(filename.length,26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE(checksum,16);
  central.writeUInt32LE(data.length,20);
  central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(filename.length,28);
  central.writeUInt32LE(offset,42);
  members.push(local,filename,data);
  directory.push(central,filename);
  offset+=local.length+filename.length+data.length;
 }
 const end=Buffer.alloc(22),contents=Buffer.concat(directory),count=Object.keys(parts).length;
 end.writeUInt32LE(0x06054b50);
 end.writeUInt16LE(count,8);
 end.writeUInt16LE(count,10);
 end.writeUInt32LE(contents.length,12);
 end.writeUInt32LE(offset,16);
 return Buffer.concat([...members,contents,end]);
}
function workbook(sheet,{mac=false}={}){
 return zip({
  '[content_TYPES].XML':'<Types/>',
  'XL/WorkBook.XML':'<workbook><workbookPr date1904="'+(mac?'1':'0')+'"/><sheets><sheet name="账单" r:id="rId1"/></sheets></workbook>',
  'XL/_ReLs/WorkBook.XML.ReLS':'<Relationships><Relationship Id="rId1" Target="/Xl/Worksheets/ZDATA.XML"/></Relationships>',
  'XL/SHAREDStrings.XML':'<sst><si/><si><r><t>交易</t></r><r><t>时间</t></r><rPh sb="0" eb="2"><t>JIAOYI</t></rPh></si><si><t>金额</t></si><si><t>摘要</t></si><si><t>状态</t></si><si><t>支付成功</t></si></sst>',
  'XL/WorKSheets/ZData.XML':sheet,
  'XL/WORKSHEETS/Adecoy.XML':'<worksheet><sheetData><row><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row><row><c><v>50</v></c><c><v>99</v></c></row></sheetData></worksheet>'
 });
}
const header='<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>4</v></c></row>';
test('XLSX keeps empty rows and shared strings aligned, skips phonetic text and resolves mixed-case parts',async()=>{
 const sheet='<worksheet><sheetData><row r="1"/>'+header+'<row r="3" />'+
  '<row r="4"><c r="A4"><v>1.5</v></c><c r="B4"><v>19.899999999999999</v></c><c r="C4" t="inlineStr"><is><r><t>中文</t></r><rPh><t>ZHONGWEN</t></rPh></is></c><c r="D4" t="s"><v>5</v></c></row>'+
  '<row r="5"><c r="A5"><v>0</v></c><c r="B5"><v>1e-2</v></c><c r="C5"/><c r="D5" t="s"><v>5</v></c></row>'+
  '</sheetData></worksheet>';
 const xlsx=workbook(sheet,{mac:true});
 const file={name:'虚构账单.xlsx',size:xlsx.byteLength,arrayBuffer:async()=>xlsx};
 const {records}=await AI.readFile(file);
 assert.deepEqual(records.map(r=>[r.date,r.time,r.amount,r.title,r.status]),[
  ['1904-01-02','1904-01-02T12:00:00',1990,'中文','支付成功'],
  ['1904-01-01','',1,'','支付成功']
 ]);
});
test('1900 epoch behavior remains available for regular XLSX workbooks',async()=>{
 const {records}=await X.parse(workbook('<worksheet><sheetData>'+header+
  '<row><c><v>61</v></c><c><v>20</v></c></row></sheetData></worksheet>'));
 assert.equal(records[0].date,'1900-03-01');
 assert.equal(X.serial('59'),'1900-02-28');
 assert.equal(X.serial('60'),'60');
});
test('XLSX dual amount columns use the positive side despite zero and placeholder values',()=>{
 const table=[['日期','收入','支出','摘要'],
  ['2025-05-01','19.80','0.00','入账甲'],
  ['2025-05-01','25','--','入账乙'],
  ['2025-05-01','--','1e-2','出账甲'],
  ['2025-05-01','0.00','19.899999999999999','出账乙']];
 const {records}=I.parseSheetRows(table,'测试.xlsx');
 assert.deepEqual(records.map(r=>[r.direction,r.amount]),[['收入',1980],['收入',2500],['支出',1],['支出',1990]]);
});
test('bill timestamps keep the statement day for one-digit hours, fractional seconds and zones',()=>{
 const {records}=I.parseReview([
  '交易时间,交易单号,金额,收/支,交易状态',
  '2025-05-01 9:30:00,one,5.00,支出,支付成功',
  '2025-05-01 9:30:00.0,two,5.00,支出,支付成功',
  '2025-05-01T23:59:59.123-03:00,three,5.00,支出,支付成功',
  '2025/5/1 9:30:00 +0800,four,5.00,支出,支付成功',
  '2025/5/1 9:30:00Z,five,5.00,支出,支付成功',
  '2025/5/1 9:30:00 GMT+8,six,5.00,支出,支付成功'
 ].join('\n'));
 assert.ok(records.every(r=>r.date==='2025-05-01'));
 assert.deepEqual(records.map(r=>r.time),[
  '2025-05-01T09:30:00','2025-05-01T09:30:00.0','2025-05-01T23:59:59.123',
  '2025-05-01T09:30:00','2025-05-01T09:30:00','2025-05-01T09:30:00'
 ]);
});
const sheetHeader=['日期','金额','方向','商户','摘要','状态'];
function importLedger(){
 const d=C.blank();d.accounts=[{id:'wallet',name:'现金',type:'现金',currency:'CNY',rate:1,opening:0,archived:false}];
 return d;
}
const classify={id:'test-local',classify:r=>({nature:r.direction==='收入'?'income':'expense',
 category:r.direction==='收入'?'cat-9':'cat-0',account:'wallet',score:1,reasons:[]})};
test('same-day same-amount indistinguishable XLSX rows get repeatable distinct IDs and can post together',async()=>{
 const sheet=[sheetHeader,
  ['2025-05-01','5','支出','地铁','交通','支付成功'],
  ['2025-05-01','5','支出','地铁','交通','支付成功'],
  ['2025-05-01','5','支出','','','支付成功'],
  ['2025-05-01','5','支出','','','支付成功'],
  ['2025-05-01','5','收入','地铁','交通','支付成功'],
  ['2025-05-01','5','支出','地铁','额外一笔','支付成功']];
 const first=I.parseSheetRows(sheet,'账单.xlsx'),ids=first.records.map(r=>r.id);
 assert.equal(new Set(ids).size,6);
 assert.match(ids[0],/-1$/);assert.match(ids[1],/-2$/);
 assert.deepEqual(I.parseSheetRows(sheet,'重命名账单.xlsx').records.map(r=>r.id),ids);
 const d=importLedger(),batch=await AI.analyze(first,d,'daily',{provider:classify});
 assert.deepEqual(AI.post(d,batch,batch.rows.map(r=>r.key)),ids);
 assert.equal(d.entries.length,6);
 const reimport=await AI.analyze(first,d,'daily',{provider:classify});
 assert.ok(reimport.rows.every(r=>r.issues.includes('duplicate')));
});
test('legacy sheet IDs block only the already posted occurrence of identical rows',async()=>{
 const row=['2025-05-01','5','支出','地铁','交通','支付成功'];
 const first=I.parseSheetRows([sheetHeader,row,row],'账单.xlsx'),d=importLedger();
 const oldBatch=await AI.analyze(first,d,'daily',{provider:classify});
 const previous=oldBatch.rows[0].entry;
 previous.id=previous.importIdentity=first.records[0].legacyId;
 d.entries.push(previous);
 const batch=await AI.analyze(first,d,'daily',{provider:classify});
 assert.ok(batch.rows[0].issues.includes('duplicate'));
 assert.equal(batch.rows[1].issues.includes('duplicate'),false);
 assert.deepEqual(AI.post(d,batch,[batch.rows[1].key]),[first.records[1].id]);
 assert.equal(d.entries.length,2);
});
