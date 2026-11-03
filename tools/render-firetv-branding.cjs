// Render the repository's SVG artwork without changing branding on other platforms.
const fs = require('node:fs/promises'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
 try {
  for (const [source, target, width, height] of [
   ['ember-firetv-tile.svg','ember_launcher_tile.png',1280,720],
   ['ember-firetv-square.svg','ember_app_icon.png',512,512]
  ]) {
   const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
   const file = path.resolve('platforms/branding',source);
   await page.goto(pathToFileURL(file).href);
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.resolve('platforms/firetv/app/src/main/res/drawable-nodpi',target),omitBackground:false});
   // Confirm intrinsic dimensions and fully opaque black corners before packaging.
   const result = await page.evaluate(async ({svg,width,height}) => {
    const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); await img.decode();
    const canvas = document.createElementNS('http://www.w3.org/1999/xhtml','canvas'); canvas.width=width; canvas.height=height;
    const context=canvas.getContext('2d');context.drawImage(img,0,0,width,height);
    return {width:img.naturalWidth,height:img.naturalHeight,corners:[[0,0],[width-1,0],[0,height-1],[width-1,height-1]].map(([x,y])=>Array.from(context.getImageData(x,y,1,1).data))};
   },{svg:await fs.readFile(file,'utf8'),width,height});
   if(result.width!==width||result.height!==height||result.corners.some(p=>p.join(',')!=='0,0,0,255')) throw new Error('Invalid Fire TV artwork');
   console.log(target+': '+width+'×'+height+', opaque black background');
   await page.close();
  }
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
