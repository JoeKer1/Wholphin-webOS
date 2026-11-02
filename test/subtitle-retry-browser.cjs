const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {for (const platform of ['webos', 'tizen', 'firetv']) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [], infos = [], starts = [];
  let attempts = 0, mode = 'once';
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
  const source = {Id: 'source', Container: 'mkv', DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: 9, MediaStreams: [{Type: 'Video', Index: 0, Codec: 'h264'}, {Type: 'Audio', Index: 1, Codec: 'aac', Language: 'eng'}, {Type: 'Subtitle', Index: 9, Codec: 'subrip', Language: 'eng'}, {Type: 'Subtitle', Index: 12, Codec: 'pgssub', Language: 'spa'}]};
  const item = {Id: 'movie', Name: 'Retry test', Type: 'Movie', MediaType: 'Video', RunTimeTicks: 18000000000};
  await page.route('https://jellyfin.test/**', async r => {
   const u = new URL(r.request().url()), body = r.request().postDataJSON(); let json = {Items: []};
   if (u.pathname.endsWith('/Resume')) json = {Items: [item]};
   if (u.pathname === '/Users/user/Items/movie') json = item;
   if (u.pathname === '/Items/movie/PlaybackInfo') {if (body) infos.push(body); json = {PlaySessionId: 'session', MediaSources: [{...source, SupportsDirectPlay: false, TranscodingUrl: '/Videos/movie/master.m3u8'}]};}
   if (u.pathname.includes('/Subtitles/')) {
    attempts++;
    if (mode === 'always' || (mode === 'once' && attempts === 1)) return r.fulfill({status: 503, body: ''});
    if (mode === 'missing') return r.fulfill({status: 404, body: ''});
    return r.fulfill({contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:29:59.000\nTest dialogue'});
   }
   if (u.pathname === '/Sessions/Playing') starts.push(body);
   if (u.pathname.startsWith('/Sessions/') || u.pathname.endsWith('/ActiveEncodings')) return r.fulfill({status: 204});
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'user', name: 'Test', token: 'fixture'}));
   localStorage.setItem('wholphin-subtitle-appearance:https://jellyfin.test:user', JSON.stringify({enabled: true}));
   let platform;
   Object.defineProperty(window, 'EmberPlatform', {get: () => platform, set: value => {value.createPlayer = element => element; value.nativePlayback = false; delete value.playbackPolicy; platform = value;}});
   const p = HTMLMediaElement.prototype;
   Object.defineProperties(p, {src: {get() {return this._src || '';}, set(v) {this._src = v; this._time = 0;}}, currentTime: {get() {return this._time || 0;}, set(v) {this._time = v; setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);}}, duration: {get() {return 1800;}}, readyState: {get() {return 4;}}, seeking: {get() {return false;}}, paused: {get() {return !this._playing;}}});
   p.load = function () {if (this._src) setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0);};
   p.play = function () {this._playing = true; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();};
   p.pause = function () {this._playing = false; this.dispatchEvent(new Event('pause'));};
   const remove = Element.prototype.removeAttribute; p.removeAttribute = function (name) {if (name === 'src') this._src = ''; return remove.call(this, name);};
  });
  await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
  async function wait(fn) {for (let i = 0; i < 200; i++) {if (fn()) return; await page.waitForTimeout(20);} throw Error('Condition not met');}
  async function start() {await page.locator('nav [data-nav=home]').click(); await page.getByRole('button', {name: 'Retry test', exact: true}).first().click(); await page.getByRole('button', {name: 'Play from beginning', exact: true}).click();}
  async function stop() {await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 413, bubbles: true}))); await page.waitForSelector('body:not(.is-playing)');}
  async function subtitles() {if (await page.locator('#player-tools').isHidden()) await page.locator('#player-options').click(); await page.locator('#subtitles').click();}
  await start(); await wait(() => starts.length === 1);
  assert.equal(attempts, 2); assert.equal(infos.at(-1).SubtitleStreamIndex, -1, `${platform}: transient extraction must not request burn-in`);
  assert.ok(!(await page.locator('#status').textContent()).includes('server-rendered'));
  await stop(); mode = 'always'; attempts = 0;
  await start(); await wait(() => starts.length === 2); assert.equal(attempts, 2); assert.notEqual(infos.at(-1).SubtitleStreamIndex, -1); assert.equal(infos.at(-1).AllowVideoStreamCopy, false);
  mode = 'success';
  await page.locator('#video').evaluate(v => {v.currentTime = 321; v.pause();});
  await subtitles(); await page.getByRole('button', {name: 'English · SRT', exact: true}).click();
  await wait(() => starts.length === 3); assert.equal(infos.at(-1).SubtitleStreamIndex, -1, 'Reselecting a burned-in SRT track recovers soft subtitles');
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true); assert.equal(infos.at(-1).StartTimeTicks, 3210000000);
  await subtitles(); const before = attempts; await page.getByRole('button', {name: 'Spanish · PGS', exact: true}).click();
  await wait(() => starts.length === 4); assert.equal(attempts, before, 'Bitmap subtitles do not enter text extraction');
  await stop(); mode = 'missing'; attempts = 0;
  // Restore the title's SRT selection for a new playback.
  await page.evaluate(() => {localStorage.removeItem('wholphin-subtitle-choices:https://jellyfin.test:user'); localStorage.removeItem('wholphin-track-preferences:https://jellyfin.test:user');});
  await start(); await wait(() => starts.length === 5); assert.equal(attempts, 1, 'A missing track is not retried');
  mode = 'always'; attempts = 0; await subtitles(); await page.getByRole('button', {name: 'English · SRT', exact: true}).click(); await wait(() => attempts === 1);
  await stop(); await page.waitForTimeout(500); assert.equal(attempts, 1, 'Stopping cancels the retry delay'); assert.equal(starts.length, 5);
  assert.deepEqual(errors, []); console.log(`PASS ${platform}: transient retry, bounded fallback, same-track recovery preserving pause/resume, PGS, permanent errors and cancellation`);
  await page.close();
 }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
