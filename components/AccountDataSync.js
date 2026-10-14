import { useContext, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { LocaleContext } from '../contexts/LocaleContext';
import { getOwnerKey, getCurrentOwnerKey } from '../utils/userStorage';
import { syncAccountDocuments, syncAccountBookmarks, getOwnLearningProgress } from '../utils/api';
import { subscribeBookmarkChanges, synchronizeBookmarks } from '../utils/bookmarks';
import { synchronizeAssistantConversations } from '../utils/assistantConversations';
import { synchronizeGoals } from '../utils/goals';
import { synchronizeUsage } from '../utils/usage';
import { synchronizePreferences, getAccountPreferences } from '../utils/accountPreferences';
import { mergeRemoteLearning, getPendingLearningRecords } from '../utils/learning';
import { createLearningSync } from '../utils/learningSync';
import { getSessions } from '../utils/sessions';
import { subscribeAccountData } from '../utils/accountSyncEvents';
import { setAccountSyncStatus, subscribeAccountSyncRetry } from '../utils/accountSyncStatus';
import { createAccountSyncScheduler } from '../utils/accountSyncScheduler';

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
    let disposed = false, lastExtended = 0;
    const pending = new Set();
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
      for (let page = 0; page < 10; page++) {
        if (!current() || !foreground()) return true;
        if (!await work()) return false;
      }
      return true;
    };
    // Keep jobs lazy: constructing promises here would start all requests
    // together before the worker has a chance to serialize them.
    const jobs = {
      bookmarks: () => synchronizeBookmarks({ ...options, send: syncAccountBookmarks }),
      'assistant:zh': () => drain(() => synchronizeAssistantConversations({ ...options, owner: accountId, locale: 'zh' })),
      'assistant:en': () => drain(() => synchronizeAssistantConversations({ ...options, owner: accountId, locale: 'en' })),
      'assistant:bailian:zh': () => drain(() => synchronizeAssistantConversations({ ...options, owner: accountId, locale: 'zh', provider: 'bailian' })),
      'assistant:bailian:en': () => drain(() => synchronizeAssistantConversations({ ...options, owner: accountId, locale: 'en', provider: 'bailian' })),
      goals: () => drain(() => synchronizeGoals(options)),
      usage: () => drain(() => synchronizeUsage(options)),
      preferences: async () => {
        const more = await drain(() => synchronizePreferences(options));
        if (current()) await applyLanguage();
        return more;
      },
      sessions: async () => { await getSessions(token, { strict: true }); return false; },
      // A retained/failed upload must stay visible without blocking downloads
      // of this account's other progress. Both jobs contribute to final status.
      learningUpload: async () => {
        await learning.flush();
        if (!current()) return false;
        if ((await getPendingLearningRecords(owner)).length) throw new Error('LEARNING_UPLOAD_PENDING');
        return false;
      },
      learningDownload: async () => {
        for (let page = 1; page <= 100 && current(); page++) {
          if (!foreground()) return true;
          const result = await getOwnLearningProgress(token, page);
          if (!current()) return false;
          if (!Array.isArray(result?.items) || !Number.isInteger(result.totalPages)) throw new Error('LEARNING_RESPONSE_INVALID');
          await mergeRemoteLearning(owner, result.items, current);
          if (page >= result.totalPages) return false;
        }
        if (current()) throw new Error('LEARNING_PAGES_PENDING');
        return false;
      },
    };
    const assistantJobs = ['assistant:zh', 'assistant:en', 'assistant:bailian:zh', 'assistant:bailian:en'];
    const basicJobs = ['bookmarks', ...assistantJobs, 'goals', 'usage', 'preferences'];
    const flush = async reasons => {
      const full = reasons.some(reason => ['initial', 'periodic', 'manual', 'foreground'].includes(reason));
      if (full) basicJobs.forEach(key => pending.add(key));
      if (full && (!lastExtended || Date.now() - lastExtended >= 60000 || reasons.some(reason => ['manual', 'foreground'].includes(reason)))) {
        lastExtended = Date.now();
        ['sessions', 'learningUpload', 'learningDownload'].forEach(key => pending.add(key));
      }
      const work = [...pending]; pending.clear();
      let failed = false, retryAfterMs = 0;
      for (const key of work) {
        if (!current() || !foreground()) { pending.add(key); continue; }
        try { if (await jobs[key]()) pending.add(key); }
        catch (error) {
          failed = true; pending.add(key);
          if (Number.isFinite(error?.retryAfterMs)) retryAfterMs = Math.max(retryAfterMs, error.retryAfterMs);
        }
      }
      return { failed, more: pending.size > 0, retryAfterMs };
    };
    const scheduler = createAccountSyncScheduler({
      run: flush, isCurrent: current, isActive: foreground,
      onStart: () => setAccountSyncStatus(owner, { state: 'syncing' }),
      onComplete: ({ failed, pending: queued }) => setAccountSyncStatus(owner, failed ? { state: 'pending' } : queued ? { state: 'syncing' } : { state: 'synced', lastSuccess: Date.now() }),
    });
    const unsubscribe = subscribeAccountData(event => {
      if (!event.remote && [owner, accountId].includes(event.owner)) {
        // A usage tick or goal edit only needs its own collection. Periodic,
        // login and manual passes still download every account collection.
        const keys = event.kind === 'assistant' ? assistantJobs : Object.hasOwn(jobs, event.kind) ? [event.kind] : basicJobs;
        keys.forEach(key => pending.add(key));
        scheduler.request();
      }
    });
    const retry = subscribeAccountSyncRetry(value => { if (value === owner) scheduler.request('manual'); });
    const bookmarkChanges = subscribeBookmarkChanges((changedOwner, details) => {
      if (changedOwner !== owner || details?.remote) return;
      pending.add('bookmarks');
      scheduler.request();
    });
    const subscription = AppState.addEventListener('change', value => {
      if (value === 'active') scheduler.request('foreground');
      else scheduler.pause();
    });
    scheduler.start();
    return () => { disposed = true; scheduler.dispose(); learning.dispose(); unsubscribe(); bookmarkChanges(); retry(); subscription.remove(); };
  }, [scope, owner, accountId, token, isGuest, isLoading]);
  return null;
}
