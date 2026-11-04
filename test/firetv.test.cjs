const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
 const commands=[], events=[];
 const parent={hidden:false,getBoundingClientRect:()=>({left:0,top:0,width:1920,height:1080})};
 const element={parentNode:parent,style:{},addEventListener(){},removeEventListener(){},dispatchEvent(event){this.lastEvent=event;events.push(event.type);this['on'+event.type]?.(event);}};
 const context={window:null,document:{body:{},documentElement:{classList:{add(){}}}},CSS:{supports:()=>true},innerWidth:1920,innerHeight:1080,MutationObserver:class {observe(){}},Event:class {constructor(type){this.type=type;}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},EmberAndroid:{command:raw=>commands.push(JSON.parse(raw))},addEventListener(){}};
 context.window=context;
 vm.runInNewContext(fs.readFileSync('platforms/firetv/platform.js','utf8'),context);
 const p=context.EmberPlatform.createPlayer(element);
 const receive=(type,data={})=>context.EmberFireTV.receive({id:commands.findLast(c=>c.action==='load')?.id,type,position:0,duration:120000,paused:false,...data});
 return {p,commands,events,receive,context,parent,element};
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

test('Native media commands keep timeline state, ignore stale sessions and send only explicit metadata',()=>{
 const f=fixture();
 f.p.setMediaInfo({title:'Example',subtitle:'Episode',duration:120000,offset:0,live:false,next:true,previous:false});
 f.p.src='https://media.test/video?api_key=fixture-secret';f.p.load();
 assert.equal(f.commands.find(c=>c.action==='load').media.title,'Example');
 assert(!JSON.stringify(f.commands.find(c=>c.action==='load').media).includes('fixture-secret'));
 f.receive('loadedmetadata',{position:30000,format:{mime:'video/hevc',colorTransfer:6}});
 assert.equal(f.p.nativeFormat().mime,'video/hevc');
 f.receive('media-command',{action:'seek',position:60000});
 assert.equal(f.element.lastEvent.detail.action,'seek');
 assert.equal(f.p.currentTime,30,'A requested seek must not masquerade as acknowledged native progress');
 const old=f.commands.find(c=>c.action==='load').id;
 f.p.src='https://media.test/next';f.p.load();const count=f.events.length;
 f.context.EmberFireTV.receive({id:old,type:'media-command',action:'stop'});
 assert.equal(f.events.length,count,'Commands for a closed player are ignored');
});
test('Fire TV media key forwarding retains key release and repeat state',()=>{
 const f=fixture(),keys=[];
 f.context.KeyboardEvent=class {constructor(type,options){this.type=type;Object.assign(this,options);}};
 f.context.document.activeElement={dispatchEvent:e=>keys.push(e)};
 f.context.EmberFireTV.key(417,'keydown',true);
 f.context.EmberFireTV.key(417,'keyup');
 f.context.EmberFireTV.key(179);
 assert.equal(keys[0].type,'keydown');assert.equal(keys[0].repeat,true);
 assert.equal(keys[1].type,'keyup');assert.equal(keys[1].repeat,false);
 assert.equal(keys[2].type,'keydown');assert.equal(keys[2].keyCode,179);
});
