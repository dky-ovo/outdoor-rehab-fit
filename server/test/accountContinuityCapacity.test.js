import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import express from 'express';
import { installAccountContinuity } from '../src/accountContinuity.js';
import { createAccountDocuments } from '../src/accountDocuments.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) return;
    await delay(5);
  }
  throw new Error('condition did not settle');
}

async function fixture(t, { count = 8, maxConcurrentJobs, answer, beforeStart, release = () => {} } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, deleted_at TEXT);
    CREATE TABLE assistant_jobs (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, request_json TEXT, result_json TEXT, error_code TEXT, created_at INTEGER, completed_at INTEGER);
    CREATE TABLE account_bookmarks (user_id TEXT, equipment_id TEXT, selected INTEGER, version INTEGER, last_operation TEXT, PRIMARY KEY(user_id, equipment_id));
    CREATE TABLE account_documents (user_id TEXT, collection TEXT, record_id TEXT, value_json TEXT, deleted INTEGER, revision INTEGER, last_operation TEXT, PRIMARY KEY(user_id,collection,record_id));`);
  const statement = text => sql.prepare(text.replaceAll(' FOR UPDATE', ''));
  // A single SQLite connection must not execute another slot's autocommit claim
  // inside an unrelated transaction which could roll back. MySQL uses separate
  // pooled connections; serialize SQLite transactions and external statements.
  const scope = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const serialize = fn => {
    const operation = queue.then(fn);
    queue = operation.catch(() => {});
    return operation;
  };
  const execute = fn => scope.getStore() ? Promise.resolve().then(fn) : serialize(fn);
  const db = {
    get: (text, values = []) => execute(() => statement(text).get(...values)),
    all: (text, values = []) => execute(() => statement(text).all(...values)),
    run: (text, values = []) => execute(() => ({ affectedRows: statement(text).run(...values).changes })),
  };
  db.transaction = fn => serialize(() => scope.run(true, async () => {
      sql.exec('BEGIN');
      try { const result = await fn(db); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
  }));
  for (let index = 0; index < count; index++) {
    const id = `job-${String(index).padStart(2, '0')}`;
    await db.run('INSERT INTO users VALUES (?, NULL)', [`user-${index}`]);
    await db.run("INSERT INTO assistant_jobs (id, user_id, status, request_json, created_at) VALUES (?, ?, 'queued', ?, ?)", [
      id, `user-${index}`, JSON.stringify({ message: `private question ${index}`, locale: 'en',
        conversation: { id: `conversation-${index}`, userMessageId: `question-${index}`, locale: 'en', createdAt: '2026-10-06T00:00:00Z' } }), index,
    ]);
  }
  const app = express(); app.use(express.json());
  const documents = createAccountDocuments(db);
  const worker = installAccountContinuity({ app, database: db, documents, maxConcurrentJobs,
    findUser: id => db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [id]),
    authenticate: req => db.get('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [req.headers.authorization || '']),
    answer,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const read = async (index, user = `user-${index}`) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/jobs/job-${String(index).padStart(2, '0')}`, { headers: { Authorization: user } });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { release(); await worker.stop(); await new Promise(resolve => server.close(resolve)); sql.close(); });
  await beforeStart?.(db);
  await worker.start();
  return { db, worker, read, documents };
}

