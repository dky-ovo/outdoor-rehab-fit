import { createHash } from "node:crypto";
import { ASSISTANT_FAQ_ENTRIES, renderAssistantFaq } from "./assistantFaqKnowledge.js";
import { BAILIAN_FAQ_IDS, BAILIAN_FAQ_POLICY } from "./assistantBailianPolicy.js";
import { createAssistantDeadline } from "./assistantDeadline.js";
import { assistantExerciseQuantityQuestion } from "./assistantLanguage.js";
import { symptomConcern } from "./assistantSymptomEvidence.js";

export const BAILIAN_FAQ_TIMEOUT_MS = 3000;
const allowedIds = new Set(BAILIAN_FAQ_IDS);
const han = /\p{Script=Han}/u;
const navigation = /\b(?:app|application|outdoorfit|menu|screen|section|tab|page|clips?|replay|records?|logs?|sessions?|goals?|features|functions|capabilities)\b|\btargets?\b.{0,50}\b(?:last|past|previous)\b|程式|程序|應用|应用|選單|选单|頁面|页面|介面|界面|按鈕|按钮|分頁|分页|片段|重播|紀錄|記錄|记录|目標|目标|功能/i;
const health = /\b(?:pain|hurt|injur\w*|symptom\w*|diagnos\w*|medic\w*|disease\w*|illness\w*|treat\w*|cure\w*|prescri\w*|hypertension|diabet\w*|blood pressure)\b|疼|痛|受傷|受伤|不適|不适|症狀|症状|診斷|诊断|治療|治疗|疾病|服藥|服药|處方|处方|血壓|血压|糖尿/i;
const broadQuantity = /\bhow (?:much|long|often|many)\b.{0,70}\b(?:exercise|walking|walk|running|run|activity|training|sessions?|workouts?)\b|(?:運動|运动|步行|行路|跑步).{0,20}(?:幾多|几多|多少|幾耐|几耐|多久)/i;
const unresolvedReference = /\b(?:for (?:this|that|it|these|those)|do (?:this|that|it))\b|(?:呢個|嗰個|這個|这个)(?:點|点|怎)/i;

// Deliberately narrow first rollout. Context is only used locally to avoid
// diverting a medical question or an unfinished guide conversation.
export function isBailianFaqEligible({ question, history = [], intent, namedEquipment, asksForTcm, guideFollowup } = {}) {
  if (typeof question !== "string" || !question.trim() || question.length > 600) return false;
  if (namedEquipment || asksForTcm || guideFollowup || intent?.urgent || intent?.concern || intent?.discomfort) return false;
  if (intent?.type === "facility" || intent?.type === "equipment") return false;
  if (health.test(question) || symptomConcern(question, history) || assistantExerciseQuantityQuestion(question) || broadQuantity.test(question) || unresolvedReference.test(question)) return false;
  return navigation.test(question);
}

export function bailianFaqCandidates(question, locale = "zh") {
  // Match the training selector's order without teaching a fixed answer index.
  const key = id => createHash("sha256").update(`${question}\0${id}`).digest("hex");
  return ASSISTANT_FAQ_ENTRIES.filter(entry => allowedIds.has(entry.id))
    .map(entry => ({ faqId: entry.id, questions: entry.questions.filter(text => han.test(text) === (locale !== "en")) }))
    .filter(candidate => candidate.questions.length)
    .sort((a, b) => key(a.faqId) < key(b.faqId) ? -1 : key(a.faqId) > key(b.faqId) ? 1 : 0);
}

function selectedFaq(value, candidates) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "action" || keys[1] !== "faqId") return null;
  if (value.action !== "faq" || typeof value.faqId !== "string" || !allowedIds.has(value.faqId)) return null;
  return candidates.some(candidate => candidate.faqId === value.faqId)
    ? ASSISTANT_FAQ_ENTRIES.find(entry => entry.id === value.faqId) : null;
}

export async function tryBailianFaqAnswer({ faqSelector = null, question, history = [], locale = "zh", intent,
  namedEquipment, asksForTcm, guideFollowup, getCatalog, signal } = {}) {
  if (typeof faqSelector !== "function") return null;
  signal?.throwIfAborted();
  if (!isBailianFaqEligible({ question, history, intent, namedEquipment, asksForTcm, guideFollowup })) return null;
  const candidates = bailianFaqCandidates(question, locale);
  if (!candidates.length) return null;
  const deadline = createAssistantDeadline({ timeoutMs: BAILIAN_FAQ_TIMEOUT_MS, signal, code: "bailianFaqUnavailable" });
  try {
    const selection = await deadline.run(childSignal => faqSelector({ question, locale, candidates, signal: childSignal }));
    signal?.throwIfAborted();
    const entry = selectedFaq(selection, candidates);
    if (!entry) return null;
    // A selector may only choose a public FAQ. Its text is never a reply source.
    // Read the published catalogue again after the asynchronous model request.
    const catalog = await deadline.run(() => getCatalog());
    signal?.throwIfAborted();
    const rendered = renderAssistantFaq(entry, catalog, locale, { message: question });
    return { ...rendered, evidencePolicy: BAILIAN_FAQ_POLICY, deepSeekUsed: false,
      ...(typeof faqSelector.model === "string" && faqSelector.model.trim() ? { model: faqSelector.model.trim() } : {}) };
  } catch {
    // A short selector timeout may use the existing provider. A cancelled
    // request/job must never start another provider request.
    signal?.throwIfAborted();
    return null;
  } finally {
    deadline.close();
  }
}
