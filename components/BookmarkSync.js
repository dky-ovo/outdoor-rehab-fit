import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { getOwnerKey } from '../utils/userStorage';
import { subscribeBookmarkChanges, synchronizeBookmarks } from '../utils/bookmarks';
import { syncAccountBookmarks } from '../utils/api';

export default function BookmarkSync() {
  const { user, isGuest, isLoading } = useAuth();
  const owner = user && getOwnerKey(user), token = user?.token;
  const scope = `${owner}|${token}`, current = useRef(scope); current.current = scope;
  useEffect(() => {
    if (!owner || !token || isGuest || isLoading) return;
    let disposed = false, running = null, timer;
    const flush = () => {
      if (disposed || running || AppState.currentState && AppState.currentState !== 'active') return;
      running = synchronizeBookmarks({ owner, token, send: syncAccountBookmarks, isCurrent: () => !disposed && current.current === scope })
        .catch(() => {}).finally(() => { running = null; });
    };
    const unsubscribe = subscribeBookmarkChanges(changed => {
      // Sync also publishes local cache changes; never start an echo loop.
      if (changed !== owner || running || timer) return;
      timer = setTimeout(() => { timer = null; flush(); }, 1000);
    });
    const subscription = AppState.addEventListener('change', flush);
    const interval = setInterval(flush, 30000); flush();
    return () => { disposed = true; unsubscribe(); subscription.remove(); clearTimeout(timer); clearInterval(interval); };
  }, [scope, owner, token, isGuest, isLoading]);
  return null;
}
