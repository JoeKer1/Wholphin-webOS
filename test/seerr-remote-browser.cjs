const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://jellyfin.test/**', r => r.fulfill({json: {Items: []}}));
  await page.addInitScript(() => {
   localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'one', token: 'fixture', name: 'One'}));
   localStorage.setItem('wholphin-seerr:https://jellyfin.test:one', JSON.stringify({server: 'https://seerr.test', auth: 'automatic'}));
   window.seerrCalls = [];
   window.EmberAndroid = {capabilities: () => '{}', command: () => {}, seerrRequest: raw => {
    const request = JSON.parse(raw); seerrCalls.push(request);
    let data;
    if (request.path === '/auth/me') data = {id: 7, jellyfinUserId: 'one', permissions: 32};
    else if (request.path === '/request' && request.method === 'POST') data = {id: 1, status: 1};
    else if (request.path.startsWith('/movie/')) data = {id: Number(request.path.split('/').at(-1)), title: 'Remote movie', mediaInfo: {status: 1}};
    else if (request.path === '/tv/50') data = {id: 50, name: 'Remote TV', seasons: [{seasonNumber: 1, name: 'Season 1', episodeCount: 8}, {seasonNumber: 2, name: 'Season 2', episodeCount: 8}], mediaInfo: {status: 4, seasons: [{seasonNumber: 1, status: 5}]}};
    else if (request.path.startsWith('/search?')) data = {results: [{id: 50, name: 'Remote TV', mediaType: 'tv'}], totalPages: 1};
    else {
     const pageNumber = Number(new URL('https://fixture' + request.path).searchParams.get('page') || 1);
     data = {results: Array.from({length: 12}, (_, i) => ({id: (pageNumber - 1) * 12 + i + 1, title: 'Movie ' + ((pageNumber - 1) * 12 + i + 1), mediaType: 'movie'})), totalPages: 2};
    }
    setTimeout(() => EmberFireTV.seerrResult({id: request.id, status: 200, data}), 10);
   }};
  });
  await page.goto(pathToFileURL(path.resolve('dist/firetv/index.html')).href);
  await page.locator('nav [data-nav=seerr]').click();
  await page.getByRole('button', {name: 'Trending', exact: true}).waitFor();
  const key = code => page.evaluate(code => EmberFireTV.key(code), code);
  const focused = () => page.locator(':focus');
  await key(40); assert.equal(await focused().getAttribute('aria-label'), 'Search Seerr', 'Down leaves category tabs');
  await key(40); assert.equal(await focused().getAttribute('data-item'), 'seerr:movie:1', 'Down enters results');
  await key(39); assert.equal(await focused().getAttribute('data-item'), 'seerr:movie:2');
  await key(40); assert.equal(await focused().getAttribute('data-item'), 'seerr:movie:8');
  await key(40);
  await page.waitForFunction(() => document.activeElement.dataset.item === 'seerr:movie:14');
  assert.ok(await page.evaluate(() => seerrCalls.some(c => c.path.includes('page=2'))), 'Remote reaches continuously loaded results');
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name: 'Request movie', exact: true}).waitFor();
  assert.equal(await focused().textContent(), 'Request movie', 'Movie request is the default action');
  await page.keyboard.press('Enter');
  await page.locator('#setting-options').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => seerrCalls.filter(c => c.path === '/request').length), 0);
  await page.keyboard.press('Enter'); await key(40); await page.keyboard.press('Enter');
  await page.getByText('Request submitted.', {exact: false}).waitFor();
  assert.deepEqual(await page.evaluate(() => seerrCalls.filter(c => c.path === '/request').at(-1).body), {mediaType: 'movie', mediaId: 14, is4k: false});
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement.dataset.item === 'seerr:movie:14');
  await key(38); await key(38); await key(38);
  assert.equal(await focused().getAttribute('aria-label'), 'Search Seerr');
  await focused().fill('Remote TV'); await page.keyboard.press('Enter');
  await page.getByRole('button', {name: 'Remote TV', exact: true}).waitFor();
  await key(40); await page.keyboard.press('Enter');
  await page.getByRole('button', {name: 'Season 2', exact: true}).waitFor();
  assert.equal(await focused().textContent(), 'Season 2', 'TV focuses the first requestable season');
  await page.keyboard.press('Enter'); await key(40);
  assert.equal(await focused().textContent(), 'Request selected seasons');
  await page.keyboard.press('Enter'); await key(40); await page.keyboard.press('Enter');
  await page.getByText('Request submitted.', {exact: false}).waitFor();
  assert.deepEqual(await page.evaluate(() => seerrCalls.filter(c => c.path === '/request').at(-1).body), {mediaType: 'tv', mediaId: 50, is4k: false, seasons: [2]});
  await page.screenshot({path: '/private/tmp/ember-seerr-remote-request.png'});
  assert.deepEqual(errors, []);
  console.log('PASS Fire TV remote: tabs/search/results, grid rows and continuous loading, Back restores focus, movie confirmation/cancel and season-specific TV requests');
 } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
