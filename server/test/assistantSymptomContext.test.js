import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { symptomConcern, symptomEvidence, symptomGuideCandidates, symptomGuideAnswer } from '../src/assistantSymptomEvidence.js';

const GUIDE = JSON.parse(fs.readFileSync(new URL('../src/equipmentGuideEvidence.json', import.meta.url), 'utf8'));
const catalog = locale => Object.keys(GUIDE).map(id => ({ id, name: `Facility ${id}`, ...GUIDE[id][locale] }));
const user = content => ({ role: 'user', content });
const ids = items => items.map(item => item.id);

test('anatomy and walking clarification answers retain the contiguous symptom and recommendation request', () => {
  for (const [locale, sequence] of [
    ['zh', ['我腿痛推薦什麼器材', '膝盖', '走路痛', '推薦器材']],
    ['zh', ['我腿痛推薦什麼器材', '膝盖痛', '走路的时候痛', '推薦器材']],
    ['zh', ['我腳痛有咩器材', '是膝頭', '行路時痛', '走路的時候']],
    ['en', ['My leg hurts, recommend equipment', 'knee', 'when walking', 'recommend equipment']],
    ['en', ['My legs hurt, suggest equipment', 'my knees hurt', 'It hurts when walking']],
  ]) {
    const history = [];
    for (const [index, question] of sequence.entries()) {
      const concern = symptomConcern(question, history);
      assert.deepEqual(concern.targets, index === 0 ? ['leg'] : ['knee'], question);
      assert.equal(concern.requested, true, question);
      assert.equal(concern.urgent, false, question);
      const candidates = symptomGuideCandidates(question, catalog(locale), locale, history);
      assert.ok(candidates.length >= 3, question);
      assert.ok(!ids(candidates).includes('28'), question);
      history.push(user(question), { role: 'assistant', content: 'Where exactly or when?' });
    }
  }
});

test('all affirmative candidate evidence is available before model selection, independent of broad catalog categories', () => {
  for (const locale of ['zh', 'en']) {
    const query = locale === 'zh' ? '膝痛，推薦器材' : 'My knee hurts, recommend equipment';
    const candidates = symptomGuideCandidates(query, catalog(locale), locale);
    assert.deepEqual(ids(candidates), locale === 'zh' ? ['4', '10', '11', '16', '25'] : ['4', '10', '11', '25']);
    assert.deepEqual(ids(symptomGuideAnswer(query, catalog(locale), locale).recommendations), ['4', '10', '11']);
    for (const item of candidates) assert.ok(GUIDE[item.id][locale][item.evidence.field].includes(item.evidence.quote));
  }
});

test('known pain can retrieve educational candidates without requiring the user to repeat recommend', () => {
  assert.deepEqual(symptomGuideCandidates('膝頭哥痛', catalog('zh')), []);
  assert.deepEqual(ids(symptomGuideCandidates('膝頭哥痛', catalog('zh'), 'zh', [], { requireRequest: false })), ['4', '10', '11', '16', '25']);
  assert.deepEqual(symptomGuideCandidates('痛', catalog('zh'), 'zh', [], { requireRequest: false }), []);
  assert.deepEqual(symptomGuideCandidates('你好', catalog('zh'), 'zh', [], { requireRequest: false }), []);
  assert.equal(symptomConcern('knee'), null, 'an isolated anatomy word alone must not invent a symptom');
});

test('generic legs need affirmative lower-limb prose and never turn sole-only text into knee evidence', () => {
  const items = [
    { id: 'knee', ptTip: '這項活動可以減輕膝關節疼痛。' },
    { id: 'calf', ptTip: '這項活動可以減輕小腿痠痛。' },
    { id: 'hip', ptTip: '這項活動可以緩解髖關節疼痛。' },
    { id: 'sole', categories: ['lower'], ptTip: '這項活動可以減輕腳底疼痛。' },
    { id: 'arm', categories: ['lower'], ptTip: '這項活動可以減輕肩膊疼痛。' },
    { id: 'category', categories: ['lower', 'knee'], description: '減輕膝痛。' },
  ];
  for (const question of ['腿痛推薦器材', '腳痛推薦器材', '脚痛推荐器材', 'My legs hurt, suggest equipment']) {
    assert.deepEqual(symptomConcern(question).targets, ['leg']);
    assert.deepEqual(ids(symptomGuideCandidates(question, items)), ['knee', 'calf', 'hip']);
  }
  assert.deepEqual(ids(symptomGuideCandidates('膝痛推薦器材', items)), ['knee']);
  assert.deepEqual(ids(symptomGuideCandidates('腳底痛推薦器材', items)), ['sole']);
  assert.equal(symptomEvidence({ ptTip: '此活動不能減輕腿痛。' }, symptomConcern('腿痛推薦器材')), null);
});

