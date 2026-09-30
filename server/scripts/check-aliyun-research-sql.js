// Run in the candidate API image, cwd /app, via node --input-type=module < script.
// Only session setup and SELECTs over synthetic bound JSON; no business reads.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkServerIdentity } from "node:tls";
import mysql from "mysql2/promise";

let connection, failure = null, stage = "configuration";
const requireCondition = (condition, code) => {
  if (!condition) throw Object.assign(new Error(code), { code });
};
try {
  const moduleAt = name => import(pathToFileURL(path.join(process.cwd(), "src", name)).href);
  const [{ readMysqlConfig }, { initializeMysqlSession }, { researchJsonText }] = await Promise.all([
    moduleAt("mysqlConfig.js"), moduleAt("mysqlDatabase.js"), moduleAt("mysqlResearchSql.js"),
  ]);
  const secretFile = process.env.MYSQL_PASSWORD_FILE;
  requireCondition(typeof secretFile === "string" && path.isAbsolute(secretFile)
    && fs.lstatSync(secretFile).isFile(), "RESEARCH_SECRET_FILE_REQUIRED");
  const password = fs.readFileSync(secretFile, "utf8");
  requireCondition(password.length > 0 && !/[\0\r\n]/.test(password), "RESEARCH_SECRET_FILE_INVALID");
  const config = readMysqlConfig({ ...process.env, MYSQL_PASSWORD: password });
  requireCondition(config.database === "outdoor_fit_prod" && config.user === "outdoor_fit_app",
    "RESEARCH_PRODUCTION_ACCOUNT_REQUIRED");
  requireCondition(config.ssl?.rejectUnauthorized === true && config.ssl?.verifyIdentity === true,
    "RESEARCH_TLS_IDENTITY_REQUIRED");
  requireCondition(config.jsonStrings === true, "RESEARCH_JSON_DRIVER_CONFIGURATION_REQUIRED");
  stage = "connection";
  connection = await mysql.createConnection(config);
  const socket = connection.connection?.stream;
  requireCondition(socket?.encrypted === true && socket.authorized === true
    && typeof socket.getPeerCertificate === "function"
    && checkServerIdentity(config.host, socket.getPeerCertificate(true)) === undefined,
  "RESEARCH_TLS_NOT_VERIFIED");
  await initializeMysqlSession(connection);
  const query = async (sql, values = []) => (await connection.execute({ sql, timeout: 8000 }, values))[0];
  stage = "session";
  const [state] = await query("SELECT DATABASE() AS db, CURRENT_USER() AS account, @@collation_connection AS collation, @@sql_mode AS sqlMode, VERSION() AS version");
  requireCondition(state.db === "outdoor_fit_prod" && state.account.split("@")[0] === "outdoor_fit_app",
    "RESEARCH_PRODUCTION_ACCOUNT_MISMATCH");
  requireCondition(/^8\.0\./.test(state.version) && state.collation === "utf8mb4_0900_bin"
    && String(state.sqlMode).split(",").includes("ONLY_FULL_GROUP_BY"), "RESEARCH_SESSION_MISMATCH");
  const scalar = researchJsonText("e.metadata_json", "screen");
  const cases = [
    [{}, null], [{ screen: null }, null], [{ screen: "" }, ""],
    [{ screen: "null" }, "null"], [{ screen: "Home" }, "Home"],
    [{ screen: "home" }, "home"], [{ screen: "home " }, "home "],
    [{ screen: "康復頁面" }, "康復頁面"], [{ screen: "活動😀" }, "活動😀"],
  ];
  const derived = cases.map(() => "SELECT ? AS case_index, ? AS metadata_json").join(" UNION ALL ");
  const parameters = cases.flatMap(([document], index) => [index, JSON.stringify(document)]);
  stage = "json_values";
  const rows = await query(`SELECT e.case_index, ${scalar} AS scalarValue,
    COALESCE(NULLIF(${scalar}, ''), '未标注页面') AS screenLabel,
    COLLATION(${scalar}) AS scalarCollation FROM (${derived}) AS e ORDER BY e.case_index`, parameters);
  requireCondition(rows.length === cases.length, "RESEARCH_JSON_ROW_COUNT_MISMATCH");
  for (const [index, row] of rows.entries()) {
    const expected = cases[index][1];
    requireCondition(Number(row.case_index) === index && row.scalarValue === expected
      && row.screenLabel === (expected === null || expected === "" ? "未标注页面" : expected),
    "RESEARCH_JSON_VALUE_MISMATCH");
    if (expected !== null) requireCondition(row.scalarCollation === "utf8mb4_0900_bin", "RESEARCH_JSON_COLLATION_MISMATCH");
  }
  stage = "binary_comparisons";
  const comparison = await query(`SELECT e.case_index, ${scalar} = ? AS matchesHome
    FROM (${derived}) AS e ORDER BY e.case_index`, ["home", ...parameters]);
  requireCondition(comparison.length === cases.length && comparison.every((row, index) =>
    cases[index][1] === null ? row.matchesHome === null : Number(row.matchesHome) === (cases[index][1] === "home" ? 1 : 0)),
  "RESEARCH_BINARY_COMPARISON_MISMATCH");
  stage = "count_aggregate";
  const countDocuments = [{ count: 3 }, { count: null }, {}, { count: 0 }, { count: "5" }];
  const [count] = await query(`SELECT SUM(COALESCE(CAST(${researchJsonText("e.metadata_json", "count")} AS SIGNED), 1)) AS taps
    FROM (${countDocuments.map(() => "SELECT ? AS metadata_json").join(" UNION ALL ")}) AS e`, countDocuments.map(document => JSON.stringify(document)));
  requireCondition(String(count.taps) === "10", "RESEARCH_COUNT_AGGREGATE_MISMATCH");
  stage = "video_aggregate";
  const [video] = await query(`WITH filtered_video_events AS (
    SELECT COALESCE(NULLIF(${researchJsonText("e.metadata_json", "contentId")}, ''),
      NULLIF(${researchJsonText("e.metadata_json", "videoId")}, ''), '未标注视频') AS contentId,
      JSON_OBJECT('screen', JSON_EXTRACT(e.metadata_json, '$.screen')) AS contentSource
    FROM (SELECT ? AS metadata_json UNION ALL SELECT ?) AS e)
    SELECT contentId, JSON_ARRAYAGG(contentSource) AS contentSources, COUNT(*) AS rowCount
    FROM filtered_video_events GROUP BY contentId ORDER BY contentId`, [
    JSON.stringify({ contentId: null, videoId: "影片 A ", screen: "康復頁面" }),
    JSON.stringify({ contentId: "影片 A ", videoId: "unused", screen: "康復頁面" }),
  ]);
  requireCondition(video?.contentId === "影片 A " && Number(video.rowCount) === 2 && typeof video.contentSources === "string"
    && JSON.parse(video.contentSources).length === 2, "RESEARCH_VIDEO_AGGREGATE_MISMATCH");
  stage = "screen_options";
  const options = await query(`SELECT DISTINCT ${scalar} AS value FROM (${derived}) AS e
    WHERE COALESCE(${scalar}, '') != '' ORDER BY value`, parameters);
  const actual = options.map(row => row.value).sort();
  const expected = cases.map(([, value]) => value).filter(value => value !== null && value !== "").sort();
  requireCondition(JSON.stringify(actual) === JSON.stringify(expected), "RESEARCH_SCREEN_OPTIONS_MISMATCH");
} catch (error) {
  failure = /^[A-Z][A-Z0-9_]+$/.test(error?.code || "") ? error.code : "RESEARCH_SQL_CHECK_FAILED";
} finally {
  if (connection) {
    try { await connection.end(); }
    catch { connection.destroy(); failure ||= "RESEARCH_CONNECTION_CLOSE_FAILED"; }
  }
}
if (failure) {
  console.log("RESEARCH_SQL_COMPATIBILITY=FAIL");
  console.log("ERROR_CODE=" + failure);
  console.log("ERROR_STAGE=" + stage);
  process.exitCode = 1;
} else console.log("RESEARCH_SQL_COMPATIBILITY=PASS");
