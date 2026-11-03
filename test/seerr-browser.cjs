const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://image.tmdb.org/**', r => r.fulfill({status: 404, body: ''}));
  await page.route('https://jellyfin.test/**', r => r.fulfill({json: {Items: []}}));
  await page.addInitScript(() => {
   if (!localStorage.getItem('wholphin-session')) localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'one', token: 'private-jellyfin-token', name: 'One'}));
   const sessions = {}; window.seerrCalls = []; window.failRequest = false; window.seerrPermissions = 32 | 1024;
   const movie = {id: 11, title: 'Example movie', overview: 'A movie to request.', posterPath: '/poster.jpg', releaseDate: '2025-01-01', mediaInfo: {status: 1}};
   const tv = {id: 12, name: 'Example series', overview: 'Choose individual seasons.', seasons: [{seasonNumber: 1, name: 'Season 1', episodeCount: 8}, {seasonNumber: 2, name: 'Season 2', episodeCount: 10}], mediaInfo: {status: 4, seasons: [{seasonNumber: 1, status: 5}]}};
   window.EmberAndroid = {capabilities: () => '{}', command: () => {}, seerrRequest: raw => {
    const value = JSON.parse(raw); window.seerrCalls.push(value);
    setTimeout(() => {
     let data = {}, status = 200, error;
     if (value.path === '/auth/logout') delete sessions[value.profile];
     else if (value.path === '/auth/jellyfin' || value.path === '/auth/local') {
      if (value.body.password !== 'test-password') {status = 403; error = 'Seerr denied access.'; delete sessions[value.profile];}
      else sessions[value.profile] = true;
     } else if (!sessions[value.profile]) {status = 403; error = 'Sign in to Seerr.';}
     else if (value.path === '/auth/me') data = {id: 7, jellyfinUsername: 'Seerr One', permissions: window.seerrPermissions};
     else if (value.path === '/request' && value.method === 'POST') {
      if (window.failRequest) {status = 403; error = 'Request quota exceeded.';} else data = {id: 1, status: 1};
     } else if (value.path.startsWith('/request?')) data = {results: [{media: {mediaType: 'movie', tmdbId: 11}}], pageInfo: {pages: 1}};
     else if (value.path === '/movie/11') data = movie;
     else if (value.path === '/tv/12') data = tv;
     else if (value.path.startsWith('/search?')) data = {results: [{...tv, mediaType: 'tv'}], totalPages: 1};
     else data = {results: value.path.includes('page=2') ? [{...movie, id: 13, title: 'Another movie', mediaType: 'movie'}] : [{...movie, mediaType: 'movie'}, {...tv, mediaType: 'tv'}], totalPages: 2};
     window.EmberFireTV.seerrResult({id: value.id, status, error, data});
    }, 5);
   }};
  });
  await page.goto(pathToFileURL(path.resolve('dist/firetv/index.html')).href);
  await page.locator('nav [data-nav=seerr]').click();
  await page.getByLabel('Seerr server address').fill('http://seerr.test:5055');
  await page.getByRole('button', {name: 'Use a different Seerr account', exact: true}).click();
  await page.getByLabel('Username (email for a Seerr local account)').fill('one');
  await page.getByLabel('Password', {exact: true}).fill('test-password');
  await page.getByRole('button', {name: 'Sign in to Seerr', exact: true}).click();
  await page.getByRole('button', {name: 'Example movie', exact: true}).focus();
  await page.getByRole('button', {name: 'Another movie', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Example movie', exact: true}).click();
  await page.getByRole('button', {name: 'Request movie', exact: true}).click();
  await page.locator('#setting-options').getByRole('button', {name: 'Cancel', exact: true}).click();
  assert.equal(await page.evaluate(() => seerrCalls.filter(v => v.path === '/request' && v.method === 'POST').length), 0, 'Cancel never submits');
  await page.getByRole('button', {name: 'Request movie', exact: true}).click();
  await page.locator('#setting-options').getByRole('button', {name: 'Confirm request', exact: true}).click();
  await page.getByText('Request submitted.', {exact: false}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Requested', exact: true}).isDisabled(), true);
  await page.getByRole('button', {name: 'Back to Seerr', exact: true}).click();
  await page.getByLabel('Search Seerr').fill('Example');
  await page.locator('.seerr-search button').click();
  await page.getByRole('button', {name: 'Example series', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: 'Season 1 · already requested or available', exact: true}).isDisabled(), true);
  await page.getByRole('button', {name: 'Quality: Standard', exact: true}).click();
  await page.getByRole('button', {name: 'Season 2', exact: true}).click();
  await page.screenshot({path: '/private/tmp/ember-seerr-seasons.png'});
  await page.getByRole('button', {name: 'Request selected seasons', exact: true}).click();
  await page.evaluate(() => {window.failRequest = true;});
  await page.locator('#setting-options').getByRole('button', {name: 'Confirm request', exact: true}).click();
  await page.getByText('Request quota exceeded.', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Request selected seasons', exact: true}).isDisabled(), false);
  assert.deepEqual(await page.evaluate(() => seerrCalls.filter(v => v.path === '/request').at(-1).body.seasons), [2]);
  assert.equal(await page.evaluate(() => seerrCalls.filter(v => v.path === '/request').at(-1).body.is4k), true);
  await page.getByRole('button', {name: 'Back to Seerr', exact: true}).click();
  assert.equal(await page.getByLabel('Search Seerr').inputValue(), 'Example', 'Back restores the search');
  await page.getByRole('button', {name: 'Example series', exact: true}).waitFor();
  await page.getByRole('button', {name: 'My requests', exact: true}).click();
  await page.getByRole('button', {name: 'Example movie', exact: true}).waitFor();
  assert.ok(await page.evaluate(() => seerrCalls.some(v => v.path.includes('requestedBy=7') && v.path.includes('skip=0'))));
  await page.evaluate(() => {window.seerrPermissions = 0;});
  await page.locator('nav [data-nav=seerr]').click();
  await page.getByRole('button', {name: 'Example movie', exact: true}).click();
  await page.getByText('This Seerr account cannot request movies.', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Request movie', exact: true}).count(), 0);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!stored.includes('test-password')); assert.ok(!stored.includes('private-cookie'));
  assert.ok(await page.evaluate(() => seerrCalls.every(v => !JSON.stringify(v).includes('private-jellyfin-token'))));
  await page.evaluate(() => {const session = JSON.parse(localStorage.getItem('wholphin-session')); session.user = 'two'; localStorage.setItem('wholphin-session', JSON.stringify(session));});
  await page.reload(); await page.locator('nav [data-nav=seerr]').click();
  await page.getByRole('button', {name: 'Seerr sign-in settings', exact: true}).click();
  await page.getByRole('button', {name: 'Use a different Seerr account', exact: true}).click();
  await page.getByRole('button', {name: 'Sign in to Seerr', exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Example movie', exact: true}).count(), 0, 'Second profile starts disconnected');
  await page.getByLabel('Username (email for a Seerr local account)').fill('two');
  await page.getByLabel('Password', {exact: true}).fill('wrong');
  await page.getByRole('button', {name: 'Sign in to Seerr', exact: true}).click();
  await page.getByText('Seerr denied access.', {exact: true}).waitFor();
  assert.equal(await page.getByLabel('Password', {exact: true}).inputValue(), '');
  assert.deepEqual(errors, []);
  for (const platform of ['webos', 'tizen']) {
   const other = await browser.newPage(); await other.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
   await other.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
   assert.equal(await other.locator('nav [data-nav=seerr]').count(), 0, `${platform} does not advertise an unsupported connection`); await other.close();
  }
  console.log('PASS Seerr Fire TV: native login, discovery/search, request confirmation/cancel, season availability, quotas, password handling and profile isolation; no unsupported LG/Tizen menu');
 } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
