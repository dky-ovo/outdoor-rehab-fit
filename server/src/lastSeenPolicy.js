// Database activity timestamps are UTC. This skips redundant telemetry writes,
// never identity reads or authorization checks.
export function shouldTouchLastSeen(value, nowMs = Date.now()) {
  if (typeof value !== "string" || !Number.isFinite(nowMs)) return true;
  const text = value.trim();
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(text)
    ? text
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(text)
      ? text.replace(" ", "T") + "Z"
      : "";
  const previous = utc ? Date.parse(utc) : NaN;
  return !Number.isFinite(previous) || previous > nowMs || nowMs - previous > 60_000;
}
