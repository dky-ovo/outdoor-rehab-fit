const COLUMNS = new Set(["e.metadata_json", "metadata_json"]);
const KEYS = new Set(["screen", "count", "contentId", "videoId"]);

// MySQL JSON_TYPE/JSON_UNQUOTE produce utf8mb4_bin regardless of SET NAMES.
// Normalize each result before comparison, not just the outer CASE/COALESCE:
// utf8mb4_bin and utf8mb4_0900_bin have different padding semantics and MySQL
// cannot choose between equally coercible binary collations (error 1267).
// Preserve JSON null as SQL NULL while retaining the literal string "null".
export function researchJsonText(column, key) {
  if (!COLUMNS.has(column) || !KEYS.has(key)) throw new TypeError("Unreviewed research JSON expression");
  const value = `JSON_EXTRACT(${column}, '$.${key}')`;
  return `(CASE WHEN JSON_TYPE(${value}) COLLATE utf8mb4_0900_bin = 'NULL' THEN NULL ELSE JSON_UNQUOTE(${value}) COLLATE utf8mb4_0900_bin END)`;
}
