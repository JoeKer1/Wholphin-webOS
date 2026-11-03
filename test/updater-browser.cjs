const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {
  for (const platform of ['webos', 'tizen', 'firetv']) {
   const page = await browser.newPage({viewport: {width:1920,height:1080}}), errors=[];
   page.on('pageerror', e => errors.push(e.message));
   await page.route('**/webapis/webapis.js', r => r.fulfill({body:''}));
   await page.route('https://jellyfin.test/**', r => r.fulfill({json:{Items:[]}}));
   await page.addInitScript(() => {
    localStorage.setItem('wholphin-session', JSON.stringify({server:'https://jellyfin.test',user:'user',token:'fixture',name:'Joe'}));
    window.updateActions = [];
    window.EmberAndroid = {capabilities:()=> '{}',appVersion:()=> '0.2.90',command:()=>{}, updateCommand: action => {
     updateActions.push(action);
     const data = {installed:'0.2.90',version:'0.2.91',canInstall:false};
     if (action === 'check') Object.assign(data,{state:'available',message:'Ember 0.2.91 is available.'});
     if (action === 'download') Object.assign(data,{state:'ready',message:'Update verified.'});
     if (action === 'permission') Object.assign(data,{state:'ready',message:'Update verified.',canInstall:true});
     setTimeout(()=>EmberFireTV.updateResult(data),10);
    }};
   });
   await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);
   await page.locator('nav [data-nav=settings]').click();
   await page.getByRole('button',{name:'About',exact:true}).click();
   const updates = page.getByRole('button',{name:'App updates',exact:true});
   if (platform !== 'firetv') {assert.equal(await updates.count(),0);await page.close();continue;}
   await updates.click();
   await page.getByRole('button',{name:'Download Ember 0.2.91',exact:true}).waitFor({state:'visible'});
   await page.getByRole('button',{name:'Download Ember 0.2.91',exact:true}).focus();
   await page.keyboard.press('Enter');
   await page.getByRole('button',{name:'Allow app installs',exact:true}).waitFor({state:'visible'});
   await page.getByRole('button',{name:'Allow app installs',exact:true}).focus();
   await page.keyboard.press('Enter');
   await page.getByRole('button',{name:'Install update',exact:true}).waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>updateActions.includes('install')),false,'Never install automatically after permission');
   await page.getByRole('button',{name:'Install update',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>updateActions),['check','download','permission','install']);
   await page.getByRole('button',{name:'Back to settings',exact:true}).click();
   await page.evaluate(()=>EmberFireTV.updateResult({state:'error',message:'Stale update callback'}));
   assert.equal(await page.getByText('Stale update callback').count(),0);
   assert.deepEqual(errors,[]);
   console.log('Fire TV updater: remote navigation, explicit download/install, permission return and stale callbacks passed; LG/Tizen unchanged');
   await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
