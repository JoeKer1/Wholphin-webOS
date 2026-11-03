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
   if (u.pathname.endsWith('/Resume')) json = {Items: [movie]};
   else if (u.pathname === '/Users/user/Items/movie') json = movie;
   else if (u.pathname.endsWith('/PlaybackInfo')) json = {PlaySessionId: 'fixture', MediaSources: [{Id: 'source', Container: 'mkv', DefaultSubtitleStreamIndex: -1, MediaStreams: [], SupportsDirectPlay: false, TranscodingUrl: '/Videos/mock/master.m3u8'}]};
   else if (u.pathname.startsWith('/Sessions/') || u.pathname.endsWith('/ActiveEncodings')) return r.fulfill({status: 204});
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'user', token: 'fixture'}));
   let adapter; Object.defineProperty(window, 'EmberPlatform', {get: () => adapter, set: value => {value.createPlayer = element => element; value.nativePlayback = false; delete value.playbackPolicy; adapter = value;}});
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
  await page.keyboard.press('Escape');
  async function keys(code, count = 1) {
   await page.evaluate(({platform, code, count}) => {for (let i = 0; i < count; i++) {
    if (platform === 'firetv') EmberFireTV.key(code);
    else document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: code, bubbles: true, cancelable: true}));
   }}, {platform, code, count});
  }
  await keys(417, 6);
  assert.equal(await page.locator('#seek-seconds').textContent(), '180', 'Repeated forward presses accumulate');
  assert.equal(await page.locator('#controls').getAttribute('aria-hidden'), 'true', 'Skip does not reveal full controls');
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 280);
  assert.ok(await page.locator('#video').evaluate(v => v._seeks.length <= 2), 'Rapid presses coalesce native seeks');
  await page.screenshot({path: '/private/tmp/ember-seeking-' + platform + '.png'});
  await keys(37);
  assert.equal(await page.locator('#seek-seconds').textContent(), '10', 'Direction change resets displayed distance');
  assert.equal(await page.locator('#seek-feedback').evaluate(n => n.classList.contains('is-backward')), true);
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 270);
  await page.waitForTimeout(850);
  assert.equal(await page.locator('#seek-feedback').isHidden(), true);
  await page.keyboard.press('Enter');
  await page.locator('#toggle').click();
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true);
  await page.keyboard.press('Escape');
  await keys(412);
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 240);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true, 'Seeking keeps paused state');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#seek-feedback').isHidden(), true, 'Back dismisses feedback without stopping playback');
  assert.equal(await page.locator('body.is-playing').count(), 1);
  await page.locator('#timeline').evaluate(n => {n.value = '1795'; n.dispatchEvent(new Event('input'));});
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 1795);
  await page.keyboard.press('Escape');
  await keys(39);
  assert.equal(await page.locator('#seek-seconds').textContent(), '5', 'Feedback shows actual distance at duration boundary');
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 1800);
  await page.emulateMedia({reducedMotion: 'reduce'});
  assert.equal(await page.locator('#seek-indicator img').evaluate(n => getComputedStyle(n).animationName), 'none');
  await keys(412, 3);
  await keys(413);
  await page.waitForSelector('body:not(.is-playing)');
  await page.getByRole('button', {name: 'Play from beginning', exact: true}).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#video').evaluate(v => v.currentTime), 0, 'Pending seeks do not leak into new playback');
  assert.equal(await page.locator('#seek-feedback').isHidden(), true);
  assert.deepEqual(errors, []);
  console.log('PASS ' + platform + ': minimal skip feedback, accumulation, delayed native position, coalescing, reversal, paused seek, bounds, Back, reduced motion and source cleanup');
  await page.close();
 }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
