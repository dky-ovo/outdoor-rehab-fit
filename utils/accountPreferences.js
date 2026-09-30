import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentOwnerKey, userDataKey } from './userStorage';
import { updateJournal, journalBatch, reconcileJournal, releaseRejectedJournalBatch } from './accountSyncJournal';
import { notifyAccountData } from './accountSyncEvents';
const queues = new Map();
function serial(owner, work) {
  const result = (queues.get(owner) || Promise.resolve()).then(work), tail = result.catch(() => {});
  queues.set(owner, tail); void tail.then(() => { if (queues.get(owner) === tail) queues.delete(owner); }); return result;
}
const key = owner => userDataKey('accountPreferencesV1', owner);
const read = async owner => JSON.parse(await AsyncStorage.getItem(key(owner)) || '{"values":{}}');
export const getAccountPreferences = owner => serial(owner, async () => (await read(owner)).values);
export function saveAccountLanguage(locale) {
  const owner = getCurrentOwnerKey(); if (!owner || !['zh','en'].includes(locale)) return Promise.resolve();
  return serial(owner, async () => {
    const state = await read(owner); state.values.language = { locale };
    state.cloud = updateJournal(state.cloud, state.values);
    await AsyncStorage.setItem(key(owner), JSON.stringify(state)); notifyAccountData(owner, 'preferences');
  });
}
export async function synchronizePreferences({ owner, token, send, isCurrent }) {
  const outgoing = await serial(owner, async () => {
    if (!isCurrent()) return null;
    const state = await read(owner); state.cloud = updateJournal(state.cloud, state.values);
    const changes = journalBatch(state.cloud, state.values, { retainUnacknowledged: true });
    await AsyncStorage.setItem(key(owner), JSON.stringify(state));
    return { collection: 'preferences', cursor: state.cloud.cursor, changes };
  });
  if (!outgoing || !isCurrent()) return;
  let result;
  try { result = await send(token, outgoing); }
  catch (error) {
    if (error?.status === 400 && error?.code === 'invalidAccountData') {
      await serial(owner, async () => {
        if (!isCurrent()) return;
        const state = await read(owner); if (!isCurrent()) return;
        state.cloud = releaseRejectedJournalBatch(state.cloud, outgoing.changes);
        await AsyncStorage.setItem(key(owner), JSON.stringify(state));
      });
    }
    throw error;
  }
  let pending = false;
  await serial(owner, async () => {
    if (!isCurrent()) return;
    const state = await read(owner), merged = reconcileJournal(state.cloud, result, outgoing.changes, state.values);
    await AsyncStorage.setItem(key(owner), JSON.stringify({ values: merged.documents, cloud: merged.journal }));
    pending = Object.keys(merged.journal.pending).length > 0;
    if (JSON.stringify(state.values) !== JSON.stringify(merged.documents)) notifyAccountData(owner, 'preferences', true);
  });
  return result.more || pending;
}
