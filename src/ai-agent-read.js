'use strict';
const C=require('./core');
function page(q,allowed=[]){if(!q||Object.keys(q).some(k=>!['offset','limit','keyword',...allowed].includes(k)))throw Error('查询参数字段无效');const offset=q.offset??0,limit=q.limit??30;if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100||q.keyword!==undefined&&(typeof q.keyword!=='string'||q.keyword.length>100))throw Error('查询范围无效');return {offset,limit};}
function result(items,q,summary,extra={}){const {offset,limit}=page(q,['start','end']);return {summary,data:{...extra,total:items.length,offset,limit,truncated:offset+limit<items.length,items:items.slice(offset,offset+limit)}};}
function accounts(d,q){page(q);const items=d.accounts.filter(a=>!q.keyword||a.name.includes(q.keyword)).map(a=>({id:a.id,name:a.name,type:a.type,currency:a.currency,archived:!!a.archived}));return result(items,q,'账户资料（不含余额、期初金额或账目）',{scope:'账户资料为插件共用；账目查询仍限当前账本，不能据此推算账户余额'});}
function accountBalance(d,book,q){
 if(!q||Object.keys(q).some(k=>!['account','at'].includes(k))||typeof q.account!=='string'||q.at!==undefined&&!C.validDate(q.at))throw Error('余额查询须指定账户和有效日期');
 const a=d.accounts.find(a=>a.id===q.account&&!a.archived);if(!a)throw Error('账户不存在或已归档');
 const involved=t=>t.account===a.id||t.toAccount===a.id||t.splits?.some(s=>s.account===a.id),at=q.at||C.today();
 if(d.entries.some(t=>t.book!==book&&involved(t)))return {summary:'该账户跨账本使用，当前授权范围不能计算完整余额',data:{available:false,account:a.name,currency:a.currency,scope:'请到资产账户查看完整余额；不发送或推算其他账本的交易'}};
 const amount=C.accountBalance({...d,entries:d.entries.filter(t=>t.book===book&&t.date<=at)},a.id);
 return {summary:a.name+'截至'+at+'的账面余额',data:{available:true,accountId:a.id,account:a.name,currency:a.currency,amount,at,scope:'期初余额加当前账本截至该日的已入账实际资金流水；不包含未入账计划'}};
}
function plans(d,book,q){page(q,['start','end']);if((q.start!==undefined||q.end!==undefined)&&(!C.validDate(q.start)||!C.validDate(q.end)||q.start>q.end||require('./planning').days(q.start,q.end)>366))throw Error('计划到期查询须给有效起止日期，最多367天');const matches=d.rules.filter(r=>r.entry.book===book&&(!q.keyword||r.name.includes(q.keyword)));
 const describe=r=>({id:r.id,name:r.name,kind:r.entry.kind,amount:r.entry.amount,currency:r.entry.currency,frequency:r.frequency,next:r.next,enabled:r.enabled,subscription:!!r.subscription,remaining:r.remaining??null,total:r.total??null,finalAmount:r.finalAmount??null});
 if(!q.start)return result(matches.map(describe),q,'当前账本周期与分期计划',{scope:'本地计划，不是已入账记录；确认入账或跳过请到周期与分期'});
 const ids=new Set(matches.map(r=>r.id)),due=C.dueRules({...d,rules:matches},q.end,book).filter(t=>t.date>=q.start&&ids.has(t.ruleId)).sort((a,b)=>a.date.localeCompare(b.date));return result(due.map(t=>({id:t.id,planId:t.ruleId,title:t.title,date:t.date,kind:t.kind,amount:t.amount,currency:t.currency,baseAmount:C.base(t),baseCurrency:'CNY'})),q,'指定期间待处理计划（尚未入账）',{scope:'只含尚未入账、未跳过的启用计划；历史已处理项目不在此列表',start:q.start,end:q.end});
}
module.exports={accounts,accountBalance,plans};
