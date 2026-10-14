import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantFaqAnswer } from '../src/assistantFaq.js';
import { retrieveAssistantFaq } from '../src/assistantFaqKnowledge.js';

const user = content => ({ role: 'user', content });
const rope = question => assert.equal(retrieveAssistantFaq(question)?.id, 'rope-use', question);

test('live v20 colloquial rope-machine miss and equivalent amounts use the reviewed answer', () => {
  for (const question of [
    '拉繩機要拉幾多下先夠？我係長者。',
    '拉绳机要拉多少下才够？我是老人。',
    '拉繩器一組拉十下夠唔夠？',
    '拉繩機每次做幾組？',
    '上肢伸展器要拉幾多下？',
    '拉繩機拉幾耐先夠？',
    '拉繩機的阻力應設多少公斤？',
    'How many reps and sets should I do on the rope-pulling machine?',
    'Is ten repetitions on the pull-down machine enough?',
    'What weight should I select on the pulldown machine?',
    'How long should I use the rope machine?',
    'Could you show me how to use the rope machine?',
    '拉繩機應該點玩？',
  ]) {
    rope(question);
    for (const locale of ['zh', 'en']) {
      const answer = assistantFaqAnswer({ message: question, locale, catalog: [{ id: '20', name: 'Pull-down Machine' }] });
      assert.equal(answer.deepSeekUsed, false);
      assert.match(answer.reply, locale === 'en' ? /do not pull on your own.*demonstrate/is : /先不要自行拉.*示範/s);
      assert.doesNotMatch(answer.reply, /\d+\s*(?:下|次|組|组|公斤|kg|reps?|repetitions?|sets?|minutes?)/i);
    }
  }
});

test('narrow quantity follow-ups inherit only an uninterrupted recent user rope topic', () => {
  const history = [user('拉繩機點用？'), { role: 'assistant', content: '先請人示範。' }];
  for (const question of ['咁要拉幾多下？', '十下夠唔夠？', '每次幾組？', '一次拉幾耐？', 'How many reps?', 'How many repetitions should I do?', 'And how many sets?', 'Is ten enough?', 'How many minutes should I use it?', 'How many seconds should I hold each stretch?', 'Can I use it for 5 minutes?']) {
    assert.equal(retrieveAssistantFaq(question, { history })?.id, 'rope-use', question);
  }
  assert.equal(retrieveAssistantFaq('每次幾組？', { history: [...history, user('十下夠唔夠？'), { role: 'assistant', content: '按能力安排。' }] })?.id, 'rope-use');
  for (const [question, prior] of [
    ['How many reps?', [{ role: 'assistant', content: 'Try the rope machine.' }]],
    ['How many reps?', [user('拉繩機點用？'), user('Tell me about the Tai Chi Wheel')]],
    ['How many reps?', [user('拉繩機點用？'), user('Where is the cafe?')]],
    ['How many reps?', [user('I do not want the rope machine')]],
    ['十下夠唔夠？', [user('用拉繩機時肩痛')]],
    ['How many reps?', [user('I have chest pain on the rope machine')]],
    ['How many reps in Paris?', history],
    ['新買的單車做幾下？', history],
    ['How many pills should I take?', history],
    ['What about my knee pain?', history],
  ]) assert.notEqual(retrieveAssistantFaq(question, { history: prior })?.id, 'rope-use', question);
});

test('rope alias does not capture locations, shopping, rejected equipment or symptoms', () => {
  for (const question of [
    '我要買一條拉繩，應該買幾米？', '拉繩機喺邊度？',
    'How much does a rope machine cost?', 'Where can I buy a rope machine?',
    '拉繩機要幾多錢？', '拉繩機維修要幾耐？',
    '不是拉繩機，是單車，要做幾次？',
    'I do not want the pull-down machine. How many reps on the Tai Chi Wheel?',
    '我用拉繩機時肩膊痛，可以繼續嗎？',
    '我用拉繩機時心口痛，仲抖唔到氣，點算？',
  ]) assert.notEqual(retrieveAssistantFaq(question)?.id, 'rope-use', question);
  const emergency = assistantFaqAnswer({ message: '我用拉繩機時心口痛，仲抖唔到氣，點算？' });
  assert.match(emergency.reply, /999/);
  assert.deepEqual(emergency.recommendations, []);
});
