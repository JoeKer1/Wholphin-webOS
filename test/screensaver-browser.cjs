const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}: {})});
  try {
    for (const platform of ['webos','tizen','firetv']) {
      const page = await browser.newPage({viewport:{width:1920,height:1080}}), errors=[], requests=[];
      let artworkFailure=false;
      const source={Id:'idle-source',Container:'mp4',SupportsDirectPlay:true,TranscodingUrl:'/Videos/idle-movie/master.m3u8',MediaStreams:[{Type:'Video',Index:0,Codec:'h264',Width:1920,Height:1080},{Type:'Audio',Index:1,Codec:'aac'}]};
      const movie={Id:'idle-movie',Name:'Idle test movie',Type:'Movie',MediaType:'Video',RunTimeTicks:6000000000,ImageTags:{Primary:'p'},MediaSources:[source],UserData:{}};
      page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install();
      await page.route('**/webapis/webapis.js',r=>r.fulfill({body:''}));
      await page.route('https://jellyfin.test/**',r=>{
        const url=new URL(r.request().url()); requests.push(url);
        if(artworkFailure && url.searchParams.get('ImageTypes')==='Backdrop') return r.fulfill({status:500,json:{}});
        if (url.pathname.endsWith('/Resume')) return r.fulfill({json:{Items:[movie]}});
        if (url.pathname.endsWith('/Items/idle-movie')) return r.fulfill({json:movie});
        if (url.pathname.includes('/PlaybackInfo')) return r.fulfill({json:{PlaySessionId:'idle-test',MediaSources:[source]}});
        if (url.pathname.includes('/Images/')) return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
        return r.fulfill({json:url.searchParams.get('ImageTypes')==='Backdrop' ? {Items:[{Id:'art1',Name:'First movie',BackdropImageTags:['b']},{Id:'art2',Name:'Second show',BackdropImageTags:['b']}]} : {Items:[]}});
      });
      await page.addInitScript(()=>{if(!localStorage.getItem('wholphin-session'))localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'user',token:'fixture',name:'Joe'}));});
      if(platform==='webos') await page.addInitScript(()=>{
        const p=HTMLMediaElement.prototype;
        Object.defineProperties(p,{src:{get(){return this._src||''},set(v){this._src=v}},currentTime:{get(){return this._time||0},set(v){this._time=v;setTimeout(()=>this.dispatchEvent(new Event('seeked')),0)}},duration:{get(){return 600}},readyState:{get(){return 4}},paused:{get(){return !this._playing}},seeking:{get(){return false}}});
        p.load=function(){if(this._src)setTimeout(()=>this.dispatchEvent(new Event('loadedmetadata')),0)};
        p.play=function(){this._playing=true;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));return Promise.resolve()};
        p.pause=function(){this._playing=false;this.dispatchEvent(new Event('pause'))};
      });
      await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);
      await page.locator('nav [data-nav=settings]').click();
      await page.getByRole('button',{name:'Screensaver',exact:true}).click();
      const preview=page.getByRole('button',{name:'Preview screensaver',exact:true});
      await page.screenshot({path:`/private/tmp/ember-screensaver-settings-${platform}.png`});
      await preview.click();
      await page.locator('#screensaver .saver-visible').waitFor();
      assert.equal(await page.locator('#main').getAttribute('aria-hidden'),'true');
      assert.equal(await page.locator('#screensaver .saver-title').textContent(),'First movie');
      await page.clock.fastForward(31000);
      await page.waitForFunction(()=>document.querySelector('.saver-title').textContent==='Second show');
      const dismiss = async()=>{
        if(platform==='firetv')await page.evaluate(()=>EmberFireTV.key(27));
        else await page.locator('#screensaver').evaluate((n,code)=>n.dispatchEvent(new KeyboardEvent('keydown',{keyCode:code,bubbles:true,cancelable:true})),platform==='tizen'?10009:461);
      };
      await dismiss();
      assert.equal(await page.locator('#screensaver').count(),0);
      assert.ok(await preview.evaluate(n=>n===document.activeElement),'Wake returns focus to the opener');
      await page.clock.fastForward(500);
      await page.getByRole('button',{name:'Moving clock: Off',exact:true}).click();
      await page.locator('#setting-options').getByRole('button',{name:'On',exact:true}).click();
      await preview.click();
      assert.equal(await page.locator('.saver-clock').isVisible(),true);
      await dismiss();
      await page.clock.fastForward(500);
      await page.getByRole('button',{name:'Start after: 5 minutes',exact:true}).click();
      await page.locator('#setting-options').getByRole('button',{name:'2 minutes',exact:true}).click();
      await page.clock.fastForward(121000);
      await page.locator('#screensaver').waitFor();
      await dismiss();
      await page.clock.fastForward(500);
      await page.getByRole('button',{name:'Screensaver: On',exact:true}).click();
      await page.locator('#setting-options').getByRole('button',{name:'Off',exact:true}).click();
      await page.clock.fastForward(121000);
      assert.equal(await page.locator('#screensaver').count(),0,'Disabled screensaver does not start');
      await preview.click();
      await page.evaluate(()=>document.dispatchEvent(new Event('ember-suspend')));
      assert.equal(await page.locator('#screensaver').count(),0,'Suspend clears the overlay');
      await page.clock.fastForward(500);
      artworkFailure=true;
      await preview.click();
      await page.clock.fastForward(1000);
      assert.equal(await page.locator('.saver-title').textContent(),'Ember', 'Network errors retain a dismissible fallback');
      await dismiss();
      await page.evaluate(()=>{
        const s=JSON.parse(localStorage.getItem('wholphin-session'));
        s.user='another-profile'; localStorage.setItem('wholphin-session',JSON.stringify(s));
      });
      await page.reload();
      await page.locator('nav [data-nav=settings]').click();
      await page.getByRole('button',{name:'Screensaver',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Moving clock: Off',exact:true}).count(),1,'Options do not leak between profiles');
      const artworkRequest=requests.find(u=>u.searchParams.get('ImageTypes')==='Backdrop');
      assert.equal(artworkRequest.pathname,'/Users/user/Items');
      assert.equal(artworkRequest.searchParams.get('Limit'),'60');
      if(platform==='webos') {
        await page.locator('nav [data-nav=home]').click();
        await page.getByRole('button',{name:'Idle test movie',exact:true}).first().click();
        await page.getByRole('button',{name:'Play from beginning',exact:true}).click();
        await page.locator('#player').waitFor({state:'visible'});
        await page.clock.fastForward(301000);
        assert.equal(await page.locator('#screensaver').count(),0,'Active playback prevents idle screensaver');
        await page.locator('#toggle').press('Enter');
        await page.clock.fastForward(301000);
        assert.equal(await page.locator('#screensaver').count(),0,'Paused playback is left undisturbed');
      }
      assert.deepEqual(errors,[]);
      console.log(`PASS ${platform}: artwork rotation, wake consumption/focus, profile options, idle start, disabled mode, preview and suspend`);
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
