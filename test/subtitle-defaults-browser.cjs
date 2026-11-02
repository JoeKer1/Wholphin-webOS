const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{for(const platform of ['webos','tizen','firetv']){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];let language='eng';
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/webapis/webapis.js',r=>r.fulfill({body:''}));
  const source=()=>({Id:'source',DefaultAudioStreamIndex:1,DefaultSubtitleStreamIndex:-1,MediaStreams:[{Type:'Video',Index:0,Codec:'h264'},{Type:'Audio',Index:1,Codec:'aac',Language:language},{Type:'Subtitle',Index:2,Codec:'subrip',Language:'eng'}]});
  const movie=()=>({Id:'movie',Name:'Subtitle test',Type:'Movie',MediaType:'Video',RunTimeTicks:6000000000,MediaSources:[source()],UserData:{}});
  await page.route('https://jellyfin.test/**',r=>{const u=new URL(r.request().url());let data={Items:[]};if(u.pathname.endsWith('/Resume'))data={Items:[movie()]};if(u.pathname.endsWith('/Items/movie'))data=movie();if(u.pathname.includes('/PlaybackInfo'))data={MediaSources:[source()]};return r.fulfill({json:data});});
  await page.addInitScript(()=>{if(!localStorage.getItem('wholphin-session'))localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'one',token:'fixture',name:'One'}));});
  await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);
  async function settings(){await page.locator('nav [data-nav=settings]').click();await page.getByRole('button',{name:'Subtitle defaults',exact:true}).click();}
  async function picker(){await page.locator('nav [data-nav=home]').click();await page.getByRole('button',{name:'Subtitle test',exact:true}).first().click();await page.locator('#detail-subtitles').waitFor();}
  await settings();
  await page.getByRole('button',{name:'Default subtitles: Remember last choice',exact:true}).click();
  await page.locator('#setting-options').getByRole('button',{name:'Preferred language when available',exact:true}).click();
  await page.screenshot({path:`/private/tmp/ember-subtitle-defaults-${platform}.png`});
  await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'2');
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wholphin-session'));s.user='two';localStorage.setItem('wholphin-session',JSON.stringify(s));});
  await page.reload();await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'-1','Profile two does not inherit subtitles from profile one');
  language='jpn';await page.reload();await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'2','Non-English default audio enables English subtitles');
  await settings();await page.getByRole('button',{name:'English for non-English audio: On',exact:true}).click();await page.locator('#setting-options').getByRole('button',{name:'Off',exact:true}).click();
  await picker();assert.equal(await page.locator('#detail-subtitles').evaluate(n=>n.value),'-1');
  assert.deepEqual(errors,[]);console.log(`PASS ${platform}: explicit language default, profile isolation, non-English audio and opt-out`);await page.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
