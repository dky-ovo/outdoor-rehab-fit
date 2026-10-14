import { assistantSymptomSubjectText } from './assistantContentPolicy.js';


// Identify requests for an exercise amount; this supplies no dose or medical
// judgement. It is shared by FAQ retrieval, source gating and symptom context
// so a short "how many reps?" cannot bypass unresolved urgent symptoms.
export function assistantExerciseQuantityQuestion(value) {
  const text = String(value || '').normalize('NFKC').trim();
  if (!text) return false;
  // Taking medicine is background, not a reason to ignore a later exercise
  // question. Exclude medication-only dosage questions instead.
  if (/藥|药|服用|口服|\b(?:medication|medicine|pills?|tablets?)\b/i.test(text)
    && !/拉|推|做|踩|踏|練|练|運動|运动|健身|器材|繩|绳|\b(?:reps?|repetitions?|sets?|exercise|workout|pull|push|pedal|hold|stretch|machine|use it)\b/i.test(text)) return false;
  if (/\b(?:where (?:can|should) i buy|how (?:much|many).{0,25}(?:cost|price)|how many minutes until (?:the )?(?:bus|train))\b/i.test(text)
    || /(?:買|买|購買|购买).{0,12}(?:幾|几|多少|公斤|千克)|(?:巴士|火車|火车).{0,12}(?:幾耐|几耐|多久|分鐘|分钟)/i.test(text)) return false;
  // Keep the interrogative next to its unit: 幾款下肢器材 and "what sets
  // this apart" are not requests for exercise repetitions.
  if (/(?:幾多|几多|多少|幾|几)\s*(?:下|組|组|次|分鐘|分钟|秒|公斤|千克|磅)/i.test(text)) return true;
  if (/\b(?:how many|number of)\s+(?:(?:total|recommended)\s+)?(?:reps?|repetitions?|sets?|minutes?|seconds?|times)\b/i.test(text)) return true;
  if (/(?:次數|次数|組數|组数|時長|时长).{0,15}(?:幾多|几多|多少|點定|点定|怎麼|怎么)/i.test(text)) return true;
  if (/(?:阻力|負重|负重).{0,20}(?:幾|几|多少|調|调|設定|设定)/i.test(text)
    || /(?:幾|几|多少|調|调|設定|设定).{0,20}(?:阻力|負重|负重)/i.test(text)) return true;
  if (/\bhow much\s+(?:weight|resistance|load)\b/i.test(text)
    || /\bhow heavy\s+(?:should|can|would|do|to)\b/i.test(text)
    || /\b(?:what|which)\s+(?:resistance|weight|load|intensity)(?:\s+(?:level|setting))?\s+(?:should|can|would|do|to)\b/i.test(text)
    || /\b(?:what|which)\s+(?:resistance|intensity)\s+(?:level|setting)\b/i.test(text)) return true;
  if (/\b(?:recommend|suggest|choose|set)\b.{0,35}\b(?:reps?|repetitions?|sets?)\s+(?:target|range|count|number)\b/i.test(text)) return true;
  if (/(?:拉|推|做|用|休息|轉|转|踩|踏|練|练|運動|运动).{0,10}(?:幾耐|几耐|多久)/i.test(text)) return true;
  if (/\bhow (?:long|often)\b.{0,55}\b(?:exercise|work out|pull|push|pedal|hold|stretch|use|train|repetition|rep|set)\b/i.test(text)) return true;
  const amount = /(?:\d+(?:\.\d+)?|[一二三四五六七八九十百兩两]+)\s*(?:下|次|組|组|公斤|分鐘|分钟|秒)|\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(?:reps?|repetitions?|sets?|kg|kgs|pounds?|minutes?|seconds?)\b/i;
  const countedText = text.replace(/(?:介紹|介绍|說明|说明|講|讲|說|说|查|睇|看|問|问|了解|解釋|解释)一下/g, '');
  if (amount.test(countedText) && /[?？]|夠|够|太多|太少|可以|得唔得|定|還是|还是|應該|应该|建議|建议|\b(?:enough|sufficient|adequate|appropriate|recommend|suggest|too many|too much|too few|okay|ok|safe|can i|should i|may i)\b/i.test(text)) return true;
  // These narrow follow-ups need context before a particular item is chosen.
  return /^(?:咁|那|那么|那麼|一組|一组|每組|每组)?\s*(?:幾多|几多|多少)(?:下|次|組|组)?(?:先夠|先够|夠唔夠|够不够|呢|呀)?[?？!！。\s]*$/i.test(text)
    || /^(?:and\s+)?(?:is|are)\s+(?:\d+|ten|twenty|twelve)\s+(?:enough|too many)[?!. \s]*$/i.test(text)
    || /^(?:should|can|may)\s+i\s+(?:do|try|perform)\s+(?:\d+|ten|twenty|twelve)[?!. \s]*$/i.test(text);
}
// Shared deterministic language boundary, not a diagnosis or a suitability
// assessment. Only user assertions supply symptoms; quotations, denials and
// resolved history must not be promoted into present symptoms by retrieval.
const PARTS = [
  ['knee', /膝|\bknees?\b/i], ['ankle', /踝|\bankles?\b/i],
  ['calf', /小腿|\b(?:calf|calves)\b/i], ['hip', /髖|髋|\bhips?\b/i],
  ['foot', /足底|腳底|脚底|腳跟|脚跟|腳掌|脚掌|腳板|脚板|\b(?:plantar|feet|foot|heels?|soles?)\b/i],
  ['shoulder', /肩|膊頭|膊头|\bshoulders?\b/i], ['elbow', /肘|\belbows?\b/i],
  ['wrist', /腕|\bwrists?\b/i], ['neck', /頸|颈|\bneck\b/i],
  ['back', /腰|背(?!後|后|景)|脊|\b(?:back|waist|spine)\b/i],
  ['leg', /腿|腳|脚|下肢|\b(?:legs?|lower[ -]+(?:body|limbs?))\b/i],
];
const SYMPTOM = /痛|疼|痠|酸|㾓|不適|不适|僵硬|腫|肿|麻|無力|无力|冇乜力|冇力|較弱|关节炎|關節炎|肩周炎|五十肩|冷凍肩|冷冻肩|足底筋膜炎|受傷|受伤|傷了|伤了|整親|整亲|扭傷|扭伤|拉傷|拉伤|\b(?:pains?|painful|hurts?|hurting|sore|soreness|aches?|aching|stiff\w*|discomfort|swelling|swollen|arthritis|frozen shoulder|plantar fasciitis|injur\w*|strain\w*|sprain\w*|weak\w*|numb\w*)\b/i;
const EMERGENCIES = [
  ['chest', /(?:胸(?:口|部)?|心口).{0,8}(?:痛|不適|不适|翳|焗|悶|闷|緊|紧|壓迫|压迫)|\bchest\s+(?:(?:feels?|is)\s+)?(?:pain|discomfort|tight\w*|pressure)\b/i],
  ['breathing', /呼吸困難|呼吸困难|(?:抖|唞|透|吸)(?:唔到|唔順|唔顺|不過|不过|不到)氣|(?:抖|唞|透|吸)(?:唔到|唔順|唔顺|不過|不过|不到)气|喘不過氣|喘不过气|\b(?:difficulty breathing|trouble breathing|cannot breathe|can't breathe|cannot catch my breath|can't catch my breath|shortness of breath)\b/i],
  ['standing', /無法站立|无法站立|站唔起|企唔起|\b(?:cannot stand|can't stand|unable to stand)(?!\s+(?:for|long))\b/i],
  ['sudden-pain', /突然(?:非常|十分|好)?(?:劇痛|剧痛|痛得厲害|痛得厉害)|\bsudden(?:ly)?\s+(?:severe|intense)\s+pain\b/i],
  ['swelling', /嚴重腫脹|严重肿胀|\bsevere swelling\b/i],
  ['neurological', /(?:會陰|会阴).{0,8}(?:麻|失去知覺)|大小便.{0,8}(?:失禁|失控|改變|改变)|\b(?:saddle|perineal).{0,15}numb|\bnumb.{0,15}(?:saddle|perineum)|\b(?:bladder|bowel).{0,20}(?:change|loss|control)\b/i],
];
const SEVERE_ONSET = /突然|忽然|突發|突发|嚴重|严重|\b(?:sudden\w*|severe\w*)\b/i;
const BILATERAL_WEAKNESS = /(?:雙腿|双腿|兩隻腳|两只脚|兩條腿|两条腿).{0,12}(?:麻|無力|无力)|\b(?:both legs.{0,15}(?:numb|weak)|(?:numbness|weakness).{0,15}both legs)\b/i;
const HISTORICAL = /以前|從前|从前|曾經|曾经|舊年|旧年|去年|已(?:經|经)?(?:康復|康复|痊癒|痊愈|好返)|\b(?:used to|previously|last year|history of|in the past|recovered|resolved|no longer|not anymore)\b/i;
const CURRENT = /現在|现在|而家|目前|此刻|今日|\b(?:now|currently|today|presently|at the moment)\b/i;
const RECURRENCE = /復發|复发|又.{0,8}(?:出現|出现|發作|发作|痛|不適|不适|麻|無力)|再次.{0,8}(?:出現|出现|發作|发作)|\b(?:returned|returning|recurring|back again|again now|again today)\b/i;
const NO_RECURRENCE = /(?:沒有|没有|未有|未|冇).{0,4}(?:復發|复发|再次|又)|\b(?:not|never|hasn't|haven't|isn't|aren't)\b.{0,15}(?:returned|returning|recurring|back|again)/i;
const REFERS_BACK = /^(?:and\s+)?(?:it\b|it's\b|this\b|these\b|that\b|they\b|now\b|today\b|the same symptoms?\b|the discomfort\b)|^(?:而家|現在|现在|今日|如今|又|再次|再度|呢個|這個|这个)/i;
const NON_REPORT = /^(?:\s*(?:如果|假如|假設|假设|假若|(?:what\s+)?if\b))|(?:標語|标语|告示|例句|句子|文章|教學寫|教学写|說明寫|说明写).{0,8}(?:寫|写|說|说|提到)|\b(?:poster|example|phrase|article|instructions?)\s+(?:says?|mentions?|reads?)\b/i;
const QUOTES = /「([^」]*)」|『([^』]*)』|“([^”]*)”|"([^"\n]*)"/g;

const CONDITIONS = [
  ['frozen-shoulder', /肩周炎|五十肩|冷凍肩|冷冻肩|\bfrozen shoulder\b/i],
  ['plantar-fasciitis', /足底筋膜炎|\bplantar fasciitis\b/i],
  ['arthritis', /關節炎|关节炎|\b(?:osteoarthritis|arthritis)\b/i],
];
export function assistantConditionIds(value) {
  return CONDITIONS.filter(([, pattern]) => pattern.test(String(value || ''))).map(([id]) => id);
}

// Grammar-sized bounded patterns attach negation to the actual condition.
// In particular, "no equipment for my chest pain" does NOT deny chest pain.
const ZBODY = '(?:膝頭哥|膝头哥|膝蓋|膝盖|膝部|膝|胸口|胸部|胸|心口|腰背|腰部|背部|腰|背|脊柱|雙腿|双腿|腿部|小腿|大腿|腿|下肢|腳底|脚底|腳跟|脚跟|腳|脚|足底|足|手腕|腕|手肘|肘|肩膊|膊頭|膊头|肩部|肩|頸部|颈部|頸|颈|會陰|会阴|大小便)';
const ZQUAL = '(?:任何|明顯|明显|持續|持续|嚴重|严重|現在|现在|而家|以前|一啲|乜|條|条|隻|只|個|个|我|佢|的|嘅|有|感到|覺得|觉得|出現|出现|\\s)';
const ZSIGN = '(?:疼痛|痛|疼|不適|不适|腫脹|肿胀|麻痺|麻痹|麻木|無力|无力|受傷|受伤|失禁|失控|改變|改变|問題|问题|事|肩周炎|五十肩|冷凍肩|冷冻肩|足底筋膜炎|關節炎|关节炎)';
const ZCONDITION = `(?:肩周炎|五十肩|冷凍肩|冷冻肩|足底筋膜炎|關節炎|关节炎|${ZBODY}(?:的|嘅)?${ZSIGN}?|呼吸困難|呼吸困难|(?:抖|唞)唔到[氣气]|${ZSIGN})`;
const ENBODY = '(?:chest|knees?|back|waist|wrists?|elbows?|shoulders?|neck|legs?|feet|foot|saddle|perineal|bladder|bowel)';
const ENSIGN = '(?:pains?|discomfort|numb\\w*|weak\\w*|injur\\w*|hurts?|aches?|sore|stiff\\w*|swelling|frozen shoulder|plantar fasciitis|osteoarthritis|arthritis|changes?|loss of control)';
const ENQUAL = '(?:(?:any|a|the|my|his|her|their|new|current|persistent|severe|i|have|having|feel|feeling)\\s+)';
const ENCONDITION = `(?:${ENBODY}(?:\\s+${ENSIGN})?|difficulty breathing|trouble breathing|shortness of breath|${ENSIGN}(?:\\s+(?:in|at|around)\\s+${ENQUAL}*${ENBODY})?|problems?\\s+with\\s+${ENQUAL}*${ENBODY})`;
const DENIALS = [
  // Consume post-position denials before "冇痛" alone can erase their verb
  // and leave the body word looking affirmative to other retrieval callers.
  new RegExp(`${ZBODY}(?:的|嘅|而家|現在|现在)?(?:沒有|没有|冇|唔會|唔会|不會|不会|唔|不|無|无)${ZSIGN}`, 'gi'),
  new RegExp(`\\b${ENBODY}\\s+(?:doesn't|does not|isn't|is not|no longer)\\s+(?:hurts?|hurting|aches?|aching|painful|sore|stiff|swollen|weak|numb)\\b`, 'gi'),
  new RegExp(`\\b${ENBODY}(?:\\s+pain)?\\s+(?:(?:is|feels?)\\s+(?:fine|okay|ok)|(?:has|have)\\s+(?:resolved|recovered))\\b`, 'gi'),
  new RegExp(`(?:唔好當|不要當|不要当|別當|别当)${ZQUAL}*${ZCONDITION}`, 'gi'),
  new RegExp(`(?:沒有|没有|並無|并无|並非|并非|不是|唔係|未有|冇|否認|否认|無(?!力|法)|无(?!力|法))${ZQUAL}*${ZCONDITION}(?:(?:同|和|及|或)${ZQUAL}*${ZCONDITION})*`, 'gi'),
  // "no knee pain and chest discomfort now" adds a present chest complaint;
  // only an explicit "or" list shares its denial without repeating "no".
  new RegExp(`\\b(?:no longer|no|not|without|never|deny|don't have|do not have|doesn't have|does not have|don't assume|do not assume)\\s+${ENQUAL}*${ENCONDITION}(?:\\s+or\\s+${ENQUAL}*${ENCONDITION})*`, 'gi'),
];

function bodies(value) {
  // "go back to lower-body exercise" is not a complaint about the back.
  const text = value.replace(/\bback\s+(?:to|again|on|with|from)\b/gi, ' ');
  const found = PARTS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  return found.length > 1 ? found.filter(id => id !== 'leg') : found;
}
function urgentReasons(value) {
  const reasons = EMERGENCIES.filter(([, pattern]) => pattern.test(value)).map(([id]) => id);
  const numbAndWeak = /麻|\bnumb\w*\b/i.test(value) && /無力|无力|\bweak\w*\b/i.test(value);
  if (BILATERAL_WEAKNESS.test(value) && (SEVERE_ONSET.test(value) || numbAndWeak)) reasons.push('sudden-bilateral');
  return reasons;
}
function unquoted(value) {
  return value.replace(QUOTES, (whole, a, b, c, d, offset) => {
    const before = value.slice(Math.max(0, offset - 30), offset);
    // A person can quote their own current sensation; a poster/example cannot.
    return /(?:我|佢|他|她)(?:現在|而家|目前)?(?:有|感到|覺得)$|\b(?:i|he|she)\s+(?:have|has|feel|feels)\s*$/i.test(before)
      ? (a || b || c || d || '') : ' '.repeat(whole.length);
  });
}

function assertionClauses(value) {
  return value.split(/[。！？.!?,，;；\n]|\bbut\b|(?:但係|但是|不過|不过|但|而是|而係)/i).flatMap(raw => {
    // Split complete new assertions, not a shared predicate such as
    // "pain in my knees and back" or "both legs are weak and numb".
    const pieces = raw.split(/\s+and\s+/i), joined = [];
    let left = pieces.shift() || '';
    for (const right of pieces) {
      const newAssertion = (bodies(right).length && SYMPTOM.test(right)) || urgentReasons(right).length
        || (REFERS_BACK.test(right) && RECURRENCE.test(right));
      if ((SYMPTOM.test(left) || urgentReasons(left).length) && newAssertion) { joined.push(left); left = right; }
      else left += ' and ' + right;
    }
    joined.push(left);
    return joined.flatMap(clause => {
      // A trailing past comparison must not erase an explicit current report:
      // "chest pain now unlike last year" reports a present symptom. Keep
      // actual past reports historical ("chest pain last year, now ...").
      const comparison = clause.match(/\b(?:unlike|compared (?:with|to))\b/i);
      if (comparison) {
        const assertion = clause.slice(0, comparison.index);
        if (CURRENT.test(assertion) && (SYMPTOM.test(assertion) || urgentReasons(assertion).length)
          && !HISTORICAL.test(assertion) && HISTORICAL.test(clause.slice(comparison.index))) return [assertion];
      }
      const now = clause.match(/現在|现在|而家|目前|此刻|\b(?:now|currently|today|presently)\b/i);
      if (now && now.index > 0 && HISTORICAL.test(clause.slice(0, now.index))) {
        return [clause.slice(0, now.index), clause.slice(now.index)];
      }
      return [clause];
    });
  });
}

export function analyzeAssistantLanguage(value) {
  const text = String(value || '').normalize('NFKC').replace(/[’‘]/g, "'").trim().slice(0, 4000);
  const subjectText = assistantSymptomSubjectText(unquoted(text));
  const current = [], mentions = new Set(), targets = new Set(), excluded = new Set(), excludedUrgent = new Set(), urgent = new Set();
  const conditionStates = new Map();
  let hasSymptom = false, historical = false, hasExplicitNegation = false, priorHistoricalUrgent = [];
  // A comma is a boundary for a denial, not permission to delete the next
  // affirmative symptom. Coordinated body parts joined by 'and/同' stay intact.
  for (const raw of assertionClauses(subjectText)) {
    let clause = raw.trim(); if (!clause) continue;
    for (const pattern of DENIALS) clause = clause.replace(pattern, span => {
      hasExplicitNegation = true;
      assistantConditionIds(span).forEach(id => conditionStates.set(id, false));
      bodies(span).forEach(id => excluded.add(id));
      urgentReasons(span).forEach(id => excludedUrgent.add(id));
      // 'chest is fine / 心口冇事' still explicitly clears that complaint.
      if (/胸|心口|\bchest\b/i.test(span)) excludedUrgent.add('chest');
      if (/呼吸|氣|气|breath/i.test(span)) excludedUrgent.add('breathing');
      return ' '.repeat(span.length);
    });
    const reasons = urgentReasons(clause);
    const recurrent = RECURRENCE.test(clause) && !NO_RECURRENCE.test(clause);
    const isHistorical = HISTORICAL.test(clause) && !(CURRENT.test(clause) && recurrent);
    if (isHistorical || NON_REPORT.test(clause)) {
      bodies(clause).forEach(id => excluded.add(id));
      if (isHistorical) { historical = true; priorHistoricalUrgent = reasons; }
      continue;
    }
    assistantConditionIds(clause).forEach(id => conditionStates.set(id, true));
    if (priorHistoricalUrgent.length && recurrent && REFERS_BACK.test(clause) && !bodies(clause).length) {
      priorHistoricalUrgent.forEach(id => urgent.add(id));
    }
    priorHistoricalUrgent = [];
    reasons.forEach(id => urgent.add(id));
    const partIds = bodies(clause);
    partIds.forEach(id => mentions.add(id));
    const symptomatic = SYMPTOM.test(clause) || reasons.length > 0;
    hasSymptom ||= symptomatic;
    if (symptomatic) partIds.forEach(id => targets.add(id));
    if (clause.trim()) current.push(clause.trim());
  }
  const ordered = values => PARTS.map(([id]) => id).filter(id => values.has(id));
  // A later explicit current assertion takes precedence over its old history.
  targets.forEach(id => excluded.delete(id));
  const currentTargets = ordered(targets), mentionedTargets = ordered(mentions);
  return { text, subjectText, affirmativeText: current.join('。 '),
    targets: currentTargets.length > 1 ? currentTargets.filter(id => id !== 'leg') : currentTargets,
    mentionedTargets: mentionedTargets.length > 1 ? mentionedTargets.filter(id => id !== 'leg') : mentionedTargets,
    excludedTargets: ordered(excluded), hasSymptom: hasSymptom || urgent.size > 0,
    deniedConditions: [...conditionStates].filter(([, present]) => !present).map(([id]) => id),
    affirmedConditions: [...conditionStates].filter(([, present]) => present).map(([id]) => id),
    urgent: urgent.size > 0, urgentReasons: [...urgent], excludedUrgentReasons: [...excludedUrgent],
    historicalOnly: historical && !hasSymptom && urgent.size === 0, hasExplicitNegation,
    correctsHistory: /其實|其实|講清楚|讲清楚|更正|纠正|糾正|唔係|不是|\b(?:correction|actually|i meant|rather than)\b/i.test(text) };
}

export function hasAssistantEmergency(message) { return analyzeAssistantLanguage(message).urgent; }
