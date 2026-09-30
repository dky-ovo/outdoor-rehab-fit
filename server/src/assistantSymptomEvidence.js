// Keep this pure module identical to server/src/assistantSymptomEvidence.js.
// Symptoms require affirmative, body-specific APP prose, never category scores.
// This is educational retrieval, not a medical suitability assessment.
import { withEquipmentTcm, withEquipmentTcmReply } from "./assistantTcm.js";
const PARTS = [
  ["knee", /膝|\bknees?\b/i, "膝部", "knee"],
  ["ankle", /踝|\bankles?\b/i, "腳踝", "ankle"],
  ["calf", /小腿|\b(?:calf|calves)\b/i, "小腿", "calf"],
  ["hip", /髖|髋|\bhips?\b/i, "髖部", "hip"],
  ["foot", /足|腳底|脚底|腳跟|脚跟|腳掌|脚掌|腳板|脚板|\b(?:feet|foot|heels?|soles?)\b/i, "足部", "foot"],
  ["shoulder", /肩|\bshoulders?\b/i, "肩部", "shoulder"],
  ["elbow", /肘|\belbows?\b/i, "手肘", "elbow"],
  ["wrist", /腕|\bwrists?\b/i, "手腕", "wrist"],
  ["neck", /頸|颈|\bneck\b/i, "頸部", "neck"],
  ["back", /腰|背|脊|\b(?:back|waist|spine)\b/i, "腰背", "back"],
  // A broad leg concern may retrieve affirmative lower-limb prose. It is never
  // used when a more precise body part (especially knee versus sole) is known.
  ["leg", /腿|膝|髖|髋|下肢|\b(?:legs?|knees?|hips?|calf|calves|lower[\s-]+(?:body|limbs?))\b/i, "下肢", "leg"],
];
const SYMPTOM = /疼|痛|痠|酸|不適|不适|僵硬|腫|肿|關節炎|关节炎|肩周炎|五十肩|冷凍肩|冷冻肩|\bfrozen[\s-]+shoulder\b|\b(?:pains?|painful|hurts?|hurting|sore|soreness|aches?|aching|stiff|stiffness|discomfort|swelling|swollen|arthritis)\b/i;
const URGENT = /胸痛|胸口痛|呼吸困難|呼吸困难|無法站立|无法站立|不能站|突然劇痛|突然剧痛|嚴重腫脹|严重肿胀|\b(?:chest pain|difficulty breathing|cannot stand|can't stand|sudden severe pain|severe swelling)\b/i;
const LOCATION = /附近|最近|周邊|周边|公園|公园|\b(?:nearby|nearest|parks?)\b|(?:設施|设施|器材|儀器|仪器).{0,15}(?:位置|地點|地点|在哪|邊度|哪里)|\b(?:where|location)\b.*\b(?:facility|facilities|equipment|machine|park)\b/i;
const FOLLOW_UP = /^(?:那|這個|这个|還有|还有|怎麼用|怎么用|如何使用|其他選擇|其他选择)|\b(?:that|those|another|how to use|how often|how long|what about)\b|^it\b/i;
const SHORT_FOLLOW_UP = /^(?:(?:那|這個|这个|還有|还有)(?:其他選擇|其他选择)?(?:呢|嗎|吗)?|其他選擇|其他选择|(?:what about )?(?:that|those|another|it)(?: one| ones| options?)?)[!！。,.，?？\s]*$/i;
const FACILITY_FOLLOW_UP = /怎麼用|怎么用|(?:器|機|机|板|徑|径|路)(?:呢|嗎|吗)?[!！。,.，?？\s]*$|\b(?:wheel|twister|stepper|parallel bars?|massage path|how often|how long|how to use)\b/i;
const GREETING = /^(你好|您好|嗨|謝謝|谢谢|多謝|hello|hi|hey|thanks?|thank you)[!！。,.，?？\s]*$/i;
const REQUEST = /推薦|推荐|建議|建议|適合|适合|用什麼|用什么|邊個|边个|有咩|器材|器械|儀器|仪器|設施|设施|鍛煉|锻炼|訓練|训练|伸展|拉伸|放鬆|放松|按摩|舒緩|舒缓|強化|强化|使用|\b(?:recommend|suggest|suitable|equipment|machines?|exercise|train|stretch|relax|massage|strengthen|use|guide)\b/i;
const BENEFIT = /減輕|减轻|緩解|缓解|紓緩|纾缓|舒緩|舒缓|緩和|缓和|減少|减少|\b(?:alleviat\w*|reliev\w*|reduc\w*|eas(?:e|es|ing))\b/i;
const PAIN_EVIDENCE = /疼|痛|痠|酸|不適|不适|僵硬|\b(?:pains?|painful|sore|soreness|aches?|aching|stiff|stiffness|discomfort)\b/i;
const NEGATIVE = /不能|不可|無法|无法|沒有|没有|並無|并无|未能|不會|不会|不適合|不适合|避免|切勿|不要|勿|不建議|不建议|未必|不一定|無助|无助|尚未|(?:證據|证据|研究|資料|资料).{0,8}不足|缺乏.{0,8}(?:證據|证据|支持)|\b(?:not|never|avoid|contraindicat\w*|no evidence|no benefit|cannot|can't|doesn't|don't|shouldn't|unlikely|insufficient evidence|unproven|uncertain|unclear|lack(?:s|ing)? (?:evidence|support)|without evidence)\b/i;
const FIELD_LABELS = {
  ptTip: ["物理治療師的小貼士", "Tips from Physiotherapists"],
  kinesiologyTip: ["運動學專家的專業介紹", "Introduction by Exercise Specialists"],
  otTip: ["職業治療師的小貼士", "Tips from Occupational Therapists"],
  tcmTip: ["中醫學角度", "Traditional Chinese Medicine"],
};

const GENERIC_LEG = /腿|腳|脚|下肢|\b(?:legs?|lower[\s-]+(?:body|limbs?))\b/i;
const LOWER_PARTS = new Set(["leg", "knee", "ankle", "calf", "hip", "foot"]);
const ANATOMY_REPLY_ZH = '是|在|我|的|係|個|个|左|右|雙|双|兩|两|邊|边|主要|其實|其实|膝頭哥|膝蓋|膝盖|膝頭|膝头|膝部|膝|關節|关节|小腿|大腿|腿部|腿|腳底|脚底|腳掌|脚掌|腳跟|脚跟|腳|脚|足部|足|踝|髖|髋|下肢|肩膊|肩膀|肩部|肩|手肘|肘|手腕|腕|頸部|颈部|頸|颈|腰背|腰|背部|背|脊柱|脊|呢|呀|啊'.split('|').sort((a, b) => b.length - a.length);
const ANATOMY_REPLY_EN = /^(?:(?:my|the|it'?s|it is|in|at|on|left|right|both|mostly|only|actually)\s+)*(?:knees?|ankles?|calf|calves|hips?|feet|foot|heels?|soles?|shoulders?|elbows?|wrists?|neck|back|waist|spine|legs?|lower body|lower limbs?)(?:\s+(?:area|joint|side))?[.!?,\s]*$/i;
const REQUEST_REPLY_ZH = '請|请|幫我|帮我|麻煩|麻烦|我想|想|再|那|可以|可否|能否|有沒有|有没有|有咩|有哪些|什麼|什么|哪個|哪个|邊個|边个|適合|适合|推薦|推荐|建議|建议|介紹|介绍|使用|用|一下|一些|其他|戶外|户外|運動|运动|器材|儀器|仪器|器械|機器|机器|設施|设施|教學|教学|參考|参考|給我|给我|我|的|嗎|吗|呢|呀|啊'.split('|').sort((a, b) => b.length - a.length);
const REQUEST_REPLY_EN = /^(?:(?:please|could you|can you|would you)\s+)?(?:recommend|suggest)(?:\s+(?:some|suitable|other|an?|outdoor|exercise|equipment|machines?|guides?|for me))*[.!?,\s]*$/i;
const MOVEMENT_REPLY_ZH = '只有|只係|只是|係|是|在|當|当|走路|行路|步行|上落樓梯|上落楼梯|上樓梯|上楼梯|落樓梯|下楼梯|站立|企|跑步|活動|活动|的時候|的时候|時|时|會|会|就|才|一直|不會|不会|痛|疼|不適|不适'.split('|').sort((a, b) => b.length - a.length);
const MOVEMENT_REPLY_EN = /^(?:(?:only|mostly|it|hurts?|when|while|during|on|with|at|after|walking|walk|stairs|upstairs|downstairs|standing|moving|movement|running|the|i|go|climbing|and)\s*)+[.!?,\s]*$/i;
const GUIDE_CONTINUATION = /^(?:(?:please|couldyou|canyou|wouldyou|請|请|麻煩|麻烦|可以))*(?:tellmemore|more(?:please|details?|information)?|goon|keepgoing|continu(?:e|ation)|elaborate|explain(?:more|further)|movement(?:steps|technique)|whatnext|somethingelse|動作要領|动作要领|[詳详][細细](?:介紹|介绍)?(?:說明|说明|一點|一点|一下|些|啲)?|再(?:講|讲|說|说)(?:多|詳細|详细|一點|一点|點|点|些|啲)*|(?:講|讲|說|说)(?:詳細|详细|多)(?:一點|一点|點|点|些|啲)?|(?:繼續|继续)(?:說|说|講|讲)?)(?:please|謝謝|谢谢)?$/i;

// Deterministic longest-token parsing avoids exponential regex backtracking on
// repeated overlapping Chinese words such as "我想" or "腰背" plus bad input.
function chinesePhrase(text, tokens) {
  const compact = text.replace(/[!！。,.，?？\s]/g, '');
  if (!compact) return false;
  let index = 0;
  while (index < compact.length) {
    const token = tokens.find(value => compact.startsWith(value, index));
    if (!token) return false;
    index += token.length;
  }
  return true;
}

function concernTargets(text) {
  const correction = text.match(/(?:不是|唔係|並非|并非)[^，,;；。]*(?:而是|而係|是|係|[，,;；]\s*(?:是|係)?)(.+)$/i)
    || text.match(/\bnot\b.+?\bbut\b\s*(.+)$/i);
  const targetText = correction ? correction[1] : text;
  const specific = PARTS.filter(([id, pattern]) => id !== "leg" && pattern.test(targetText)).map(([id]) => id);
  return specific.length ? specific : GENERIC_LEG.test(targetText) ? ["leg"] : [];
}

function anatomyReply(text) {
  return chinesePhrase(text.replace(/^(?:那|不是|唔係)/, '').replace(/(?:而是|而係|不是|唔係)/g, '是'), ANATOMY_REPLY_ZH)
    || ANATOMY_REPLY_EN.test(text.replace(/^what about\s+/i, ''));
}

function explicitConcernTargets(text) {
  // Body words inside a newly named machine are not a change to the user's
  // symptoms ("what about the shoulder wheel?" after a knee-pain question).
  return SYMPTOM.test(text) || anatomyReply(text) ? concernTargets(text) : [];
}

function concernTurn(text) {
  if (!text || GREETING.test(text) || (LOCATION.test(text) && !SYMPTOM.test(text))) return false;
  if (SYMPTOM.test(text) || URGENT.test(text)) return true;
  if (text.length <= 80 && GUIDE_CONTINUATION.test(text.replace(/[^\p{L}\p{N}]/gu, ''))) return true;
  if (FOLLOW_UP.test(text) && (REQUEST.test(text) || SHORT_FOLLOW_UP.test(text) || FACILITY_FOLLOW_UP.test(text))) return true;
  if (anatomyReply(text)) return true;
  if (REQUEST.test(text) && (chinesePhrase(text, REQUEST_REPLY_ZH) || REQUEST_REPLY_EN.test(text))) return true;
  return /走路|行路|步行|樓梯|楼梯|站立|跑步|\b(?:walking|walk|stairs|upstairs|downstairs|standing|moving|movement|running)\b/i.test(text)
    && (chinesePhrase(text, MOVEMENT_REPLY_ZH) || MOVEMENT_REPLY_EN.test(text));
}

export function symptomConcern(question, history = []) {
  const text = String(question || "").trim();
  if (!concernTurn(text)) return null;
  let urgent = URGENT.test(text), hasSymptom = SYMPTOM.test(text) || urgent;
  let targets = explicitConcernTargets(text), requested = REQUEST.test(text);
  const contextQuestions = [];
  // Collect a contiguous, bounded chain of USER statements only. Short answers
  // to our clarification retain the user's request; model prose supplies none.
  const previousUsers = (Array.isArray(history) ? history : [])
    .filter(item => item?.role === "user" && typeof item.content === "string").slice(-8).reverse();
  for (const previous of previousUsers) {
    const prior = previous.content.trim();
    if (!concernTurn(prior)) break;
    contextQuestions.push(prior);
    urgent ||= URGENT.test(prior);
    hasSymptom ||= SYMPTOM.test(prior) || URGENT.test(prior);
    requested ||= REQUEST.test(prior);
    const previousTargets = explicitConcernTargets(prior);
    if (!targets.length || (targets.length === 1 && targets[0] === "leg" && previousTargets.length && previousTargets.every(target => LOWER_PARTS.has(target)))) targets = previousTargets.length ? previousTargets : targets;
  }
  if (!hasSymptom) return null;
  if (urgent) return { question: text, urgent: true, targets: [], requested: false, contextQuestions };
  // Do not carry a named facility from an older, different body-part topic into
  // the new target. Older request intent can carry, but its body part cannot.
  const matchingContext = contextQuestions.filter(prior => {
    const previousTargets = explicitConcernTargets(prior);
    return !previousTargets.length || previousTargets.every(target => targets.includes(target) || (target === "leg" && targets.every(value => LOWER_PARTS.has(value))));
  });
  return { question: text, urgent: false, targets, requested, ...(matchingContext.length ? { contextQuestions: matchingContext } : {}) };
}

function activeItems(catalog) {
  const seen = new Set();
  return (Array.isArray(catalog) ? catalog : []).filter(item => {
    if (!item || item.id == null || item.isActive === false || item.deletedAt || seen.has(String(item.id))) return false;
    seen.add(String(item.id));
    return true;
  });
}

const NAME_CHARACTERS = {
  极: '極', 轮: '輪', 关: '關', 节: '節', 设: '設', 单: '單', 双: '雙', 压: '壓', 锻: '鍛', 炼: '煉', 强: '強',
  离: '離', 机: '機', 体: '體', 骑: '騎', 脚: '腳', 动: '動', 运: '運', 经: '經', 径: '徑', 练: '練',
};
const compact = value => [...String(value || "").toLowerCase()].map(character => NAME_CHARACTERS[character] || character).join('').replace(/[^\p{L}\p{N}]/gu, "");
function namedItems(question, items, contextQuestions = []) {
  // Prefer a newly named facility to old names. Otherwise retain the nearest
  // named subject during "how often/that one" follow-ups, always using the
  // inherited symptom's evidence rather than broad body-category scores.
  for (const lookup of [question, ...contextQuestions]) {
    const text = compact(lookup);
    const matches = items.map(item => {
      const aliases = [item.name, item.nameZh, item.nameEn, ...(Array.isArray(item.aliases) ? item.aliases : [])]
        .filter(value => typeof value === "string").flatMap(value => [value, ...value.split(/[／/|]/)]);
      return { item, length: Math.max(0, ...aliases.map(compact).filter(name => name.length >= 3 && text.includes(name)).map(name => name.length)) };
    }).filter(match => match.length).sort((a, b) => b.length - a.length);
    if (matches.length) return [matches[0].item];
  }
  return items;
}

export function symptomEvidence(item, concern) {
  if (!concern || concern.urgent || !concern.targets.length) return null;
  for (const field of Object.keys(FIELD_LABELS)) {
    if (field === "tcmTip" && !item.tcmEnabled) continue;
    const prose = typeof item[field] === "string" ? item[field] : "";
    for (const part of prose.match(/[^。！？.!?\n]+[。！？.!?]?/g) || []) {
      const quote = part.trim();
      if (!quote || quote.length > 800 || !PAIN_EVIDENCE.test(quote) || !BENEFIT.test(quote) || NEGATIVE.test(quote)) continue;
      if (!concern.targets.every(target => PARTS.find(([id]) => id === target)?.[1].test(quote))) continue;
      return { field, quote, targets: [...concern.targets] };
    }
  }
  return null;
}

export function symptomGuideCandidates(question, catalog, locale = "zh", history = [], { requireRequest = true } = {}) {
  const concern = symptomConcern(question, history);
  if (!concern || concern.urgent || (requireRequest && !concern.requested) || !concern.targets.length) return [];
  const en = locale === "en";
  const available = activeItems(catalog);
  return withEquipmentTcm(namedItems(concern.question, available, concern.contextQuestions).flatMap(item => {
      const evidence = symptomEvidence(item, concern);
      if (!evidence) return [];
      const section = FIELD_LABELS[evidence.field][en ? 1 : 0];
      return [{ id: String(item.id), name: item.name || item.nameZh || item.nameEn || "",
        reason: en ? `APP excerpt — ${section}: “${evidence.quote}”` : `APP「${section}」原文：「${evidence.quote}」`,
        evidence }];
    }), available, locale);
}

export function symptomGuideAnswer(question, catalog, locale = "zh", history = []) {
  const concern = symptomConcern(question, history);
  if (!concern) return null;
  const en = locale === "en";
  const available = activeItems(catalog);
  const targetLabel = concern.targets.map(target => PARTS.find(([id]) => id === target)?.[en ? 3 : 2]).filter(Boolean).join(en ? " / " : "／");
  const recommendations = symptomGuideCandidates(question, available, locale, history).slice(0, 3);
  let reply;
  if (concern.urgent) {
    reply = en ? "Please stop exercising and seek prompt medical help. I will not recommend equipment for these symptoms."
      : "請停止運動並盡快尋求醫護協助。我不會根據這些症狀推薦器材。";
  } else if (!concern.targets.length || !concern.requested) {
    reply = en ? "I cannot determine suitable equipment from pain alone. Where exactly is the discomfort? I can help you look up related APP information, but a professional assessment is needed before exercising with pain."
      : "不能單憑疼痛判斷哪項器材適合您。請問具體是哪個部位不適？我可以幫您查閱APP相關資料，但有疼痛時應先由醫護人員評估。";
  } else if (recommendations.length) {
    reply = en ? `According to the APP Facility Guide, the following equipment descriptions explicitly discuss ${targetLabel} discomfort. Here are the original passages and their stated conditions. They are information for reference, not a diagnosis or confirmation of suitability for your symptoms; please have a healthcare professional assess suitability before use.`
      : `根據APP設施教學，以下器材的說明有明確提及${targetLabel}疼痛或不適。以下列出相應原文及原文所述的適用情況，方便您查閱。這些資料並不代表已判斷器材適合您的症狀，也不是診斷或治療建議；使用前請先由醫護人員評估。`;
  } else {
    reply = en ? `I did not find an affirmative APP passage linking this request to relief of ${targetLabel} discomfort. A body-area category alone is not evidence of suitability, so I will not add equipment recommendations. Please seek a professional assessment if pain is severe, persistent or worsening.`
      : `APP現有說明中，未找到能明確支持本次查詢與${targetLabel}疼痛緩解相對應的原文。僅屬於某個身體部位的分類，不能證明器材適合這種疼痛，因此不會補上器材推薦。疼痛嚴重、持續或加劇時，請尋求醫護人員評估。`;
  }
  return withEquipmentTcmReply({ reply, action: "equipment_evidence", focus: concern.targets.join(","), categories: [],
    recommendations, confirmationRequired: false, source: "app_content", knowledgeSource: "facility_guide",
    evidencePolicy: "app-symptom-v1", recommendationsFinal: true, deepSeekUsed: false }, available, locale);
}
