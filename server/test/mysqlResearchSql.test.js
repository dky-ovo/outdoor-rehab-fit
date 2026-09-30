import assert from "node:assert/strict";
import test from "node:test";
import { createMysqlApp } from "../src/appMysql.js";
import { researchJsonText } from "../src/mysqlResearchSql.js";
import { signToken } from "../src/security.js";

const SECRET = "mysql-research-http-regression-secret-over-32-characters";
const TIME = "2026-09-24T12:00:00.000Z";

// Query-contract check, not a MySQL server emulator. MySQL 8.0.36 gives both
// functions utf8mb4_bin; every result must be normalized before operators see
// it. In particular, COLLATE around the outer CASE cannot fix its comparison.
function requireJsonCollationBoundaries(sql) {
  const functions = /\bJSON_(?:TYPE|UNQUOTE)\s*\(/gi;
  let match, count = 0;
  while ((match = functions.exec(sql))) {
    let cursor = functions.lastIndex, depth = 1, quote = null;
    while (cursor < sql.length && depth) {
      const character = sql[cursor++];
      if (quote) {
        if (character === quote) {
          if (sql[cursor] === quote) cursor++;
          else quote = null;
        }
      } else if (character === "'") quote = character;
      else if (character === "(") depth++;
      else if (character === ")") depth--;
    }
    assert.equal(depth, 0, "balanced JSON SQL expression");
    assert.match(sql.slice(cursor), /^\s+COLLATE\s+utf8mb4_0900_bin\b/i,
      "JSON function must have explicit collation before comparison/coalescing");
    count++;
  }
  return count;
}

async function fixture(operation, permissions = ["research.read", "data.export"]) {
  const calls = [], writes = [];
  const metadataJson = JSON.stringify({ screen: "outdoor.detail", contentId: 0 });
  const user = { id: "research-reader", name: "Reader", phone: "+85270000001", profile_role: "staff", deleted_at: null };
  const identityRepository = {
    async getDeletionState() { return { deleted_at: null }; },
    async getUserById() { return user; },
    async touchLastSeen() {},
    async getAdminAccountByUserId() {
      return { user_id: user.id, system_role: "operator", is_active: 1, permissions_json: JSON.stringify(permissions) };
    },
  };
  async function read(sql, values = []) {
    await Promise.resolve();
    assert.equal((sql.match(/\?/g) || []).length, values.length, "all parameters stay bound");
    const boundaries = requireJsonCollationBoundaries(sql);
    calls.push({ sql, values, boundaries });
    if (/SELECT id FROM media_categories/.test(sql)) return [{ id: "other" }];
    if (/SELECT id, name_zh, name_en, deleted_at FROM app_equipment_items/.test(sql)) {
      return [{ id: "0", name_zh: "当前设施名称", name_en: "Current equipment", deleted_at: null }];
    }
    if (/SELECT id, title FROM content_items/.test(sql)) return [];
    if (/AS totalEvents/.test(sql)) return [{ totalEvents: 2, activeParticipants: 1, screenViews: "0", taps: "3", videosStarted: "1", videosCompleted: "1", audioPlays: "0" }];
    if (/COUNT\(\*\) AS total\b/.test(sql)) return [{ total: 2 }];
    if (/WITH filtered_video_events/.test(sql)) return [{ contentId: "0", contentSources: '[{"screen":"outdoor.detail","contentType":null,"equipmentId":null}]', started: "1", completed: "1" }];
    if (/AS screen, COUNT\(\*\) AS count/.test(sql)) return [{ screen: "outdoor.detail", count: 2 }];
    if (/AS day, COUNT\(\*\)/.test(sql)) return [{ day: "2026-09-24", count: 2, participants: 1 }];
    if (/AS eventCount/.test(sql)) return [{ id: user.id, name: user.name, phone: user.phone, profileRole: "staff", eventCount: 2, lastEventAt: TIME, screenViews: "0", videosCompleted: "1" }];
    if (/SELECT e.event_name AS eventName/.test(sql)) return [{ eventName: "video.completed", count: 1 }];
    if (/SELECT DISTINCT event_name AS value/.test(sql)) return [{ value: "video.completed" }];
    if (/SELECT DISTINCT[\s\S]*AS value FROM research_events/.test(sql)) return [{ value: "outdoor.detail" }];
    if (/SELECT e.id, e.event_name AS eventName/.test(sql)) return [{ id: "event-1", eventName: "video.completed", eventTime: TIME, appVersion: null, metadataJson, participantId: user.id, participantName: user.name, participantPhone: user.phone, profileRole: "staff" }];
    assert.fail("Unexpected query in research HTTP fixture");
  }
  const database = {
    dialect: "mysql",
    all: read,
    async get(sql, values = []) { return (await read(sql, values))[0]; },
    async run(sql, values = []) {
      assert.match(sql, /INSERT INTO system_logs/);
      writes.push({ sql, values });
      return { affectedRows: 1, warningStatus: 0 };
    },
    async transaction(callback) { return callback(database); },
  };
  const app = await createMysqlApp({ database, identityRepository, jwtSecret: SECRET });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const token = signToken(user, SECRET);
  calls.length = 0;
  const request = async (route, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/${route}`, {
      headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: response.status, data: await response.json() };
  };
  try { await operation({ request, calls, writes, metadataJson }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("SQL contract detects the original inner collation error even with an outer COLLATE", () => {
  const old = "CASE WHEN JSON_TYPE(JSON_EXTRACT(e.metadata_json, '$.screen')) = 'NULL' THEN NULL ELSE JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.screen')) END";
  assert.throws(() => requireJsonCollationBoundaries(`SELECT (${old}) COLLATE utf8mb4_0900_bin`));
  for (const column of ["e.metadata_json", "metadata_json"]) {
    for (const key of ["screen", "count", "contentId", "videoId"]) {
      assert.equal(requireJsonCollationBoundaries(researchJsonText(column, key)), 2);
    }
  }
  assert.throws(() => researchJsonText("e.metadata_json); DROP TABLE users", "screen"), TypeError);
  assert.throws(() => researchJsonText("e.metadata_json", "screen' OR 1=1"), TypeError);
});

test("MySQL research analytics wires normalized JSON SQL through every aggregate and option query", async () => {
  await fixture(async ({ request, calls, metadataJson }) => {
    const { status, data } = await request("research-analytics");
    assert.equal(status, 200);
    assert.equal(data.summary.taps, 3);
    assert.equal(data.summary.videoCompletionRate, 100);
    assert.equal(data.videos[0].completed, 1);
    assert.equal(data.videos[0].contentNameZh, "当前设施名称");
    assert.equal(Object.hasOwn(data.videos[0], "contentSources"), false);
    assert.equal(data.participants[0].videosCompleted, 1);
    assert.equal(data.events[0].metadataJson, metadataJson);
    assert.equal(data.events[0].metadata.contentId, 0);
    assert.deepEqual(data.options.screens, ["outdoor.detail"]);
    const jsonQueries = calls.filter(call => call.boundaries);
    assert.equal(jsonQueries.length, 4, "summary, screens, videos and screen options are covered");
    assert.ok(jsonQueries.some(call => call.sql.includes("'$.count'")));
    assert.ok(jsonQueries.some(call => call.sql.includes("'$.contentId'") && call.sql.includes("'$.videoId'")));
  });
});

test("filtered analytics, paginated events and export share the corrected JSON screen comparison and bound filters", async () => {
  await fixture(async ({ request, calls, writes }) => {
    const screen = "outdoor.detail' OR 1=1 --";
    const filters = new URLSearchParams({ screen, dateFrom: "2026-09-01", dateTo: "2026-09-24", eventName: "video.completed", profileRole: "staff", userSearch: "READ_er%\\=", page: "1", pageSize: "1" });
    for (const route of ["research-analytics", "research-events", "research-export"]) {
      const start = calls.length;
      const { status, data } = await request(`${route}?${filters}`);
      assert.equal(status, 200, route);
      assert.equal(data.filters.screen, screen);
      assert.equal(data.events[0].contentNameEn, "Current equipment");
      const filtered = calls.slice(start).filter(call => call.sql.includes("JOIN users u ON u.id = e.participant_id"));
      assert.ok(filtered.length > 0);
      for (const call of filtered) {
        assert.ok(call.boundaries >= 2);
        assert.ok(call.values.includes(screen));
        assert.ok(call.values.includes("2026-09-01T00:00:00.000Z"));
        assert.ok(call.values.includes("2026-09-24T23:59:59.999Z"));
        assert.ok(!call.sql.includes(screen));
      }
    }
    assert.equal(writes.length, 1, "only the existing export audit writes");
    assert.equal(writes[0].values[3], "research.export");
  });
});

test("research collation fix retains anonymous and permission boundaries", async () => {
  await fixture(async ({ request, calls, writes }) => {
    for (const route of ["research-analytics", "research-events", "research-export"]) {
      assert.equal((await request(route, false)).status, 401);
      assert.equal((await request(route)).status, 403);
    }
    assert.equal(calls.length, 0);
    assert.equal(writes.length, 0);
  }, ["dashboard.read"]);
  await fixture(async ({ request, writes }) => {
    assert.equal((await request("research-events")).status, 200);
    assert.equal((await request("research-export")).status, 403);
    assert.equal(writes.length, 0);
  }, ["research.read"]);
});
