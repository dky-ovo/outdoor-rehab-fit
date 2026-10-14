import { BUILT_IN_EQUIPMENT_CATALOG } from "./equipmentCatalog.js";

// Shared by API and APP. This is a presentation/content boundary, not a web
// fetcher: chat uses reviewed project FAQ and maintained in-app guide text.
export const ASSISTANT_CONTENT_POLICY = "app-content-only-v1";

const NAME_FOLD = { 机: "機", 器: "器", 背: "背", 关: "關", 节: "節", 运: "運", 动: "動", 练: "練", 炼: "煉", 锻: "鍛", 轮: "輪", 压: "壓", 腿: "腿", 强: "強", 骑: "騎", 体: "體", 脚: "腳", 离: "離" };
const foldName = text => [...String(text || "").normalize("NFKC")].map(char => NAME_FOLD[char] || char).join("");
const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Recognize complete equipment labels, not isolated anatomy. A label such as
// "扭腰機" cannot add back pain to "膝痛". Ambiguous movement names such as
// "back stretch" need an explicit machine/equipment suffix before masking.
const machineLabelPatterns = [...new Set(BUILT_IN_EQUIPMENT_CATALOG.flatMap(item => [item.nameZh, item.nameEn]
  .flatMap(name => [name, ...name.split(/[／/|]/)]).map(name => foldName(name).trim()).filter(Boolean)))]
  .sort((a, b) => b.length - a.length).map(name => {
    const latin = /^[\x00-\x7f]+$/.test(name);
    const explicit = /[器機架輪板徑]|\b(?:machine|wheel|apparatus|exerciser|equipment|station)\b/i.test(name);
    const suffix = explicit ? "" : latin ? "\\s+(?:machine|equipment|apparatus)\\b" : "(?:器材|機|器)";
    return new RegExp(`${latin ? "\\b" : ""}${escapePattern(name).replace(/\s+/g, "\\s+")}${latin ? "\\b" : ""}${suffix}`, "gi");
  });

export function assistantSymptomSubjectText(value) {
  let text = foldName(value);
  for (const pattern of machineLabelPatterns) text = text.replace(pattern, " equipment ");
  return text;
}

const EXTERNAL_NAMES = /\b(?:NHS|WebMD|Mayo Clinic|Wikipedia)\b|維基百科|维基百科|世界[衛卫]生[組组][織织]/i;
// Uppercase acronym must not match the ordinary English pronoun "who".
const namesOutside = value => EXTERNAL_NAMES.test(value) || /\bWHO\b/.test(value) || /(?:according to|based on|source:)\s*(?:the\s+)?who\b/i.test(value);
const WEB_ADDRESS = /(?:https?:\/\/|www\.)|\b(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|hk|uk|cn|io)(?:\b|\/)/i;
export function assistantHasExternalContent(value) {
  return typeof value === "string" && (WEB_ADDRESS.test(value) || namesOutside(value) ||
    /(?:根據|根据|參考|参考|來自|来自).{0,25}(?:外部|網站|网站|網頁|网页|網上|网上)|\b(?:according to|from|based on).{0,35}\b(?:website|web page|internet|online sources?)\b/i.test(value));
}

function outsideAttributedParagraph(text) {
  if (!namesOutside(text)) return false;
  return /根據|根据|參考|参考|來自|来自|資料來源|资料来源|(?:according to|based on|source:|says|recommends|advises|suggests|states|visit|website)\b/i.test(text);
}

