import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAssistantLanguage } from '../src/assistantLanguage.js';
import { symptomConcern, symptomGuideCandidates } from '../src/assistantSymptomEvidence.js';
import { assistantQuickGuideAnswer } from '../src/assistantGuideAnswers.js';
import { deepSeekSymptomRecommendations } from '../src/assistantSymptomRecommendations.js';
import { deepSeekSymptomRecommendations as mysqlRecommendations } from '../src/mysqlAssistantSymptomRecommendations.js';
import { createApp } from '../src/app.js';
import { createMysqlApp } from '../src/appMysql.js';
import { createDatabase } from '../src/database.js';
import { signToken } from '../src/security.js';

const user = content => ({ role: 'user', content });
const shoulder = { id: 'shoulder', name: 'Shoulder machine', categories: ['upper'], ptTip: 'Gentle movement can alleviate shoulder pain.', details: 'Move gently. Stop if pain increases.' };
const foot = { id: 'foot', name: 'Foot machine', categories: ['lower'], ptTip: 'Gentle movement can relieve foot pain.', details: 'Stop if painful.' };
const catalog = [shoulder, foot,
  { ...shoulder, id: 'frozen', ptTip: 'For patients with frozen shoulder, this movement can relieve shoulder pain.' },
  { ...foot, id: 'plantar', ptTip: 'For plantar fasciitis, this can relieve foot pain.' },
];

test('denied diagnosis is separate from present pain, in English, Traditional and Cantonese', () => {
  for (const [question, condition, part] of [
    ['I do not have frozen shoulder. My shoulder hurts; what equipment can help?', 'frozen-shoulder', 'shoulder'],
    ['我沒有肩周炎，只是肩膊痛，有甚麼器材？', 'frozen-shoulder', 'shoulder'],
    ['唔係肩周炎，只係膊頭痛，有咩器材？', 'frozen-shoulder', 'shoulder'],
    ['我沒有足底筋膜炎，只是腳底有點痛，有甚麼器材？', 'plantar-fasciitis', 'foot'],
    ['I do not have plantar fasciitis, just foot pain. What equipment can help?', 'plantar-fasciitis', 'foot'],
  ]) {
    const analysis = analyzeAssistantLanguage(question);
    assert.deepEqual(analysis.targets, [part], question);
    assert.deepEqual(analysis.deniedConditions, [condition], question);
    const candidates = symptomGuideCandidates(question, catalog, 'en');
    assert.deepEqual(candidates.map(x => x.id), [part], question);
  }
});

test('a denied diagnosis survives true followups, and a later explicit correction replaces it', () => {
  const history = [user('I do not have frozen shoulder. My shoulder hurts; what equipment can help?')];
  assert.deepEqual(symptomConcern('tell me more', history).deniedConditions, ['frozen-shoulder']);
  assert.deepEqual(symptomGuideCandidates('tell me more', catalog, 'en', history).map(x => x.id), ['shoulder']);
  const corrected = symptomConcern('Correction: I have frozen shoulder and shoulder pain; what equipment can help?', history);
  assert.equal(corrected.deniedConditions, undefined);
  assert.equal(symptomConcern('Where is the nearest park?', history), null);
  assert.equal(symptomConcern('My shoulder is fine but I have chest pain now', history).urgent, true);
});

test('a denied diagnosis cannot silently switch a normal pain answer to TCM-only causal claims', () => {
  const item = { id: 'tcm', name: 'Foot stretch', tcmEnabled: true, tcmTip: 'This alleviates heel pain caused by cold-dampness.' };
  const question = 'I do not have plantar fasciitis, just foot pain. What equipment can help?';
  assert.deepEqual(symptomGuideCandidates(question, [item], 'en'), []);
  assert.deepEqual(symptomGuideCandidates('tell me more', [item], 'en', [user(question)]), []);
  assert.equal(symptomGuideCandidates(question + ' Please explain the TCM view.', [item], 'en').length, 1);
});

const guide = { id: 'g', name: 'Tai Chi Wheel', categories: ['upper'], details: 'Turn gently. Stop if pain increases.',
  careTip: 'Stay nearby. Do not force the movement.', otTip: 'Practice everyday arm movements.', tcmEnabled: true, tcmTip: 'UNREQUESTED_TCM' };
test('explicit section, pronoun followup and upper-body selection read complete current guides without added TCM', () => {
  const question = 'Please explain the occupational therapy tips for the Tai Chi Wheel from the app.';
  const first = assistantQuickGuideAnswer({ message: question, catalog: [guide], locale: 'en' });
  assert.equal(first.deepSeekUsed, false); assert.equal(first.guideContentDirect, true);
  assert.match(first.reply, /Practice everyday arm movements/); assert.doesNotMatch(first.reply, /UNREQUESTED_TCM/);
  const follow = assistantQuickGuideAnswer({ message: 'Tell me more about how to use it, using only the published guide in this app.',
    history: [user(question), { role: 'assistant', content: first.reply }], catalog: [guide], locale: 'en' });
  assert.match(follow.reply, /Stop if pain increases/); assert.equal(follow.recommendations[0].id, 'g');
  const broad = assistantQuickGuideAnswer({ message: 'Could you find an upper-body guide in this app and show its instructions and precautions?', catalog: [
    { ...guide, id: 'hidden', isActive: false }, { ...guide, id: 'wheelchair', categories: ['upper', 'wheelchair'] }, guide,
  ], locale: 'en' });
  assert.equal(broad.recommendations[0].id, 'g'); assert.match(broad.reply, /Do not force the movement/);
  assert.doesNotMatch(broad.reply, /UNREQUESTED_TCM/);
});

