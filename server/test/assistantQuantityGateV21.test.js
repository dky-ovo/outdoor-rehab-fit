import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantExerciseQuantityQuestion } from '../src/assistantLanguage.js';
import { assistantAsksForGuideContent } from '../src/assistant.js';
import { symptomConcern } from '../src/assistantSymptomEvidence.js';
import { symptomConcern as clientSymptomConcern } from '../../utils/assistantSymptomEvidence.js';
import { createApp } from '../src/app.js';
import { createMysqlApp } from '../src/appMysql.js';
import { createDatabase } from '../src/database.js';
import { signToken } from '../src/security.js';

const user = content => ({ role: 'user', content });
const quantities = [
  '拉繩機要拉幾多下先夠？我係長者。', '每組拉十下得唔得？', '每次幾組？',
  '做幾分鐘？', '拉幾耐？', '休息多久？', 'Should I do 10 reps?',
  'Is 10 repetitions sufficient?', '10 reps?', 'How many sets?',
  'How many minutes should I use it?', 'How many seconds should I hold each stretch?',
  'Can I use it for 5 minutes?', 'What weight should I select?',
  'How heavy should I set it?', 'Recommend a daily rep target for the zigzag machine.', 'Should I do ten?',
  'Which resistance level is suitable?', 'I take blood pressure pills. How many reps on the zigzag machine?',
  '我有食血壓藥。拉繩機拉幾多下？', '太極推手器中醫教學，每日做幾多分鐘？',
];
const nonQuantities = [
  '請介紹一下拉繩機', '幾款下肢器材有影片？', 'What sets this apart?',
  'Where can I buy 10 kg weights?', 'How many minutes until the bus comes?',
  'Can I take 2 pills?', 'How many tablets should I take?', '血壓藥一日食幾次？',
  'I completed 10 reps yesterday.', '膝頭痛咗幾耐？',
];

test('quantity gate recognizes dose questions, including medication background, without stealing other topics', () => {
  for (const message of quantities) {
    assert.equal(assistantExerciseQuantityQuestion(message), true, message);
    assert.equal(assistantAsksForGuideContent(message), true, message);
  }
  for (const message of nonQuantities) assert.equal(assistantExerciseQuantityQuestion(message), false, message);
});

test('both symptom parsers preserve urgent exercise follow-ups but drop a changed non-exercise topic', () => {
  const history = [user('我心口痛，抖唔到氣')];
  for (const concern of [symptomConcern, clientSymptomConcern]) {
    for (const message of quantities) assert.equal(concern(message, history)?.urgent, true, message);
    for (const message of ['Where can I buy 10 kg weights?', 'How many minutes until the bus comes?']) {
      assert.equal(concern(message, history), null, message);
    }
  }
});

async function fixture(t, backend) {
  const sqlite = createDatabase(':memory:'), now = new Date().toISOString(), secret = 'v21-quantity-local-only';
  sqlite.prepare('INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('v21-quantity', 'isolated quantity test', '+85269009991', 'participant', 'unused', 'unused', now, now);
  sqlite.prepare("UPDATE ai_configuration SET api_key='local-provider-stub',model='deepseek-v4-pro' WHERE id='default'").run();
  let calls = 0;
  const database = backend === 'sqlite' ? sqlite : {
    dialect: 'mysql', get: async (sql, args = []) => sqlite.prepare(sql).get(...args),
    all: async (sql, args = []) => sqlite.prepare(sql).all(...args),
    run: async (sql, args = []) => ({ affectedRows: sqlite.prepare(sql).run(...args).changes }),
    transaction: async fn => fn(database),
  };
  const options = { database, jwtSecret: secret, deepSeekClientFactory: () => ({ chat: { completions: { create: async () => {
    calls++;
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      reply: 'Do 12 repetitions for 2 sets on the zigzag machine.', recommendations: [],
    }) } }] };
  } } } }) };
  const app = backend === 'sqlite' ? createApp(options) : await createMysqlApp(options);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await app.locals.accountContinuity?.stop(); await app.locals.imageRetirement?.stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); sqlite.close();
  });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return { calls: () => calls, request: async (message, locale = 'en', history = []) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken({ id: 'v21-quantity' }, secret)}` },
      body: JSON.stringify({ message, locale, history }), signal: AbortSignal.timeout(10000),
    });
    const answer = await response.json(); assert.equal(response.status, 200, JSON.stringify(answer)); return answer;
  } };
}

for (const backend of ['sqlite', 'mysql']) {
  test(`${backend}: live colloquial rope request and narrow continuation use FAQ without provider`, async t => {
    const env = await fixture(t, backend);
    const message = '拉繩機要拉幾多下先夠？我係長者。';
    const first = await env.request(message, 'zh');
    assert.equal(first.faqId, 'rope-use'); assert.equal(first.deepSeekUsed, false);
    assert.match(first.reply, /先不要自行拉.*示範/s);
    assert.doesNotMatch(first.reply, /\d+\s*(?:次|下|組|组|分鐘)/);
    const second = await env.request('每次幾組？', 'zh', [user(message), { role: 'assistant', content: first.reply }]);
    assert.equal(second.faqId, 'rope-use'); assert.equal(env.calls(), 0);
  });

  test(`${backend}: unknown machine quantity never returns the stub provider's unverified dose`, async t => {
    const env = await fixture(t, backend);
    for (const message of [
      'How many reps on the zigzag machine?', 'Should I do 10 reps on the zigzag machine?',
      'Is 10 repetitions sufficient on the zigzag machine?', '10 reps on the zigzag machine?',
      'I take blood pressure pills. How many reps on the zigzag machine?',
      'How heavy should I set the zigzag machine?', 'Recommend a daily rep target for the zigzag machine.',
    ]) {
      const before = env.calls(); const answer = await env.request(message);
      assert.equal(env.calls(), before + 1, message);
      assert.doesNotMatch(answer.reply, /12 repetitions|2 sets/i, message);
      assert.match(answer.reply, /which piece of equipment|tell me its name|describe/i, message);
      assert.deepEqual(answer.recommendations, []);
    }
  });

  test(`${backend}: unresolved urgent symptoms block quantity and duration follow-ups without provider`, async t => {
    const env = await fixture(t, backend), history = [user('I have chest pain and trouble breathing now.')];
    for (const message of [
      'How many minutes should I use it?', 'How many seconds should I hold each stretch?',
      'Can I use it for 5 minutes?', 'Should I do 10 reps?', '10 reps?',
      'How heavy should I set it?', 'Recommend a daily rep target for the zigzag machine.', 'Should I do ten?',
      'I take blood pressure pills. How many reps on the zigzag machine?',
      '太極推手器中醫教學，每日做幾多分鐘？',
    ]) {
      const answer = await env.request(message, 'en', history);
      assert.match(answer.reply, /stop.*urgent.*999/is, message);
      assert.deepEqual(answer.recommendations, []); assert.equal(answer.faqId, undefined);
    }
    assert.equal(env.calls(), 0);
  });

  test(`${backend}: reviewed weekly activity target is preserved without provider`, async t => {
    const env = await fixture(t, backend);
    const answer = await env.request('How many minutes should older people exercise each week?');
    assert.equal(answer.faqId, 'weekly-activity'); assert.match(answer.reply, /150[–-]300/);
    assert.equal(answer.deepSeekUsed, false); assert.equal(env.calls(), 0);
  });
}