test('urgent symptoms cannot be cleared by anatomy, activity details or a bare recommendation request', () => {
  for (const first of ['胸痛，呼吸困難', '突然劇痛而且無法站立', 'I have chest pain and difficulty breathing']) {
    const history = [user(first)];
    for (const question of ['膝盖', '走路痛', 'when walking', '推薦器材', 'recommend equipment']) {
      assert.equal(symptomConcern(question, history).urgent, true, `${first} -> ${question}`);
      assert.deepEqual(symptomGuideCandidates(question, catalog('zh'), 'zh', history, { requireRequest: false }), []);
      history.push(user(question));
    }
  }
});

test('new body parts replace old ones, including explicit corrections, without reusing named old-topic guides', () => {
  const history = [user('膝痛，測試膝器材適合嗎？')];
  for (const question of ['肩膀痛', '不是膝盖，是肩膀痛', 'Not my knee but my shoulder hurts']) {
    assert.deepEqual(symptomConcern(question, history).targets, ['shoulder']);
    const items = [{ id: 'knee', name: '測試膝器材', ptTip: '可以減輕膝部疼痛。' }, { id: 'shoulder', name: '測試肩器材', ptTip: '可以減輕肩部疼痛。' }];
    assert.deepEqual(ids(symptomGuideCandidates(question, items, 'zh', history)), ['shoulder']);
  }
  const lower = [user('腿痛推薦器材'), user('膝蓋')];
  assert.deepEqual(symptomConcern('腳底', lower).targets, ['foot']);
});

test('new topics, greetings and plain map queries break the chain, and assistant text cannot supply symptoms', () => {
  for (const barrier of ['你好', '今天天氣如何？', '那今天的天氣呢？', '最近的器材在哪裡？', 'Where is the nearest park?', '推薦餐廳']) {
    const history = [user('膝蓋痛推薦器材'), user(barrier)];
    assert.equal(symptomConcern('推薦器材', history), null, barrier);
    assert.equal(symptomConcern('when walking', history), null, barrier);
  }
  assert.equal(symptomConcern('膝盖', [{ role: 'assistant', content: '胸痛膝痛，推薦器材' }]), null);
  assert.equal(symptomConcern('推薦器材', [user('膝痛'), ...Array.from({ length: 8 }, () => user('when walking'))]), null);
});

test('newly named equipment keeps its own evidence and unavailable guides stay excluded from candidates', () => {
  const items = [{ id: 'k', name: '膝部訓練器', ptTip: '可以減輕膝部疼痛。' }, { id: 'f', name: '石春路', ptTip: '可以減輕腳底疼痛。' }, { id: 'hidden', isActive: false, ptTip: '可以減輕膝部疼痛。' }];
  const history = [user('膝痛，推薦器材')];
  assert.deepEqual(ids(symptomGuideCandidates('那石春路呢？', items, 'zh', history)), []);
  assert.deepEqual(ids(symptomGuideCandidates('推薦器材', items, 'zh', history)), ['k']);
  const shoulder = [{ id: 's', name: 'Shoulder Wheel', nameZh: '肩部轉輪器', ptTip: '可以減輕肩部疼痛。' }];
  for (const question of ['那肩部轉輪器呢？', 'What about Shoulder Wheel?']) {
    assert.deepEqual(symptomConcern(question, history).targets, ['knee']);
    assert.deepEqual(symptomGuideCandidates(question, shoulder, 'zh', history), []);
  }
  const simplified = [{ id: '0', name: '太極揉推器', ptTip: '可以減輕肩部疼痛。' }, { id: '4', name: '膝部伸展器', ptTip: '可以減輕膝部疼痛。' }];
  assert.deepEqual(symptomGuideCandidates('太极揉推器怎么使用，适合腿痛吗？', simplified), []);
});

test('bounded guide continuations retain symptom cards without inheriting unrelated conversations', () => {
  const history = [user('膝蓋痛，推薦器材')];
  for (const question of ['继续', '詳細', 'more details', 'Tell me more', 'Movement steps?', '動作要領？', '請講詳細一點', 'Explain further']) {
    assert.deepEqual(symptomConcern(question, history).targets, ['knee'], question);
    assert.ok(symptomGuideCandidates(question, catalog('zh'), 'zh', history).length > 0, question);
    assert.equal(symptomConcern(question, [user('今天天氣如何？')]), null, question);
    assert.equal(symptomConcern(question, [...history, user('你好')]), null, question);
    assert.equal(symptomConcern(question), null, question);
    assert.equal(symptomConcern(question, [user('胸痛，呼吸困難')]).urgent, true, question);
  }
  assert.equal(symptomConcern('詳細介紹一下明天的天氣', history), null);
});
