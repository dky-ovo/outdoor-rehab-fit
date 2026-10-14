// Educational excerpts only: never invent, translate, rank, or add facilities.
// The caller supplies the current language's trusted, published APP catalog.
const UNSAFE_SENTENCE = /首選|首选|首推|最佳|最好|最有效|最適合|最适合|優先|优先|第一選擇|第一选择|治癒|治愈|治好|根治|包治|赤腳|赤脚|光腳|光脚|服用|口服|外敷|處方|处方|用藥|用药|藥方|药方|煎服|針灸|针灸|艾灸|拔罐|\b(?:first[- ](?:choice|line)|top[- ]choice|best|most effective|preferred treatment|cure[sd]?|curing|heal(?:s|ed|ing)?|barefoot|bare feet|prescri\w*|dosage|medicat\w*|acupuncture|moxibustion|cupping)\b|\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml)\b|\d+(?:\.\d+)?\s*(?:克|毫升|公克)/i;
// Do not detach a benefit from a warning or negation elsewhere in its paragraph.
const QUALIFYING_WARNING = /切勿|不要|避免|不建議|不建议|不適合|不适合|禁忌|禁止|不能|不可|無法|无法|沒有證據|没有证据|無證據|无证据|未必|不一定|無助|无助|不會|不会|不應|不应|諮詢|咨询|停止|\b(?:avoid|never|do not|don't|cannot|can't|not|no evidence|contraindicat\w*|stop|consult|unless|insufficient|unproven)\b/i;
const LATER_CONDITION = /只適用|只适用|僅適用|仅适用|只有|僅限|仅限|必須|必须|如果|倘若|條件|条件|\b(?:only|if|unless|provided|must|for people|for patients|for individuals)\b/i;
const SENTENCE = /[\s\S]+?(?:[。！？!?]+[”’」』"]*|\.(?!\d)[”’」』"]*|$)/g;

export function equipmentTcmExcerpt(item, locale = "zh") {
  if (!item || item.tcmEnabled !== true || item.isActive === false || item.deletedAt || item.deleted_at) return null;
  if (typeof item.tcmTip !== "string" || !item.tcmTip.trim()) return null;
  const maximum = locale === "en" ? 550 : 220;
  // Only the already-localized tcmTip is consulted. In particular, an empty
  // English tip must not borrow Chinese prose or be automatically translated.
  for (const rawParagraph of item.tcmTip.split(/\r?\n\s*\r?\n/)) {
    const paragraph = rawParagraph.trim();
    if (!paragraph || QUALIFYING_WARNING.test(paragraph)) continue;
    const sentences = [...paragraph.matchAll(SENTENCE)];
    let end = 0, accepted = 0;
    for (const sentence of sentences) {
      const content = sentence[0].trim();
      if (!content) continue;
      // Retain only a safe prefix, not isolated later benefit sentences whose
      // conditions or antecedents may have appeared in the rejected sentence.
      if (UNSAFE_SENTENCE.test(content)) break;
      const nextEnd = sentence.index + sentence[0].length;
      if ([...paragraph.slice(0, nextEnd).trim()].length > maximum) break;
      end = nextEnd;
      accepted += 1;
      if (accepted === 2) break;
    }
    const quote = paragraph.slice(0, end).trim();
    // A short excerpt must not lose a limiting condition in a later sentence.
    if (LATER_CONDITION.test(paragraph.slice(end))) continue;
    if (quote) return { field: "tcmTip", quote };
  }
  return null;
}

export function withEquipmentTcm(recommendations, catalog, locale = "zh") {
  if (!Array.isArray(recommendations)) return [];
  const trusted = new Map();
  for (const item of Array.isArray(catalog) ? catalog : []) {
    if (item?.id == null) continue;
    const id = String(item.id);
    // Duplicate identities are ambiguous; do not pick one version's prose.
    trusted.set(id, trusted.has(id) ? null : item);
  }
  return recommendations.map(recommendation => {
    if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) return recommendation;
    const { tcmExcerpt: ignored, ...clean } = recommendation;
    if (clean.evidence?.field === "tcmTip") return clean;
    const excerpt = equipmentTcmExcerpt(trusted.get(String(clean.id)), locale);
    return excerpt ? { ...clean, tcmExcerpt: excerpt } : clean;
  });
}

const EQUIPMENT_REPLY_VERSION = "app-equipment-prose-v1";
const EVIDENCE_LABELS = {
  ptTip: ["物理治療師的小貼士", "Tips from Physiotherapists"],
  kinesiologyTip: ["運動學專家的介紹", "Exercise specialist tips"],
  otTip: ["職業治療師的小貼士", "Tips from Occupational Therapists"],
  tcmTip: ["中醫小知識", "TCM background"],
};