test('two and six slots complete independent answers without exceeding the configured concurrency', async t => {
  for (const concurrency of [2, 6]) await t.test(`${concurrency} slots`, async t => {
    const gates = new Map(), calls = new Map();
    let active = 0, maximum = 0, releaseAll = false;
    const env = await fixture(t, { count: 12, maxConcurrentJobs: concurrency,
      release: () => { releaseAll = true; for (const release of gates.values()) release(); },
      answer: async (req, res, user) => {
        calls.set(user.id, (calls.get(user.id) || 0) + 1);
        maximum = Math.max(maximum, ++active);
        if (!releaseAll) await new Promise(resolve => gates.set(user.id, resolve));
        active--;
        res.json({ reply: `${user.id}: ${req.body.message}` });
      },
    });
    await until(() => gates.size === concurrency);
    assert.equal(calls.size, concurrency);
    assert.equal(maximum, concurrency);
    // One slow answer does not prevent the other slots from making progress.
    gates.get('user-0')();
    await until(() => calls.size === concurrency + 1);
    assert.equal((await env.read(0)).body.status, 'complete');
    assert.equal((await env.read(1)).body.status, 'running');
    releaseAll = true;
    for (const release of gates.values()) release();
    await until(async () => Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'complete'")).n) === 12);
    assert.equal(maximum, concurrency);
    assert.equal(calls.size, 12);
    assert.ok([...calls.values()].every(count => count === 1));
    for (let index = 0; index < 12; index++) {
      assert.equal((await env.read(index)).body.result.reply, `user-${index}: private question ${index}`);
      assert.equal((await env.read(index, `user-${(index + 1) % 12}`)).status, 404);
      const history = await env.documents.sync(`user-${index}`, { collection: 'assistant_en', cursor: 0, changes: [] });
      assert.equal(history.records[0].value.messages[1].reply, `user-${index}: private question ${index}`);
    }
  });
});

test('competing slots reserve ambiguous claims and each invokes the provider exactly once', async t => {
  for (const applied of [false, true]) await t.test(applied ? 'claim committed' : 'claim not committed', async t => {
    let failed = false;
    const calls = new Map();
    const env = await fixture(t, { count: 12, maxConcurrentJobs: 6,
      answer: async (req, res, user) => {
        calls.set(user.id, (calls.get(user.id) || 0) + 1);
        await delay(2);
        res.json({ reply: req.body.message });
      },
      beforeStart: db => {
        const run = db.run;
        db.run = async (text, values) => {
          if (!failed && text.startsWith("UPDATE assistant_jobs SET status = 'running'")) {
            failed = true;
            if (applied) await run(text, values);
            throw Object.assign(new Error('uncertain claim'), { code: 'ECONNRESET' });
          }
          return run(text, values);
        };
      },
    });
    // Other slots work before the failed slot retries its reserved job.
    await until(async () => Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'complete'")).n) === 11);
    assert.equal(calls.has('user-0'), false);
    await until(async () => (await env.read(0)).body.status === 'complete');
    assert.equal(calls.size, 12);
    assert.ok([...calls.values()].every(count => count === 1));
  });
});

test('a result-save failure retries only that slot while the other answers finish', async t => {
  let failed = false;
  const calls = new Map();
  const env = await fixture(t, { count: 12, maxConcurrentJobs: 6,
    answer: async (req, res, user) => {
      calls.set(user.id, (calls.get(user.id) || 0) + 1);
      res.json({ reply: req.body.message });
    },
    beforeStart: db => {
      const run = db.run;
      db.run = async (text, values) => {
        if (!failed && text.startsWith('UPDATE assistant_jobs SET status = ?') && values.at(-1) === 'job-00') {
          failed = true;
          throw Object.assign(new Error('uncertain result save'), { code: 'ECONNRESET' });
        }
        return run(text, values);
      };
    },
  });
  await until(async () => Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'complete'")).n) === 11);
  assert.equal(calls.get('user-0'), 1);
  await until(async () => (await env.read(0)).body.status === 'complete');
  assert.ok([...calls.values()].every(count => count === 1));
  const history = await env.documents.sync('user-0', { collection: 'assistant_en', cursor: 0, changes: [] });
  assert.deepEqual(history.records[0].value.messages.map(message => message.id), ['question-0', 'job-00-answer']);
});

test('a lost result COMMIT response reconciles without another provider call or history write', async t => {
  const calls = new Map();
  let failed = false, answerWrites = 0, completionChecks = 0;
  const env = await fixture(t, { count: 12, maxConcurrentJobs: 6,
    answer: async (req, res, user) => {
      calls.set(user.id, (calls.get(user.id) || 0) + 1);
      res.json({ reply: req.body.message });
    },
    beforeStart: db => {
      const transaction = db.transaction;
      db.transaction = async fn => {
        let wroteTarget = false;
        const result = await transaction(tx => fn({ ...tx,
          get: (text, values) => {
            if (text.startsWith('SELECT * FROM assistant_jobs') && text.includes('FOR UPDATE') && values[0] === 'job-00') completionChecks++;
            return tx.get(text, values);
          },
          run: async (text, values) => {
            if (text.startsWith('UPDATE assistant_jobs SET status = ?') && values.at(-1) === 'job-00') {
              wroteTarget = true;
              answerWrites++;
            }
            return tx.run(text, values);
          },
        }));
        if (wroteTarget && !failed) {
          failed = true;
          throw Object.assign(new Error('COMMIT response lost'), { code: 'ECONNRESET' });
        }
        return result;
      };
    },
  });
  await until(async () => Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'complete'")).n) === 12);
  await env.read(0); // Wake the slot holding the uncertain save for reconciliation.
  await until(() => completionChecks === 2);
  assert.equal(failed, true);
  assert.equal(answerWrites, 1);
  assert.equal(calls.size, 12);
  assert.ok([...calls.values()].every(count => count === 1));
});

test('50 queued accounts complete with a bounded provider stub at one versus six slots', async t => {
  const results = [];
  for (const concurrency of [1, 6]) {
    let active = 0, maximum = 0, calls = 0;
    const start = performance.now();
    const env = await fixture(t, { count: 50, maxConcurrentJobs: concurrency,
      answer: async (req, res) => {
        calls++;
        maximum = Math.max(maximum, ++active);
        await delay(20);
        active--;
        res.json({ reply: req.body.message });
      },
    });
    await until(async () => Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'complete'")).n) === 50);
    const elapsedMs = Math.round(performance.now() - start);
    await env.worker.stop();
    assert.equal(calls, 50);
    assert.equal(maximum, concurrency);
    const rows = await env.db.all('SELECT user_id, result_json FROM assistant_jobs');
    for (const row of rows) assert.equal(JSON.parse(row.result_json).reply, `private question ${row.user_id.slice(5)}`);
    results.push({ accounts: 50, provider: 'local 20ms stub', maxConcurrentJobs: concurrency, observedConcurrency: maximum, completed: 50, providerCalls: calls, elapsedMs });
  }
  t.diagnostic(JSON.stringify({ localWorkerComparison: results }));
});

test('stop awaits every active slot, starts no queued work and preserves deletion during completion', async t => {
  const gates = new Map();
  let calls = 0;
  const env = await fixture(t, { count: 8, maxConcurrentJobs: 6,
    release: () => { for (const release of gates.values()) release(); },
    answer: async (req, res, user) => {
      calls++;
      await new Promise(resolve => gates.set(user.id, resolve));
      res.json({ reply: req.body.message });
    },
  });
  await until(() => gates.size === 6);
  await env.db.run("UPDATE users SET deleted_at = '2026-10-06' WHERE id = 'user-0'");
  await env.db.run("DELETE FROM assistant_jobs WHERE id = 'job-01'");
  let stopped = false;
  const stopping = env.worker.stop().then(() => { stopped = true; });
  gates.get('user-0')();
  gates.get('user-1')();
  await until(async () => !await env.db.get("SELECT id FROM assistant_jobs WHERE id = 'job-00'"));
  assert.equal(stopped, false);
  for (const release of gates.values()) release();
  await stopping;
  assert.equal(calls, 6);
  assert.equal(Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'queued'")).n), 2);
  assert.equal(Number((await env.db.get("SELECT COUNT(*) AS n FROM assistant_jobs WHERE status = 'complete'")).n), 4);
  assert.equal(Number((await env.db.get("SELECT COUNT(*) AS n FROM account_documents WHERE user_id IN ('user-0', 'user-1')")).n), 0);
});

test('a deleted and reused job ID cannot receive an older in-flight answer', async t => {
  for (const changed of ['request', 'createdAt']) await t.test(changed, async t => {
    const gates = [];
    let calls = 0;
    const env = await fixture(t, { count: 1, maxConcurrentJobs: 2,
      release: () => { for (const release of gates) release(); },
      answer: async (_req, res) => {
        const generation = ++calls;
        await new Promise(resolve => gates.push(resolve));
        res.json({ reply: `answer from generation ${generation}` });
      },
    });
    await until(() => gates.length === 1);
    const old = await env.db.get("SELECT * FROM assistant_jobs WHERE id = 'job-00'");
    const input = JSON.parse(old.request_json);
    if (changed === 'request') input.message = 'replacement question';
    await env.db.run("DELETE FROM assistant_jobs WHERE id = 'job-00'");
    await env.db.run("INSERT INTO assistant_jobs (id, user_id, status, request_json, created_at) VALUES ('job-00', 'user-0', 'queued', ?, ?)",
      [JSON.stringify(input), changed === 'createdAt' ? old.created_at + 1 : old.created_at]);
    await env.read(0);
    await until(() => gates.length === 2);
    gates[0]();
    await delay(20);
    const pending = await env.read(0);
    assert.equal(pending.body.status, 'running');
    assert.equal(pending.body.result, undefined);
    assert.equal(Number((await env.db.get('SELECT COUNT(*) AS n FROM account_documents')).n), 0);
    gates[1]();
    await until(async () => (await env.read(0)).body.status === 'complete');
    assert.equal((await env.read(0)).body.result.reply, 'answer from generation 2');
    const history = await env.documents.sync('user-0', { collection: 'assistant_en', cursor: 0, changes: [] });
    assert.equal(history.records[0].value.messages[0].text, input.message);
    assert.equal(history.records[0].value.messages[1].reply, 'answer from generation 2');
  });
});

test('a claim cannot adopt a replacement ID between selection and its UPDATE', async t => {
  let replaced = false, calls = 0;
  const env = await fixture(t, { count: 1, maxConcurrentJobs: 2,
    answer: async (req, res) => { calls++; res.json({ reply: req.body.message }); },
    beforeStart: db => {
      const run = db.run;
      db.run = async (text, values) => {
        if (!replaced && text.startsWith("UPDATE assistant_jobs SET status = 'running'")) {
          replaced = true;
          await run("DELETE FROM assistant_jobs WHERE id = 'job-00'");
          await run("INSERT INTO assistant_jobs (id, user_id, status, request_json, created_at) VALUES ('job-00', 'user-0', 'queued', ?, 1)",
            [JSON.stringify({ message: 'replacement question', locale: 'en' })]);
          // The old claim must affect no rows, even if its response is lost.
          const result = await run(text, values);
          assert.equal(result.affectedRows, 0);
          throw Object.assign(new Error('old claim response lost'), { code: 'ECONNRESET' });
        }
        return run(text, values);
      };
    },
  });
  await until(async () => (await env.read(0)).body.status === 'complete');
  assert.equal(calls, 1);
  assert.equal((await env.read(0)).body.result.reply, 'replacement question');
});
