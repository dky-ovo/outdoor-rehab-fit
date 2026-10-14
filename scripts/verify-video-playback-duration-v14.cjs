// Read only local public-video files through a loopback server. No production
// requests, credentials, playback, downloads or changes to the video manifest.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('C:/Users/杜铠羽/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'workspace-artifacts/video-capacity-20261003-v14');
const plan = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { entries: [] };
const previousPath = path.join(OUT, 'source-playback-durations.json');
const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : { entries: [] };
const observationsPath = path.join(ROOT, 'workspace-artifacts/load-test-20261003-v13/results.json');
const observations = JSON.parse(fs.readFileSync(observationsPath, 'utf8')).setups;
const files = new Map(), rows = [];
for (const source of plan.entries) {
  const filePath = path.resolve(ROOT, source.sourceLocalPath);
  if (!filePath.startsWith(ROOT + path.sep) || fs.lstatSync(filePath).isSymbolicLink() || fs.statSync(filePath).size !== source.sourceSizeBytes) throw new Error('UNSAFE_LOCAL_SOURCE');
  files.set(source.sourceSha256, filePath);
  const derivative = manifest.entries.find(entry => entry.sourceSha256 === source.sourceSha256);
  if (derivative) {
    const derivativePath = path.join(OUT, 'derivatives', derivative.derivativeStorageName);
    if (!/^[a-f0-9]{64}\.mp4$/.test(derivative.derivativeStorageName) || fs.lstatSync(derivativePath).isSymbolicLink()) throw new Error('UNSAFE_LOCAL_DERIVATIVE');
    files.set(derivative.derivativeSha256, derivativePath);
  }
  rows.push({ source, derivative });
}
const server = http.createServer((request, response) => {
  if (request.url === '/') { response.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store'}); return response.end('<!doctype html><title>Local metadata verification</title>'); }
  const match = /^\/video\/([a-f0-9]{64})\.mp4$/.exec(request.url || '');
  const file = match && files.get(match[1]);
  if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); return response.end(); }
  const size = fs.statSync(file).size, range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0, end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) { response.writeHead(416, {'Content-Range': `bytes */${size}`}); return response.end(); }
  response.writeHead(range ? 206 : 200, {'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...(range ? {'Content-Range': `bytes ${start}-${end}/${size}`} : {})});
  if (request.method === 'HEAD') return response.end();
  const stream = fs.createReadStream(file, {start, end});
  stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response);
});
function save(result) { const temporary = previousPath + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n'); fs.renameSync(temporary, previousPath); }
(async () => {
  let browser;
  const result = { version: 1, observedAtUTC: new Date().toISOString(), source: 'local Edge HTMLMediaElement loadedmetadata, preload metadata, no playback', network: 'loopback only', complete: false, entries: [] };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({channel: 'msedge', headless: true});
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    await page.goto(base + '/');
    const metadata = sha => page.evaluate(src => new Promise((resolve, reject) => {
      const video = document.createElement('video'); video.preload = 'metadata'; video.autoplay = false; video.muted = true;
      const done = value => { clearTimeout(timer); video.pause(); video.removeAttribute('src'); video.load(); video.remove(); resolve(value); };
      const timer = setTimeout(() => { video.remove(); reject(new Error('LOCAL_METADATA_TIMEOUT')); }, 10000);
      video.onloadedmetadata = () => done({durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight});
      video.onerror = () => { clearTimeout(timer); video.remove(); reject(new Error('LOCAL_METADATA_ERROR')); };
      document.body.append(video); video.src = src;
    }), base + `/video/${sha}.mp4`);
    for (const {source, derivative} of rows) {
      const cached = previous.entries.find(entry => entry.sourceSha256 === source.sourceSha256);
      const sourceMetadata = cached?.sourceMetadata || await metadata(source.sourceSha256);
      if (!Number.isFinite(sourceMetadata.durationSeconds) || sourceMetadata.durationSeconds <= 0) throw new Error('INVALID_SOURCE_BROWSER_DURATION');
      const observed = [...new Set(observations.filter(item => item.ok && item.src === source.sourcePublicPath && Number.isFinite(item.duration)).map(item => item.duration))];
      const matchesPrevious = observed.length ? observed.every(duration => Math.round(duration * 1000) === Math.round(sourceMetadata.durationSeconds * 1000)) : null;
      if (matchesPrevious === false) throw new Error('ORIGINAL_BROWSER_DURATION_CHANGED');
      const derivativeMetadata = derivative ? (cached?.derivativeSha256 === derivative.derivativeSha256 ? cached.derivativeMetadata : null) || await metadata(derivative.derivativeSha256) : null;
      const entry = {sourceSha256: source.sourceSha256, sourceStorageName: source.sourceStorageName, sourcePublicPath: source.sourcePublicPath, equipmentId: source.equipmentId, locale: source.locale, sourcePlaybackDurationSeconds: sourceMetadata.durationSeconds, sourceMetadata, previousProductionBrowserDurations: observed, matchesPreviousProductionAtMilliseconds: matchesPrevious,
        ...(derivative ? {derivativeSha256: derivative.derivativeSha256, derivativeMetadata, playbackDurationDifferenceSeconds: Math.abs(derivativeMetadata.durationSeconds - sourceMetadata.durationSeconds)} : {})};
      result.entries.push(entry); save(result);
    }
    result.complete = result.entries.length === plan.entries.length;
    result.finishedAtUTC = new Date().toISOString(); result.originalProductionComparisons = result.entries.filter(entry => entry.matchesPreviousProductionAtMilliseconds === true).length;
    result.derivativeMetadataCount = result.entries.filter(entry => entry.derivativeMetadata).length; save(result);
    console.log(JSON.stringify({complete: result.complete, sourceMetadataCount: result.entries.length, derivativeMetadataCount: result.derivativeMetadataCount, originalProductionComparisons: result.originalProductionComparisons}));
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
