const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});try{
 for(const platform of ['webos','tizen','firetv']){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[],requests=[];let anime=true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/webapis/webapis.js',r=>r.fulfill({body:''}));
  const source={Id:'source',DefaultAudioStreamIndex:1,DefaultSubtitleStreamIndex:-1,MediaStreams:[{Type:'Video',Index:0,Codec:'h264'},{Type:'Audio',Index:1,Codec:'aac',Language:'eng'},{Type:'Audio',Index:3,Codec:'aac',Language:'jpn'},{Type:'Subtitle',Index:2,Codec:'subrip',Language:'eng'}]};
  const movie={Id:'movie',Name:'Anime test',Type:'Movie',MediaType:'Video',RunTimeTicks:6000000000,MediaSources:[source],UserData:{}};
  await page.route('https://jellyfin.test/**',r=>{const u=new URL(r.request().url());requests.push(u.pathname);let data={Items:[]};if(u.pathname.endsWith('/Views'))data={Items:[{Id:'anime',Name:'Anime',CollectionType:'tvshows'}]};if(u.pathname.endsWith('/Resume'))data={Items:[movie]};if(u.pathname.endsWith('/Items/movie'))data=movie;if(u.pathname.endsWith('/Ancestors'))data=[{Id:anime?'anime':'tv',Name:anime?'Anime':'TV',Type:'CollectionFolder'}];if(u.pathname.includes('/PlaybackInfo'))data={MediaSources:[source]};return r.fulfill({json:data});});
  await page.addInitScript(()=>{if(!localStorage.getItem('wholphin-session'))localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'one',token:'fixture',name:'One'}));});
  await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);
  async function settings(){await page.locator('nav [data-nav=settings]').click();await page.getByRole('button',{name:'Subtitle defaults',exact:true}).waitFor();}
  async function picker(){await page.locator('nav [data-nav=home]').click();await page.getByRole('button',{name:'Anime test',exact:true}).first().click();await page.waitForFunction(()=>document.getElementById('detail-subtitles')&&!document.getElementById('detail-subtitles').disabled);}
  await settings();await page.getByRole('button',{name:'Anime audio language: Use normal audio preference',exact:true}).click();await page.locator('#setting-options').getByRole('button',{name:'Japanese',exact:true}).click();
  await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'2','Japanese anime audio enables English subtitles');assert.ok(requests.includes('/Items/movie/Ancestors'));
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wholphin-session'));s.user='two';localStorage.setItem('wholphin-session',JSON.stringify(s));});await page.reload();await settings();assert.equal(await page.getByRole('button',{name:'Anime audio language: Use normal audio preference',exact:true}).count(),1);await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'-1','Other profile retains English audio and no subtitles');
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wholphin-session'));s.user='one';localStorage.setItem('wholphin-session',JSON.stringify(s));});anime=false;await page.reload();await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'-1','Ordinary TV does not inherit anime audio preference');
  assert.deepEqual(errors,[]);console.log(`PASS ${platform}: profile anime language, ancestry resolution, English subtitles and ordinary-TV isolation`);await page.close();
 }
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
