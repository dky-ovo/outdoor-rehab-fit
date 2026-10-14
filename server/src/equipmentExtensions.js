// Additive fields preserve the original bilingual video/text contract for old clients.
export function equipmentExtensionArray(value) {
  try { const result = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(result) ? result : []; } catch { return []; }
}

export function equipmentExtensionsInput(body, current = {}) {
  const additionalVideos = body?.additionalVideos === undefined ? equipmentExtensionArray(current.additional_videos_json) : body.additionalVideos;
  const teachingSections = body?.teachingSections === undefined ? equipmentExtensionArray(current.teaching_sections_json) : body.teachingSections;
  if (!Array.isArray(additionalVideos) || additionalVideos.length > 40 || !Array.isArray(teachingSections) || teachingSections.length > 32) return null;
  const ids = new Set();
  const valid = (items, fields, max) => items.every(item => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(item.id || "") || ids.has(item.id)) return false;
    ids.add(item.id);
    return fields.every(field => typeof item[field] === "string" && item[field].length <= (field.startsWith("title") ? 200 : max));
  });
  if (!valid(additionalVideos, ["titleZh", "titleEn", "videoUrlZh", "videoUrlEn"], 2048) || !valid(teachingSections, ["titleZh", "titleEn", "bodyZh", "bodyEn"], 20000)) return null;
  if (additionalVideos.some(item => !item.videoUrlZh && !item.videoUrlEn) || teachingSections.some(item => !item.titleZh.trim() && !item.titleEn.trim())) return null;
  return {
    additionalVideos: additionalVideos.map(({ id, titleZh, titleEn, videoUrlZh, videoUrlEn }) => ({ id, titleZh: titleZh.trim(), titleEn: titleEn.trim(), videoUrlZh: videoUrlZh.trim(), videoUrlEn: videoUrlEn.trim() })),
    teachingSections: teachingSections.map(({ id, titleZh, titleEn, bodyZh, bodyEn }) => ({ id, titleZh: titleZh.trim(), titleEn: titleEn.trim(), bodyZh: bodyZh.trim(), bodyEn: bodyEn.trim() })),
  };
}

export function additionalEquipmentVideoUrls(value) {
  return equipmentExtensionArray(value).flatMap(item => [item?.videoUrlZh, item?.videoUrlEn]).filter(url => typeof url === "string" && url);
}
