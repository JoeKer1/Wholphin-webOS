const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {for (const platform of ['webos', 'tizen', 'firetv']) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [], calls = [], positions = {movie: 0, episode: 1200000000};
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
  const source = {Id: 'source', Container: 'mkv', DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1, MediaStreams: [{Type: 'Video', Index: 0, Codec: 'h264'}, {Type: 'Audio', Index: 1, Codec: 'aac', Language: 'eng'}]};
  const item = id => ({Id: id, Name: 'Rewatch ' + id, Type: id === 'movie' ? 'Movie' : 'Episode', ...(id === 'episode' ? {SeriesId: 'show', SeriesName: 'Rewatch show', ParentId: 'season', ParentIndexNumber: 1, IndexNumber: 1} : {}), MediaType: 'Video', RunTimeTicks: 18000000000, Chapters: [], UserData: {Played: true, PlaybackPositionTicks: positions[id], PlayedPercentage: 100, IsFavorite: true}, MediaSources: [source]});
  await page.route('https://jellyfin.test/**', r => {
   const u = new URL(r.request().url()), body = r.request().postDataJSON(); calls.push({path: u.pathname, method: r.request().method(), body}); let json = {Items: []};
   if (u.pathname.endsWith('/Views')) json = {Items: [{Id: 'movies', Name: 'Movies', CollectionType: 'movies'}]};
   else if (u.pathname.endsWith('/Latest')) json = [item('movie')];
   else if (u.pathname.endsWith('/Resume')) json = {Items: ['movie', 'episode'].filter(id => positions[id] > 0).map(item)};
   else if (u.pathname === '/Shows/show/Seasons') json = {Items: [{Id: 'season', Name: 'Season 1', Type: 'Season', IndexNumber: 1}]};
   else if (u.pathname === '/Users/user/Items' && u.searchParams.get('ParentId') === 'season') json = {Items: [item('episode')], TotalRecordCount: 1};
   else if (/\/Users\/user\/Items\/(movie|episode)$/.test(u.pathname)) json = item(u.pathname.split('/').at(-1));
   else if (u.pathname.endsWith('/PlaybackInfo')) json = {PlaySessionId: 'fixture', MediaSources: [{...source, SupportsDirectPlay: false, TranscodingUrl: '/Videos/mock/master.m3u8'}]};
   else if (u.pathname === '/Sessions/Playing/Stopped') {positions[body.ItemId] = body.PositionTicks >= 18000000000 ? 0 : body.PositionTicks; return r.fulfill({status: 204});}
   else if (u.pathname.startsWith('/Sessions/') || u.pathname.endsWith('/ActiveEncodings')) return r.fulfill({status: 204});
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'user', token: 'fixture'}));
   localStorage.setItem('wholphin-playback-options:https://jellyfin.test:user', JSON.stringify({autoplay: false, stillWatching: 0}));
   let adapter; Object.defineProperty(window, 'EmberPlatform', {get: () => adapter, set: value => {value.createPlayer = element => element; value.nativePlayback = false; delete value.playbackPolicy; adapter = value;}});
   const p = HTMLMediaElement.prototype;
   Object.defineProperties(p, {src: {get() {return this._src || '';}, set(v) {this._src = v; this._time = 0;}}, currentTime: {get() {return this._time || 0;}, set(v) {this._time = v; setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);}}, duration: {get() {return 1800;}}, readyState: {get() {return 4;}}, seeking: {get() {return false;}}, paused: {get() {return !this._playing;}}});
   p.load = function () {if (this._src) setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0);};
   p.play = function () {this._playing = true; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();};
   p.pause = function () {this._playing = false; this.dispatchEvent(new Event('pause'));};
   const remove = Element.prototype.removeAttribute; p.removeAttribute = function (name) {if (name === 'src') this._src = ''; return remove.call(this, name);};
  });
  await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
  const resumed = id => page.locator('#home-rows [data-row=continue] [data-item=' + id + ']');
  for (const id of ['movie', 'episode']) {
   if (id === 'movie') await page.locator('#home-rows [data-item=movie]').first().click();
   else await resumed(id).click();
   await page.getByRole('button', {name: id === 'movie' ? 'Play from beginning' : 'Resume', exact: true}).click();
   await page.waitForFunction(() => document.querySelector('#video')._playing);
   await page.waitForTimeout(100);
   await page.locator('#video').evaluate(v => {v.currentTime = 600; v.dispatchEvent(new Event('timeupdate'));});
   await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 413, bubbles: true})));
   await page.waitForSelector('body:not(.is-playing)');
   await page.getByRole('button', {name: 'Resume', exact: true}).waitFor();
   assert.equal(positions[id], 6000000000, 'Rewatch stop saves position without unmarking watched');
   await page.locator('nav [data-nav=home]').click();
   await resumed(id).waitFor();
   assert.equal(await resumed(id).locator('.watched-badge').count(), 1);
   assert.equal(await resumed(id).locator('.card-progress').count(), 1, 'Watched check does not hide rewatch progress');
   const width = await resumed(id).locator('.card-progress div').evaluate(n => parseFloat(n.style.width));
   assert.ok(Math.abs(width - 100 / 3) < 0.1, 'Progress uses resume position even if PlayedPercentage is stale');
   await resumed(id).click();
   await page.getByRole('button', {name: 'Resume', exact: true}).click();
   await page.waitForFunction(() => document.querySelector('#video')._playing && document.querySelector('#video').currentTime === 600);
   await page.locator('#video').evaluate(v => {v.currentTime = 1800; v.dispatchEvent(new Event('timeupdate')); v.dispatchEvent(new Event('ended'));});
   await page.waitForSelector('body:not(.is-playing)');
   await page.waitForTimeout(200);
   await page.locator('nav [data-nav=home]').click();
   await page.locator('#home-rows [data-item=movie]').first().waitFor();
   assert.equal(await resumed(id).count(), 0, 'Completed rewatch leaves Continue watching');
  }
  assert.equal(calls.filter(c => c.path.includes('/PlayedItems/')).length, 0, 'Rewatch never resets watched history');
  assert.deepEqual(errors, []);
  console.log('PASS ' + platform + ': movie and episode rewatch stop, Continue watching, watched plus progress, resume position and completion');
  await page.close();
 }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
