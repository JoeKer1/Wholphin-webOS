const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const maker=await browser.newPage();
 const sprite=Buffer.from(await maker.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');['#ff0000','#00ff00','#0000ff','#ffff00'].forEach((color,i)=>{x.fillStyle=color;x.fillRect(i%2*160,Math.floor(i/2)*90,160,90);});return c.toDataURL('image/png').split(',')[1];}),'base64');await maker.close();
 try{for(const platform of ['webos','tizen','firetv']){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],images=[];
  let mode='normal',release=null,foreign=0;
  page.on('pageerror',e=>errors.push(e.message));
  const info={Width:160,Height:90,TileWidth:2,TileHeight:2,ThumbnailCount:181,Interval:10000};
  const movie=()=>({Id:'movie',Name:'Trickplay movie',Type:'Movie',MediaType:'Video',RunTimeTicks:18000000000,Chapters:[],Trickplay:mode==='missing'?null:{[mode==='wrong-version'?'other':'source']:{160:info}},MediaSources:[],UserData:{}});
  await page.route('**/webapis/webapis.js',r=>r.fulfill({body:''}));
  await page.route('https://foreign.test/**',r=>{foreign++;return r.abort();});
  await page.route('https://jellyfin.test/**',async r=>{
   const u=new URL(r.request().url());let json={Items:[]};
   if(u.pathname.endsWith('/Resume'))json={Items:[movie()]};
   else if(u.pathname==='/Users/user/Items/movie')json=movie();
   else if(u.pathname.includes('/Trickplay/')){
    assert.equal(u.searchParams.get('mediaSourceId'),'source');assert(!u.searchParams.has('api_key'));assert.match(r.request().headers().authorization,/fixture/);images.push(u.pathname);
    if(mode==='late')await new Promise(resolve=>{release=resolve;});
    if(mode==='oversized')return r.fulfill({contentType:'image/png',headers:{'content-length':'8388609'},body:sprite}).catch(()=>{});
    if(mode==='invalid-image')return r.fulfill({contentType:'application/json',body:'{}'});
    if(mode==='broken')return r.fulfill({status:404,body:''});
    if(mode==='redirect')return r.fulfill({status:302,headers:{location:'https://foreign.test/tile.jpg'}});
    return r.fulfill({contentType:'image/png',body:sprite}).catch(()=>{});
   }else if(u.pathname.endsWith('/PlaybackInfo'))json={PlaySessionId:'fixture',MediaSources:[{Id:'source',Container:'mkv',MediaStreams:[],DefaultSubtitleStreamIndex:-1,SupportsDirectPlay:false,TranscodingUrl:'/Videos/mock/master.m3u8'}]};
   else if(u.pathname.startsWith('/Sessions/')||u.pathname.endsWith('/ActiveEncodings'))return r.fulfill({status:204});
   return r.fulfill({json});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'user',token:'fixture',name:'Test'}));
   let adapter;Object.defineProperty(window,'EmberPlatform',{get:()=>adapter,set:value=>{value.createPlayer=element=>element;value.nativePlayback=false;delete value.playbackPolicy;adapter=value;}});
   const p=HTMLMediaElement.prototype;
   Object.defineProperties(p,{src:{get(){return this._src||'';},set(v){this._src=v;this._time=0;this._generation=(this._generation||0)+1;}},currentTime:{get(){return this._time||0;},set(v){this._seeks=(this._seeks||[]).concat(v);this._seeking=true;const gen=this._generation;setTimeout(()=>{if(gen!==this._generation)return;this._time=v;this._seeking=false;this.dispatchEvent(new Event('seeked'));},80);}},duration:{get(){return 1800;}},readyState:{get(){return 4;}},seeking:{get(){return !!this._seeking;}},paused:{get(){return !this._playing;}}});
   p.load=function(){if(this._src)setTimeout(()=>this.dispatchEvent(new Event('loadedmetadata')),0);};p.play=function(){this._playing=true;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve();};p.pause=function(){this._playing=false;this.dispatchEvent(new Event('pause'));};
   const remove=Element.prototype.removeAttribute;p.removeAttribute=function(name){if(name==='src')this._src='';return remove.call(this,name);};
  });
  async function key(code,phase='keydown',repeat=false){await page.evaluate(({platform,code,phase,repeat})=>{if(platform==='firetv')EmberFireTV.key(code,phase,repeat);else document.dispatchEvent(new KeyboardEvent(phase,{keyCode:code,repeat,bubbles:true,cancelable:true}));},{platform,code,phase,repeat});}
  async function tap(code){await key(code);await key(code,'keyup');}
  async function hide(){for(let i=0;i<3&&await page.locator('#controls').getAttribute('aria-hidden')!=='true';i++)await tap(27);}
  async function open(){await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);await page.getByRole('button',{name:'Trickplay movie',exact:true}).first().click();await page.getByRole('button',{name:'Play from beginning',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#video')._playing);await page.waitForTimeout(100);await page.locator('#video').evaluate(v=>{v._time=25;v.dispatchEvent(new Event('timeupdate'));});await hide();}
  await open();await tap(39);
  await page.locator('#seek-preview').waitFor({state:'visible'});
  assert.equal(await page.locator('#seek-target').textContent(),'0:35');
  assert.deepEqual(await page.locator('#seek-thumbnail').evaluate(c=>Array.from(c.getContext('2d').getImageData(100,100,1,1).data)),[255,255,0,255],'Crop the correct row and column from the sprite');
  assert.equal(images.filter(x=>x.endsWith('/0.jpg')).length,1);
  await tap(37);await page.waitForFunction(()=>document.querySelector('#video').currentTime===25);
  assert.equal(images.length,1,'Adjacent frames reuse the sheet');
  assert.deepEqual(await page.locator('#seek-thumbnail').evaluate(c=>Array.from(c.getContext('2d').getImageData(100,100,1,1).data)),[0,0,255,255]);
  await tap(417);await page.waitForFunction(()=>document.querySelector('#seek-thumbnail').dataset.sheet==='1');
  assert.equal(await page.locator('#controls').getAttribute('aria-hidden'),'true');
  await page.waitForTimeout(200);
  await page.screenshot({path:'/private/tmp/ember-trickplay-'+platform+'.png'});
  await page.locator('#timeline').evaluate(n=>{n.value='165';n.dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>document.querySelector('#seek-thumbnail').dataset.sheet==='4');
  assert.equal(await page.locator('#seek-feedback').evaluate(n=>n.classList.contains('is-timeline')),true);
  assert.equal(await page.locator('#seek-target').textContent(),'2:45');
  // Keep timers real while controlling elapsed hold duration, including repeat throttling.
  await page.locator('#timeline').evaluate(n=>{n.value='60';n.dispatchEvent(new Event('input'));});await page.waitForFunction(()=>document.querySelector('#video').currentTime===60);await hide();
  await page.evaluate(()=>{window.realSeekNow=Date.now;window.seekClock=0;Date.now=()=>realSeekNow()+seekClock;});
  await key(39);let previous=await page.locator('#video').evaluate(v=>v._seeks.at(-1));
  for(const step of [500,500,300]){await page.evaluate(n=>{seekClock+=n;},step);await key(39,'keydown',true);}
  let current=await page.locator('#video').evaluate(v=>v._seeks.at(-1));assert.equal(current-previous,50,'Hold enters the 30-second stage after the initial repeats');
  for(const step of [500,500,500,200]){await page.evaluate(n=>{seekClock+=n;},step);previous=await page.locator('#video').evaluate(v=>v._seeks.at(-1));await key(39,'keydown',true);}
  current=await page.locator('#video').evaluate(v=>v._seeks.at(-1));assert.equal(current-previous,60,'Long holds reach the bounded 60-second stage');
  await key(39,'keyup');previous=current;await tap(39);await page.waitForTimeout(160);current=await page.locator('#video').evaluate(v=>v._seeks.at(-1));assert.equal(current-previous,10,'Releasing resets acceleration');
  await page.evaluate(()=>{Date.now=realSeekNow;});
  await page.locator('#video').evaluate(v=>v.pause());await hide();await tap(37);await page.waitForTimeout(100);assert.equal(await page.locator('#video').evaluate(v=>v.paused),true);
  mode='normal';await open();
  await page.evaluate(()=>Object.defineProperty(Response.prototype,'body',{configurable:true,get(){return null;}}));
  await tap(39);await page.locator('#seek-preview').waitFor({state:'visible'});
  for(const fallback of ['missing','wrong-version','broken','redirect','oversized','invalid-image']){
   mode=fallback;const count=images.length;await open();await tap(39);await page.waitForTimeout(300);
   assert.equal(await page.locator('#seek-preview').isHidden(),true);assert.equal(await page.locator('#seek-target').textContent(),'0:35');
   assert.equal(await page.locator('#seek-feedback').isVisible(),true,'Missing thumbnails keep the normal feedback');
   if(fallback==='missing'||fallback==='wrong-version')assert.equal(images.length,count);
  }
  assert.equal(foreign,0,'Authenticated thumbnail fetches never follow off-server redirects');
  release=null;mode='late';await open();await tap(39);for(let i=0;i<100&&!release;i++)await page.waitForTimeout(10);assert(release);
  await tap(417);mode='normal';release();
  await page.waitForFunction(()=>document.querySelector('#seek-thumbnail').dataset.sheet==='1'&&!document.querySelector('#seek-preview').hidden);
  assert.deepEqual(await page.locator('#seek-thumbnail').evaluate(c=>Array.from(c.getContext('2d').getImageData(100,100,1,1).data)),[0,0,255,255],'A delayed old sheet cannot show the wrong scene for the current target');
  release=null;mode='late';await open();await tap(39);for(let i=0;i<100&&!release;i++)await page.waitForTimeout(10);assert(release);
  await tap(413);await page.waitForSelector('body:not(.is-playing)');mode='normal';
  await page.getByRole('button',{name:'Play from beginning',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#video')._playing);
  release();await page.waitForTimeout(200);assert.equal(await page.locator('#seek-preview').isHidden(),true,'Late images cannot leak into new playback');
  assert.deepEqual(errors,[]);console.log('PASS '+platform+': authenticated sprites, crop/sheet/cache, timeline preview, hold/release acceleration, paused seek, fallback/version matching, redirects and source cleanup');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
