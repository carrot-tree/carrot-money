'use strict';
const C=require('./core');
const DAY=86400000;
const stamp=s=>Date.parse(s+'T12:00:00Z');
const shift=(s,n)=>new Date(stamp(s)+n*DAY).toISOString().slice(0,10);
const days=(a,b)=>Math.round((stamp(b)-stamp(a))/DAY)+1;
const monthEnd=m=>C.range('month',m+'-01')[1];
const clampDay=(ym,day)=>{const e=monthEnd(ym),d=ym+'-'+day;return d>e?e:d;};
function canTruncate(mode,anchor,today=C.today()){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(anchor||''))return false;if(mode==='month')return anchor===today.slice(0,7)&&today<monthEnd(anchor);if(mode==='year')return anchor.slice(0,4)===today.slice(0,4)&&today<anchor.slice(0,4)+'-12-31';return false;}
function period(mode,anchor=C.today().slice(0,7),start,end,options={}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(anchor))throw Error('请选择有效月份');
 const today=options.today||C.today(),partial=!!options.toDate&&canTruncate(mode,anchor,today);
 let a,b;if(mode==='year'){a=anchor.slice(0,4)+'-01-01';b=anchor.slice(0,4)+'-12-31';}else if(mode==='last12'){b=monthEnd(anchor);a=new Date(Date.UTC(Number(anchor.slice(0,4)),Number(anchor.slice(5))-12,1,12)).toISOString().slice(0,10);}else if(mode==='custom'){a=start;b=end;}else{a=anchor+'-01';b=monthEnd(anchor);}
 if(partial)b=today;
 if(!C.validDate(a)||!C.validDate(b)||a>b)throw Error('请选择有效的开始和结束日期');if(days(a,b)>3660)throw Error('一次最多查看十年，请缩短范围');
 let previousStart,previousEnd;if(mode==='month'){const m=new Date(Date.UTC(Number(anchor.slice(0,4)),Number(anchor.slice(5))-2,1,12)).toISOString().slice(0,7);previousStart=m+'-01';previousEnd=partial?clampDay(m,today.slice(8)):monthEnd(m);}else if(mode==='year'){const y=Number(anchor.slice(0,4))-1;previousStart=y+'-01-01';previousEnd=partial?clampDay(y+'-'+today.slice(5,7),today.slice(8)):y+'-12-31';}else{previousEnd=shift(a,-1);previousStart=shift(previousEnd,-days(a,b)+1);}
 return {start:a,end:b,previousStart,previousEnd,days:days(a,b),partial};
}
function matchesMetric(t,key){const s=C.impact(t);return key==='net'?!!(s.income||s.expense):!!s[key];}
function buckets(rows,start,end,grain='auto'){
 const span=days(start,end);if(grain==='auto')grain=span<=62?'day':span<=150?'week':'month';
 const slots=[];for(let at=start;at<=end;){let to=grain==='day'?at:grain==='week'?shift(at,6):monthEnd(at.slice(0,7));to=to>end?end:to;slots.push({start:at,end:to,label:grain==='month'?at.slice(0,7):at.slice(5),income:0,expense:0,net:0,count:0,metricCounts:{income:0,expense:0,net:0},ids:[]});at=shift(to,1);}
 const index=new Map();for(const b of slots)for(let at=b.start;at<=b.end;at=shift(at,1))index.set(at,b);
 for(const t of rows){const b=index.get(t.date);if(!b)continue;const s=C.impact(t);b.income+=s.income;b.expense+=s.expense;b.net+=s.income-s.expense;b.count++;for(const key of ['income','expense','net'])if(matchesMetric(t,key))b.metricCounts[key]++;b.ids.push(t.id);}return {grain,slots};
}
function groups(d,rows,metric='expense',dimension='category',level='leaf'){
 const map=new Map();for(const t of rows){const value=C.impact(t)[metric];if(!value)continue;let key,label;if(dimension==='person'){key=t.person||'';label=key||'未注明人物';}else if(dimension==='payee'){key=t.payee||'';label=key||'未注明商家';}else{key=t.category||'';if(level==='parent')key=d.categories.find(c=>c.id===key)?.parent||key;label=C.categoryName(d,key);}
 if(!map.has(key))map.set(key,{key,label,value:0,count:0,ids:[]});const g=map.get(key);g.value+=value;g.count++;g.ids.push(t.id);}
 return [...map.values()].sort((a,b)=>b.value-a.value);
}
function donutGroups(groups,limit=6){const positive=groups.filter(g=>g.value>0),negative=groups.filter(g=>g.value<0),total=positive.reduce((n,g)=>n+g.value,0),negativeTotal=negative.reduce((n,g)=>n+g.value,0);const slices=positive.length>limit?[...positive.slice(0,limit-1),{key:'__other',label:'其余 '+(positive.length-limit+1)+' 项',value:positive.slice(limit-1).reduce((n,g)=>n+g.value,0),ids:positive.slice(limit-1).flatMap(g=>g.ids),count:positive.slice(limit-1).reduce((n,g)=>n+g.count,0)}]:positive;return {slices,positive,negative,total,negativeTotal,net:total+negativeTotal};}
function comparison(current,previous){return {delta:current-previous,percent:previous>0?(current-previous)/previous*100:null};}
function insights(rows,range){const s=C.totals(rows),daysSet=new Set(rows.filter(t=>C.impact(t).expense>0).map(t=>t.date));const expenses=rows.map(t=>({t,value:C.impact(t).expense})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);const daily=buckets(rows,range.start,range.end,'day').slots;const maxDay=[...daily].sort((a,b)=>b.expense-a.expense)[0];return {...s,net:s.income-s.expense,dailyAverage:Math.round(s.expense/range.days),activeDays:daysSet.size,largest:expenses[0]||null,maxDay:maxDay?.expense>0?maxDay:null};}
function accountDelta(t,id){if(t.kind==='legacy')return 0;if(t.kind==='expense'&&t.splits?.length)return -t.splits.filter(s=>s.account===id).reduce((n,s)=>n+s.amount,0);let n=0;if(t.account===id)n+=['expense','transfer'].includes(t.kind)?-t.amount:t.amount;if(t.kind==='transfer'&&t.toAccount===id)n+=t.toAmount;return n;}
function accountLedger(d,id){const a=d.accounts.find(x=>x.id===id);if(!a)return [];let balance=a.opening;return d.entries.map((t,i)=>({t,i,delta:accountDelta(t,id)})).filter(x=>x.delta!==0).sort((a,b)=>a.t.date.localeCompare(b.t.date)||String(a.t.createdAt||'').localeCompare(String(b.t.createdAt||''))||a.i-b.i).map(x=>{balance+=x.delta;return {...x,balance};});}
// Four arithmetic operations, no eval; calculate with exact rational numbers, round only once to cents.
function calculate(expression){const s=String(expression).replace(/[\s,，]/g,'').replace(/−/g,'-').replace(/×/g,'*').replace(/[÷]/g,'/');if(s.length>180||!/^[\d.+*/()-]+$/.test(s))throw Error('只能计算数字和 + − × ÷');const tokens=s.match(/\d+(?:\.\d*)?|\.\d+|[()+*/-]/g)||[];let i=0;const add=(a,b,sign=1n)=>[a[0]*b[1]+sign*b[0]*a[1],a[1]*b[1]];function atom(){const t=tokens[i++];if(t==='+'||t==='-'){const v=atom();return [t==='-'?-v[0]:v[0],v[1]];}if(t==='('){const v=sum();if(tokens[i++]!==')')throw Error('括号未闭合');return v;}if(!t||!/^\d|^\.\d/.test(t))throw Error('请补全金额算式');const [n,f='']=t.split('.');if(f.length>6)throw Error('小数最多六位');return [BigInt((n||'0')+f),10n**BigInt(f.length)];}function product(){let a=atom();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++],b=atom();if(op==='/'&&b[0]===0n)throw Error('不能除以零');a=op==='*'?[a[0]*b[0],a[1]*b[1]]:[a[0]*b[1],a[1]*b[0]];}return a;}function sum(){let a=product();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++];a=add(a,product(),op==='+'?1n:-1n);}return a;}let [n,den]=sum();if(i!==tokens.length)throw Error('金额算式不完整');if(den<0n){n=-n;den=-den;}const sign=n<0n?-1n:1n;n=n<0n?-n:n;const cents=sign*((n*100n*2n+den)/(den*2n));const value=Number(cents);if(!Number.isSafeInteger(value))throw Error('金额超出范围');return value;}
module.exports={matchesMetric,shift,days,period,canTruncate,buckets,groups,donutGroups,comparison,insights,accountDelta,accountLedger,calculate};
