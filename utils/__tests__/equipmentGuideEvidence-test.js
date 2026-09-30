import { equipmentTranslations } from '../../constants/Equipments';
import evidence from '../../server/src/equipmentGuideEvidence.json';

const FIELDS = ['details', 'kinesiologyTip', 'ptTip', 'otTip', 'tcmTip', 'tcmEnabled', 'careTip'];

test.each(['zh', 'en'])('server evidence contains the exact current APP professional content for all equipment in %s', (locale) => {
  const items = equipmentTranslations[locale].equipmentList;
  expect(Object.keys(evidence).sort()).toEqual(items.map((item) => String(item.id)).sort());
  expect(items).toHaveLength(29);
  for (const item of items) {
    expect(evidence[String(item.id)][locale]).toEqual(Object.fromEntries(FIELDS.map((field) => [field,
      field === 'tcmEnabled' ? Boolean(item[field]) : String(item[field] || ''),
    ])));
  }
});

test('guide snapshot preserves complete instruction and professional sections without images or truncated descriptions', () => {
  for (const item of Object.values(evidence)) {
    expect(Object.keys(item).sort()).toEqual(['en', 'zh']);
    for (const content of Object.values(item)) expect(Object.keys(content).sort()).toEqual([...FIELDS].sort());
  }
});

test('inclined stretches explicitly describe knee-pain relief in both languages, unlike the foot massage path', () => {
  for (const id of ['4', '10']) {
    expect(evidence[id].zh.ptTip).toContain('減輕腳底和膝關節的痛楚');
    expect(evidence[id].en.ptTip).toMatch(/(?:alleviate foot and knee joint pain|reducing pain in the foot and knee joints)/);
  }
  const foot = evidence['28'];
  expect(foot.zh.ptTip).toContain('足底感知訓練與輕度按摩');
  expect(foot.en.ptTip).toContain('sensory training and mild foot relaxation');
  expect(Object.values(foot.zh).join('\n')).not.toMatch(/膝/);
  expect(Object.values(foot.en).join('\n')).not.toMatch(/\bknees?\b/i);
  expect(foot.zh.tcmEnabled).toBe(true);
  expect(foot.en.tcmEnabled).toBe(false);
});
