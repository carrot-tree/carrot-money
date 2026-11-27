'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core'),IO=require('../src/vault-io');
const {Store,ROOT,PATH}=require('../src/storage');
const Appearance=require('../src/appearance'),Session=require('../src/ai-sessions'),Preferences=require('../src/ai-preferences'),Entry=require('../src/entry-drafts'),Draft=require('../src/ai-drafts');
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
function vault(seed=[]){
 const files=new Map(seed),folders=new Set([ROOT]),unindexed=new Set();
 const v={
  files,unindexed,
  adapter:{exists:async p=>files.has(p)||folders.has(p),read:async p=>{if(!files.has(p))throw Error('missing file');return files.get(p);},list:async p=>({files:[...files.keys()].filter(x=>x.startsWith(p+'/'))})},
  createFolder:async p=>{if(folders.has(p))throw Error('folder exists');folders.add(p);},
  getAbstractFileByPath:p=>files.has(p)&&!unindexed.has(p)?{path:p}:null,
  create:async(p,s)=>{if(files.has(p))throw Error('file exists');files.set(p,s);},
  process:async(f,fn)=>{assert.ok(f,'never process null');files.set(f.path,fn(files.get(f.path)));},
  trash:async f=>files.delete(f.path)
 };
 return v;
}

const state={sessionId:'s',input:'hello',turns:[],sessions:[{id:'s',title:'样本',turns:[],input:''}]};
const draft={entry:C.newEntry(C.blank(),{id:'draft'}),values:{amount:'3 +'},splits:[],fileNames:[]};
const appearance={style:'mist',mode:'dark',density:'comfortable',accent:null,radius:null};
const prefs=[{id:'p',text:'示例',enabled:true}];
let serial=0;
const stores=[
 ['sessions',Session.PATH,Session.SessionStore,s=>s.save('daily',state),s=>s.get('daily'),null],
 ['preferences',Preferences.PATH,Preferences.PreferenceStore,s=>s.save('daily',prefs),s=>s.get('daily'),[]],
 ['appearance',Appearance.PATH,Appearance.AppearanceStore,s=>s.save(appearance),s=>s.data,null],
 ['entry drafts',Entry.PATH,Entry.EntryDraftStore,s=>s.save({...draft,values:{amount:String(++serial)}}),s=>s.get('daily'),null],
 ['import drafts',Draft.PATH,Draft.DraftStore,s=>s.save('daily',{batch:null}),s=>s.data.drafts,[]]
];
for(const [name,path,Type,save,read,blank] of stores){
 test(name+' queues reload behind write, rejects an unindexed file, and recreates after deletion',async()=>{
  const v=vault(),s=new Type(v);await s.load();await save(s);
  const before=v.files.get(path);assert.ok(before);
  v.unindexed.add(path);await assert.rejects(save(s),/尚未同步/);assert.equal(v.files.get(path),before);v.unindexed.clear();
  const entered=gate(),unblock=gate(),process=v.process;
  v.process=async(f,fn)=>{entered.release();await unblock.promise;await process(f,fn);};
  const saving=save(s);await entered.promise;
  let reloaded=false;const loading=s.load().then(()=>{reloaded=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reloaded,false);
  unblock.release();await Promise.all([saving,loading]);assert.equal(s.raw,v.files.get(path));
  v.files.delete(path);
  await assert.rejects(save(s),/重新读取/);
  await s.load();assert.equal(s.raw,null);assert.deepEqual(read(s),blank);
  await save(s);assert.ok(v.files.has(path));
 });
}

test('Vault I/O never overwrites a create race, and disposes a directory race',async()=>{
 const v=vault();
 v.createFolder=async p=>{v.files.set(p,'');throw Error('folder exists');};
 await IO.mkdir(v,ROOT+'/race');
 v.create=async(p)=>{v.files.set(p,'other window');throw Error('file exists');};
 await assert.rejects(IO.write(v,ROOT+'/race.json','overwrite',null),/其他窗口/);
 assert.equal(v.files.get(ROOT+'/race.json'),'other window');
});

test('ledger change validates once and a concurrent manual backup sees the committed revision',async t=>{
 const v=vault(),s=new Store(v);await s.load();
 const validate=t.mock.method(C,'validate'),clone=t.mock.method(C,'clone');
 const entered=gate(),unblock=gate(),process=v.process;
 v.process=async(f,fn)=>{if(f.path===PATH){entered.release();await unblock.promise;}return process(f,fn);};
 const writing=s.change(d=>{d.books[0].name='synthetic';});await entered.promise;
 let done=false;const snapshot=s.backup(undefined,true).then(path=>{done=true;return path;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);
 unblock.release();await writing;const path=await snapshot;
 assert.equal(JSON.parse(v.files.get(path)).revision,1);
 assert.equal(validate.mock.callCount(),1);assert.equal(clone.mock.callCount(),1);
});

test('rotation retains 30 current dates and 20 newest manual snapshots plus unrelated files',async()=>{
 const v=vault(),s=new Store(v);await s.load();
 const dir=ROOT+'/备份/',day=C.today();
 for(let offset=1;offset<=40;offset++){
  const date=new Date(Date.parse(day+'T12:00:00Z')-offset*86400000).toISOString().slice(0,10);
  v.files.set(dir+date+'.json',s.raw);
 }
 for(let i=1;i<=25;i++)v.files.set(dir+'手动-2001-01-'+String(i).padStart(2,'0')+'T00-00-00-000Z-abcdef.json',s.raw);
 const preserved=[dir+'用户留档.json',dir+'损坏原件-123.txt',dir+'手动-从前.json'];
 for(const path of preserved)v.files.set(path,'keep');
 await s.change(d=>{d.books[0].name='synthetic';});const manual=await s.backup(undefined,true);
 assert.equal([...v.files.keys()].filter(p=>p.startsWith(dir)&&/\/\d{4}-/.test(p)).length,30);
 assert.equal([...v.files.keys()].filter(p=>p.startsWith(dir+'手动-')&&/\d{4}-/.test(p)).length,20);
 assert.ok(v.files.has(manual));for(const path of preserved)assert.equal(v.files.get(path),'keep');
});

test('session stamp protects a stale view after another view saves the same book',async()=>{
 const v=vault(),s=new Session.SessionStore(v);await s.load();
 const a={...structuredClone(state),sessionStamp:s.stamp('daily')},b=structuredClone(a);
 await s.save('daily',a);
 b.input='stale';await assert.rejects(s.save('daily',b),/会话已更新/);
 assert.equal(s.get('daily').sessions[0].input,'hello');
 b.sessionStamp=s.stamp('daily');await s.save('daily',b);
 assert.equal(s.get('daily').sessions[0].input,'stale');
});
