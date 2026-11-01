const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1920,height:1080}}), errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const source={Id:'source',Container:'mkv',DefaultAudioStreamIndex:3,DefaultSubtitleStreamIndex:9,MediaStreams:[{Type:'Video',Index:0,Codec:'h264',VideoRangeType:'SDR',Width:1920,Height:1080,BitDepth:8},{Type:'Audio',Index:3,Codec:'aac',Language:'eng',DisplayTitle:'English stereo'},{Type:'Audio',Index:7,Codec:'ac3',Language:'spa',DisplayTitle:'Spanish surround'},{Type:'Subtitle',Index:9,Codec:'ass',IsExternal:false,Language:'eng',DisplayTitle:'English ASS'}]};
 const movie={Id:'movie',Name:'Fire TV movie',Type:'Movie',MediaType:'Video',RunTimeTicks:1200000000,UserData:{PlaybackPositionTicks:300000000},ImageTags:{},MediaSources:[source]};
  await page.route('https://jellyfin.test/**',r=>{
   const u=new URL(r.request().url());requests.push({path:u.pathname,auth:r.request().headers().authorization,body:r.request().postDataJSON()});
   let data={Items:[]};
   if(u.pathname.endsWith('/Views'))data={Items:[{Id:'movies',Name:'Movies',CollectionType:'movies'}]};
   else if(u.pathname.endsWith('/Resume'))data={Items:[movie]};
   else if(u.pathname.endsWith('/Items/movie'))data=movie;
   else if(u.pathname.endsWith('/PlaybackInfo')){
    const body=r.request().postDataJSON(), direct=body?.DeviceProfile?.Name.startsWith('Fire TV');
    data={PlaySessionId:'session',MediaSources:[{...source,SupportsDirectPlay:!!direct,...(!direct?{TranscodingUrl:'/Videos/movie/master.m3u8?api_key=token',TranscodingContainer:'ts'}:{})}]};
   }
   return r.fulfill({json:data});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'user',token:'token',name:'Joe'}));
   window.nativeCommands=[];window.nativeState={position:0,duration:120000,paused:true,id:0};
   window.EmberAndroid={capabilities:()=>JSON.stringify({videos:[{codec:'h264',width:1920,height:1080,bitDepth:8,frameRate:60,bitrate:40000000,level:42}],audio:['aac','ac3'],maxAudioChannels:6}),command(raw){
    const c=JSON.parse(raw);nativeCommands.push(c);
    const event=(type)=>setTimeout(()=>window.EmberFireTV.receive({...nativeState,type,seekStart:0,seekEnd:120000}),0);
    if(c.action==='load'){nativeState={position:0,duration:120000,paused:true,id:c.id};if(window.failNextNativeLoad&&c.url.includes('/stream?')){window.failNextNativeLoad=false;event('error');}else event('loadedmetadata');}
    if(c.action==='play'){nativeState.paused=false;event('play');event('playing');}
    if(c.action==='pause'){nativeState.paused=true;event('pause');}
    if(c.action==='seek'){nativeState.position=c.ms;event('seeked');}
   }};
  });
  await page.goto(pathToFileURL(path.resolve('dist/firetv/index.html')).href);
  await page.getByRole('button',{name:'Fire TV movie',exact:true}).first().click();
  await page.getByRole('button',{name:/^Resume/}).first().click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='seek'&&c.ms>=30000)&&nativeCommands.some(c=>c.action==='play'));
  assert.ok(requests.some(r=>(r.auth||'').includes('Device="Fire TV"')));
  const native = requests.find(r=>r.body?.DeviceProfile?.Name.startsWith('Fire TV'));
  assert.ok(native.body.EnableDirectPlay && native.body.EnableDirectStream);
  assert.equal(native.body.MaxAudioChannels,6);
  assert.ok(await page.evaluate(()=>nativeCommands.some(c=>c.action==='load'&&c.url.includes('/stream?')&&c.tracks.subtitle===0&&c.tracks.audio===0)));

  assert.equal(await page.locator('#player').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.evaluate(()=>EmberFireTV.key(457));
  assert.ok(await page.locator("#player-tools").isVisible());
  await page.locator('#audio').click();
  await page.getByRole('button',{name:'Spanish surround',exact:true}).click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='load'&&c.tracks.audio===1));
  assert.ok(requests.some(r=>r.body?.AudioStreamIndex===7&&r.body.EnableDirectPlay));

  await page.waitForFunction(()=>!nativeState.paused);
  await page.evaluate(()=>EmberFireTV.key(457));
  await page.evaluate(()=>EmberFireTV.key(27));
  await page.locator("#player-tools[hidden]").waitFor({state:"attached"});
  await page.evaluate(()=>EmberFireTV.key(179));
  await page.waitForFunction(()=>nativeState.paused);

  await page.evaluate(()=>{nativeState.position=35000;EmberFireTV.receive({...nativeState,type:'timeupdate'});EmberFireTV.receive({...nativeState,type:'error'});});
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='load'&&c.url.includes('master.m3u8')));
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='seek'&&c.ms>=35000));
  assert.ok(requests.some(r=>r.body?.DeviceProfile?.Name==='Ember (H.264 / AAC)'&&r.body.EnableDirectPlay===false));
  assert.equal(await page.evaluate(()=>nativeCommands.findLast(c=>c.action==='load').tracks.subtitle),-1);
  assert.equal(await page.evaluate(()=>nativeState.paused),true);
  assert.ok(requests.some(r=>r.body?.DeviceProfile?.Name==='Ember (H.264 / AAC)'&&r.body.AudioStreamIndex===7));
  await page.evaluate(()=>document.dispatchEvent(new Event('ember-suspend')));
  await page.locator('#player[hidden]').waitFor({state:'attached'});
  assert.ok(await page.evaluate(()=>nativeCommands.some(c=>c.action==='close')));
  await page.locator('nav [data-nav=settings]').click();
  const mode=page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Automatic)',exact:true});
  assert.equal(await mode.isDisabled(),false);
  await mode.click();
  assert.ok(await page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Compatibility)',exact:true}).isVisible());
  await page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Compatibility)',exact:true}).click();
  await page.evaluate(()=>{window.failNextNativeLoad=true;nativeCommands.length=0;});
  await page.locator('nav [data-nav=home]').click();
  await page.getByRole('button',{name:'Fire TV movie',exact:true}).first().click();
  await page.getByRole('button',{name:/^Resume/}).first().click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='load'&&c.url.includes('master.m3u8'))&&nativeState.position>=30000&&!nativeState.paused);
  assert.ok(await page.evaluate(()=>nativeCommands.some(c=>c.action==='load'&&c.url.includes('/stream?'))));
  await page.evaluate(()=>document.dispatchEvent(new Event('ember-suspend')));
  await page.locator('#player[hidden]').waitFor({state:'attached'});
  assert.deepEqual(errors,[]);
  console.log('PASS: Fire TV bundled startup, resume, native playback bridge, native ASS selection, direct-play negotiation, position-preserving compatibility fallback, remote pause, background cleanup and mode switching');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
