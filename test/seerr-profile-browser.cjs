const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [], authorizations = [];
  let enabled = true, wrongServer = false;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://jellyfin.test/**', r => {
   const u = new URL(r.request().url()); let json = {Items: []};
   if (u.pathname === '/QuickConnect/Enabled') json = enabled;
   else if (u.pathname === '/QuickConnect/Connect') json = {Code: wrongServer ? '999999' : '123456', Authenticated: false};
   else if (u.pathname === '/QuickConnect/Authorize') {authorizations.push({user: u.searchParams.get('UserId'), code: u.searchParams.get('Code')}); json = true;}
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   if (!localStorage.getItem('wholphin-session')) localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'one', token: 'private-jellyfin-token', name: 'One'}));
   localStorage.setItem('wholphin-seerr-server:https://jellyfin.test', 'http://seerr.test:5055');
   window.seerrCalls = []; window.seerrSessions = {}; window.holdInit = false; window.wrongIdentity = false;
   window.EmberAndroid = {capabilities: () => '{}', command: () => {}, seerrRequest: raw => {
    const value = JSON.parse(raw); window.seerrCalls.push(value);
    const reply = () => {
     let status = 200, data = {}, error;
     if (value.path.endsWith('/quickconnect/initiate')) data = {code: '123456', secret: 'abcdef0123456789'};
     else if (value.path.endsWith('/quickconnect/authenticate')) window.seerrSessions[value.profile] = value.profile.split(':').at(-1);
     else if (value.path === '/auth/logout') delete window.seerrSessions[value.profile];
     else if (!window.seerrSessions[value.profile]) {status = 403; error = 'Sign in to Seerr.';}
     else if (value.path === '/auth/me') data = {id: 7, jellyfinUserId: window.wrongIdentity ? 'someone-else' : window.seerrSessions[value.profile], displayName: window.seerrSessions[value.profile], permissions: 32};
     else data = {results: [{id: 11, title: 'Auto connected movie', mediaType: 'movie'}], totalPages: 1};
     window.EmberFireTV.seerrResult({id: value.id, status, data, error});
    };
    if (window.holdInit && value.path.endsWith('/quickconnect/initiate')) window.releaseInit = reply;
    else setTimeout(reply, 5);
   }};
  });
  await page.goto(pathToFileURL(path.resolve('dist/firetv/index.html')).href);
  const open = () => page.locator('nav [data-nav=seerr]').click();
  const movie = () => page.getByRole('button', {name: 'Auto connected movie', exact: true});
  await open(); await movie().waitFor();
  assert.deepEqual(authorizations, [{user: 'one', code: '123456'}]);
  assert.equal(await page.getByLabel('Password', {exact: true}).count(), 0, 'Automatic browsing has no password prompt');
  await page.locator('nav [data-nav=home]').click(); await open(); await movie().waitFor();
  assert.equal(authorizations.length, 1, 'Valid cookie is reused without reconnecting');
  await page.evaluate(() => {seerrSessions['wholphin-seerr:https://jellyfin.test:one'] = 'other';});
  await page.locator('nav [data-nav=home]').click(); await open(); await movie().waitFor();
  assert.equal(authorizations.length, 2, 'A session for a different Jellyfin user is replaced');
  await page.evaluate(() => {const s = JSON.parse(localStorage.getItem('wholphin-session')); s.user = 'two'; localStorage.setItem('wholphin-session', JSON.stringify(s));});
  await page.reload(); await open(); await movie().waitFor();
  assert.equal(authorizations.at(-1).user, 'two', 'Profile change authorizes the selected user');
  assert.ok(await page.evaluate(() => seerrCalls.every(v => !JSON.stringify(v).includes('private-jellyfin-token'))), 'Jellyfin token never goes to Seerr');
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!stored.includes('abcdef0123456789'), 'One-time Quick Connect secret is not persisted');
  await page.evaluate(() => {seerrSessions = {}; holdInit = true;});
  await page.locator('nav [data-nav=home]').click(); await open();
  await page.waitForFunction(() => !!window.releaseInit);
  const beforeCancel = authorizations.length;
  await page.locator('nav [data-nav=home]').click(); await page.evaluate(() => releaseInit()); await page.waitForTimeout(100);
  assert.equal(authorizations.length, beforeCancel, 'Leaving the page cancels authorization');
  enabled = false;
  await page.reload(); await open();
  await page.getByText('Enable Quick Connect on your Jellyfin server to connect this profile without a password.', {exact: true}).waitFor();
  assert.equal(authorizations.length, beforeCancel);
  enabled = true; wrongServer = true;
  await page.reload(); await open();
  await page.getByText('Seerr must use the same Jellyfin server as this Ember profile.', {exact: true}).waitFor();
  assert.equal(authorizations.length, beforeCancel, 'A different Jellyfin server cannot be authorized');
  wrongServer = false;
  await page.reload(); await page.evaluate(() => {wrongIdentity = true;}); await open();
  await page.getByText('Seerr returned a different Jellyfin profile. The connection was cleared.', {exact: true}).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(seerrSessions).length), 0, 'Wrong identity clears cookie');
  await page.getByRole('button', {name: 'Seerr sign-in settings', exact: true}).click();
  assert.equal(await page.getByLabel('Password', {exact: true}).isVisible(), false);
  await page.getByRole('button', {name: 'Connect with this profile', exact: true}).waitFor();
  await page.screenshot({path: '/private/tmp/ember-seerr-profile-settings.png'});
  await page.evaluate(() => {wrongIdentity = false;});
  await page.getByRole('button', {name: 'Connect with this profile', exact: true}).click();
  await movie().waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wholphin-seerr:https://jellyfin.test:two')).auth), 'automatic');
  assert.deepEqual(errors, []);
  console.log('PASS Seerr automatic profile connection: no password, cookie reuse, stale identity, profile isolation, cancellation, disabled Quick Connect, server mismatch, wrong identity and secret handling');
 } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
