const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const documents = {}, writes = [], errors = [];
  let offline = false;
  async function device(platform, user = 'one', seed = {}) {
    const context = await browser.newContext({viewport: {width: 1920, height: 1080}});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
    await page.route('https://jellyfin.test/**', async r => {
      const u = new URL(r.request().url());
      if (u.pathname === '/DisplayPreferences/usersettings') {
        assert.equal(u.searchParams.get('client'), 'ember');
        const id = u.searchParams.get('userId');
        assert.ok(['one', 'two'].includes(id));
        assert.ok(r.request().headers().authorization.includes('fixture'));
        if (offline) return r.fulfill({status: 503, body: ''});
        if (r.request().method() === 'POST') {
          const doc = r.request().postDataJSON();
          assert.equal(doc.CustomPrefs.unrelated, 'keep me');
          documents[id] = doc;
          writes.push(id);
          return r.fulfill({status: 204});
        }
        return r.fulfill({json: documents[id] || {Id: 'settings', ShowSidebar: true, CustomPrefs: {unrelated: 'keep me'}}});
      }
      return r.fulfill({json: {Items: []}});
    });
    await page.addInitScript(({user, seed}) => {
      if (!localStorage.getItem('wholphin-session')) {
        localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user, token: 'fixture', name: user}));
        Object.entries(seed).forEach(([key, value]) => localStorage.setItem('wholphin-' + key + ':https://jellyfin.test:' + user, JSON.stringify(value)));
      }
    }, {user, seed});
    await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
    await page.locator('nav [data-nav=settings]').click();
    await page.getByRole('button', {name: 'Subtitle defaults', exact: true}).waitFor();
    return {page, context};
  }
  async function choose(page, button, value) {
    await page.getByRole('button', {name: button, exact: true}).click();
    await page.locator('#setting-options').getByRole('button', {name: value, exact: true}).click();
  }
  async function synced(page) {
    await page.waitForFunction(() => !Object.keys(JSON.parse(localStorage.getItem('wholphin-language-sync-pending:https://jellyfin.test:one') || '{}')).length);
  }
  try {
    const lg = await device('webos', 'one', {'audio-defaults': {animeLanguage: 'jpn'}});
    assert.equal(JSON.parse(documents.one.CustomPrefs['ember-audio-defaults']).animeLanguage, 'jpn', 'Migrate existing explicit local choices');
    await lg.page.getByRole('button', {name: 'Subtitle defaults', exact: true}).click();
    await choose(lg.page, 'Default subtitles: Remember last choice', 'Preferred language when available');
    await choose(lg.page, 'Preferred language: English', 'Spanish');
    await choose(lg.page, 'English for non-English audio: On', 'Off');
    await synced(lg.page);
    for (const platform of ['tizen', 'firetv']) {
      const d = await device(platform);
      assert.equal(await d.page.getByRole('button', {name: 'Anime audio language: Japanese', exact: true}).count(), 1);
      await d.page.getByRole('button', {name: 'Subtitle defaults', exact: true}).click();
      assert.equal(await d.page.getByRole('button', {name: 'Default subtitles: Preferred language when available', exact: true}).count(), 1);
      assert.equal(await d.page.getByRole('button', {name: 'Preferred language: Spanish', exact: true}).count(), 1);
      assert.equal(await d.page.getByRole('button', {name: 'English for non-English audio: Off', exact: true}).count(), 1);
      await d.context.close();
    }
    const other = await device('firetv', 'two');
    assert.equal(await other.page.getByRole('button', {name: 'Anime audio language: Use normal audio preference', exact: true}).count(), 1);
    assert.ok(!documents.two, 'No default upload for a fresh profile');
    await other.context.close();
    offline = true;
    await choose(lg.page, 'Preferred language: Spanish', 'French');
    await lg.page.getByText('Saved on this TV.', {exact: false}).waitFor();
    assert.equal(JSON.parse(documents.one.CustomPrefs['ember-subtitle-defaults']).language, 'spa');
    offline = false;
    await lg.page.locator('nav [data-nav=settings]').click();
    await lg.page.getByRole('button', {name: 'Subtitle defaults', exact: true}).waitFor();
    await synced(lg.page);
    assert.equal(JSON.parse(documents.one.CustomPrefs['ember-subtitle-defaults']).language, 'fra', 'Retry offline changes without replacing them with stale server settings');
    // A clean local cache must adopt edits made on another device.
    documents.one.CustomPrefs['ember-audio-defaults'] = JSON.stringify({animeLanguage: 'eng'});
    await lg.page.locator('nav [data-nav=home]').click();
    await lg.page.locator('nav [data-nav=settings]').click();
    await lg.page.getByRole('button', {name: 'Anime audio language: English', exact: true}).waitFor();
    assert.deepEqual(errors, []);
    assert.ok(writes.length >= 3);
    console.log('PASS language sync: LG → Tizen/Fire TV, profile isolation, local migration, server refresh, offline retry, unrelated settings preserved');
  } finally { await browser.close(); }
})().catch(e => {console.error(e); process.exitCode = 1;});
