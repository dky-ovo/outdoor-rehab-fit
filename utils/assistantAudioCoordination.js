// Assistant audio only: no recording or transcript is stored here.
const microphones = new Set();
const readers = new Set();
export function setAssistantMicrophoneActive(owner, active) {
  if (active) microphones.add(owner); else microphones.delete(owner);
}
export const isAssistantMicrophoneActive = () => microphones.size > 0;
export function registerAssistantReader(stop) {
  readers.add(stop);
  return () => readers.delete(stop);
}
export async function stopAssistantReaders(except) {
  await Promise.all([...readers].filter(stop => stop !== except).map(stop => Promise.resolve().then(stop).catch(() => {})));
}
