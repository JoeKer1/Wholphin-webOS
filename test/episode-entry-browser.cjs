const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  try {for (const platform of ['webos', 'tizen', 'firetv']) {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [], pages = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
    const episode = n => ({Id: 'ep' + n, Name: 'Episode ' + n, Type: 'Episode', SeriesId: 'show', SeriesName: 'Long season', SeasonId: 's2', ParentIndexNumber: 2, IndexNumber: n, MediaType: 'Video', Overview: 'Description ' + n, UserData: {}, MediaSources: []});
    await page.route('https://jellyfin.test/**', r => {
      const u = new URL(r.request().url()); let json = {Items: []};
      if (u.pathname.endsWith('/Resume')) json = {Items: [episode(50)]};
      else if (u.pathname.endsWith('/Seasons')) json = {Items: [1, 2].map(n => ({Id: 's' + n, Name: 'Season ' + n, Type: 'Season', IndexNumber: n}))};
      else if (u.pathname === '/Users/user/Items' && u.searchParams.has('ParentId')) {
        const start = Number(u.searchParams.get('StartIndex') || 0); pages.push(start);
        json = {Items: Array.from({length: Math.min(48, 50 - start)}, (_, i) => episode(start + i + 1)), TotalRecordCount: 50};
      } else if (/\/Items\/ep\d+$/.test(u.pathname)) json = episode(Number(u.pathname.match(/ep(\d+)$/)[1]));
      return r.fulfill({json});
    });
    await page.addInitScript(() => localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'user', token: 'fixture'})));
    await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
    await page.locator('#home-rows [data-item=ep50]').click();
    await page.locator('.episode-browser-name').filter({hasText: 'Episode 50'}).waitFor();
    assert.equal(await page.locator('.season-browser-tabs [aria-selected=true]').textContent(), 'Season 2');
    assert.equal(await page.locator(':focus').getAttribute('data-item'), 'ep50');
    assert.ok(pages.includes(48), 'Episode beyond the first page is loaded and highlighted');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator(':focus').getAttribute('role'), 'tab');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-item'), 'ep50', 'Returning from tabs keeps highlighted episode');
    await page.locator('.episode-browser-rail [data-item=ep49]').focus();
    await page.locator('.episode-browser-name').filter({hasText: 'Episode 49'}).waitFor();
    assert.equal(await page.locator('.episode-browser-overview').textContent(), 'Description 49');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'Play');
    assert.equal(await page.locator('.season-browser').count(), 1);
    await page.getByRole('button', {name: 'More options', exact: true}).click();
    await page.locator('#detail-more-options:not([hidden])').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'detail-more-button');
    assert.deepEqual(errors, []);
    console.log('PASS ' + platform + ': direct episode entry, correct season, late-page focus, tabs return, highlighted metadata and in-place actions');
    await page.close();
  }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
