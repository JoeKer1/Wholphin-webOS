// Run against the packaged assets, including platform adapters and legacy CSS.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  try {
    for (const platform of ['webos', 'tizen', 'firetv']) {
      const page = await browser.newPage({viewport:{width:1920,height:1080}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/webapis/webapis.js', r => r.fulfill({body:''}));
      await page.route('https://jellyfin.test/**', r => r.fulfill({json:r.request().url().includes('/plugins/profiles/list') ? [] : {Items:[]}}));
      await page.addInitScript(({platform}) => {
        localStorage.setItem('wholphin-session', JSON.stringify({server:'https://jellyfin.test',user:'user',token:'fixture',name:'Joe'}));
        if (platform !== 'webos') {
          const supports = CSS.supports.bind(CSS);
          CSS.supports = (...args) => args.join(':') === 'display:grid' ? false : supports(...args);
          delete window.AbortController;
          delete Promise.allSettled;
          delete Promise.prototype.finally;
        }
      }, {platform});
      await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
      assert.equal(await page.evaluate(() => EmberPlatform.id), platform);
      if (platform !== 'webos') assert.ok(await page.locator('html').evaluate(n => n.classList.contains('legacy-grid')));
      async function back() {
        await page.evaluate(platform => {
          if (platform === 'firetv') EmberFireTV.key(27);
          else document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {keyCode:platform === 'tizen' ? 10009 : 461, bubbles:true,cancelable:true}));
        }, platform);
      }
      await page.locator('nav [data-nav=settings]').click();
      await page.getByRole('button',{name:'Playback',exact:true}).click();
      const countdown = page.getByRole('button',{name:'Up Next countdown: 30 seconds',exact:true});
      await countdown.click();
      assert.equal(await page.locator(':focus').textContent(),'30 seconds');
      await page.keyboard.press('ArrowDown');
      assert.ok(await page.locator(':focus').evaluate(n => !!n.closest('#setting-options')));
      await back();
      assert.equal(await page.locator('#setting-options').count(),0);
      assert.equal(await countdown.evaluate(n => n === document.activeElement),true);
      await page.getByRole('button',{name:'Subtitles',exact:true}).click();
      await page.getByRole('button',{name:'Subtitle appearance',exact:true}).click();
      await page.getByRole('button',{name:/^Text size:/}).click();
      await back();
      assert.equal(await page.locator('.subtitle-editor-choices').isVisible(),false);
      assert.ok(await page.locator(':focus').getAttribute('aria-label').then(v => v.startsWith('Text size:')));
      await page.screenshot({path:`/private/tmp/ember-menu-${platform}.png`});
      await back();
      await page.getByRole('button',{name:'Customize Home',exact:true}).click();
      await page.locator('.home-options input[type=checkbox]').first().focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator(':focus').textContent(),'Save and open Home');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator(':focus').getAttribute('type'),'checkbox');
      await page.getByRole('button',{name:'Reset row order and artwork',exact:true}).focus();
      const box = await page.locator('.home-editor-actions').boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 1080, 'Home save controls remain visible');
      await page.getByRole('button',{name:'Save and open Home',exact:true}).click();
      await page.getByRole('heading',{name:'Home',exact:true}).waitFor();
      assert.deepEqual(errors,[]);
      console.log(`PASS ${platform}: packaged assets, legacy fallback, settings D-pad, platform Back, nested subtitle Back, Home toolbar and save`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
