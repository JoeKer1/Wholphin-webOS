const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try {for(const scenario of ['direct','audio-remux','explicit-compatibility','startup-error','decoder-error']){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),infos=[],starts=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const source={Id:'source',Container:'mkv',DefaultAudioStreamIndex:1,DefaultSubtitleStreamIndex:2,MediaStreams:[
   {Type:'Video',Index:0,Codec:'hevc',Profile:'Main 10',Level:93,Width:1280,Height:720,BitDepth:10,RealFrameRate:23.976025,VideoRangeType:'SDR'},
   {Type:'Audio',Index:1,Codec:scenario==='audio-remux'?'dts':'aac',Profile:'LC',Channels:2,Language:'eng'},
   {Type:'Audio',Index:3,Codec:'aac',Profile:'LC',Channels:2,Language:'jpn',DisplayTitle:'Japanese'},
   {Type:'Subtitle',Index:2,Codec:'ass',Language:'eng',DisplayTitle:'English'}]};
  const item={Id:'episode',Name:'LG HEVC regression',Type:'Movie',MediaType:'Video',RunTimeTicks:18000000000,MediaSources:[source],Chapters:[]};
  await page.route('https://jellyfin.test/**',r=>{
   const u=new URL(r.request().url()),body=r.request().postDataJSON();let json={Items:[]};
   if(u.pathname.endsWith('/Resume'))json={Items:[item]};
   else if(u.pathname==='/Users/user/Items/episode')json=item;
   else if(u.pathname.includes('/Subtitles/'))return r.fulfill({contentType:'text/vtt',body:'WEBVTT\n\n00:00:05.000 --> 00:00:10.000\nAligned subtitle\n'});
   else if(u.pathname.endsWith('/PlaybackInfo')){
    if(body)infos.push(body);
    const native=!!body&&body.DeviceProfile.Name.includes('C1');
    const direct=native&&scenario!=='audio-remux'&&body.EnableDirectPlay;
    json={PlaySessionId:'fixture',MediaSources:[{...source,SupportsDirectPlay:direct,SupportsDirectStream:native&&!direct,TranscodingUrl:'/Videos/episode/master.m3u8?VideoCodec='+(native?'copy':'h264')}]};
   } else if(u.pathname==='/Sessions/Playing')starts.push(body);
   if(u.pathname.startsWith('/Sessions/')||u.pathname.endsWith('/ActiveEncodings'))return r.fulfill({status:204});
   return r.fulfill({json});
  });
  await page.addInitScript(({scenario})=>{
   localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'user',token:'fixture'}));
   // Use the same per-video correction as the real LG case; never a global offset.
   localStorage.setItem('wholphin-subtitle-timing:https://jellyfin.test:user',JSON.stringify({
    '["episode","source",[false,0,"",false,false],"ass","eng"]':{delay:-3,updated:1}
   }));
   if(scenario==='explicit-compatibility')localStorage.setItem('wholphin-decoder-options:https://jellyfin.test:user',JSON.stringify({native:false}));
   const p=HTMLMediaElement.prototype;
   Object.defineProperties(p,{src:{get(){return this._src||'';},set(v){this._src=v;this._time=0;}},currentTime:{get(){return this._time||0;},set(v){this._time=v;setTimeout(()=>this.dispatchEvent(new Event('seeked')),0);}},duration:{get(){return 1800;}},readyState:{get(){return 4;}},seeking:{get(){return false;}},paused:{get(){return !this._playing;}}});
   p.load=function(){if(!this._src)return;if(scenario==='startup-error'&&!window.failedOnce&&this._src.includes('/stream?')){window.failedOnce=true;this.dispatchEvent(new Event('error'));return;}setTimeout(()=>this.dispatchEvent(new Event('loadedmetadata')),0);};
   p.play=function(){this._playing=true;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve();};
   p.pause=function(){this._playing=false;this.dispatchEvent(new Event('pause'));};
   const remove=Element.prototype.removeAttribute;p.removeAttribute=function(n){if(n==='src')this._src='';return remove.call(this,n);};
  },{scenario});
  await page.goto(pathToFileURL(path.resolve('dist/webos/index.html')).href);
  await page.getByRole('button',{name:'LG HEVC regression',exact:true}).first().click();
  await page.getByRole('button',{name:'Play from beginning',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#video')._playing);
  async function wait(fn){for(let i=0;i<250;i++){if(fn())return;await page.waitForTimeout(20);}throw Error('Condition not met: '+scenario);}
  await wait(()=>starts.length>0);
  const first=infos[0];
  assert.equal(first.SubtitleStreamIndex,-1,'Local ASS must not request burn-in');
  assert.equal(first.MediaSourceId,'source','Pin the video source to the one used to extract local subtitle timestamps');
  assert.equal(first.AllowVideoStreamCopy,true);
  if(scenario==='explicit-compatibility')assert.equal(first.EnableDirectStream,false);
  else{
   assert.equal(first.EnableDirectPlay,true,'Local subtitles and their preference must not force a remux');
   assert.equal(first.EnableDirectStream,true);
   assert(first.DeviceProfile.DirectPlayProfiles.some(p=>p.Container.split(',').includes('mkv')));
  }
  if(scenario==='direct'){
   assert.match(await page.locator('#video').evaluate(v=>v.src),/\/stream\?/);
   await page.locator('#video').evaluate(v=>{v.currentTime=2;v.dispatchEvent(new Event('timeupdate'));});
   await page.waitForFunction(()=>!document.querySelector('#subtitle-overlay').hidden);
   assert.match(await page.locator('#subtitle-overlay').textContent(),/Aligned subtitle/,'Per-track -3s correction remains effective during direct play');
   await page.locator('#player-options').click();await page.locator('#audio').click();
   await page.getByRole('button',{name:'Japanese',exact:true}).click();
   await wait(()=>infos.length===2&&starts.length===2);
   assert.equal(infos[1].EnableDirectPlay,false,'Non-default audio must remux rather than silently play the default track');
   assert.equal(infos[1].EnableDirectStream,true);assert.equal(infos[1].AllowVideoStreamCopy,true);assert.equal(infos[1].AudioStreamIndex,3);
  }
  if(scenario==='audio-remux')assert.match(await page.locator('#video').evaluate(v=>v.src),/VideoCodec=copy/);
  if(scenario==='decoder-error'){
   await page.locator('#video').evaluate(v=>{v.currentTime=321;v.dispatchEvent(new Event('timeupdate'));v.dispatchEvent(new Event('error'));});
   await wait(()=>infos.length===2&&starts.length===2);
   assert.equal(infos[1].StartTimeTicks,3210000000);
  }
  if(scenario==='startup-error'||scenario==='decoder-error'){
   await wait(()=>infos.length===2);
   assert.equal(infos[1].AllowVideoStreamCopy,false,'A failed native decoder must retry with actual H.264 conversion');
   assert.equal(infos[1].EnableDirectStream,false);assert.equal(infos[1].SubtitleStreamIndex,-1);
   await page.locator('#video').evaluate(v=>v.dispatchEvent(new Event('error')));
   await page.waitForSelector('body:not(.is-playing)');assert.equal(infos.length,2,'Compatibility failures do not retry forever');
  }
  assert.deepEqual(errors,[]);console.log('PASS LG '+scenario);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
