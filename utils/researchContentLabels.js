const readable = value => typeof value === "string" && value.trim() && !/^\d+$/.test(value.trim()) ? value.trim() : "";
const copy = (locale, simplified, traditional, english) => locale === "en" ? english : locale === "zh-HK" || locale === "zh" ? traditional : simplified;

export function researchVideoLabel(item = {}, locale = "zh-CN") {
  const name = locale === "en" ? readable(item.contentNameEn) || readable(item.contentNameZh) : readable(item.contentNameZh) || readable(item.contentNameEn);
  if (item.contentStatus === "deleted") {
    const prefix = copy(locale, "已删除器材", "已刪除器材", "Deleted equipment");
    return name ? `${prefix} · ${name}` : prefix;
  }
  if (name) return name;
  if (item.contentKind === "equipment") return copy(locale, "未知或已移除器材", "未知或已移除器材", "Unknown or removed equipment");
  if (item.contentKind === "ambiguous") return copy(locale, "来源不明确的视频内容", "來源不明確的影片內容", "Video content with an ambiguous source");
  if (item.contentKind === "content") return copy(locale, "未知或已移除内容", "未知或已移除內容", "Unknown or removed content");
  return copy(locale, "未标注或未知视频", "未標註或未知影片", "Unlabelled or unknown video");
}

export function researchEventObjectLabel(event = {}, locale = "zh-CN") {
  const metadata = event.metadata || {};
  const isVideo = /^video\./.test(event.eventName || "");
  if (event.contentKind && (isVideo || event.contentKind === "equipment" || event.contentKind === "content")) return researchVideoLabel(event, locale);
  if (isVideo) return readable(metadata.title) || researchVideoLabel({ contentKind: metadata.screen === "outdoor.detail" || metadata.equipmentId != null ? "equipment" : "video" }, locale);
  return readable(metadata.title) || readable(metadata.button) || readable(metadata.screen) || "-";
}
