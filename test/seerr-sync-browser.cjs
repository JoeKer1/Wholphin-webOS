const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 const documents = {}, writes = [], errors = []; let offline = false;
 async function device(platform, user = 'one', base = 'https://jellyfin.test', legacy) {
  const context = await browser.newContext({viewport: {width: 1920, height: 1080}}), page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
  await page.route(base + '/**', r => {
   const u = new URL(r.request().url()); let json = {Items: []};
   if (u.pathname === '/DisplayPreferences/usersettings') {
    const user = u.searchParams.get('userId'); assert.equal(u.searchParams.get('client'), 'ember');
    if (offline) return r.fulfill({status: 503, body: ''});
    if (r.request().method() === 'POST') {
     const doc = r.request().postDataJSON();
     assert.equal(doc.CustomPrefs.unrelated, 'keep');
     assert.equal(doc.CustomPrefs['ember-audio-defaults'], JSON.stringify({animeLanguage: 'jpn'}));
     documents[user] = doc; writes.push(user); return r.fulfill({status: 204});
    }
    return r.fulfill({json: documents[user] || {Id: 'settings', CustomPrefs: {unrelated: 'keep', 'ember-audio-defaults': JSON.stringify({animeLanguage: 'jpn'})}}});
   }
   if (u.pathname === '/QuickConnect/Enabled' || u.pathname === '/QuickConnect/Authorize') json = true;
   else if (u.pathname === '/QuickConnect/Connect') json = {Code: '123456', Authenticated: false};
   return r.fulfill({json});
  });
  await page.addInitScript(({user, base, legacy}) => {
   if (!localStorage.getItem('wholphin-session')) {
    localStorage.setItem('wholphin-session', JSON.stringify({server: base, user, token: 'fixture', name: user}));
    if (legacy) localStorage.setItem('wholphin-seerr:' + base + ':' + user, JSON.stringify({server: legacy, auth: 'automatic'}));
   }
   const sessions = {}; window.seerrCalls = [];
   window.EmberAndroid = {capabilities: () => '{}', command: () => {}, seerrRequest: raw => {
    const request = JSON.parse(raw); seerrCalls.push(request); const key = request.server + ':' + request.profile;
    let status = 200, data = {}, error;
    if (request.path.endsWith('/quickconnect/initiate')) data = {code: '123456', secret: 'abcdef0123456789'};
    else if (request.path.endsWith('/quickconnect/authenticate')) sessions[key] = true;
    else if (!sessions[key]) {status = 401; error = 'Sign in';}
    else if (request.path === '/auth/me') data = {id: 7, jellyfinUserId: request.profile.split(':').at(-1), permissions: 32};
    else data = {results: [{id: 1, title: 'From synced address', mediaType: 'movie'}], totalPages: 1};
    setTimeout(() => EmberFireTV.seerrResult({id: request.id, status, data, error}), 5);
   }};
  }, {user, base, legacy});
  await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
  await page.waitForFunction(() => !!localStorage.getItem('wholphin-audio-defaults:' + JSON.parse(localStorage.getItem('wholphin-session')).server + ':' + JSON.parse(localStorage.getItem('wholphin-session')).user));
  return {page, context};
 }
 try {
  const existing = await device('firetv', 'one', 'https://jellyfin.test', 'https://requests.test/login');
  assert.deepEqual(JSON.parse(documents.one.CustomPrefs['ember-seerr-connection']), {server: 'https://requests.test'}, 'Existing address migrates to Jellyfin without cookies or auth mode');
  for (const platform of ['webos', 'tizen', 'firetv']) {
   const fresh = await device(platform, 'one', 'https://public-jellyfin.test');
   assert.deepEqual(await fresh.page.evaluate(() => JSON.parse(localStorage.getItem('wholphin-seerr-connection:https://public-jellyfin.test:one'))), {server: 'https://requests.test'});
   if (platform === 'firetv') {
    await fresh.page.locator('nav [data-nav=seerr]').click();
    await fresh.page.getByRole('button', {name: 'From synced address', exact: true}).waitFor();
    assert.equal(await fresh.page.getByLabel('Seerr server address').count(), 0, 'New device needs no address entry');
    assert.ok(await fresh.page.evaluate(() => seerrCalls.every(c => c.server === 'https://requests.test')));
   } else assert.equal(await fresh.page.locator('nav [data-nav=seerr]').count(), 0);
   await fresh.context.close();
  }
  await existing.page.evaluate(() => {const s = JSON.parse(localStorage.getItem('wholphin-session')); s.user = 'two'; localStorage.setItem('wholphin-session', JSON.stringify(s));});
  await existing.page.reload();
  await existing.page.locator('nav [data-nav=seerr]').click();
  await existing.page.getByRole('button', {name: 'From synced address', exact: true}).waitFor();
  assert.deepEqual(JSON.parse(documents.two.CustomPrefs['ember-seerr-connection']), {server: 'https://requests.test'}, 'Another profile inherits the URL on a configured TV');
  assert.ok(await existing.page.evaluate(() => seerrCalls.filter(c => c.path.endsWith('/quickconnect/authenticate')).every(c => c.profile.endsWith(':two'))), 'New profile authenticates separately');
  await existing.page.locator('.seerr-tabs').getByRole('button', {name: 'Seerr settings', exact: true}).click();
  offline = true;
  await existing.page.getByLabel('Seerr server address').fill('https://new-requests.test');
  await existing.page.getByRole('button', {name: 'Connect with this profile', exact: true}).click();
  await existing.page.getByRole('button', {name: 'From synced address', exact: true}).waitFor();
  assert.equal(JSON.parse(documents.two.CustomPrefs['ember-seerr-connection']).server, 'https://requests.test');
  assert.equal(await existing.page.evaluate(() => JSON.parse(localStorage.getItem('wholphin-language-sync-pending:https://jellyfin.test:two'))['seerr-connection']), true);
  offline = false;
  await existing.page.locator('nav [data-nav=seerr]').click();
  await existing.page.getByRole('button', {name: 'From synced address', exact: true}).waitFor();
  assert.equal(JSON.parse(documents.two.CustomPrefs['ember-seerr-connection']).server, 'https://new-requests.test', 'Offline edit retries without being overwritten by stale server settings');
  const stale = await device('firetv', 'two', 'https://jellyfin.test', 'https://old-requests.test');
  assert.equal(await stale.page.evaluate(() => JSON.parse(localStorage.getItem('wholphin-seerr-connection:https://jellyfin.test:two')).server), 'https://new-requests.test', 'Clean old local address adopts server configuration');
  await stale.context.close();
  assert.deepEqual(errors, []);
  assert.ok(writes.length >= 3);
  console.log('PASS Seerr Jellyfin sync: legacy migration, fresh LG/Tizen/Fire TV caches, public Jellyfin alias, no address prompt, profile URL inheritance with separate authentication, offline retry and unrelated preferences preserved');
  await existing.context.close();
 } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
