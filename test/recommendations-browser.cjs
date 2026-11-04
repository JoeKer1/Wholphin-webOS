const assert = require('node:assert/strict'), path = require('node:path'), {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
 let document = {Id: 'settings', CustomPrefs: {unrelated: 'keep'}};
 try {for (const platform of ['webos', 'tizen', 'firetv']) {
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}}), errors = [], infos = [];
  let number = platform === 'webos' ? 1 : 2, show = 'show', profile = 'one', failQuality = false;
  page.on('pageerror', e => errors.push(e.message));
  const source = n => ({Id: 'source-' + n, Container: 'mkv', Bitrate: 15000000, DefaultAudioStreamIndex: 1, DefaultSubtitleStreamIndex: -1, MediaStreams: [
   {Type: 'Video', Index: 0, Codec: 'h264', Width: 1920, Height: 1080, VideoRangeType: 'SDR'},
   {Type: 'Audio', Index: 1, Codec: 'aac', Language: 'eng', DisplayTitle: 'English'}, {Type: 'Audio', Index: 3, Codec: 'aac', Language: 'jpn', DisplayTitle: 'Japanese'},
   {Type: 'Subtitle', Index: 6, Codec: 'subrip', Language: 'eng', DisplayTitle: 'English'},
   {Type: 'Subtitle', Index: n === 1 ? 2 : 7, Codec: 'subrip', Language: 'en', IsHearingImpaired: true, DisplayTitle: 'English SDH'}]});
  const episode = n => ({Id: show + n, Name: 'Episode ' + n, Type: 'Episode', SeriesId: show, SeriesName: 'Track show', SeasonId: show + '-season', ParentId: show + '-season', ParentIndexNumber: 1, IndexNumber: n, RunTimeTicks: 18000000000, Genres: ['Anime'], MediaType: 'Video', UserData: {}, Chapters: [], MediaSources: [source(n)], ImageTags: {Primary: 'still-' + n}, SeriesPrimaryImageTag: 'poster-v2'});
  await page.route('**/webapis/webapis.js', r => r.fulfill({body: ''}));
  await page.route('https://jellyfin.test/**', async r => {
   const u = new URL(r.request().url()), body = r.request().postDataJSON(); let json = {Items: []};
   if (u.pathname === '/DisplayPreferences/usersettings') {
    if (profile === 'two') return r.fulfill({json: {CustomPrefs: {}}});
    if (body) {assert.equal(body.CustomPrefs.unrelated, 'keep'); document = body; return r.fulfill({status: 204});}
    return r.fulfill({json: document});
   }
   if (u.pathname.endsWith('/Resume')) json = {Items: [episode(number)]};
   else if (u.pathname.endsWith('/Seasons')) json = {Items: [{Id: show + '-season', Name: 'Season 1', IndexNumber: 1, Type: 'Season'}]};
   else if (u.pathname.endsWith('/Items') && u.searchParams.has('ParentId')) json = {Items: [episode(1), episode(2)], TotalRecordCount: 2};
   else if (/\/Items\/(show|other)[12]$/.test(u.pathname)) json = episode(Number(u.pathname.at(-1)));
   else if (u.pathname.endsWith('/PlaybackInfo')) {
    const n = Number(u.pathname.split('/')[2].at(-1));
    if (body) {infos.push(body); if (failQuality) return r.fulfill({status: 403, body: ''});}
    json = {PlaySessionId: 'fixture', MediaSources: [{...source(n), SupportsDirectPlay: !!body?.EnableDirectPlay, TranscodingUrl: '/Videos/test/master.m3u8'}]};
   } else if (u.pathname.includes('/Subtitles/')) return r.fulfill({contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:01.000 --> 00:00:10.000\nCaption\n'});
   else if (u.pathname.includes('/Images/')) return r.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150"/>'});
   else if (u.pathname.startsWith('/Sessions/') || u.pathname.endsWith('/ActiveEncodings')) return r.fulfill({status: 204});
   return r.fulfill({json});
  });
  await page.addInitScript(() => {
   if (!localStorage.getItem('wholphin-session')) localStorage.setItem('wholphin-session', JSON.stringify({server: 'https://jellyfin.test', user: 'one', name: 'One', token: 'fixture'}));
   localStorage.setItem('wholphin-subtitle-appearance:https://jellyfin.test:one', JSON.stringify({enabled: true}));
   localStorage.setItem('wholphin-audio-defaults:https://jellyfin.test:one', JSON.stringify({animeLanguage: 'eng'}));
   window.EmberAndroid = {capabilities: () => JSON.stringify({videos: [{codec: 'h264', width: 3840, height: 2160, fps: 60, bitDepth: 8}], audio: ['aac'], maxAudioChannels: 2, videoRanges: ['SDR']})};
   let platform; Object.defineProperty(window, 'EmberPlatform', {get: () => platform, set: value => {value.createPlayer = element => element; platform = value;}});
   const p = HTMLMediaElement.prototype;
   Object.defineProperties(p, {src: {get() {return this._src || '';}, set(v) {this._src = v; this._time = 0;}}, currentTime: {get() {return this._time || 0;}, set(v) {this._time = v; setTimeout(() => this.dispatchEvent(new Event('seeked')), 0);}}, duration: {get() {return 1800;}}, readyState: {get() {return 4;}}, seeking: {get() {return false;}}, paused: {get() {return !this._playing;}}});
   p.load = function () {if (this._src) setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0);};
   p.play = function () {this._playing = true; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); return Promise.resolve();};
   p.pause = function () {this._playing = false; this.dispatchEvent(new Event('pause'));};
   const remove = Element.prototype.removeAttribute; p.removeAttribute = function (name) {if (name === 'src') this._src = ''; return remove.call(this, name);};
  });
  await page.goto(pathToFileURL(path.resolve('dist', platform, 'index.html')).href);
  async function details() {
   const card = page.locator('#home-rows [data-item=' + show + number + ']');
   assert.match(await card.locator('img').getAttribute('data-src') || await card.locator('img').getAttribute('src'), /tag=poster-v2/);
   await card.click(); await page.waitForFunction(() => document.querySelector('#detail-subtitles') && !document.querySelector('#detail-subtitles').disabled);
  }
  await details();
  if (platform === 'webos') {
   await page.locator('#detail-subtitles').click(); await page.locator('#detail-subtitle-menu [data-index="2"]').click();
  } else assert.equal(await page.locator('#detail-subtitles').evaluate(n => n.value), '7', 'Another platform matches the selected SDH track despite changed stream indices');
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#video')._playing);
  async function waitCount(n) {await page.waitForFunction(n => document.querySelector('#video')._playing || document.querySelector('#video').paused, n); for (let i = 0; i < 250; i++) {if (infos.length >= n && await page.locator('#quality').isEnabled()) return; await page.waitForTimeout(20);} throw Error('Missing playback request');}
  async function panel(id) {await page.locator('#player-options').click(); await page.locator('#' + id).click();}
  if (platform === 'webos') {
   await panel('audio'); await page.getByRole('button', {name: 'Japanese', exact: true}).click();
   await waitCount(2); await page.waitForTimeout(100);
  } else assert.equal(infos[0].AudioStreamIndex, 3, 'Show preference overrides the general Anime language on another platform');
  if (platform === 'firetv') assert.equal(infos[0].EnableDirectPlay, true, 'Exercise the native Fire TV policy, not just compatibility playback');
  const count = infos.length;
  await page.locator('#video').evaluate(v => {v.currentTime = 123; v.dispatchEvent(new Event('timeupdate')); v.pause();});
  await panel('quality');
  await page.keyboard.press('ArrowDown');
  assert.match(await page.locator(':focus').textContent(), /Mbps/, 'Remote reaches a quality option');
  await page.screenshot({path: '/private/tmp/ember-quality-' + platform + '.png'});
  await page.getByRole('button', {name: '5 Mbps', exact: true}).click(); await waitCount(count + 1);
  const limited = infos.at(-1);
  assert.equal(limited.StartTimeTicks, 1230000000); assert.equal(limited.AudioStreamIndex, 3); assert.equal(limited.SubtitleStreamIndex, -1);
  assert.equal(limited.MaxStreamingBitrate, 5000000); assert.equal(limited.AllowVideoStreamCopy, false); assert.equal(limited.EnableDirectPlay, false); assert.equal(limited.EnableDirectStream, false);
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 123);
  assert.equal(await page.locator('#video').evaluate(v => v.paused), true, 'Quality changes keep a paused video paused');
  const afterLimit = infos.length;
  await panel('audio'); await page.getByRole('button', {name: 'English', exact: true}).click(); await waitCount(afterLimit + 1);
  assert.equal(infos.at(-1).MaxStreamingBitrate, 5000000, 'Changing audio keeps the quality limit');
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 123);
  await panel('audio'); await page.getByRole('button', {name: 'Japanese', exact: true}).click(); await waitCount(afterLimit + 2);
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 123);
  const beforeAutomatic = infos.length;
  await panel('quality'); assert.equal(await page.getByRole('button', {name: '5 Mbps', exact: true}).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', {name: 'Automatic', exact: true}).click(); await waitCount(beforeAutomatic + 1);
  if (platform === 'firetv') assert.equal(infos.at(-1).EnableDirectPlay, true, 'Automatic restores direct play on supported native players');
  assert.ok(infos.at(-1).MaxStreamingBitrate > 5000000); assert.equal(infos.at(-1).AllowVideoStreamCopy, true);
  await page.waitForFunction(() => document.querySelector('#video').currentTime === 123);
  await panel('quality'); failQuality = true;
  await page.getByRole('button', {name: '2 Mbps', exact: true}).click(); await page.getByText('Could not change quality.', {exact: false}).waitFor();
  assert.equal(await page.locator('#player').isVisible(), true); failQuality = false;
  number = 2; await page.reload(); await details();
  assert.equal(await page.locator('#detail-subtitles').evaluate(n => n.value), '7');
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem('wholphin-language-sync-pending:https://jellyfin.test:one') || '{}')['series-track-preferences']);
  assert.equal(JSON.parse(document.CustomPrefs['ember-series-track-preferences']).entries['series:show'].Audio.value.language, 'ja');
  show = 'other'; number = 1; await page.reload(); await details();
  assert.equal(await page.locator('#detail-subtitles').evaluate(n => n.value), '-1', 'Another show does not inherit this show subtitle choice');
  profile = 'two'; show = 'show';
  await page.evaluate(() => {const s = JSON.parse(localStorage.getItem('wholphin-session')); s.user = 'two'; localStorage.setItem('wholphin-session', JSON.stringify(s));});
  await page.reload(); await details();
  assert.equal(await page.locator('#detail-subtitles').evaluate(n => n.value), '-1', 'Another profile does not inherit show choices');
  assert.deepEqual(errors, []); console.log('PASS ' + platform + ': series track sync/isolation/reordered SDH, tagged artwork, quality conversion/restore/position/tracks/paused/failure');
  await page.close();
 }} finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
