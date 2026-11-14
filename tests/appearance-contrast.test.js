'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {colorTokens,contrast}=require('../src/appearance');
// Independent luminance implementation: assert readability, not exact palettes.
function ratio(a,b){const lum=s=>{const n=parseInt(s.slice(1),16),v=[n>>16,n>>8&255,n&255].map(x=>x/255).map(x=>x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4));return .2126*v[0]+.7152*v[1]+.0722*v[2];};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('custom accents keep readable text and primary actions in both themes and modes',()=>{
 const shades=['#ffffff','#000000','#ffff00','#00ffff','#ff00ff','#ff0000','#00ff00','#0000ff','#a65de8','#2d6657'];
 for(let r=0;r<=255;r+=51)for(let g=0;g<=255;g+=51)for(let b=0;b<=255;b+=51)shades.push('#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''));
 for(const style of ['mist','paper'])for(const accent of shades){const t=colorTokens(style,accent);for(const bg of style==='mist'?['#f6f4fa','#ffffff']:['#f4f3ed','#fffef9'])assert.ok(ratio(t['--cm-ink-light'],bg)>=4.5,style+' '+accent+' light');for(const bg of style==='mist'?['#211f2b','#2b2838']:['#1e2824','#27332d'])assert.ok(ratio(t['--cm-ink-dark'],bg)>=4.5,style+' '+accent+' dark');assert.ok(ratio(t['--cm-button-light'],'#ffffff')>=4.5);assert.ok(ratio(t['--cm-button-dark'],'#1c1a22')>=4.5);}
 assert.equal(contrast('#000000','#ffffff'),21);
});
test('invalid accents are rejected before deriving style tokens',()=>{for(const c of ['','red','#fff','#000000; color:red','#12345g'])assert.throws(()=>colorTokens('mist',c));assert.throws(()=>colorTokens('__proto__','#ffffff'));});
