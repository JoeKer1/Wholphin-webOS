const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {
  const page=await browser.newPage({viewport:{width:1920,height:1080}}), errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const movie={Id:'movie',Name:'Fire TV movie',Type:'Movie',MediaType:'Video',RunTimeTicks:1200000000,UserData:{PlaybackPositionTicks:300000000},ImageTags:{},MediaSources:[{Id:'source',MediaStreams:[]}]};
  await page.route('https://jellyfin.test/**',r=>{
   const u=new URL(r.request().url());requests.push({path:u.pathname,auth:r.request().headers().authorization});
   let data={Items:[]};
   if(u.pathname.endsWith('/Views'))data={Items:[{Id:'movies',Name:'Movies',CollectionType:'movies'}]};
   else if(u.pathname.endsWith('/Resume'))data={Items:[movie]};
   else if(u.pathname.endsWith('/Items/movie'))data=movie;
   else if(u.pathname.endsWith('/PlaybackInfo'))data={PlaySessionId:'session',MediaSources:[{Id:'source',TranscodingUrl:'/Videos/movie/master.m3u8?api_key=token',TranscodingContainer:'ts'}]};
   return r.fulfill({json:data});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'user',token:'token',name:'Joe'}));
   window.nativeCommands=[];window.nativeState={position:0,duration:120000,paused:true,id:0};
   window.EmberAndroid={command(raw){
    const c=JSON.parse(raw);nativeCommands.push(c);
    const event=(type)=>setTimeout(()=>window.EmberFireTV.receive({...nativeState,type,seekStart:0,seekEnd:120000}),0);
    if(c.action==='load'){nativeState={position:0,duration:120000,paused:true,id:c.id};event('loadedmetadata');}
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
  assert.equal(await page.locator('#player').evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.evaluate(()=>EmberFireTV.key(457));
  assert.ok(await page.locator("#player-tools").isVisible());
  await page.evaluate(()=>EmberFireTV.key(27));
  await page.locator("#player-tools[hidden]").waitFor({state:"attached"});
  await page.evaluate(()=>EmberFireTV.key(179));
  await page.waitForFunction(()=>nativeState.paused);
  await page.evaluate(()=>document.dispatchEvent(new Event('ember-suspend')));
  await page.locator('#player[hidden]').waitFor({state:'attached'});
  assert.ok(await page.evaluate(()=>nativeCommands.some(c=>c.action==='close')));
  await page.locator('nav [data-nav=settings]').click();
  assert.ok(await page.getByRole('button',{name:'Playback mode: Fire TV Media3 (Compatibility)',exact:true}).isDisabled());
  assert.deepEqual(errors,[]);
  console.log('PASS: Fire TV bundled startup, resume, native playback bridge, remote pause, background cleanup and platform settings');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
