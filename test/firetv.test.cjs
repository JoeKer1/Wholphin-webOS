const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
 const commands=[], events=[];
 const parent={hidden:false,getBoundingClientRect:()=>({left:0,top:0,width:1920,height:1080})};
 const element={parentNode:parent,style:{},addEventListener(){},removeEventListener(){},dispatchEvent(event){events.push(event.type);this['on'+event.type]?.(event);}};
 const context={window:null,document:{body:{},documentElement:{classList:{add(){}}}},CSS:{supports:()=>true},innerWidth:1920,innerHeight:1080,MutationObserver:class {observe(){}},Event:class {constructor(type){this.type=type;}},EmberAndroid:{command:raw=>commands.push(JSON.parse(raw))},addEventListener(){}};
 context.window=context;
 vm.runInNewContext(fs.readFileSync('platforms/firetv/platform.js','utf8'),context);
 const p=context.EmberPlatform.createPlayer(element);
 const receive=(type,data={})=>context.EmberFireTV.receive({id:commands.findLast(c=>c.action==='load')?.id,type,position:0,duration:120000,paused:false,...data});
 return {p,commands,events,receive,context,parent};
}
test('Fire TV bridge preserves resume seconds, waits for native playback and closes cancelled sources',async()=>{
 const f=fixture();f.p.src='https://media.test/live.m3u8#t=30';f.p.load();
 assert.equal(f.commands.find(c=>c.action==='load').url,'https://media.test/live.m3u8');
 let started=false; const play=f.p.play().then(()=>{started=true;});
 assert.equal(started,false);f.receive('loadedmetadata');f.p.currentTime=30;
 assert.equal(f.commands.find(c=>c.action==='seek').ms,30000);assert.equal(f.p.seeking,true);
 f.receive('seeked',{position:30000});assert.equal(f.p.currentTime,30);assert.equal(f.p.seeking,false);
 f.receive('playing',{position:30000});await play;assert.equal(started,true);
 f.p.pause();assert.equal(f.commands.at(-1).action,'pause');assert.equal(f.p.paused,true);
 const id=f.commands.find(c=>c.action==='load').id;
 f.p.src='https://media.test/new.m3u8';f.p.load();
 f.context.EmberFireTV.receive({id,type:'error'});assert.equal(f.p.error,null);
 const pending=f.p.play();f.p.removeAttribute('src');f.p.load();await assert.rejects(pending,/cancelled/);
 assert.equal(f.commands.at(-1).action,'close');
});
test('Fire TV native view follows preview geometry and exposes only a real seekable live window',()=>{
 const f=fixture();f.p.src='https://media.test/live.m3u8';f.p.load();
 f.receive('loadedmetadata',{live:true,seekStart:0,seekEnd:60000,position:30000});
 assert.equal(f.p.duration,Infinity);assert.equal(f.p.seekable.end(0),60);
 f.parent.getBoundingClientRect=()=>({left:1400,top:24,width:480,height:270});
 f.receive('timeupdate',{live:true,position:31000});
 const rect=f.commands.findLast(c=>c.action==='rect');assert.equal(rect.left,1400);assert.equal(rect.width,480);
 assert.equal(f.p.seekable.length,0);
});
test('Fire TV HTTP artwork uses local blobs, releases them, and ignores replaced requests',async()=>{
 const {context:c}=fixture(), pending=[], released=[];
 c.fetch=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));
 c.URL={createObjectURL:()=> 'blob:artwork',revokeObjectURL:url=>released.push(url)};
 const listeners={},img={addEventListener:(t,f)=>listeners[t]=f,removeEventListener:t=>delete listeners[t],dispatchEvent(){}};
 c.EmberPlatform.loadImage(img,'http://lan.test/poster');
 assert.equal(pending[0].options.credentials,'omit');
 pending[0].resolve({ok:true,blob:async()=>({})});
 await new Promise(r=>setImmediate(r));
 assert.equal(img.src,'blob:artwork');listeners.load();assert.deepEqual(released,['blob:artwork']);
 c.EmberPlatform.loadImage(img,'http://lan.test/old');
 c.EmberPlatform.loadImage(img,'https://secure.test/new');
 pending[1].resolve({ok:true,blob:async()=>({})});
 await new Promise(r=>setImmediate(r));
 assert.equal(img.src,'https://secure.test/new');
});
test('Native subtitle changes are acknowledged without replacing the video and cancel on stop',async()=>{
 const f=fixture();f.context.setTimeout=setTimeout;f.context.clearTimeout=clearTimeout;
 f.p.src='https://media.test/movie.mkv';f.p.load();f.receive('loadedmetadata');
 const before=f.commands.filter(c=>c.action==='load').length;
 const changed=f.p.selectTracks({audio:0,subtitle:1});
 assert.equal(f.commands.at(-1).action,'tracks');f.receive('trackschanged');await changed;
 assert.equal(f.commands.filter(c=>c.action==='load').length,before);
 const rejected=f.p.selectTracks({audio:0,subtitle:2});f.receive('tracksfailed');await assert.rejects(rejected,/unavailable/);
 const cancelled=f.p.selectTracks({audio:0,subtitle:-1});f.p.removeAttribute('src');f.p.load();await assert.rejects(cancelled,/cancelled/);
});
test('Display matching is optional and passes only a device-local preference to the native bridge',()=>{
 const f=fixture();
 assert.equal(f.context.EmberPlatform.displayMatching(),null);
 f.context.EmberAndroid.capabilities=()=>JSON.stringify({displayMatching:{rate:false,resolution:true}});
 assert.equal(f.context.EmberPlatform.displayMatching().resolution,true);
 assert.equal(f.context.EmberPlatform.displayMatching().rate,false);
 f.context.EmberPlatform.configureDisplay('resolution');
 assert.equal(f.commands.at(-1).action,'displayPreferences');
 assert.equal(f.commands.at(-1).mode,'resolution');
 delete f.context.EmberAndroid;
 assert.doesNotThrow(()=>f.context.EmberPlatform.configureDisplay('off'));
});
