// Presentation only. Keep stored replies, evidence and model context intact.
// Match our known source wrappers, never delete arbitrary APP/原文 words.
function withoutSourceWrappers(text) {
  return text
    .replace(/根據APP設施教學，以下器材的說明有明確提及([^。\n]+)疼痛或不適。以下列出相應原文及原文所述的適用情況，方便您查閱。/g,
      "以下是與$1疼痛或不適相關的器材說明及適用情況，供您參考。")
    .replace(/According to the APP Facility Guide, the following equipment descriptions explicitly discuss ([^.\n]+) discomfort\. Here are the original passages and their stated conditions\./g,
      "The following equipment descriptions discuss $1 discomfort and their stated conditions of use.")
    .replace(/APP現有說明中，未找到能明確支持本次查詢與([^。\n]+)疼痛緩解相對應的原文。/g,
      "目前沒有足夠資料支持推薦器材來緩解$1疼痛。")
    .replace(/I did not find an affirmative APP passage linking this request to relief of ([^.\n]+) discomfort\./g,
      "There is not enough information to recommend equipment for relief of $1 discomfort.")
    .replaceAll("我可以幫您查閱APP相關資料", "我可以幫您查閱相關器材說明")
    .replaceAll("I can help you look up related APP information", "I can help you look up related equipment information")
    .replaceAll("我先根據APP內的設施分類，為您篩選以下參考器材。", "以下是按運動部位分類的參考器材。")
    .replaceAll("I selected these reference items from the in-app Facility Guide categories.", "Here are some equipment references grouped by activity area.")
    .replaceAll("以下是根據APP設施分類篩選出的參考器材。", "以下是按運動部位分類的參考器材。")
    .replaceAll("此設施在APP內歸類為", "此設施屬於")
    .replaceAll("This Facility Guide item is categorized for", "This equipment is categorized for")
    .replaceAll("這是APP的中醫背景資料，並非針對症狀的使用建議。", "以上說明僅供參考，並非針對症狀的使用建議。")
    .replaceAll("This is TCM background from the APP, not advice to use this equipment for your symptoms.", "This TCM information is for reference, not advice to use this equipment for your symptoms.")
    .replace(/（APP原文(?:節錄|节录)?）/g, "")
    .replace(/ \(APP excerpt\)/g, "")
    .replace(/^APP「([^」\n]+)」原文：/gm, "$1：")
    .replace(/^APP excerpt — /gm, "")
    .replace(/^根據APP內「設施教學－([^\n]+)」的資料：/gm, "$1：")
    .replace(/^以下內容來自「設施教學－([^\n]+)」：/gm, "$1：")
    .replace(/^(?:According to the Facility Guide for|The following information comes from the Facility Guide for) ([^\n]+):/gm, "$1:")
    .replace(/已在APP的設施教學中找到「([^」\n]+)」，請點擊下方入口查看現有說明和圖片。/g, "您可以點擊下方入口，查看「$1」的說明和圖片。")
    .replace(/I found ([^.\n]+) in the Facility Guide\. Open it below for the available instructions and pictures\./g, "Open the link below for instructions and pictures of $1.")
    .replaceAll("目前沒有可顯示的中醫學角度摘錄", "目前沒有可顯示的中醫學角度說明")
    .replaceAll("There is currently no TCM excerpt available", "There is currently no TCM information available")
    .replace(/^APP 設施參考$/gm, "設施參考")
    // Older model replies may use a short source lead-in instead of our fixed
    // templates. Remove only that clause, not the following explanation.
    .replace(/^(?:根據|根据)(?:我們的|我们的)?\s*APP\s*(?:內|内|中)?(?:的)?(?:設施教學(?:資料|內容)?|设施教学(?:资料|内容)?|設施分類|设施分类|原文|資料|资料|內容|内容)[，,:：][ \t]*/gmi, "")
    .replace(/^(?:According to|Based on) (?:the |our )?APP(?:'s)? (?:content|information|data|original text|Facility Guide|facility categories)[,:][ \t]*/gmi, "");
}

export function formatAssistantDisplayText(value, protectedPassages = []) {
  if (typeof value !== "string" || !value) return value;
  // Preserve real facility text verbatim, even if it mentions APP or happens
  // to contain one of our wrapper phrases. Only surrounding UI prose changes.
  const spans = [];
  const passages = new Set((Array.isArray(protectedPassages) ? protectedPassages : [])
    .filter(passage => typeof passage === "string" && passage.trim()));
  for (const passage of passages) {
    let start = value.indexOf(passage);
    while (start !== -1) {
      spans.push([start, start + passage.length]);
      start = value.indexOf(passage, start + passage.length);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  let cursor = 0, result = "";
  for (const [start, end] of merged) {
    result += withoutSourceWrappers(value.slice(cursor, start)) + value.slice(start, end);
    cursor = end;
  }
  return result + withoutSourceWrappers(value.slice(cursor));
}
