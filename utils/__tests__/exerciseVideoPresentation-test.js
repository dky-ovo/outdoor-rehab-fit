import vm from 'node:vm';
import { EXERCISE_VIDEO_RATIO, exerciseVideoHtml, previewFrameTime } from '../exerciseVideoPresentation';

jest.mock('../api', () => ({ resolveApiAssetUrl: value => value }));

function documentFor(preview = true) {
  const events = {}, documentEvents = {}, messages = [], buttonEvents = {};
  const video = { currentTime: 0, duration: 8, readyState: 0, ended: false, paused: true, dataset: {},
    play: jest.fn(() => Promise.resolve()), pause: jest.fn(), addEventListener: (name, callback) => { events[name] = callback; } };
  const notice = { style: {}, textContent: '' }, resume = { style: {}, addEventListener: (name, callback) => { buttonEvents[name] = callback; } };
  const document = { hidden: false, getElementById: name => ({ video, notice, resume })[name], addEventListener: (name, callback) => { documentEvents[name] = callback; } };
  const html = exerciseVideoHtml('https://host/video.mp4', { preview, title: '<unsafe "title">' });
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { document, window: { ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) } } });
  return { events, documentEvents, messages, buttonEvents, video, notice, resume, document, html };
}

test('covers have a fixed ratio and choose a frame within short clips', () => {
  expect(EXERCISE_VIDEO_RATIO).toBe(16 / 9);
  expect([100, 2, .2, 0, NaN, Infinity, -1].map(previewFrameTime)).toEqual([1, .5, .05, 0, 0, 0, 0]);
  expect(exerciseVideoHtml('javascript:alert(1)')).toBe('');
});

test('native cover never starts or reports playback, renders only a loaded selected frame, and exposes errors', () => {
  const p = documentFor();
  expect(p.html).toContain('object-fit:cover');
  expect(p.html).toContain('<video id="video" muted');
  expect(p.html).not.toContain('controls autoplay');
  expect(p.html).toContain('&lt;unsafe &quot;title&quot;&gt;');
  p.events.loadedmetadata();
  expect(p.video.currentTime).toBe(1); expect(p.notice.style.display).not.toBe('none');
  p.video.readyState = 2; p.video.currentTime = 0; p.events.loadeddata();
  expect(p.notice.style.display).not.toBe('none');
  p.video.currentTime = 1; p.events.seeked(); expect(p.notice.style.display).toBe('none');
  p.events.play(); expect(p.video.pause).toHaveBeenCalledTimes(1);
  expect(p.video.play).not.toHaveBeenCalled(); expect(p.messages).toEqual([]);
  p.events.error(); expect(p.notice.style.display).toBe('flex'); expect(p.notice.textContent).toBe('暫無預覽');
  p.document.hidden = true; p.documentEvents.visibilitychange(); expect(p.video.pause).toHaveBeenCalledTimes(2);
});

test('native full player retains controls, bounded automatic start and real events; rejected autoplay offers a button', async () => {
  const p = documentFor(false);
  expect(p.html).toContain('object-fit:contain'); expect(p.html).toContain('controls autoplay');
  p.video.play.mockRejectedValueOnce(new Error('gesture required'));
  p.events.canplay(); p.events.canplay(); await Promise.resolve(); await Promise.resolve();
  expect(p.video.play).toHaveBeenCalledTimes(1); expect(p.resume.style.display).toBe('block');
  p.buttonEvents.click(); await Promise.resolve(); expect(p.video.play).toHaveBeenCalledTimes(2);
  p.video.currentTime = 2; p.events.playing();
  p.video.ended = true; p.events.pause(); p.events.ended();
  expect(p.messages.map(row => row.state)).toEqual(['playing', 'ended']);
  expect(p.messages[0]).toEqual({ type: 'facility-video', state: 'playing', positionMs: 2000, durationMs: 8000 });
  expect(p.resume.style.display).toBe('none');
});
