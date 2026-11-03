const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {for (const platform of ['webos', 'tizen', 'firetv']) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
  const movie = {Id: 'movie', Name: 'Seeking movie', Type: 'Movie', MediaType: 'Video', RunTimeTicks: 18000000000, UserData: {}, MediaSources: []};
  await page.route('https://jellyfin.test/**', r => {
   const u = new URL(r.request().url()); let json = {Items: []};
   if (u.pathname.startsWith('/MediaSegments/')) json = {Items: [{Type: 'Intro', StartTicks: 1000000000, EndTicks: 1200000000}, {Type: 'Outro', StartTicks: 17000000000, EndTicks: 18000000000}]};
   else if (u.pathname.endsWith('/Resume')) json = {Items: [movie]};
   else if (u.pathname === '/Users/user/Items/movie') json = movie;
   else if (u.pathname.endsWith('/PlaybackInfo')) json = {PlaySessionId: 'fixture', MediaSources: [{Id: 'source', Container: 'mkv', DefaultSubtitleStreamIndex: -1, MediaStreams: [], SupportsDirectPlay: false, TranscodingUrl: '/Videos/mock/master.m3u8'}]};
   else if (u.pathname.startsWith('/Sessions/') || u.pathname.endsWith('/ActiveEncodings')) return r.fulfill({status: 204});
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'user', token: 'fixture'}));
   localStorage.setItem('ember-display-matching', 'both'); let adapter; Object.defineProperty(window, 'EmberPlatform', {get: () => adapter, set: value => {value.createPlayer = element => element; value.nativePlayback = false; delete value.playbackPolicy; value.displayMatching = () => ({rate: false, resolution: true}); value.configureDisplay = mode => {window.displayPreference = mode;}; adapter = value;}});
   const p = HTMLMediaElement.prototype;
   Object.defineProperties(p, {src: {get() {return this._src || '';}, set(v) {this._src = v; this._time = 0; this._generation = (this._generation || 0) + 1;}}, currentTime: {get() {return this._time || 0;}, set(v) {this._seeks = (this._seeks || []).concat(v); this._seeking = true; const generation = this._generation; setTimeout(() => {if (this._generation !== generation) return; this._time = v; this._seeking = false; this.dispatchEvent(new Event('seeked'));}, 180);}}, duration: {get() {return 1800;}}, readyState: {get() {return 4;}}, seeking: {get() {return !!this._seeking;}}, paused: {get() {return !this._playing;}}});
   p.load = function () {if (this._src) setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0);};
   p.play = function () {this._playing = true; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();};
   p.pause = function () {this._playing = false; this.dispatchEvent(new Event('pause'));};
   const remove = Element.prototype.removeAttribute; p.removeAttribute = function (name) {if (name === 'src') this._src = ''; return remove.call(this, name);};
  });
  await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
  await page.getByRole('button', {name: 'Seeking movie', exact: true}).first().click();
  await page.getByRole('button', {name: 'Play from beginning', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#video')._playing);
  await page.waitForTimeout(100);
  await page.locator('#video').evaluate(v => {v._time = 100; v._seeks = []; v.dispatchEvent(new Event('timeupdate'));});
  await page.waitForFunction(() => !document.querySelector('#skip-segment').hidden);
  assert.equal(await page.locator('#skip-segment').textContent(), 'Skip intro');
  assert.equal(await page.evaluate(() => window.displayPreference), 'off', 'Compatibility playback cannot change display modes');
  await page.keyboard.press('Escape');
  // Real TV remote OK, while transport is hidden, skips directly.
  await page.evaluate(platform => {
    if (platform === 'firetv') window.EmberFireTV.key(13);
    else document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 13, bubbles: true, cancelable: true}));
  }, platform);
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 120);
  assert.equal(await page.locator('#skip-segment').isHidden(), true);
  assert.equal(await page.locator('#controls').getAttribute('aria-hidden'), 'true');
  // Seeking back into the segment offers it again after leaving it.
  await page.locator('#video').evaluate(v => {v.dispatchEvent(new Event('timeupdate')); v._time = 105; v.dispatchEvent(new Event('timeupdate'));});
  await page.waitForFunction(() => !document.querySelector('#skip-segment').hidden);
  await page.locator('#skip-segment').click();
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 120);
  // A profile can automatically skip intros while another profile keeps the button.
  await page.evaluate(() => {
    localStorage.setItem('wholphin-playback-options:https://jellyfin.test:user', JSON.stringify({intro: 'auto', outro: 'off'}));
    const v = document.querySelector('#video'); v.dispatchEvent(new Event('timeupdate')); v._time = 110; v.dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 120);
  await page.locator('#video').evaluate(v => {v._time = 1710; v.dispatchEvent(new Event('timeupdate'));});
  assert.equal(await page.locator('#skip-segment').isHidden(), true, 'Disabled outro does not interrupt credits');
  await page.evaluate(() => {
    localStorage.setItem('wholphin-playback-options:https://jellyfin.test:user', JSON.stringify({intro: 'ask', outro: 'ask'}));
    document.querySelector('#video').dispatchEvent(new Event('timeupdate'));
  });
  await page.waitForFunction(() => !document.querySelector('#skip-segment').hidden);
  await page.screenshot({path: '/private/tmp/ember-segments-' + platform + '.png'});
  await page.locator('#skip-segment').click();
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 1800);
  assert.equal(await page.locator('#skip-segment').isHidden(), true);
  assert.deepEqual(errors, []);
  // The selected profile's skip choices do not change another profile's defaults.
  assert.equal(await page.evaluate(() => localStorage.getItem('wholphin-playback-options:https://jellyfin.test:other')), null);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 413, bubbles: true, cancelable: true})));
  await page.waitForFunction(() => document.querySelector('#player').hidden);
  await page.locator('nav [data-nav=settings]').click();
  await page.getByRole('button', {name: 'Playback', exact: true}).click();
  await page.getByRole('button', {name: 'Skip intro', exact: true}).click();
  assert.equal(await page.locator('#setting-options [aria-pressed="true"]').textContent(), 'Show skip button');
  await page.locator('#setting-options').getByRole('button', {name: 'Automatically', exact: true}).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wholphin-playback-options:https://jellyfin.test:user')).intro), 'auto');
  await page.getByRole('button', {name: 'Match video display', exact: true}).click();
  assert.equal(await page.locator('#setting-options').getByRole('button', {name: 'Resolution', exact: true}).count(), 1);
  assert.equal(await page.locator('#setting-options').getByRole('button', {name: 'Refresh rate', exact: true}).count(), 0, 'Do not offer unadvertised frame-rate switching');
  await page.locator('#setting-options').getByRole('button', {name: 'Off', exact: true}).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('ember-display-matching')), 'off');
  console.log(platform + ': intro/outro buttons, remote OK, replay, profile preferences and compatibility display guard passed');
  await page.close();
 }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
