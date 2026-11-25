const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
  });
  try {
    for (const platform of ['webos', 'tizen']) {
      const page = await browser.newPage();
      const connected = new Set();
      const authorizations = [];
      await page.route('**/webapis/webapis.js', route => route.fulfill({body: ''}));
      await page.route('https://jellyfin.test/**', route => {
        const request = route.request();
        const url = new URL(request.url());
        const user = request.headers().authorization?.includes('Token="two"') ? 'two' : 'one';
        let json = {Items: []};
        switch (url.pathname) {
          case '/Ember/Requests/status':
            json = {enabled: true};
            break;
          case '/QuickConnect/Enabled':
            json = true;
            break;
          case '/QuickConnect/Connect':
            json = {Code: '123456', Authenticated: false};
            break;
          case '/QuickConnect/Authorize':
            assert.equal(url.searchParams.get('UserId'), user);
            authorizations.push(user);
            json = true;
            break;
          case '/Ember/Requests/api/auth/jellyfin/quickconnect/initiate':
            json = {code: '123456', secret: 'abcdef0123456789'};
            break;
          case '/Ember/Requests/api/auth/jellyfin/quickconnect/authenticate':
            assert.equal(request.postDataJSON().secret, 'abcdef0123456789');
            connected.add(user);
            return route.fulfill({status: 204});
          case '/Ember/Requests/api/auth/me':
            if (!connected.has(user)) return route.fulfill({status: 401, json: {}});
            json = {id: user === 'one' ? 1 : 2, jellyfinUserId: user, displayName: user};
            break;
          case '/Ember/Requests/api/discover/trending':
            json = {results: [{id: 11, title: 'Trending fixture', mediaType: 'movie'}], totalPages: 1};
            break;
          case '/Ember/Requests/api/request':
            assert.equal(url.searchParams.get('requestedBy'), user === 'one' ? '1' : '2');
            json = {results: [], totalPages: 1};
            break;
        }
        return route.fulfill({json});
      });
      await page.addInitScript(() => {
        const user = localStorage.getItem('fixture-profile') || 'one';
        localStorage.setItem('wholphin-session', JSON.stringify({
          server: 'https://jellyfin.test', user, token: user, name: user,
        }));
      });
      await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
      for (const user of ['one', 'two']) {
        await page.locator('nav').getByRole('button', {name: 'Requests', exact: true}).click();
        await page.getByRole('button', {name: 'Trending fixture', exact: true}).waitFor();
        await page.getByRole('button', {name: 'My requests', exact: true}).click();
        await page.getByRole('heading', {name: 'My requests', exact: true}).waitFor();
        if (user === 'one') {
          await page.evaluate(() => localStorage.setItem('fixture-profile', 'two'));
          await page.reload();
        }
      }
      assert.deepEqual(authorizations, ['one', 'two']);
      await page.close();
      console.log('PASS native Requests through Jellyfin on ' + platform);
    }
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
