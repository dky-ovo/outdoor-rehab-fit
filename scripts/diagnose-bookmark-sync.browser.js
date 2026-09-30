// Run in the Console of the signed-in https://app.outdoorfit.hk page.
// Read local state and send an EMPTY changes list: never change favorites.
// No credentials, account identifiers, favorite IDs or response bodies are logged.
(async () => {
  const report = { diagnostic: 'bookmark-sync-20260928', origin: location.origin };
  const print = () => console.log('BOOKMARK_SYNC_DIAGNOSTIC\n' + JSON.stringify(report, null, 2));
  if (location.origin !== 'https://app.outdoorfit.hk') {
    report.error = 'OPEN_APP_OUTDOORFIT_HK_FIRST'; print(); return;
  }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safeError = value => typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : 'REQUEST_FAILED';
  try {
    const session = JSON.parse(localStorage.getItem('authSession') || 'null');
    const owner = localStorage.getItem('currentOwnerKey');
    const raw = owner ? JSON.parse(localStorage.getItem(`userData/${owner}/bookmarkedItems`) || '{}') : {};
    const current = object(raw) && raw.format === 2;
    const values = current ? raw.value : raw;
    const pending = current && object(raw.pending) ? Object.values(raw.pending) : [];
    const selected = object(values) ? Object.keys(values).filter(id => Boolean(values[id])) : [];
    report.pageVisible = document.visibilityState === 'visible';
    report.webV9Loaded = Array.from(document.scripts).some(script => script.src.includes('entry-8a54489af61ffb4173f17a5befbf94fa.js'));
    report.loggedIn = Boolean(session?.token);
    report.guest = owner === 'guest' || session?.isGuest === true || session?.role === 'guest';
    report.ownerPresent = Boolean(owner);
    const meta = owner ? JSON.parse(localStorage.getItem(`userData/${owner}/meta`) || 'null') : null;
    report.localOwnerMatchesSession = Boolean(meta?.remoteId && session?.id && String(meta.remoteId) === String(session.id));
    report.localFormat = current ? 2 : 1;
    report.syncInitialized = current && raw.initialized === true;
    report.localSelectedCount = selected.length;
    report.pendingCount = pending.length;
    report.invalidPendingCount = pending.filter(change => !object(change)
      || typeof change.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(change.id)
      || ['__proto__', 'constructor', 'prototype'].includes(change.id)
      || typeof change.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(change.operationId)
      || typeof change.selected !== 'boolean'
      || !(change.version === null || Number.isSafeInteger(change.version) && change.version >= 0)).length;
    if (!session?.token || report.guest) { print(); return; }
    const read = async (name, path, options) => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, signal: controller.signal });
        report[name + 'Http'] = response.status;
        const body = await response.json().catch(() => null);
        if (!response.ok) { report[name + 'Error'] = safeError(body?.error); return null; }
        return body;
      } catch (error) { report[name + 'Error'] = error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR'; return null; }
      finally { clearTimeout(timer); }
    };
    const me = await read('profile', '/api/users/me', { method: 'GET' });
    if (me) report.serverAccountMatchesSession = String(me.user?.id ?? me.id ?? '') === String(session.id ?? '');
    const result = await read('cloud', '/api/account/bookmarks/sync', { method: 'POST', body: JSON.stringify({ changes: [] }) });
    if (result) {
      report.cloudResponseValid = Array.isArray(result.records) && Array.isArray(result.acknowledged);
      if (Array.isArray(result.records)) {
        report.cloudRecordCount = result.records.length;
        report.cloudInvalidRecordCount = result.records.filter(row => typeof row.id !== 'string' || typeof row.selected !== 'boolean' || !Number.isSafeInteger(row.version)).length;
        const cloud = new Set(result.records.filter(row => row.selected === true && typeof row.id === 'string').map(row => row.id));
        const local = new Set(selected);
        report.cloudSelectedCount = cloud.size;
        report.localOnlyCount = selected.filter(id => !cloud.has(id)).length;
        report.cloudOnlyCount = [...cloud].filter(id => !local.has(id)).length;
      }
    }
  } catch { report.error = 'LOCAL_STATE_UNREADABLE'; }
  print();
})();
