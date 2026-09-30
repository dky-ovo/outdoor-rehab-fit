// Durable account data. Only the production process starts the job dispatcher.
// No provider request or database transaction depends on an open phone socket.
export function installAccountContinuity({ app, database: db, authenticate, findUser, answer, documents }) {
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  const publicJob = row => ({ id: row.id, status: row.status,
    ...(row.status === 'complete' ? { result: parse(row.result_json) } : {}),
    ...(row.status === 'complete' && row.error_code === 'accountHistoryFull' ? { historyError: row.error_code } : {}),
    ...(row.status === 'failed' ? { error: row.error_code } : {}) });
  const owner = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = await authenticate(req);
    if (!user) res.status(401).json({ error: 'unauthorized' });
    return user;
  };
  let started = false, stopping = false, work = null, retry, requested = false, completing = null, claiming = null;
  async function recordResult(tx, row, input, message) {
    try {
      if (documents) await documents.recordJob(tx, row.user_id, row.id, input, message);
      return null;
    } catch (error) {
      // Capacity cannot recover by retrying this answer. Retain the job result
      // even when history is full; actual database failures still retry normally.
      if (error?.code !== 'accountHistoryFull') throw error;
      console.error('ASSISTANT_JOB_HISTORY_FULL');
      return error.code;
    }
  }
  async function commitResult() {
    const { row, result, error } = completing;
    if (!(await findUser(row.user_id))) await db.run('DELETE FROM assistant_jobs WHERE user_id = ?', [row.user_id]);
    else await db.transaction(async tx => {
      if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [row.user_id])) return;
      const historyError = await recordResult(tx, row, parse(row.request_json), error
        ? { action: 'error', reply: parse(row.request_json).locale === 'en' ? 'This request could not be completed. Please send it again.' : '此查詢未能完成，請重新發送。' } : result);
      await tx.run('UPDATE assistant_jobs SET status = ?, result_json = ?, request_json = NULL, error_code = ?, completed_at = ? WHERE id = ?',
        [error ? 'failed' : 'complete', result && !error ? JSON.stringify(result) : null, error || historyError, Date.now(), row.id]);
    });
    completing = null;
  }
  async function claimNext() {
    while (!stopping) {
      if (claiming) {
        // This single production worker has not called the provider yet. A lost
        // UPDATE response may already have committed; reconcile that exact job
        // before claiming another one or issuing any provider request.
        const current = await db.get('SELECT * FROM assistant_jobs WHERE id = ?', [claiming.id]);
        if (!current || !['queued', 'running'].includes(current.status)) { claiming = null; continue; }
        if (current.status === 'running') { claiming = null; return current; }
        claiming = current;
      } else {
        claiming = await db.get("SELECT * FROM assistant_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1");
        if (!claiming) return null;
      }
      const row = claiming;
      const claim = await db.run("UPDATE assistant_jobs SET status = 'running' WHERE id = ? AND status = 'queued'", [row.id]);
      claiming = null;
      if (claim.affectedRows) return row;
    }
    return null;
  }
  async function drain() {
    while (!stopping) {
      // A transient RDS failure when saving an answer retries that save only.
      if (completing) await commitResult();
      const row = await claimNext();
      if (!row) return;
      let result = null, error = null;
      try {
        const user = await findUser(row.user_id);
        if (!user || user.deleted_at) error = 'accountDeleted';
        else {
          let status = 200;
          const response = { status(n) { status = n; return this; }, setHeader() {},
            json(value) { if (status >= 400) error = value.error || 'deepSeekUnavailable'; else result = value; return this; } };
          await answer({ body: parse(row.request_json) }, response, user);
          if (!result && !error) error = 'deepSeekInvalidResponse';
        }
      } catch { error = 'deepSeekUnavailable'; }
      // Recheck deletion after the provider returns; never retain a deleted account's answer.
      completing = { row, result, error };
      await commitResult();
    }
  }
  function kick() {
    if (!started || stopping) return;
    if (work) { requested = true; return; }
    requested = false;
    work = drain().catch(() => {
      console.error('ASSISTANT_JOB_WORKER RETRY');
      if (!stopping) { retry = setTimeout(kick, 10000); retry.unref?.(); }
    }).finally(() => { work = null; if (requested) kick(); });
  }
  app.post('/api/assistant/jobs', async (req, res) => {
    const user = await owner(req, res); if (!user) return;
    const { id, request: input } = req.body || {};
    if (!validId(id) || !input || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 600 || input.imageData) {
      return res.status(400).json({ error: 'invalidAssistantJob' });
    }
    const body = { message: input.message, locale: input.locale === 'en' ? 'en' : 'zh',
      history: Array.isArray(input.history) ? input.history.slice(-8).filter(x => x && ['user', 'assistant'].includes(x.role))
        .map(x => ({ role: x.role, content: String(x.content || '').slice(0, 6000) })) : [] };
    for (const key of ['latitude', 'longitude']) if (Number.isFinite(input[key])) body[key] = input[key];
    if (input.conversation && validId(input.conversation.id) && validId(input.conversation.userMessageId)
      && ['zh','en'].includes(input.conversation.locale) && Number.isFinite(Date.parse(input.conversation.createdAt))) {
      body.conversation = { id: input.conversation.id, userMessageId: input.conversation.userMessageId,
        locale: input.conversation.locale, createdAt: input.conversation.createdAt };
    }
    await db.run('DELETE FROM assistant_jobs WHERE completed_at < ?', [Date.now() - 7 * 86400000]);
    const result = await db.transaction(async tx => {
      if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [user.id])) return { error: 'unauthorized', code: 401 };
      const existing = await tx.get('SELECT * FROM assistant_jobs WHERE id = ?', [id]);
      if (existing) return existing.user_id === user.id ? { job: publicJob(existing) } : { error: 'invalidAssistantJob', code: 409 };
      const count = await tx.get('SELECT COUNT(*) AS n FROM assistant_jobs WHERE user_id = ? AND created_at > ?', [user.id, Date.now() - 600000]);
      if (Number(count.n) >= 30) return { error: 'assistantRateLimited', code: 429 };
      const pending = await tx.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE user_id = ? AND status IN ('queued', 'running')", [user.id]);
      if (Number(pending.n) >= 4) return { error: 'assistantJobBusy', code: 409 };
      await tx.run("INSERT INTO assistant_jobs (id, user_id, status, request_json, created_at) VALUES (?, ?, 'queued', ?, ?)", [id, user.id, JSON.stringify(body), Date.now()]);
      if (documents) await documents.recordJob(tx, user.id, id, body);
      return { job: { id, status: 'queued' } };
    });
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.status(202).json(result.job); kick();
  });
  app.get('/api/assistant/jobs/:id', async (req, res) => {
    const user = await owner(req, res); if (!user) return;
    const row = validId(req.params.id) && await db.get('SELECT * FROM assistant_jobs WHERE id = ? AND user_id = ?', [req.params.id, user.id]);
    if (!row) return res.status(404).json({ error: 'assistantJobNotFound' });
    res.json(publicJob(row)); kick();
  });
  app.post('/api/account/bookmarks/sync', async (req, res) => {
    const user = await owner(req, res); if (!user) return;
    const changes = req.body?.changes;
    if (!Array.isArray(changes) || changes.length > 100 || changes.some(x => !x || typeof x.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(x.id) || ['__proto__','constructor','prototype'].includes(x.id)
      || !validId(x.operationId) || typeof x.selected !== 'boolean' || !(x.version === null || Number.isSafeInteger(x.version) && x.version >= 0))) {
      return res.status(400).json({ error: 'invalidBookmarks' });
    }
    const result = await db.transaction(async tx => {
      if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [user.id])) return null;
      const acknowledged = [];
      for (const change of changes) {
        const previous = await tx.get('SELECT * FROM account_bookmarks WHERE user_id = ? AND equipment_id = ?', [user.id, change.id]);
        // null version is a one-time legacy import. Preserve remote removals.
        // Version checks also make lost-response retries safe after another device writes.
        if (!previous) {
          await tx.run('INSERT INTO account_bookmarks (user_id, equipment_id, selected, version, last_operation) VALUES (?, ?, ?, 1, ?)',
            [user.id, change.id, Number(change.selected), change.operationId]);
        } else if (previous.last_operation !== change.operationId && change.version !== null && Number(previous.version) === change.version) {
          await tx.run('UPDATE account_bookmarks SET selected = ?, version = version + 1, last_operation = ? WHERE user_id = ? AND equipment_id = ?',
            [Number(change.selected), change.operationId, user.id, change.id]);
        }
        acknowledged.push({ id: change.id, operationId: change.operationId });
      }
      return { acknowledged, records: (await tx.all('SELECT equipment_id, selected, version FROM account_bookmarks WHERE user_id = ?', [user.id]))
        .map(x => ({ id: x.equipment_id, selected: Boolean(x.selected), version: Number(x.version) })) };
    });
    if (!result) return res.status(401).json({ error: 'unauthorized' });
    res.json(result);
  });
  return {
    async start() {
      // Single production API instance. A process interruption is explicit, never
      // an automatic second paid provider request with an ambiguous first result.
      if (documents) {
        const interrupted = await db.all("SELECT * FROM assistant_jobs WHERE status = 'running'");
        for (const row of interrupted) await db.transaction(async tx => {
          if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [row.user_id])) return;
          const input = parse(row.request_json);
          await recordResult(tx, row, input, { action: 'error', reply: input.locale === 'en' ? 'The request was interrupted. Please send it again.' : '查詢已中斷，請重新發送。' });
        });
      }
      await db.run("UPDATE assistant_jobs SET status = 'failed', request_json = NULL, error_code = 'assistantInterrupted', completed_at = ? WHERE status = 'running'", [Date.now()]);
      await db.run('DELETE FROM assistant_jobs WHERE completed_at < ?', [Date.now() - 7 * 86400000]);
      await db.run('DELETE FROM assistant_jobs WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)');
      await db.run('DELETE FROM account_bookmarks WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)');
      if (documents) await db.run('DELETE FROM account_documents WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)');
      started = true; kick();
    },
    async stop() { stopping = true; clearTimeout(retry); await work; },
  };
}
