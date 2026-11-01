const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH}: {})});
 try {
  for (const platform of ['webos','tizen','firetv']) {
   const page = await browser.newPage({viewport:{width:1920,height:1080}});
   const libraries = [ ['discover','Discover','movies'], ['kids','Kids TV','tvshows'], ['collections','Collections','boxsets'], ['anime','Anime','tvshows'], ['tv','TV Shows','tvshows'], ['movies','Movies','movies'] ].map(([Id,Name,CollectionType])=>({Id,Name,CollectionType}));
   await page.route('https://jellyfin.test/**', r => {
    const u = new URL(r.request().url());
    if (u.pathname === '/plugins/profiles/list') return r.fulfill({status:404,json:{}});
    return r.fulfill({json:u.pathname.endsWith('/Views') ? {Items:libraries} : {Items:[], TotalRecordCount:0}});
   });
   await page.addInitScript(()=>localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'user',token:'token',name:'Joe'})));
   await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);
   await page.locator('nav [data-nav=movies]').waitFor();
   assert.deepEqual(await page.locator('nav button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))), ['Search','Home','Movies','TV','Anime','Kids TV','Live TV','Favorites','Collections','Discover','Settings']);
   await page.locator('nav [data-nav=movies]').click();
   const firstTab = page.locator('.tv-library-tabs button').first();
   await firstTab.waitFor();
   await firstTab.focus();
   await page.keyboard.press('ArrowLeft');
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.nav),'home');
   await page.keyboard.press('ArrowUp');
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.nav),'search');
   await page.keyboard.press('ArrowDown');
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.nav),'home');
   await page.close();
   console.log('PASS: '+platform+' sidebar order and Home entry focus');
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
