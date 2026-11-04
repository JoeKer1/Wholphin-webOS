const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{for(const platform of ['webos','tizen','firetv']){
  const page=await browser.newPage({viewport:{width:1920,height:1080}}), calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/webapis/webapis.js',r=>r.fulfill({body:''}));
  await page.route('https://jellyfin.test/**',r=>{
   const u=new URL(r.request().url());let json={Items:[]};
   if(u.pathname.endsWith('/Views'))json={Items:[{Id:'root',Name:'Home videos',CollectionType:'homevideos'}]};
   if(u.pathname.endsWith('/Items')&&u.searchParams.has('ParentId')){
    const parent=u.searchParams.get('ParentId');calls.push(Object.fromEntries(u.searchParams));
    json={Items:parent==='root'?[{Id:'child',Name:'Child folder',Type:'Folder',IsFolder:true}]:parent==='child'?[{Id:'grandchild',Name:'Grandchild',Type:'Folder',IsFolder:true}]:[],TotalRecordCount:parent==='grandchild'?0:1};
   }
   return r.fulfill({json});
  });
  await page.addInitScript(()=>{
   if(!localStorage.getItem('wholphin-session')){
    localStorage.setItem('wholphin-session',JSON.stringify({server:'https://jellyfin.test',user:'one',token:'fixture'}));
    localStorage.setItem('wholphin-library-options:root:https://jellyfin.test:one',JSON.stringify({sort:'added-desc',watched:'unwatched',genre:'Comedy',year:'2020'}));
   }
  });
  await page.goto(pathToFileURL(path.resolve('dist',platform,'index.html')).href);
  async function root(){await page.locator('nav [data-nav=root]').click();await page.locator('.card[data-item=child]').waitFor();}
  async function child(){await page.locator('.card[data-item=child]').click();await page.locator('.card[data-item=grandchild]').waitFor();}
  await root();await child();
  let request=calls.filter(c=>c.ParentId==='child').at(-1);
  assert.equal(request.SortBy,'DateCreated,SortName');assert.equal(request.SortOrder,'Descending');assert.equal(request.IsPlayed,'false');
  assert(!request.Genres&&!request.Years,'Do not inherit parent genre/year filters into an unrelated subfolder');
  await page.locator('#library-sort').click();
  await page.locator('#library-options').getByRole('button',{name:'Title (Z–A)',exact:true}).click();
  await page.locator('.card[data-item=grandchild]').waitFor();
  await root();
  await page.evaluate(()=>localStorage.setItem('wholphin-library-options:root:https://jellyfin.test:one',JSON.stringify({sort:'release-asc',watched:'all'})));
  await root();await child();
  request=calls.filter(c=>c.ParentId==='child').at(-1);
  assert.equal(request.SortBy,'SortName');assert.equal(request.SortOrder,'Descending','Explicit child preference wins over changed parent preference');
  await page.locator('.card[data-item=grandchild]').click();
  await page.waitForFunction(()=>document.querySelector('main h1').textContent==='Grandchild');
  for(let i=0;i<100&&!calls.some(c=>c.ParentId==='grandchild');i++)await page.waitForTimeout(20);
  request=calls.filter(c=>c.ParentId==='grandchild').at(-1);assert.equal(request.SortOrder,'Descending');assert.equal(request.SortBy,'SortName');
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wholphin-session'));s.user='two';localStorage.setItem('wholphin-session',JSON.stringify(s));});
  await page.reload();await root();await child();
  request=calls.filter(c=>c.ParentId==='child').at(-1);assert.equal(request.SortOrder,'Ascending');assert(!request.IsPlayed,'Profile two does not inherit profile one filters');
  assert.deepEqual(errors,[]);console.log('PASS '+platform+': nested sort/watch inheritance, explicit child override, genre/year isolation and profile isolation');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
