// Durable account data. Only the production process starts the job dispatcher.
// No provider request or database transaction depends on an open phone socket.
import { createAssistantDeadline } from './assistantDeadline.js';

export function installAccountContinuity({ app, database: db, authenticate, findUser, answer, documents, prepareRequest, maxConcurrentJobs = 6, jobTimeoutMs = 75000 }) {
  if (!Number.isInteger(maxConcurrentJobs) || maxConcurrentJobs < 1 || maxConcurrentJobs > 16) {
    throw new TypeError('maxConcurrentJobs must be an integer between 1 and 16');
  }
  if (!Number.isInteger(jobTimeoutMs) || jobTimeoutMs < 1 || jobTimeoutMs > 120000) throw new TypeError('Invalid assistant job deadline');
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
  const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
  const sameGeneration = (current, original) => current && current.user_id === original.user_id
    && String(current.created_at) === String(original.created_at) && current.request_json === original.request_json;
  const runtimeFor = row => parse(row.request_json)?.runtimeSnapshot;
  const providerFor = row => runtimeFor(row)?.provider || parse(row.result_json)?.provider || 'deepseek';
  const retainedRequest = row => runtimeFor(row) ? JSON.stringify({ runtimeSnapshot: runtimeFor(row) }) : null;
  function snapshotFor(value) {
    if (!value || !['deepseek', 'bailian'].includes(value.provider)) throw Object.assign(new Error('assistantRuntimeInvalid'), { code: 'assistantRuntimeInvalid' });
    const result = { provider: value.provider };
    for (const key of ['model', 'revision', 'promptMode', 'scope', 'responsePolicy']) if (typeof value[key] === 'string') result[key] = value[key];
    if (typeof value.faqEnabled === 'boolean') result.faqEnabled = value.faqEnabled;
    if (Number.isSafeInteger(value.protocol)) result.protocol = value.protocol;
    return result;
  }
  const publicJob = row => ({ id: row.id, status: row.status, provider: providerFor(row),
    ...(runtimeFor(row)?.model ? { model: runtimeFor(row).model } : {}),
    ...(row.status === 'complete' ? { result: parse(row.result_json) } : {}),
    ...(row.status === 'complete' && row.error_code === 'accountHistoryFull' ? { historyError: row.error_code } : {}),
    ...(row.status === 'failed' ? { error: row.error_code } : {}) });
  const owner = async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = await authenticate(req);
    if (!user) res.status(401).json({ error: 'unauthorized' });
    return user;
  };
  let started = false, stopping = false, claimQueue = Promise.resolve();
  const workers = Array.from({ length: maxConcurrentJobs }, () => ({ work: null, retry: null, requested: false, completing: null, claiming: null, settling: null }));
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
  async function commitResult(worker) {
    const { row, result, error } = worker.completing;
    if (!(await findUser(row.user_id))) await db.run('DELETE FROM assistant_jobs WHERE user_id = ?', [row.user_id]);
    else await db.transaction(async tx => {
      if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [row.user_id])) return;
      // A history deletion can remove a pending job while its provider is running.
      // An uncertain previous COMMIT can also have completed it already.
      const current = await tx.get("SELECT * FROM assistant_jobs WHERE id = ? AND user_id = ? AND status = 'running' FOR UPDATE", [row.id, row.user_id]);
      // A deleted ID may have been submitted again. Never save an old answer
      // into that new request, even when it now belongs to another worker slot.
      if (!sameGeneration(current, row)) return;
      const historyError = await recordResult(tx, row, parse(row.request_json), error
        ? { action: 'error', reply: parse(row.request_json).locale === 'en' ? 'This request could not be completed. Please send it again.' : '此查詢未能完成，請重新發送。' } : result);
      await tx.run('UPDATE assistant_jobs SET status = ?, result_json = ?, request_json = ?, error_code = ?, completed_at = ? WHERE id = ?',
        [error ? 'failed' : 'complete', result && !error ? JSON.stringify(result) : null, retainedRequest(row), error || historyError, Date.now(), row.id]);
    });
    worker.completing = null;
  }
  async function claimNextLocked(worker) {
    while (!stopping) {
      if (worker.claiming) {
        // A lost UPDATE response may already have committed. This slot retains
        // its reservation, so only this slot can reconcile and invoke the provider.
        const current = await db.get('SELECT * FROM assistant_jobs WHERE id = ?', [worker.claiming.id]);
        if (!sameGeneration(current, worker.claiming) || !['queued', 'running'].includes(current.status)) { worker.claiming = null; continue; }
        if (current.status === 'running') { worker.claiming = null; return current; }
        worker.claiming = current;
      } else {
        const reserved = workers.flatMap(slot => slot.claiming ? [slot.claiming.id] : []);
        worker.claiming = await db.get("SELECT * FROM assistant_jobs WHERE status = 'queued'"
          + (reserved.length ? ` AND id NOT IN (${reserved.map(() => '?').join(',')})` : '')
          + ' ORDER BY created_at, id LIMIT 1', reserved);
        if (!worker.claiming) return null;
      }
      const row = worker.claiming;
      const claim = await db.run("UPDATE assistant_jobs SET status = 'running' WHERE id = ? AND status = 'queued' AND user_id = ? AND created_at = ? AND request_json = ?",
        [row.id, row.user_id, row.created_at, row.request_json]);
      worker.claiming = null;
      if (claim.affectedRows) return row;
    }
    return null;
  }
  function claimNext(worker) {
    // Serialize only the short claim step within this single production process.
    // Provider calls never hold the claim lock or a database transaction.
    const operation = claimQueue.then(() => claimNextLocked(worker));
    claimQueue = operation.catch(() => {});
    return operation;
  }
  async function drain(worker) {
    while (!stopping) {
      // A transient RDS failure when saving an answer retries that save only.
      if (worker.completing) await commitResult(worker);
      if (worker.settling) { await worker.settling; worker.settling = null; }
      const row = await claimNext(worker);
      if (!row) return;
      let result = null, error = null;
      const deadline = createAssistantDeadline({ timeoutMs: jobTimeoutMs, code: 'assistantTimeout' });
      const operation = (async () => {
        const user = await findUser(row.user_id);
        deadline.signal.throwIfAborted();
        if (!user || user.deleted_at) error = 'accountDeleted';
        else {
          let status = 200;
          const response = { status(n) { status = n; return this; }, setHeader() {},
            json(value) {
              // A late response after cancellation cannot replace the durable timeout.
              if (!deadline.signal.aborted) {
                if (status >= 400) error = value.error || 'deepSeekUnavailable'; else result = value;
              }
              return this;
            } };
          const body = parse(row.request_json);
          const runtime = body.runtimeSnapshot || { provider: 'deepseek' };
          await answer({ body, assistantRuntime: runtime, signal: deadline.signal }, response, user);
          if (result) {
            if (result.provider != null && result.provider !== runtime.provider || runtime.provider === 'bailian' && runtime.model && result.model !== runtime.model) {
              result = null; error = 'assistantProviderMismatch';
            } else result = { ...result, provider: runtime.provider, ...(runtime.model && !result.model ? { model: runtime.model } : {}),
              ...(runtime.responsePolicy ? { responsePolicy: runtime.responsePolicy } : {}) };
          }
          if (!result && !error) error = 'deepSeekInvalidResponse';
        }
      })();
      const finished = operation.then(() => {}, () => {});
      try { await deadline.run(() => operation); }
      catch (failure) {
        error = deadline.signal.aborted ? 'assistantTimeout' : 'deepSeekUnavailable';
        const code = /^[A-Za-z0-9_]{1,64}$/.test(failure?.code || '') ? failure.code : 'ASSISTANT_EXECUTION_FAILED';
        console.error('ASSISTANT_JOB_EXECUTION ' + code);
      } finally { deadline.close(); }
      // Recheck deletion after the provider returns; never retain a deleted account's answer.
      worker.completing = { row, result, error };
      worker.settling = Promise.all([finished, deadline.whenIdle()]);
      await commitResult(worker);
      // Do not turn a transport that ignores abort into unbounded provider
      // concurrency. Its slot remains occupied until actual work has settled.
      await worker.settling; worker.settling = null;
    }
  }
  function kickWorker(worker) {
    if (!started || stopping) return;
    if (worker.work) { worker.requested = true; return; }
    clearTimeout(worker.retry);
    worker.requested = false;
    worker.work = drain(worker).catch(error => {
      const code = /^[A-Za-z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'ASSISTANT_WORKER_FAILED';
      console.error('ASSISTANT_JOB_WORKER RETRY ' + (worker.completing ? 'SAVE ' : worker.claiming ? 'CLAIM ' : 'DISPATCH ') + code);
      if (!stopping) { worker.retry = setTimeout(() => kickWorker(worker), 10000); worker.retry.unref?.(); }
    }).finally(() => { worker.work = null; if (worker.requested) kickWorker(worker); });
  }
  function kick() {
    for (const worker of workers) kickWorker(worker);
  }
  // Protocol-specific paths fail closed on a pre-provider server after rollback.
  // Keep legacy paths only for already-installed DeepSeek clients.
  app.post(['/api/assistant/jobs', '/api/assistant/v2/jobs'], async (req, res) => {
    const user = await owner(req, res); if (!user) return;
    const { id, request: input } = req.body || {};
    if (!validId(id) || !input || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 600 || input.imageData) {
      return res.status(400).json({ error: 'invalidAssistantJob' });
    }
    const provider = input.provider || 'deepseek';
    if (!['deepseek', 'bailian'].includes(provider) || input.historyScope != null && input.historyScope !== provider
      || input.conversation?.provider != null && input.conversation.provider !== provider) return res.status(400).json({ error: 'assistantProviderMismatch' });
    const body = { message: input.message, locale: input.locale === 'en' ? 'en' : 'zh',
      history: Array.isArray(input.history) ? input.history.slice(-8).filter(x => x && ['user', 'assistant'].includes(x.role))
        .map(x => ({ role: x.role, content: String(x.content || '').slice(0, 6000) })) : [] };
    for (const key of ['latitude', 'longitude']) if (Number.isFinite(input[key])) body[key] = input[key];
    if (input.conversation && validId(input.conversation.id) && validId(input.conversation.userMessageId)
      && ['zh','en'].includes(input.conversation.locale) && Number.isFinite(Date.parse(input.conversation.createdAt))) {
      body.conversation = { id: input.conversation.id, userMessageId: input.conversation.userMessageId, provider,
        locale: input.conversation.locale, createdAt: input.conversation.createdAt };
    }
    await db.run('DELETE FROM assistant_jobs WHERE completed_at < ?', [Date.now() - 7 * 86400000]);
    const result = await db.transaction(async tx => {
      if (!await tx.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [user.id])) return { error: 'unauthorized', code: 401 };
      const existing = await tx.get('SELECT * FROM assistant_jobs WHERE id = ?', [id]);
      if (existing) return existing.user_id === user.id && providerFor(existing) === provider ? { job: publicJob(existing) } : { error: 'invalidAssistantJob', code: 409 };
      if (prepareRequest) {
        try {
          body.runtimeSnapshot = snapshotFor(await prepareRequest(input, tx));
          if (body.runtimeSnapshot.provider !== provider) return { error: 'assistantProviderChanged', code: 409 };
        } catch (error) {
          if ([400, 409, 503].includes(error?.status || error?.statusCode) && /^[A-Za-z0-9_]{1,64}$/.test(error?.code || '')) return { error: error.code, code: error.status || error.statusCode };
          throw error;
        }
      } else if (provider !== 'deepseek') return { error: 'assistantClientUpdateRequired', code: 409 };
      const count = await tx.get('SELECT COUNT(*) AS n FROM assistant_jobs WHERE user_id = ? AND created_at > ?', [user.id, Date.now() - 600000]);
      if (Number(count.n) >= 30) return { error: 'assistantRateLimited', code: 429 };
      const pending = await tx.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE user_id = ? AND status IN ('queued', 'running')", [user.id]);
      if (Number(pending.n) >= 4) return { error: 'assistantJobBusy', code: 409 };
      await tx.run("INSERT INTO assistant_jobs (id, user_id, status, request_json, created_at) VALUES (?, ?, 'queued', ?, ?)", [id, user.id, JSON.stringify(body), Date.now()]);
      if (documents) await documents.recordJob(tx, user.id, id, body);
      return { job: { id, status: 'queued', provider, ...(body.runtimeSnapshot?.model ? { model: body.runtimeSnapshot.model } : {}) } };
    });
    if (result.error) return res.status(result.code).json({ error: result.error });
    res.status(202).json(result.job); kick();
  });
  app.get(['/api/assistant/jobs/:id', '/api/assistant/v2/jobs/:id'], async (req, res) => {
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
      const interruptedJobs = await db.all("SELECT * FROM assistant_jobs WHERE status = 'running'");
      for (const row of interruptedJobs) await db.run("UPDATE assistant_jobs SET status = 'failed', request_json = ?, error_code = 'assistantInterrupted', completed_at = ? WHERE id = ? AND status = 'running'", [retainedRequest(row), Date.now(), row.id]);
      await db.run('DELETE FROM assistant_jobs WHERE completed_at < ?', [Date.now() - 7 * 86400000]);
      await db.run('DELETE FROM assistant_jobs WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)');
      await db.run('DELETE FROM account_bookmarks WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)');
      if (documents) await db.run('DELETE FROM account_documents WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)');
      started = true; kick();
    },
    async stop() {
      stopping = true;
      for (const worker of workers) clearTimeout(worker.retry);
      await Promise.all(workers.map(worker => worker.work));
    },
  };
}
