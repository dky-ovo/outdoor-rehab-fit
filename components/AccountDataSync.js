import { useContext, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { LocaleContext } from '../contexts/LocaleContext';
import { getOwnerKey, getCurrentOwnerKey } from '../utils/userStorage';
import { syncAccountDocuments, getOwnLearningProgress } from '../utils/api';
import { synchronizeAssistantConversations } from '../utils/assistantConversations';
import { synchronizeGoals } from '../utils/goals';
import { synchronizeUsage } from '../utils/usage';
import { synchronizePreferences, getAccountPreferences } from '../utils/accountPreferences';
import { mergeRemoteLearning, getPendingLearningRecords } from '../utils/learning';
import { createLearningSync } from '../utils/learningSync';
import { getSessions } from '../utils/sessions';
import { subscribeAccountData } from '../utils/accountSyncEvents';
import { setAccountSyncStatus, subscribeAccountSyncRetry } from '../utils/accountSyncStatus';

// Root-mounted: no navigation, image download or screen loader waits for this.
export default function AccountDataSync() {
  const { user, isGuest, isLoading } = useAuth();
  const { applyAccountLanguage } = useContext(LocaleContext);
  const apply = useRef(applyAccountLanguage); apply.current = applyAccountLanguage;
  const owner = user && getOwnerKey(user), accountId = user?.id && String(user.id), token = user?.token;
  const scope = `${owner}|${accountId}|${token}|${user?.assistantSessionId}`;
  const latest = useRef(scope); latest.current = scope;
  useEffect(() => {
    if (!owner || !accountId || !token || isGuest || isLoading) return;
    let disposed = false, running = false, dirty = false, timer, lastExtended = 0;
    const current = () => !disposed && latest.current === scope && getCurrentOwnerKey() === owner;
    const foreground = () => !AppState.currentState || AppState.currentState === 'active';
    const options = { owner, token, send: syncAccountDocuments, isCurrent: current };
    const learning = createLearningSync({ owner, token, isCurrent: current });
    const applyLanguage = async () => {
      const preferences = await getAccountPreferences(owner);
      if (current() && preferences.language?.locale) apply.current?.(preferences.language.locale);
    };
    void applyLanguage().catch(() => {});
    const drain = async work => {
      for (let page = 0; page < 10 && current(); page++) if (!await work()) return;
      dirty = true;
    };
    const flush = async () => {
      if (!current() || !foreground()) return;
      if (running) { dirty = true; return; }
      running = true; dirty = false;
      setAccountSyncStatus(owner, { state: 'syncing' });
      const work = [
        ...['zh', 'en'].map(locale => drain(() => synchronizeAssistantConversations({ ...options, owner: accountId, locale }))),
        drain(() => synchronizeGoals(options)), drain(() => synchronizeUsage(options)),
        drain(() => synchronizePreferences(options)).then(applyLanguage),
      ];
      if (Date.now() - lastExtended >= 60000) {
        lastExtended = Date.now();
        work.push(getSessions(token, { strict: true }));
        work.push((async () => {
          await learning.flush();
          if (!current()) return;
          if ((await getPendingLearningRecords(owner)).length) throw new Error('LEARNING_UPLOAD_PENDING');
          for (let page = 1; page <= 100 && current(); page++) {
            const result = await getOwnLearningProgress(token, page);
            if (!Array.isArray(result?.items) || !Number.isInteger(result.totalPages)) throw new Error('LEARNING_RESPONSE_INVALID');
            await mergeRemoteLearning(owner, result.items, current);
            if (page >= result.totalPages) return;
          }
          throw new Error('LEARNING_PAGES_PENDING');
        })());
      }
      const results = await Promise.allSettled(work);
      running = false;
      if (!current()) return;
      const failed = results.some(result => result.status === 'rejected');
      if (failed) lastExtended = 0;
      setAccountSyncStatus(owner, failed ? { state: 'pending' } : dirty ? { state: 'syncing' } : { state: 'synced', lastSuccess: Date.now() });
      if (dirty) schedule();
    };
    const schedule = () => { if (!timer && current()) timer = setTimeout(() => { timer = undefined; void flush(); }, 1000); };
    const unsubscribe = subscribeAccountData(event => {
      if (!event.remote && [owner, accountId].includes(event.owner)) { dirty = true; schedule(); }
    });
    const retry = subscribeAccountSyncRetry(value => { if (value === owner) { lastExtended = 0; void flush(); } });
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') { lastExtended = 0; void flush(); } });
    const interval = setInterval(() => { void flush(); }, 30000);
    void flush();
    return () => { disposed = true; learning.dispose(); unsubscribe(); retry(); subscription.remove(); clearInterval(interval); clearTimeout(timer); };
  }, [scope, owner, accountId, token, isGuest, isLoading]);
  return null;
}
