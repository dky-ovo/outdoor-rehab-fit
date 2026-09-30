import { formatAssistantDisplayText } from "./assistantDisplayText";
import { equipmentTcmExcerpt, withEquipmentTcmReply } from "./assistantTcm";

// Presentation only: never summarize with a model, shorten instructions, or
// change the evidence, recommendation order, saved history or API context.
// A mention of range/force is not itself a precaution (e.g. "improves range
// of motion"). Actual instructions, negations and conditions remain intact.
const SAFETY_OR_LIMIT = /注意|提醒|切勿|不要|避免|不建議|不建议|不適合|不适合|禁忌|禁止|不能|不可|無法|无法|沒有|没有|未必|不一定|無助|无助|不會|不会|不應|不应|諮詢|咨询|停止|醫護|医护|醫生|医生|評估|评估|疼痛加|痛楚加|劇痛|剧痛|風險|风险|危險|危险|受傷|受伤|僅|仅|只適|只适|只有|必須|必须|如果|倘若|條件|条件|先由|前請|前请|控制(?:力度|幅度)|保持在|過度|过度|\b(?:caution|warning|precaution|avoid|never|do not|don't|cannot|can't|not|no evidence|contraindicat\w*|stop|consult|unless|insufficient|unproven|only|if|provided|must|before|should|within|without|risk|danger|injur\w*|severe|worsen\w*|assess\w*|medical|healthcare)\b/i;
const INSTRUCTIONS = /使用步驟|使用步骤|操作步驟|操作步骤|\b(?:instructions|steps?\s*\d|how to use)\b|(?:^|\n)\s*\d+[.、．)]?\s*\n/i;
const INDEPENDENT = new Set(["equipment_local", "equipment_image", "image_confirmation", "facility", "auth_error", "error"]);
const LATER_QUALIFIER = /切勿|不要|避免|不能|不可|無法|无法|未必|不一定|無助|无助|不會|不会|不應|不应|只適|只适|只有|僅|仅|必須|必须|如果|倘若|條件|条件|(?:如|若)不[適适]|停止|諮詢|咨询|評估|评估|醫護|医护|禁忌|警告|注意|\b(?:not|never|avoid|cannot|can't|only|if|unless|provided|must|for people|for patients|for individuals|stop|consult|assess\w*|medical|healthcare|caution|warning|precaution|contraindicat\w*)\b/i;
const PART_LABELS = { knee: ["膝部", "knee"], ankle: ["腳踝", "ankle"], calf: ["小腿", "calf"], hip: ["髖部", "hip"], foot: ["足部", "foot"], shoulder: ["肩部", "shoulder"], elbow: ["手肘", "elbow"], wrist: ["手腕", "wrist"], neck: ["頸部", "neck"], back: ["腰背", "back"] };

function isKnownIntroduction(message, locale) {
  const en = locale === "en", base = message.equipmentReplyBase;
  const targets = String(message.focus || "").split(",");
  if (message.action === "equipment_evidence" && targets.every(target => Object.hasOwn(PART_LABELS, target))) {
    const label = targets.map(target => PART_LABELS[target][en ? 1 : 0]).join(en ? " / " : "／");
    const expected = en
      ? `According to the APP Facility Guide, the following equipment descriptions explicitly discuss ${label} discomfort. Here are the original passages and their stated conditions. They are information for reference, not a diagnosis or confirmation of suitability for your symptoms; please have a healthcare professional assess suitability before use.`
      : `根據APP設施教學，以下器材的說明有明確提及${label}疼痛或不適。以下列出相應原文及原文所述的適用情況，方便您查閱。這些資料並不代表已判斷器材適合您的症狀，也不是診斷或治療建議；使用前請先由醫護人員評估。`;
    if (base === expected) return true;
  }
  return base === (en
    ? "I selected these reference items from the in-app Facility Guide categories. Please read the guide and start gently."
    : "我先根據APP內的設施分類，為您篩選以下參考器材。請先閱讀設施教學，並按自身情況慢慢進行。");
}

function singleEquipmentExplanation(cards, fullText, locale) {
  const en = locale === "en";
  for (const item of cards) {
    const { field, quote } = item.evidence || {};
    // Use one complete, already verified professional excerpt, not a new
    // model summary or an unrelated benefit from elsewhere in the catalog.
    // Never trim off a condition just to make an explanation fit the preview.
    if (!["ptTip", "kinesiologyTip", "otTip"].includes(field) ||
      typeof quote !== "string" || !quote.trim() || !item.name ||
      [...quote].length > (en ? 350 : 100) ||
      typeof item[field] !== "string" || !item[field].includes(quote) ||
      !fullText.includes(quote)) continue;
    return { item, quote };
  }
  return null;
}

function shortTcmExplanation(item, fullText, locale) {
  // Rebuild from the same facility's current enabled content; never borrow
  // another card's TCM paragraph or a model-supplied excerpt. Keep a complete
  // first sentence only when no later condition would be lost.
  const quote = equipmentTcmExcerpt(item, locale)?.quote;
  if (!quote || !fullText.includes(quote)) return "";
  const first = quote.match(/^[\s\S]+?(?:[。！？!?]+[”’」』"]*|\.(?!\d)[”’」』"]*|$)/)?.[0]?.trim();
  if (!first || [...first].length > (locale === "en" ? 240 : 90) ||
    LATER_QUALIFIER.test(first) || INSTRUCTIONS.test(first) || LATER_QUALIFIER.test(quote.slice(first.length))) return "";
  return `${locale === "en" ? "From a traditional Chinese medicine perspective: " : "從中醫學角度："}${first}`;
}

function conversationalRecommendation(message, explanation, cards, fullText, locale, replyIndex) {
  const en = locale === "en";
  // Chronological recommendation order gives consecutive replies different
  // wording without random changes on render, scrolling or opening details.
  const variant = Number.isSafeInteger(replyIndex) && replyIndex >= 0 ? replyIndex % 6 : 0;
  const part = String(message.focus || "").split(",").map(key => PART_LABELS[key]?.[en ? 1 : 0]).filter(Boolean).join(en ? " / " : "／");
  let intro;
  if (explanation) {
    const name = explanation.item.name;
    const topic = en ? (part ? `your ${part} query` : "your equipment query") : (part ? `您提到的${part}問題` : "您的器材查詢");
    intro = (en ? [
      `Thank you for explaining. For ${topic}, you can start by learning about ${name}:`,
      `For ${topic}, I suggest reading the guide for ${name}:`,
      `Thank you for explaining what you are looking for. Let me introduce ${name}:`,
      `Let's look at ${name} in relation to ${topic}:`,
      `To help with ${topic}, I recommend learning about ${name} first:`,
      `Here is a brief explanation of ${name} for ${topic}:`,
    ] : [
      `我了解您想查詢${part ? `${part}方面的資料` : "器材的作用"}。建議先了解「${name}」：`,
      `關於${topic}，我建議先查看「${name}」的教學：`,
      `收到您的描述。我先為您介紹「${name}」的作用：`,
      `針對${topic}，可以先認識「${name}」：`,
      `謝謝您說明想了解的情況。我推薦您先了解「${name}」的教學：`,
      `我明白您想找相關的器材資料，先看看「${name}」有甚麼作用：`,
    ])[variant];
  } else {
    // No qualified short evidence: don't substitute a new benefit or turn
    // broad activity categories into a claim of suitability for symptoms.
    intro = (en ? [
      "I understand you would like to learn more about these facilities.",
      "Let me help you find the relevant equipment information.",
      "Thank you for your question. The guides below explain these facilities.",
      "You can explore the equipment information below.",
      "I have gathered the available explanations for you to read.",
      "Let's look at the available guides and explanations.",
    ] : [
      "我了解您想進一步認識相關器材。",
      "我來幫您查閱相關的器材資料。",
      "收到您的查詢，下方整理了相關器材的說明。",
      "您可以先了解下方器材的資料。",
      "我已整理好相關說明，方便您進一步了解。",
      "我們可以先從下方的器材教學了解更多。",
    ])[variant];
  }
  const more = cards.length > 1;
  const cta = (en ? [
    `To learn more${more ? " about the other equipment" : ""}, tap “View details”, or tap an equipment card below to open its guide.`,
    "Tap “View details” for the full explanations, or open a guide from an equipment card below.",
    "For more information, open “View details”; the equipment cards below also take you to the guides.",
  ] : [
    `想了解${more ? "其他器材" : "更多"}，可點擊「查看詳細說明」，或點擊下方器材查看教學。`,
    "完整解釋放在「查看詳細說明」；也可以點擊下方器材，查看使用教學。",
    "如想進一步了解，請點擊「查看詳細說明」，或開啟下方器材的教學。",
  ])[variant % 3];
  return { variant, text: [
    explanation ? `${intro}\n${explanation.quote}` : intro,
    explanation ? shortTcmExplanation(explanation.item, fullText, locale) : "",
    cta,
  ].filter(Boolean).join("\n\n") };
}

export function assistantReplyPresentation(message, equipmentCards = [], locale = "zh", replyIndex = 0) {
  const raw = message?.text || message?.reply || "";
  if (message?.sender !== "ai") return { fullText: raw, previewText: raw, canExpand: false };
  const cards = Array.isArray(equipmentCards) ? equipmentCards : [];
  const protectedPassages = cards.flatMap(item => [item.evidence?.quote, item.tcmExcerpt?.quote,
    item.details, item.kinesiologyTip, item.ptTip, item.otTip, item.tcmTip, item.careTip]);
  const format = text => formatAssistantDisplayText(text, protectedPassages);
  let fullText = format(raw);
  const blocked = message.confirmationAnswered === "no" ||
    (message.confirmationRequired && message.confirmationAnswered !== "yes") ||
    ["image_confirmation", "facility", "auth_error", "error"].includes(message.action);
  // Navigation cards are now compact. A warning that used to live only in a
  // card must remain visible in the article, not disappear with that card text.
  const additionalReasons = [];
  if (!blocked) for (const item of cards) {
    if (typeof item.reason !== "string") continue;
    const reason = format(item.reason).trim();
    const quote = item.evidence?.quote;
    if (!reason || fullText.includes(reason) ||
      ["點擊進入設施教學，查看完整說明、圖片和動作示範。", "Open the Facility Guide for complete instructions and pictures."].includes(reason) ||
      (quote && fullText.includes(quote) && item.reason.includes(quote) && !SAFETY_OR_LIMIT.test(item.reason.replace(quote, "")))) continue;
    const paragraph = `${item.name}\n${reason}`;
    if (!additionalReasons.includes(paragraph)) additionalReasons.push(paragraph);
  }
  if (additionalReasons.length) fullText = [fullText, ...additionalReasons].filter(Boolean).join("\n\n");

  const unchanged = () => ({ fullText, previewText: fullText, canExpand: false });
  if (blocked || INDEPENDENT.has(message.action) || message.tcmInReply || !cards.length ||
    message.equipmentReplyVersion !== "app-equipment-prose-v1" ||
    typeof message.equipmentReplyBase !== "string" || INSTRUCTIONS.test(raw)) return unchanged();
  // A stored/model-provided version marker alone is not sufficient. Require
  // an exact match with the existing deterministic, current-catalog builder.
  const rebuilt = withEquipmentTcmReply({ ...message, text: undefined,
    reply: message.equipmentReplyBase, equipmentReplyVersion: undefined,
    equipmentReplyBase: undefined, recommendations: cards }, cards, locale);
  if (rebuilt.reply !== raw) return unchanged();
  const base = format(message.equipmentReplyBase);
  if (!fullText.startsWith(base)) return unchanged();
  // Never hide a quoted limitation behind the details dialog, or detach it
  // from its surrounding context. Safety beats our target preview length.
  if (cards.some(item => {
    const tcm = equipmentTcmExcerpt(item, locale)?.quote;
    return SAFETY_OR_LIMIT.test(item.evidence?.quote || "") || INSTRUCTIONS.test(item.evidence?.quote || "") ||
      (tcm && fullText.includes(tcm) && LATER_QUALIFIER.test(tcm));
  })) return unchanged();
  const en = locale === "en", knownIntroduction = isKnownIntroduction(message, locale);
  // Unknown model prose is not a trustworthy summary source. Keep every word
  // of that base and any card-only reason; only the verified appended sections
  // may move to the independently scrollable details dialog.
  // One professional explanation plus optional short TCM background for that
  // same facility. No clinical diagnosis or unsupported personal suitability.
  const conversation = knownIntroduction
    ? conversationalRecommendation(message, singleEquipmentExplanation(cards, fullText, locale), cards, fullText, locale, replyIndex)
    : null;
  // Ordinary card descriptions belong in the reader too. A specific warning
  // must stay visible, including warnings not covered by the fixed notice.
  const previewReasons = knownIntroduction
    ? additionalReasons.filter(reason => SAFETY_OR_LIMIT.test(reason) || INSTRUCTIONS.test(reason))
    : additionalReasons;
  const previewText = [conversation?.text || base, ...previewReasons].filter(Boolean).join("\n\n");
  const saving = [...fullText].length - [...previewText].length;
  // Keep short, unknown answers intact. Without a suitable short excerpt,
  // keep a detail entry point instead of inventing or truncating evidence.
  if (!knownIntroduction && ([...fullText].length < (en ? 520 : 180) || saving < (en ? 140 : 60))) return unchanged();
  return { fullText, previewText, canExpand: true, ...(conversation ? { introVariant: conversation.variant } : {}) };
}
