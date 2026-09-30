import { BUILT_IN_EQUIPMENT_CATALOG } from "./equipmentCatalog.js";

const identifier = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const name = value => typeof value === "string" && !/^\d+$/.test(value.trim()) ? value.trim() : "";
const builtIns = new Map(BUILT_IN_EQUIPMENT_CATALOG.map(item => [String(item.id), item]));
const unknown = kind => ({ contentKind: kind, contentStatus: "unknown", contentNameZh: "", contentNameEn: "" });

// Only read names already maintained by the server. Research readers must not
// need equipment-edit permissions or receive the equipment's private fields.
// Rebuilt for each request so renaming a facility is immediately reflected.
export function createResearchContentResolver(database) {
  const equipment = new Map(database.prepare("SELECT id, name_zh, name_en, deleted_at FROM app_equipment_items").all().map(row => [String(row.id), row]));
  const content = new Map(database.prepare("SELECT id, title FROM content_items").all().map(row => [String(row.id), row]));
  function resolve(metadata) {
    const explicitEquipment = identifier(metadata?.equipmentId);
    const id = explicitEquipment || identifier(metadata?.contentId) || identifier(metadata?.videoId);
    const screen = identifier(metadata?.screen);
    const isEquipment = Boolean(explicitEquipment) || screen === "outdoor.detail";
    const isManaged = !isEquipment && (Boolean(screen) || ["video", "text", "feature"].includes(metadata?.contentType));
    if (isEquipment || (!isManaged && equipment.has(id) && !content.has(id))) {
      const row = equipment.get(id);
      if (!row) return unknown("equipment");
      const builtin = builtIns.get(id);
      const currentZh = name(row.name_zh), currentEn = name(row.name_en);
      // A current maintained name in either language wins over an old built-in
      // translation; the UI performs the requested-language fallback.
      return { contentKind: "equipment", contentStatus: row.deleted_at ? "deleted" : "current",
        contentNameZh: currentZh || (!currentEn ? name(builtin?.nameZh) : ""),
        contentNameEn: currentEn || (!currentZh ? name(builtin?.nameEn) : "") };
    }
    if (isManaged || (!equipment.has(id) && content.has(id))) {
      const row = content.get(id);
      if (!row) return unknown("content");
      return { contentKind: "content", contentStatus: "current", contentNameZh: name(row.title), contentNameEn: name(row.title) };
    }
    return unknown(equipment.has(id) && content.has(id) ? "ambiguous" : "video");
  }
  return {
    event(event) {
      const metadata = event.metadata || {};
      if (![metadata.equipmentId, metadata.contentId, metadata.videoId].some(value => identifier(value))) return event;
      return { ...event, ...resolve(metadata) };
    },
    video(video) {
      const { contentSources, ...record } = video;
      let sources;
      try { sources = JSON.parse(contentSources || "[]"); } catch { sources = []; }
      if (!Array.isArray(sources) || !sources.length) sources = [{}];
      const labels = sources.map(source => resolve({ ...source, contentId: record.contentId }));
      const distinct = new Set(labels.map(item => JSON.stringify(item)));
      // Keep historical aggregates and counts unchanged. If old records mixed
      // two different content domains under one ID, do not mislabel that group.
      return { ...record, ...(distinct.size === 1 ? labels[0] : unknown("ambiguous")) };
    },
  };
}