export function withEquipmentTcmReply(answer, catalog, locale = "zh") {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return answer;
  // Direct TCM answers already contain their excerpt. Their dedicated history
  // refresh path is responsible for rebuilding them after a maintenance edit.
  if (answer.tcmInReply === true) return answer;
  const en = locale === "en";
  const originalReply = typeof answer.reply === "string" ? answer.reply : typeof answer.text === "string" ? answer.text : "";
  // This metadata tracks only the appended presentation block. It is not proof
  // of source, authorization, or the trustworthiness of the original reply.
  const base = answer.equipmentReplyVersion === EQUIPMENT_REPLY_VERSION && typeof answer.equipmentReplyBase === "string"
    ? answer.equipmentReplyBase : originalReply;
  const trusted = new Map();
  for (const item of Array.isArray(catalog) ? catalog : []) {
    if (item?.id == null) continue;
    const id = String(item.id);
    trusted.set(id, trusted.has(id) ? null : item);
  }
  const seen = new Set();
  const recommendations = (Array.isArray(answer.recommendations) ? answer.recommendations : []).flatMap(recommendation => {
    if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation) || recommendation.id == null) return [];
    const id = String(recommendation.id), item = trusted.get(id);
    if (seen.has(id) || !item || item.isActive === false || item.deletedAt || item.deleted_at) return [];
    seen.add(id);
    const { tcmExcerpt: ignored, evidence: proposedEvidence, ...clean } = recommendation;
    clean.name = (typeof item.name === "string" && item.name.trim()) ||
      (typeof item[en ? "nameEn" : "nameZh"] === "string" && item[en ? "nameEn" : "nameZh"].trim()) || id;
    const field = proposedEvidence?.field, quote = proposedEvidence?.quote;
    if (Object.hasOwn(EVIDENCE_LABELS, field) && typeof quote === "string" && quote.trim() &&
      typeof item[field] === "string" && item[field].includes(quote) && (field !== "tcmTip" || item.tcmEnabled === true)) {
      clean.evidence = { ...proposedEvidence };
    } else if (proposedEvidence) {
      // A rejected old evidence object must not survive as unlabelled card
      // prose after its field is disabled or its original quote is edited.
      delete clean.reason;
    }
    return [clean];
  });
  // A direct guide answers the requested section. Do not append unrelated TCM
  // or other sections on restore. The flag affects presentation only: catalog
  // visibility, IDs and any proposed evidence were still checked above.
  const enriched = answer.guideContentDirect === true ? recommendations
    : withEquipmentTcm(recommendations, [...trusted.values()].filter(Boolean), locale);
  const blocked = ["facility", "auth_error", "error", "image_confirmation"].includes(answer.action) ||
    answer.confirmationAnswered === "no" || (answer.confirmationRequired && answer.confirmationAnswered !== "yes");
  const blocks = [];
  let includesTcm = false;
  const quoted = quote => en ? `“${quote}”` : `「${quote}」`;
  const passage = (label, quote) => `${label}${en ? ": " : "："}${quoted(quote)}`;
  if (!blocked) {
    for (const recommendation of enriched) {
      const passages = [];
      if (answer.action === "equipment_evidence" && recommendation.evidence) {
        const { field, quote } = recommendation.evidence;
        if (field === "tcmTip") includesTcm = true;
        if (!base.includes(quote)) passages.push(passage(EVIDENCE_LABELS[field][en ? 1 : 0], quote));
      }
      if (answer.guideContentDirect !== true && recommendation.tcmExcerpt && !base.includes(recommendation.tcmExcerpt.quote)) {
        passages.push(passage(EVIDENCE_LABELS.tcmTip[en ? 1 : 0], recommendation.tcmExcerpt.quote));
        includesTcm = true;
      }
      if (passages.length) blocks.push(`${recommendation.name}\n${passages.join("\n\n")}`);
    }
  }
  const tcmNote = en
    ? "These are general TCM explanations, not treatment advice. If you have pain, ask a healthcare professional before exercising."
    : "這些是中醫的一般說明，不能代替診治。有痛楚時，請先找醫護人員評估。";
  if (includesTcm && !base.includes(tcmNote)) blocks.push(tcmNote);
  return { ...answer, recommendations: enriched,
    reply: blocks.length ? [base, ...blocks].filter(part => part.trim()).join("\n\n") : base,
    equipmentReplyVersion: EQUIPMENT_REPLY_VERSION, equipmentReplyBase: base };
}
