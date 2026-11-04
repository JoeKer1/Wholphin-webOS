const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 try {for (const platform of ['webos', 'tizen', 'firetv']) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [], requests = [], played = {}, progress = {};
  let failFollowing = true, followingCalls = 0;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
  const show = {Id: 'show', Name: 'Completion show', Type: 'Series', IsFolder: true};
  const season = {Id: 'season', SeriesId: 'show', Name: 'Season 1', Type: 'Season', IsFolder: true, IndexNumber: 1};
  const source = id => ({Id: 'source-' + id, Container: 'mkv', DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1, MediaStreams: [{Type: 'Video', Index: 0, Codec: 'h264'}, {Type: 'Audio', Index: 1, Codec: 'aac', Language: 'eng'}]});
  const episode = id => ({Id: id, Name: 'Episode ' + id.slice(1), Type: 'Episode', SeriesId: 'show', SeriesName: 'Completion show', ParentId: 'season', ParentIndexNumber: 1, IndexNumber: Number(id.slice(1)), MediaType: 'Video', RunTimeTicks: 18000000000, Chapters: [], UserData: {Played: !!played[id], PlaybackPositionTicks: progress[id] || 0}, MediaSources: [source(id)]});
  await page.route('https://jellyfin.test/**', async r => {
   const u = new URL(r.request().url()), body = r.request().postDataJSON();
   requests.push({path: u.pathname, method: r.request().method(), body}); let json = {Items: []};
   if (u.pathname.endsWith('/Resume')) json = {Items: [show]};
   else if (u.pathname === '/Shows/show/Seasons') json = {Items: [season]};
   else if (u.pathname === '/Users/user/Items' && u.searchParams.get('ParentId') === 'season') json = {Items: ['e1', 'e2', 'e3'].map(episode), TotalRecordCount: 3};
   else if (u.pathname === '/Users/user/Items/show') json = show;
   else if (/\/Users\/user\/Items\/e\d$/.test(u.pathname)) json = episode(u.pathname.split('/').at(-1));
   else if (u.pathname === '/Shows/show/Episodes') {
    followingCalls++;
    if (u.searchParams.get('StartItemId') === 'e1' && failFollowing) {failFollowing = false; return r.fulfill({status: 503, body: ''});}
    const start = u.searchParams.get('StartItemId') || 'e1'; json = {Items: ['e1', 'e2', 'e3'].slice(Number(start.slice(1)) - 1).map(episode)};
   } else if (/\/Items\/e\d\/PlaybackInfo$/.test(u.pathname)) {
    const id = u.pathname.split('/')[2]; json = {PlaySessionId: 'session-' + id, MediaSources: [{...source(id), SupportsDirectPlay: false, TranscodingUrl: '/Videos/' + id + '/master.m3u8'}]};
   } else if (u.pathname === '/Sessions/Playing/Stopped') {
    if (body.ItemId === 'e1') return r.fulfill({status: 503, body: ''});
    if (body.PositionTicks >= 18000000000) played[body.ItemId] = true;
    progress[body.ItemId] = played[body.ItemId] ? 0 : body.PositionTicks;
    return r.fulfill({status: 204});
   } else if (/\/Users\/user\/PlayedItems\/e\d$/.test(u.pathname)) {
    const id = u.pathname.split('/').at(-1); played[id] = r.request().method() === 'POST'; progress[id] = 0;
    return r.fulfill({json: {Played: played[id], PlaybackPositionTicks: 0}});
   } else if (u.pathname.endsWith('/ActiveEncodings')) return r.fulfill({status: 503, body: ''});
   else if (u.pathname.startsWith('/Sessions/')) return r.fulfill({status: 204});
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'user', name: 'Test', token: 'fixture'}));
   localStorage.setItem('wholphin-playback-options:https://jellyfin.test:user', JSON.stringify({autoplay: true, stillWatching: 0, countdown: 0}));
   let platform; Object.defineProperty(window, 'EmberPlatform', {get: () => platform, set: value => {value.createPlayer = element => element; value.nativePlayback = false; delete value.playbackPolicy; platform = value;}});
   const p = HTMLMediaElement.prototype;
   Object.defineProperties(p, {src: {get() {return this._src || '';}, set(v) {this._src = v; this._time = 0;}}, currentTime: {get() {return this._time || 0;}, set(v) {this._time = v; setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);}}, duration: {get() {return 1800;}}, readyState: {get() {return 4;}}, seeking: {get() {return false;}}, paused: {get() {return !this._playing;}}});
   p.load = function () {if (this._src) setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0);};
   p.play = function () {this._playing = true; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();};
   p.pause = function () {this._playing = false; this.dispatchEvent(new Event('pause'));};
   const remove = Element.prototype.removeAttribute; p.removeAttribute = function (name) {if (name === 'src') this._src = ''; return remove.call(this, name);};
  });
  await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
  async function wait(fn) {for (let i = 0; i < 300; i++) {if (fn()) return; await page.waitForTimeout(20);} throw Error('Condition not met');}
  const starts = () => requests.filter(r => r.path === '/Sessions/Playing');
  await page.getByRole('button', {name: 'Completion show', exact: true}).first().click();
  await page.locator('.episode-browser-actions').getByRole('button', {name: 'Play', exact: true}).click();
  await wait(() => starts().length === 1); await wait(() => followingCalls >= 1);
  // Some TV engines reset their clock before emitting ended. Completion must retain the full duration.
  await page.locator('#video').evaluate(v => {v.currentTime = 1798; v.dispatchEvent(new Event('timeupdate')); v._time = 0; v.dispatchEvent(new Event('ended')); v.dispatchEvent(new Event('ended'));});
  await wait(() => starts().length === 2);
  assert.equal(starts()[1].body.ItemId, 'e2'); assert.ok(followingCalls >= 2, 'A failed following query is retried at completion');
  const stopOne = requests.filter(r => r.path === '/Sessions/Playing/Stopped' && r.body.ItemId === 'e1');
  assert.equal(stopOne.length, 1, 'Duplicate ended does not duplicate stop'); assert.equal(stopOne[0].body.PositionTicks, 18000000000);
  assert.equal(played.e1, true, 'Natural end is marked watched even when Stopped fails');
  assert.equal(await page.locator('.card[data-item=e1]').getAttribute('data-watched'), 'true', 'Existing season card updates while next episode is playing');
  assert.equal(await page.locator('.card[data-item=e1] .watched-badge').count(), 1);
  assert.equal(await page.locator('.episode-browser-actions').getByRole('button', {name: 'Mark as unwatched', exact: true, includeHidden: true}).count(), 1, 'Selected episode actions refresh too');
  const endedIndex = requests.findIndex(r => r.path === '/Sessions/Playing/Stopped' && r.body.ItemId === 'e1'), nextIndex = requests.findIndex(r => r.path === '/Sessions/Playing' && r.body.ItemId === 'e2'); assert.ok(endedIndex < nextIndex);
  // Skipping a partially watched episode must not mark it complete.
  await page.locator('#video').evaluate(v => {v.currentTime = 100; v.dispatchEvent(new Event('timeupdate'));});
  if (platform === 'firetv') await page.locator('#video').evaluate(v => v.dispatchEvent(new CustomEvent('ember-media-command', {detail: {action: 'next'}})));
  else await page.locator('#next-video').click();
  await wait(() => starts().length === 3);
  assert.equal(starts()[2].body.ItemId, 'e3'); assert.ok(!played.e2);
  assert.equal(requests.filter(r => r.path === '/Users/user/PlayedItems/e2' && r.method === 'POST').length, 0);
  await page.locator('#video').evaluate(v => {v.currentTime = 1800; v.dispatchEvent(new Event('timeupdate')); v.dispatchEvent(new Event('ended'));});
  await page.waitForSelector('body:not(.is-playing)'); assert.equal(played.e3, true);
  assert.equal(requests.filter(r => r.path === '/Users/user/PlayedItems/e3' && r.method === 'POST').length, 0, 'Do not mark twice when the server already completed it');
  await page.locator('nav [data-nav=home]').click(); await page.getByRole('button', {name: 'Completion show', exact: true}).first().click();
  await page.locator('.card[data-item=e3]').waitFor();
  assert.equal(await page.locator('.card[data-item=e1]').getAttribute('data-watched'), 'true');
  assert.equal(await page.locator('.card[data-item=e2]').getAttribute('data-watched'), 'false');
  assert.equal(await page.locator('.card[data-item=e3]').getAttribute('data-watched'), 'true', 'Reopening a cached season needs no client restart');
  assert.deepEqual(errors, []); console.log(`PASS ${platform}: immediate watched badges/actions, zero-clock completion, duplicate ended, following retry, stop/cleanup failures, manual skip, finale and cache refresh`);
  await page.close();
 }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
