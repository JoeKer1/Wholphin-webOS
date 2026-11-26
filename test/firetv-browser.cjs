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
   const u=new URL(r.request().url());requests.push({path:u.pathname,term:u.searchParams.get('SearchTerm'),auth:r.request().headers().authorization,body:r.request().postDataJSON()});
   let data={Items:[]};
   if(u.pathname.endsWith('/Views'))data={Items:[{Id:'movies',Name:'Movies',CollectionType:'movies'}]};
   else if(u.pathname.endsWith('/Resume'))data={Items:[movie]};
   else if(u.searchParams.get('SearchTerm')===movie.Name)data={Items:[movie]};
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
   window.systemSyncs=[];window.artworkRequests=[];
   window.EmberAndroid={capabilities:()=>JSON.stringify({videos:[{codec:'h264',width:1920,height:1080,bitDepth:8,frameRate:60,bitrate:40000000,level:42}],audio:['aac','ac3'],maxAudioChannels:6,...(window.dvCapable?{dolbyVisionConversionAvailable:true,videos:[{codec:'hevc',width:3840,height:2160,bitDepth:10}]}:{})}),command(raw){
    const c=JSON.parse(raw);nativeCommands.push(c);
    const event=(type)=>setTimeout(()=>window.EmberFireTV.receive({...nativeState,type,seekStart:0,seekEnd:120000}),0);
    if(c.action==='load'){nativeState={position:0,duration:120000,paused:true,id:c.id};if(window.failNextNativeLoad&&c.url.includes('/stream?')){window.failNextNativeLoad=false;event('error');}else event('loadedmetadata');}
    if(c.action==='tracks')event('trackschanged');
    if(c.action==='play'){nativeState.paused=false;event('play');event('playing');}
    if(c.action==='pause'){nativeState.paused=true;event('pause');}
    if(c.action==='seek'){nativeState.position=c.ms;event('seeked');}
   },
    systemProfile(profile){window.systemProfile=profile;},
    syncWatchNext(raw){window.systemSyncs.push(JSON.parse(raw));},
    takeSystemResume(profile){
     if(window.pendingSystemResume?.profile!==profile)return '';
     const link=window.pendingSystemResume;window.pendingSystemResume=null;return JSON.stringify(link);
    },
    artwork(raw){window.artworkRequests.push(JSON.parse(raw));},
    voiceSearch(id){window.voiceRequestId=id;}
   };
  });
  await page.goto(pathToFileURL(path.resolve('dist/firetv/index.html')).href);
  await page.waitForFunction(()=>systemSyncs.length>0);
  assert.equal(await page.evaluate(()=>systemSyncs[0].items[0].id),'movie');
  assert.equal(await page.evaluate(()=>JSON.stringify(systemSyncs[0].items).includes('token')),false);
  await page.locator('nav [data-nav=search]').click();
  const voice=page.getByRole('button',{name:'Voice search',exact:true});
  await voice.click();
  await page.waitForFunction(()=>window.voiceRequestId===1);
  await page.evaluate(()=>EmberFireTV.voiceSearchResult({id:99,status:'ok',title:'Stale title'}));
  assert.equal(await page.locator('#search').inputValue(),'');
  await page.evaluate(()=>EmberFireTV.voiceSearchResult({id:1,status:'ok',title:'  Fire TV movie  '}));
  await page.getByRole('button',{name:'Fire TV movie',exact:true}).waitFor();
  assert.equal(await page.locator('#search').inputValue(),movie.Name);
  assert.ok(requests.some(r=>r.term===movie.Name));
  const titleSearches = () => requests.filter(r=>r.path==='/Users/user/Items' && r.term===movie.Name).length;
  const beforeCancelledSearch = titleSearches();
  await voice.click();
  await page.waitForFunction(()=>window.voiceRequestId===2);
  await page.evaluate(()=>EmberFireTV.voiceSearchResult({id:2,status:'unavailable',title:''}));
  await page.getByText('This device doesn’t provide voice search to Ember. You can type a title.',{exact:true}).waitFor();
  await voice.click();
  await page.waitForFunction(()=>window.voiceRequestId===3);
  await page.evaluate(()=>EmberFireTV.voiceSearchResult({id:3,status:'cancelled',title:''}));
  await page.locator('button[aria-busy="true"]').filter({hasText:'Voice search'}).waitFor({state:'detached'});
  assert.equal(titleSearches(),beforeCancelledSearch);
  await page.locator('nav [data-nav=home]').click();
  await page.getByRole('button',{name:'Fire TV movie',exact:true}).first().click();
  await page.getByRole('button',{name:/^Resume/}).first().click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='seek'&&c.ms>=30000)&&nativeCommands.some(c=>c.action==='play'));
  assert.ok(requests.some(r=>(r.auth||'').includes('Device="Fire TV"')));
  const native = requests.find(r=>r.body?.DeviceProfile?.Name.startsWith('Fire TV'));
  assert.ok(native.body.EnableDirectPlay && native.body.EnableDirectStream);
  assert.equal(native.body.MaxAudioChannels,6);
  assert.ok(await page.evaluate(()=>nativeCommands.some(c=>c.action==='load'&&c.url.includes('/stream?')&&c.tracks.subtitle===0&&c.tracks.audio===0)));

  await page.waitForFunction(()=>!nativeState.paused);
  const media = await page.evaluate(()=>nativeCommands.find(c=>c.action==='load').media);
  assert.equal(media.title,'Fire TV movie'); assert(!JSON.stringify(media).includes('token'));
  assert.equal(await page.evaluate(()=>artworkRequests[0].item),'movie');
  await page.evaluate(()=>EmberFireTV.receive({...nativeState,type:'timeupdate',diagnostics:{
   bufferMs:12500,state:3,dropped:4,rendered:240,rebufferCount:2,rebufferMs:800,
   videoDecoder:'fixture.decoder',audioDecoder:'fixture.audio',audioMime:'audio/mp4a-latm',audioChannels:2,frameRate:23.976
  }}));
  await page.locator('#player-options').click();
  await page.locator('#playback-info').click();
  await page.getByText('12.5 seconds',{exact:true}).waitFor();
  await page.getByText('4 / 244',{exact:true}).waitFor();
  await page.getByText('fixture.decoder',{exact:true}).waitFor();
  await page.locator('#playback-panel').getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>EmberFireTV.receive({id:nativeState.id,type:'media-command',action:'pause'}));
  await page.waitForFunction(()=>nativeState.paused);
  await page.evaluate(()=>EmberFireTV.receive({id:nativeState.id,type:'media-command',action:'seek',position:45000}));
  await page.waitForFunction(()=>nativeState.position===45000);
  await page.evaluate(()=>EmberFireTV.receive({id:nativeState.id-1,type:'media-command',action:'stop'}));
  assert.equal(await page.locator('#player').isVisible(),true);
  await page.evaluate(()=>EmberFireTV.receive({id:nativeState.id,type:'media-command',action:'play'}));
  await page.waitForFunction(()=>!nativeState.paused);

  const beforeTracks = await page.evaluate(()=>nativeCommands.filter(c=>c.action==='load').length);
  await page.locator('#subtitles').click();
  await page.getByRole('button',{name:'Off',exact:true}).click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='tracks'&&c.tracks.subtitle===-1));
  await page.locator('#playback-panel[hidden]').waitFor({state:'attached'});
  assert.equal(await page.evaluate(()=>nativeCommands.filter(c=>c.action==='load').length),beforeTracks);
  assert.equal(await page.locator('#player').isVisible(),true);
  await page.locator('#subtitles').click();
  await page.getByRole('button',{name:'English · ASS',exact:true}).click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='tracks'&&c.tracks.subtitle===0));
  await page.locator('#playback-panel[hidden]').waitFor({state:'attached'});
  assert.equal(await page.evaluate(()=>nativeCommands.filter(c=>c.action==='load').length),beforeTracks);

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
  await page.evaluate(()=>{
   window.pendingSystemResume={profile:'another-profile',item:'movie'};
   document.dispatchEvent(new Event('ember-system-resume'));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#player').isVisible(),false,'Launcher cannot resume another profile');
  await page.evaluate(()=>{
   window.pendingSystemResume={profile:window.systemProfile,item:'movie'};
   document.dispatchEvent(new Event('ember-system-resume'));
  });
  await page.waitForFunction(()=>!nativeState.paused);
  assert.equal(await page.evaluate(()=>nativeState.position),30000,'Launcher resumes from Jellyfin bookmark');
  await page.evaluate(()=>document.dispatchEvent(new Event('ember-suspend')));
  await page.locator('#player[hidden]').waitFor({state:'attached'});
  assert.ok(await page.evaluate(()=>nativeCommands.some(c=>c.action==='close')));
  await page.locator('nav [data-nav=settings]').click();
  await page.getByRole('button',{name:'HDR formats',exact:true}).click();
  await page.getByRole('button',{name:'HDR10: Automatic',exact:true}).click();
  await page.locator('#setting-options').getByRole('button',{name:'Disabled',exact:true}).click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ember-hdr-options')).hdr10),'off');
  await page.screenshot({path:'/private/tmp/ember-hdr-settings.png'});
  await page.getByRole('button',{name:'Reset HDR formats to Automatic',exact:true}).click();
  await page.evaluate(()=>EmberFireTV.key(27));
  const mode=page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Automatic)',exact:true});
  assert.equal(await mode.isDisabled(),false);
  await mode.click();
  await page.locator("#setting-options").getByRole("button",{name:"Fire TV Media3 (Compatibility)",exact:true}).click();
  assert.ok(await page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Compatibility)',exact:true}).isVisible());
  await page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Compatibility)',exact:true}).click();
  await page.locator("#setting-options").getByRole("button",{name:"Fire TV Media3 (Automatic)",exact:true}).click();
  Object.assign(source.MediaStreams[0],{Codec:'hevc',VideoRangeType:'DOVIWithEL',DvProfile:7,BitDepth:10});
  await page.addInitScript(()=>{window.dvCapable=true;});
  await page.reload();
  await page.locator('nav [data-nav=settings]').click();
  await page.getByRole('button',{name:'HDR formats',exact:true}).click();
  await page.getByRole('button',{name:'Convert Dolby Vision profile 7 (experimental): Off',exact:true}).click();
  await page.evaluate(()=>{window.failNextNativeLoad=true;nativeCommands.length=0;});
  const beforeConversion=requests.length;
  await page.locator('nav [data-nav=home]').click();
  await page.getByRole('button',{name:'Fire TV movie',exact:true}).first().click();
  await page.getByRole('button',{name:/^Resume/}).first().click();
  await page.waitForFunction(()=>nativeCommands.some(c=>c.action==='load'&&c.url.includes('master.m3u8'))&&nativeState.position>=30000&&!nativeState.paused);
  const loads=await page.evaluate(()=>nativeCommands.filter(c=>c.action==='load'));
  assert.equal(loads.length,2);
  assert.ok(loads[0].url.includes('/stream?')&&loads[0].tracks.convertProfile7===true);
  assert.ok(loads[1].url.includes('master.m3u8')&&!loads[1].tracks.convertProfile7);
  const conversion=requests.slice(beforeConversion).find(r=>r.body?.EnableDirectPlay);
  assert.equal(conversion.body.EnableDirectStream,false);
  assert.equal(conversion.body.AllowVideoStreamCopy,false);
  await page.evaluate(()=>document.dispatchEvent(new Event('ember-suspend')));
  await page.locator('#player[hidden]').waitFor({state:'attached'});
  assert.deepEqual(errors,[]);
  console.log('PASS: Fire TV bundled startup, resume, native playback bridge, native ASS selection, direct-play negotiation, position-preserving compatibility fallback, system transport commands, stale-session rejection, private metadata, HDR settings, remote pause, background cleanup and mode switching');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
