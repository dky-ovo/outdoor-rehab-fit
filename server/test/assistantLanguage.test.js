import assert from 'node:assert/strict';
import test from 'node:test';
import { symptomConcern, symptomGuideAnswer } from '../src/assistantSymptomEvidence.js';
import { analyzeAssistantLanguage, hasAssistantEmergency } from '../src/assistantLanguage.js';

const user = content => ({ role: 'user', content });

test('reported Cantonese chest/breathing symptoms take the urgent branch before equipment lookup', () => {
  for (const question of [
    '我用扭腰機嗰陣心口痛，仲抖唔到氣，咁可唔可以繼續呀？',
    '我玩緊扭腰機，突然心口翳住，抖唔到氣，仲可唔可以繼續呀？',
    '行兩步就心口焗住而家唞唔到氣', '現在胸悶並且喘不過氣，能運動嗎？',
    'My chest feels tight and I cannot catch my breath. Can I keep exercising?',
  ]) {
    assert.equal(symptomConcern(question)?.urgent, true, question);
    const result = symptomGuideAnswer(question, [], 'zh');
    assert.match(result.reply, /立即|即刻/); assert.match(result.reply, /999/);
    assert.deepEqual(result.recommendations, []);
  }
});

test('explicit denial excludes only the denied symptom in either word order', () => {
  for (const question of [
    '我的膝蓋痛，但沒有腰痛，可以介紹相關器材嗎？',
    '我係膝頭哥痛，條腰冇痛㗎，有咩器材可以睇吓呀？',
    '我淨係膝頭哥痛，條腰冇事，唔好當我腰痛。公園有咩器械可以了解下？',
    '我沒有腰痛，只有膝蓋痛，可以用扭腰機嗎？',
    'Can you show me a gentle machine for sore knees? I do not have back pain.',
    "My back doesn't hurt, but my knee hurts. What machine can I use?",
    'My knee hurts but my back is fine. Suggest a machine.',
    'Not my back but my knees hurt. Please suggest equipment.',
    'I have no pain in my back, only sore knees. Which machine?',
    'My back is not hurting, my knee hurts. Please suggest equipment.',
    'My back no longer hurts, but my knee is sore. Which machine?',
    '我腰部不會痛，只有膝痛，推薦器材。',
  ]) assert.deepEqual(symptomConcern(question)?.targets, ['knee'], question);
});

test('a later denial/correction cannot resurrect old symptoms from real user history', () => {
  const history = [user('我有腰痛，想了解相關的戶外器材。'), { role: 'assistant', content: '腰背資料' }];
  assert.deepEqual(symptomConcern('我講清楚啲，其實冇腰痛，係膝頭哥痛。咁應該睇邊啲器材？', history)?.targets, ['knee']);
  assert.equal(symptomConcern('我其實冇腰痛，有咩器材？', history), null);
  assert.deepEqual(symptomConcern('My back pain has resolved. My knees hurt now; suggest exercise.', [user('My back hurts, recommend equipment')])?.targets, ['knee']);
});

test('two real symptoms and body-only clarifications are retained without treating machine names as symptoms', () => {
  for (const question of ['我膝頭哥同條腰都痛，咁仲用唔用得扭腰機呀？', 'Both my knees and back hurt; can I use the twister?']) {
    assert.deepEqual(symptomConcern(question)?.targets, ['knee', 'back'], question);
  }
  assert.deepEqual(symptomConcern('我膝頭哥痛，想用扭腰機')?.targets, ['knee']);
  assert.deepEqual(symptomConcern('My knee hurts when I go back to lower-body exercise')?.targets, ['knee']);
});

test('denied, historical and quoted emergencies do not manufacture a current emergency', () => {
  for (const question of [
    '我沒有胸口痛，膝頭哥痛想查器材', '我心口冇事，冇呼吸困難，只有膝痛',
    '我沒有胸痛，只有膝痛。', '唔係胸痛，只係膝頭哥痛。',
    '我沒有嚴重腫脹，可以運動嗎？', '我冇嚴重腫脹，只有膝痛。',
    'I have no chest pain or difficulty breathing, just knee pain.',
    'I had chest pain last year and it has resolved. My knee hurts now.',
    '以前胸痛，已經康復，而家膝痛有咩器材？',
    '標語寫著「心口痛，抖唔到氣」，我只想查膝痛器材。',
    'The poster says "chest pain". I have knee pain.',
    '以前胸口痛，膝痛又出現，有咩器材？',
    '以前胸口痛，現在膝痛又出現，有咩器材？',
    'I had chest pain last year, now my knee pain has returned.',
    '我的雙腿較無力，容易跌倒，有哪些較安全的戶外運動？',
    'Both my legs are weak and I fall easily. What equipment is safer?',
  ]) assert.equal(Boolean(symptomConcern(question)?.urgent), false, question);
  for (const question of [
    '我沒有膝痛，但而家心口痛抖唔到氣',
    'I have chest pain now unlike last year.',
    'My chest feels tight today compared with last year.',
    '現在胸痛，可以繼續運動嗎？', '我嚴重腫脹，可以運動嗎？',
    'I have no knee pain and chest discomfort now. How often should I exercise?',
    'I had knee pain last year and chest discomfort now. How often should I exercise?',
    '去年手腕痛現在胸口不適，每星期運動多久？',
    'No equipment seems suitable for my chest discomfort now.',
    '以前胸口不適，今日又發作',
    'My chest discomfort resolved last year, but it has returned today.',
    '雙腿突然麻痺無力，無法站立',
    '雙腿無力麻木，可以做運動嗎', '双腿麻木无力，还能运动吗',
    'Both legs are weak and numb. Can I exercise?',
  ]) assert.equal(symptomConcern(question)?.urgent, true, question);
});

test('affirmative text and excluded anatomy agree across the shared FAQ/evidence interface', () => {
  const state = analyzeAssistantLanguage('我係膝頭哥痛，條腰冇痛㗎，有咩器材可以睇吓呀？');
  assert.deepEqual(state.targets, ['knee']);
  assert.deepEqual(state.mentionedTargets, ['knee']);
  assert.deepEqual(state.excludedTargets, ['back']);
  assert.doesNotMatch(state.affirmativeText, /腰/);
  assert.equal(hasAssistantEmergency('我沒有 胸口痛，只有膝痛'), false);
  assert.equal(hasAssistantEmergency('雙腿較無力，容易跌倒'), false);
  assert.equal(hasAssistantEmergency('雙腿無力麻木'), true);
});

test('explicit correction of a historical emergency differs from an unresolved urgent follow-up', () => {
  const history = [user('I have chest pain and difficulty breathing')];
  assert.equal(symptomConcern('Which exercise?', history)?.urgent, true);
  assert.equal(Boolean(symptomConcern('Correction: I have no chest pain or difficulty breathing, only knee pain.', history)?.urgent), false);
  assert.deepEqual(symptomConcern('Correction: I have no chest pain or difficulty breathing, only knee pain.', history)?.targets, ['knee']);
  assert.equal(symptomConcern('Correction: I have no chest pain or difficulty breathing.', history), null);
});
