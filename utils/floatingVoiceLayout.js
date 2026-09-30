export const VOICE_BALL_SIZE = 76;
const GAP = 12;

export function floatingVoiceBounds({ width, height, top = 8, bottom = 8, left = 8, right = 8 }) {
  const minX = Math.max(0, left), minY = Math.max(0, top);
  return { minX, minY, maxX: Math.max(minX, width - right - VOICE_BALL_SIZE), maxY: Math.max(minY, height - bottom - VOICE_BALL_SIZE) };
}

export function clampVoiceDrag(point, bounds) {
  return { x: Math.max(bounds.minX, Math.min(bounds.maxX, Number(point.x) || 0)), y: Math.max(bounds.minY, Math.min(bounds.maxY, Number(point.y) || 0)) };
}

export function voiceOverlapsTimer(point, obstacle) {
  return !!obstacle && point.x < obstacle.x + obstacle.width + GAP && point.x + VOICE_BALL_SIZE + GAP > obstacle.x
    && point.y < obstacle.y + obstacle.height + GAP && point.y + VOICE_BALL_SIZE + GAP > obstacle.y;
}

export function snapVoicePosition(point, bounds, obstacle) {
  const clamped = clampVoiceDrag(point, bounds);
  const x = clamped.x <= (bounds.minX + bounds.maxX) / 2 ? bounds.minX : bounds.maxX;
  const preferred = { x, y: clamped.y };
  if (!voiceOverlapsTimer(preferred, obstacle)) return preferred;
  const alternatives = [obstacle.y - VOICE_BALL_SIZE - GAP, obstacle.y + obstacle.height + GAP]
    .filter(y => y >= bounds.minY && y <= bounds.maxY)
    .map(y => ({ x, y })).sort((a, b) => Math.abs(a.y - preferred.y) - Math.abs(b.y - preferred.y));
  if (alternatives.length) return alternatives[0];
  // A compact/landscape viewport may not have a vertical slot on that side.
  const opposite = { x: x === bounds.minX ? bounds.maxX : bounds.minX, y: clamped.y };
  return !voiceOverlapsTimer(opposite, obstacle) ? opposite : preferred;
}

// Only layout coordinates are shared. No account, audio or other user data.
let timerSnapshot = null;
let timerOwner = null;
const subscribers = new Set();
export const getFloatingTimerObstacle = () => timerSnapshot;
export function subscribeFloatingTimerObstacle(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }
export function publishFloatingTimerObstacle(owner, rect) {
  if (!rect && owner !== timerOwner) return;
  const unchanged = timerSnapshot === rect || (timerSnapshot && rect && ["x", "y", "width", "height"].every(key => timerSnapshot[key] === rect[key]));
  timerOwner = rect ? owner : null;
  if (unchanged) return;
  timerSnapshot = rect;
  subscribers.forEach(callback => callback());
}
