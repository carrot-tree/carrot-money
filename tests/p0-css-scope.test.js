'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

const roots=[
 'carrot-money','cm-modal','cm-themed-dialog','cm-ai-settings','cm-entry-drawer',
 'cm-entry-modal','cm-detail-modal','cm-account-modal','cm-ai-edit','cm-ai-edit-modal',
 'cm-ai-edit-narrow','cm-import-preview-modal'
];
const root='\\.(?:'+roots.join('|')+')(?![\\w-])';
const scope=':where(.carrot-money,.cm-modal,.cm-themed-dialog,.cm-ai-settings) ';
const direct=new RegExp(root+'|:has\\(\\s*>?\\s*(?:\\.modal)?'+root+'(?:\\[[^\\]]+\\])*\\s*\\)','y');

// Split selector lists in style rules, including rules inside @media and
// @container. A comma inside a functional pseudo-class is not a separator.
function selectors(css){
 const result=[];
 let start=0,depth=0,rule=false,parts=[];
 for(const {0:token,index} of css.matchAll(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\\.|[()[\]{},;]/g)){
  if(token==='('||token==='['){depth++;continue;}
  if(token===')'||token===']'){depth--;continue;}
  if(depth)continue;
  if(token===','&&!rule){parts.push([start,index]);start=index+1;}
  else if(token==='{'){
   const prelude=selectorText(css.slice(parts[0]?.[0]??start,index));
   if(!prelude.startsWith('@')){
    result.push(...parts,[start,index]);
    rule=true;
   }
   parts=[];start=index+1;
  }else if(token==='}'||token===';'&&!rule){rule=false;parts=[];start=index+1;}
 }
 return result;
}
function scoped(selector){
 if(selector.startsWith(scope))return !/^[+~]/.test(selector.slice(scope.length).trimStart());
 // A negated root or a sibling outside the root does not constrain a rule.
 let depth=0,anchored=false;
 for(const {0:token,index} of selector.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\\.|[()[\].+:~]/g)){
  if(!depth){
   direct.lastIndex=index;
   if(direct.test(selector))anchored=true;
   if(token==='+'||token==='~')anchored=false;
  }
  if(token==='('||token==='[')depth++;
  else if(token===')'||token===']')depth--;
 }
 return anchored;
}
const selectorText=value=>value.replace(/^(?:\s|\/\*[\s\S]*?\*\/)*/,'');

test('all .cm-* rules are scoped, including CodeMirror header, error and table classes',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../styles.css'),'utf8');
 const parsed=selectors(css).map(([start,end])=>selectorText(css.slice(start,end)));
 assert.ok(parsed.length>1000);
 assert.deepEqual(parsed.filter(selector=>/\.cm-[\w-]+/.test(selector)&&!scoped(selector)),[]);
 const unsafe='@media(max-width:720px){.cm-header,.cm-error:hover,:not(.carrot-money) .cm-table,.modal:has(.cm-modal,.cm-header){display:flex}}';
 assert.equal(selectors(unsafe).filter(([a,b])=>!scoped(unsafe.slice(a,b))).length,4);
});