test('quick guide cannot override symptoms, location, or a changed conversation topic', () => {
  for (const message of ['My chest hurts, show an upper-body guide', 'My shoulder hurts, how do I use Tai Chi Wheel?', 'Where is the Tai Chi Wheel?']) {
    assert.equal(assistantQuickGuideAnswer({ message, catalog: [guide], locale: 'en' }), null, message);
  }
  assert.equal(assistantQuickGuideAnswer({ message: 'Tell me more', history: [user('How do I use Tai Chi Wheel?'), user('Where is the nearest park?')], catalog: [guide], locale: 'en' }), null);
  for (const message of ['Tell me more about lunch.', 'Tell me more about Paris.', 'I do not want the Tai Chi Wheel. Show me another upper-body guide.']) {
    assert.equal(assistantQuickGuideAnswer({ message, history: [user('Show me the Tai Chi Wheel instructions.')], catalog: [guide], locale: 'en' }), null, message);
  }
  assert.equal(assistantQuickGuideAnswer({ message: 'How do I use Tai Chi Wheel?', catalog: [{ ...guide, deletedAt: '2026-10-01' }], locale: 'en' }), null);
  const urgentHistory = [user('My chest hurts and I have trouble breathing now.')];
  const nextGuide = 'Could you find an upper-body guide and explain its instructions and precautions?';
  assert.equal(symptomConcern(nextGuide, urgentHistory).urgent, true);
  assert.equal(assistantQuickGuideAnswer({ message: nextGuide, history: urgentHistory, catalog: [guide], locale: 'en' }), null);
  assert.equal(symptomConcern('Tell me more about Paris.', urgentHistory), null);
});

for (const [backend, recommend] of [['sqlite', deepSeekSymptomRecommendations], ['mysql', mysqlRecommendations]]) {
  test(`${backend}: no matching evidence replies without waiting for a provider, but still honours cancellation`, async () => {
    let calls = 0;
    const args = { client: { chat: { completions: { create: () => { calls++; throw Error('must not call'); } } } }, model: 'deepseek-v4-pro',
      question: 'My shoulder hurts; what equipment can help?', history: [], locale: 'en', concern: { targets: ['shoulder'], requested: true }, catalog: [], getCatalog: () => [], timeoutMs: 1000 };
    const result = await recommend(args);
    assert.equal(calls, 0); assert.equal(result.deepSeekUsed, false); assert.deepEqual(result.recommendations, []);
    assert.match(result.reply, /stop movements/i); assert.doesNotMatch(result.reply, /FAQ|evidence|catalog|passage/i);
    await assert.rejects(recommend({ ...args, signal: AbortSignal.abort() }), { code: 'deepSeekUnavailable' });
  });

  test(`${backend}: bounded model selection keeps exact evidence but does not request long reasoning`, async () => {
    const question = 'I do not have frozen shoulder. My shoulder hurts; what equipment can help?';
    let sent;
    const result = await recommend({ client: { chat: { completions: { create: async body => {
      sent = body; const candidate = JSON.parse(body.messages[1].content).candidates[0];
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ style: 'direct', recommendations: [{ id: candidate.id, evidence: candidate.evidence }] }) } }] };
    } } } }, model: 'deepseek-v4-pro', question, history: [], locale: 'en', concern: symptomConcern(question), catalog, getCatalog: () => catalog });
    assert.equal(sent.thinking.type, 'disabled'); assert.equal(sent.reasoning_effort, undefined);
    assert.deepEqual(JSON.parse(sent.messages[1].content).candidates.map(x => x.id), ['shoulder']);
    assert.match(result.reply, /Gentle movement can alleviate shoulder pain/);
    assert.doesNotMatch(result.reply, /frozen shoulder|APP excerpt|FAQ/i); assert.equal(result.guideContentDirect, true);
  });
}

for (const backend of ['sqlite', 'mysql']) test(`${backend}: production handler resolves real v19 missed guide questions without a model call`, async t => {
  const sqlite = createDatabase(':memory:'), now = new Date().toISOString(), secret = 'v20-isolated-test-only';
  sqlite.prepare('INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('v20', 'isolated test', '+85269009990', 'participant', 'unused', 'unused', now, now);
  sqlite.prepare("UPDATE ai_configuration SET api_key='unused-local-key',model='deepseek-v4-pro' WHERE id='default'").run();
  let calls = 0;
  const database = backend === 'sqlite' ? sqlite : {
    dialect: 'mysql', get: async (sql, args = []) => sqlite.prepare(sql).get(...args),
    all: async (sql, args = []) => sqlite.prepare(sql).all(...args),
    run: async (sql, args = []) => ({ affectedRows: sqlite.prepare(sql).run(...args).changes }),
    transaction: async fn => fn(database),
  };
  const options = { database, jwtSecret: secret, deepSeekClientFactory: () => ({ chat: { completions: { create: () => { calls++; throw Error('not needed'); } } } }) };
  const app = backend === 'sqlite' ? createApp(options) : await createMysqlApp(options);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await app.locals.accountContinuity?.stop(); sqlite.close(); });
  const history = [];
  for (const question of [
    'Please explain the occupational therapy tips for the Tai Chi Wheel from the app.',
    'Tell me more about how to use it, using only the published guide in this app.',
    'Could you find an upper-body guide in this app and show its instructions and precautions?',
  ]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/chat`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken({ id: 'v20' }, secret)}` },
      body: JSON.stringify({ message: question, locale: 'en', history }) });
    const answer = await response.json(); assert.equal(response.status, 200, JSON.stringify(answer));
    assert.equal(answer.deepSeekUsed, false); assert.equal(answer.action, 'equipment_local');
    assert.equal(answer.recommendations.length, 1); assert.doesNotMatch(answer.reply, /could not verify|FAQ|TCM background/i);
    history.push(user(question), { role: 'assistant', content: answer.reply });
  }
  assert.equal(calls, 0);
});