export function assistantAppText(value) {
  if (typeof value !== "string") return value;
  // Separate paragraphs first: no nested unbounded regex over long histories.
  return value.split(/\n[ \t]*\n/).filter(paragraph => !outsideAttributedParagraph(paragraph)).join("\n\n")
    // Drop obsolete source-only rows without removing adjacent precautions.
    .replace(/^[ \t]*(?:資料來源|资料来源|參考來源|参考来源|Sources?|References?)\s*[:：][^\n]*(?:https?:\/\/|www\.)[^\n]*$/gmi, "")
    .replace(/<a\b[^>]*\bhref\s*=\s*["'][^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/\[([^\]\n]+)\]\(\s*(?:https?:\/\/|www\.|\/\/)[^\s)]*(?:\s+["'][^"']*["'])?\s*\)/gi, "$1")
    .replace(/<?(?:https?:\/\/|www\.)[^\s<>"'\u3000\u3002\uff0c\uff1b\uff01\uff1f\uff09\u3001\u300c\u300d]+>?/gi, "")
    .replace(/\b(?:[a-z0-9-]+\.)+(?:com|org|net|gov|edu|hk|uk|cn|io)\b(?:\/[^\s<>"'。！？；，]*)?/gi, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Do not mutate persisted messages or user input. Covers old histories, model
// bodies, card-only explanations, and speech/details readers using this row.
export function assistantAppMessage(message) {
  if (!message || message.sender !== "ai") return message;
  const clean = { ...message };
  let changed = false;
  if (Object.hasOwn(clean, "knowledgeReferences") && (!Array.isArray(clean.knowledgeReferences) || clean.knowledgeReferences.length)) {
    clean.knowledgeReferences = []; changed = true;
  }
  for (const key of ["text", "reply", "equipmentReplyBase"]) {
    if (typeof clean[key] === "string") {
      const text = assistantAppText(clean[key]);
      if (text !== clean[key]) { clean[key] = text; changed = true; }
    }
  }
  if ([message.text, message.reply].some(text => typeof text === "string" && text.trim()) &&
      ![clean.text, clean.reply].some(text => typeof text === "string" && text.trim())) {
    clean.text = undefined;
    clean.reply = /[\u4e00-\u9fff]/.test(message.text || message.reply || "")
      ? "這段舊回答已停止顯示。請再問一次，我會幫您找相關的器材教學。"
      : "This older answer is no longer shown. Please ask again and I will help you find the relevant equipment guide.";
    changed = true;
  }
  if (Array.isArray(clean.recommendations)) clean.recommendations = clean.recommendations.map(item => {
    if (typeof item?.reason !== "string") return item;
    const reason = assistantAppText(item.reason);
    if (reason === item.reason) return item;
    changed = true;
    return { ...item, reason };
  });
  return changed ? clean : message;
}

export function conflictingRopeInstructions(text) {
  // A known editorial conflict in maintained companion instructions. Do not
  // choose a technique on the reader's behalf or silently rewrite the source.
  const noBoth = /(?:不要|不可|避免|切勿).{0,25}(?:兩手|两手|雙手|双手).{0,10}(?:同時|同时).{0,10}拉(?:繩|绳)/.test(text)
    || /\b(?:avoid|do not|don't|not to|never)\b[^.!?\n]{0,80}\bboth hands\b[^.!?\n]{0,35}\b(?:simultaneously|at the same time|together)\b/i.test(text);
  const noSingle = /(?:不要|不可|避免|切勿).{0,15}(?:單手|单手).{0,10}拉(?:繩|绳)/.test(text)
    || /\b(?:not to|do not|don't|never|avoid)\b[^.!?\n]{0,45}\b(?:one|single) hand\b[^.!?\n]{0,45}\b(?:pull|rope)\b/i.test(text);
  return noBoth && noSingle;
}

export function assistantRopeCaution(locale = "zh") {
  return locale === "en"
    ? "Do not pull on your own yet. Ask venue staff or a physiotherapist to demonstrate the correct technique first."
    : "先不要自行拉，請場地人員或治療師示範正確方法。";
}

export function assistantGuideExplanation(item, locale = "zh", { careTips = false, maximum = 1800 } = {}) {
  const en = locale === "en";
  const fields = careTips ? ["careTip"] : ["ptTip", "kinesiologyTip", "otTip"];
  const labels = {
    careTip: en ? "Tips for Exercise Companions" : "給陪同者的提示",
    ptTip: en ? "Physiotherapy tips" : "物理治療師貼士",
    kinesiologyTip: en ? "Exercise specialist tips" : "運動學專家介紹",
    otTip: en ? "Occupational therapy tips" : "職業治療師貼士",
  };
  for (const field of fields) {
    const text = typeof item?.[field] === "string" ? assistantAppText(item[field]).trim() : "";
    if (conflictingRopeInstructions(text)) return { field, label: labels[field], text: assistantRopeCaution(locale) };
    // A long section stays in its guide. Do not cut off a warning to fit a card.
    if (text && !/^(?:[\s/\\.\-—–]+|n\/?a|none|無|无)$/i.test(text) && text.length <= maximum) return { field, text, label: labels[field] };
  }
  return null;
}

// If a provider violates the app-only source instruction, discard its outside
// answer (not just its URL) and render the facts already held by this APP.
// Normal conversational responses continue through the existing guide checks.
export function assistantAppOnlyReply({ question, intent, recommendations = [], catalog = [], locale = "zh", facility = null }) {
  const en = locale === "en";
  if (/^(你好|您好|嗨|早安|午安|晚安|hello|hi|hey)[!！。,.，?？\s]*$/i.test(question)) return en
    ? "Hello! How can I help you with the equipment guides or exercise questions in this app?"
    : "您好！您想了解哪項器材的教學，或哪方面的運動問題？";
  if (/^(謝謝|谢谢|多謝|再見|再见|thanks?|thank you|bye)[!！。,.，?？\s]*$/i.test(question)) return en ? "You're welcome. You can ask me about the app's equipment guides whenever you need." : "不用客氣，需要時可以再問我器材教學的問題。";
  if (intent.type === "facility") return facility ? [en ? "You can check this location:" : "您可以查看這個地點：", facility.name || facility[en ? "nameEn" : "nameZh"], facility.address,
    facility.distanceKm != null ? (en ? `Approximately ${facility.distanceKm} km away.` : `距離約 ${facility.distanceKm} 公里。`) : ""].filter(Boolean).join("\n")
    : en ? "Open Find Facility Locations to see nearby places." : "請開啟「尋找設施地點」，查看附近的位置。";
  if (recommendations.length) {
    // One complete short explanation is enough for the first response. Keep
    // longer sections behind their guide rather than cutting off precautions.
    const blocks = recommendations.slice(0, 3).flatMap(({ id }) => {
      const item = catalog.find(item => String(item.id) === String(id));
      const note = assistantGuideExplanation(item, locale, { maximum: 600 });
      if (!note) return [];
      return [`${assistantAppText(item.name || item[en ? "nameEn" : "nameZh"] || "")}\n${note.text}`];
    }).slice(0, 1);
    return [en ? "You can open the guides below to see the demonstrations and precautions before trying the movements."
      : "可點開下方教學，先看示範和注意事項，再嘗試動作。", ...blocks].join("\n\n");
  }
  if (intent.type === "equipment") return en ? "Which body area or equipment would you like to learn about? I can help you find its demonstration and precautions."
    : "您想了解哪個身體部位或哪項器材？我可以幫您找示範和注意事項。";
  return en ? "Could you tell me a little more about the exercise or equipment you mean?"
    : "您想了解哪項運動或器材？可以再說多一點嗎？";
}
