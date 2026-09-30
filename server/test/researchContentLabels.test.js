import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/app.js";
import { signToken } from "../src/security.js";
import { createResearchContentResolver } from "../src/researchContentLabels.js";

const SECRET = "research-label-test-secret-with-over-32-characters";
const TIME = "2026-09-23T12:00:00.000Z";
async function fixture(run) {
  const database = createDatabase(":memory:"), tokens = {};
  for (const [index, [id, permissions]] of [["reader", ["research.read"]], ["exporter", ["research.read", "data.export"]], ["blocked", ["dashboard.read"]]].entries()) {
    database.prepare("INSERT INTO users(id,name,phone,profile_role,password_salt,password_hash,created_at,updated_at) VALUES (?,?,?,'staff','unused','unused',?,?)").run(id, id, `+8527888000${index}`, TIME, TIME);
    database.prepare("INSERT INTO admin_accounts(user_id,system_role,permissions_json,is_active,created_at,updated_at) VALUES (?,'operator',?,1,?,?)").run(id, JSON.stringify(permissions), TIME, TIME);
    tokens[id] = signToken({ id, profile_role: "staff" }, SECRET);
  }
  database.prepare("UPDATE app_equipment_items SET name_zh='后台当前太極名稱', name_en='Current Tai Chi name' WHERE id='0'").run();
  database.prepare("UPDATE app_equipment_items SET deleted_at=? WHERE id='1'").run(TIME);
  database.prepare("INSERT INTO app_equipment_items(id,is_custom,name_zh,name_en,created_at,updated_at) VALUES ('custom-english',1,'','Current English Only',?,?)").run(TIME,TIME);
  database.prepare("INSERT INTO content_items(id,page_key,content_type,title,value,created_at,updated_at) VALUES ('home-video-uuid','home','video','首页目前的视频标题','video.mp4',?,?)").run(TIME,TIME);
  const insertEvent = (id, contentId, metadata = {}) => {
    database.prepare("INSERT INTO research_events(id,participant_id,event_name,event_time,metadata_json) VALUES (?,'reader','video.completed',?,?)").run(id,TIME,JSON.stringify({ screen: "outdoor.detail", contentId, ...metadata }));
  };
  insertEvent("renamed", 0, { title: "旧客户端器材名称" });
  insertEvent("deleted", "1");
  insertEvent("unknown", "9999");
  insertEvent("english-only", "custom-english");
  insertEvent("home", "home-video-uuid", { screen: "home", contentType: "video", title: "旧首页标题" });
  const server = createApp({ database, jwtSecret: SECRET }).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const request = async (path, actor = "reader") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: actor ? { Authorization: `Bearer ${tokens[actor]}` } : {} });
    return { status: response.status, data: await response.json() };
  };
  try { await run({ database, request, insertEvent }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); database.close(); }
}

test("research-only readers receive current facility names without maintenance access or mutation of raw records", async () => {
  await fixture(async ({ database, request }) => {
    const original = database.prepare("SELECT metadata_json FROM research_events WHERE id='renamed'").get().metadata_json;
    for (const route of ["research-events", "research-analytics", "research-export"]) {
      const result = await request(`/api/admin/${route}`, route === "research-export" ? "exporter" : "reader");
      assert.equal(result.status, 200);
      const renamed = result.data.events.find(event => event.id === "renamed");
      assert.equal(renamed.contentNameZh, "后台当前太極名稱");
      assert.equal(renamed.contentNameEn, "Current Tai Chi name");
      assert.equal(renamed.contentKind, "equipment");
      assert.equal(renamed.metadata.contentId, 0);
      assert.equal(renamed.metadata.title, "旧客户端器材名称");
      assert.equal(renamed.metadataJson, original);
      assert.equal(renamed.contentStatus, "current");
      assert.equal(Object.hasOwn(renamed, "detailsZh"), false);
      if (route === "research-analytics") {
        assert.equal(result.data.summary.videosCompleted, 5);
        const video = result.data.videos.find(item => String(item.contentId) === "0");
        assert.equal(video.contentNameZh, renamed.contentNameZh);
        assert.equal(video.completed, 1);
        assert.equal(video.started, 0);
        assert.equal(Object.hasOwn(video, "contentSources"), false);
      }
    }
    assert.equal(database.prepare("SELECT metadata_json FROM research_events WHERE id='renamed'").get().metadata_json, original);
  });
});

test("deleted, unknown and single-language equipment are explicitly distinguished from home content", async () => {
  await fixture(async ({ request }) => {
    const { data } = await request("/api/admin/research-analytics");
    const find = id => data.videos.find(item => String(item.contentId) === id);
    assert.equal(find("1").contentStatus, "deleted");
    assert.ok(find("1").contentNameZh);
    assert.deepEqual([find("9999").contentKind, find("9999").contentStatus, find("9999").contentNameZh], ["equipment", "unknown", ""]);
    assert.equal(find("custom-english").contentNameZh, "");
    assert.equal(find("custom-english").contentNameEn, "Current English Only");
    assert.equal(find("home-video-uuid").contentKind, "content");
    assert.equal(find("home-video-uuid").contentNameZh, "首页目前的视频标题");
  });
});

test("name changes appear on the next research request, not a stale request cache", async () => {
  await fixture(async ({ database, request }) => {
    await request("/api/admin/research-analytics");
    database.prepare("UPDATE app_equipment_items SET name_zh='再更新名称',name_en='' WHERE id='0'").run();
    const { data } = await request("/api/admin/research-events");
    const item = data.events.find(event => event.id === "renamed");
    assert.equal(item.contentNameZh, "再更新名称");
    assert.equal(item.contentNameEn, "");
  });
});

test("ambiguous legacy aggregates preserve counts without assigning a wrong facility name", async () => {
  await fixture(async ({ database, request, insertEvent }) => {
    database.prepare("INSERT INTO content_items(id,page_key,content_type,title,value,created_at,updated_at) VALUES ('8','home','video','独立首页视频','demo.mp4',?,?)").run(TIME,TIME);
    insertEvent("equipment-eight", "8");
    insertEvent("home-eight", "8", { screen: "home", contentType: "video" });
    const { data } = await request("/api/admin/research-analytics");
    const aggregate = data.videos.find(item => item.contentId === "8");
    assert.equal(aggregate.completed, 2);
    assert.equal(aggregate.contentKind, "ambiguous");
    assert.equal(aggregate.contentNameZh, "");
    assert.equal(data.events.find(item => item.id === "home-eight").contentNameZh, "独立首页视频");
    assert.equal(data.events.find(item => item.id === "equipment-eight").contentNameZh, "扭腰機");
  });
});

test("explicit equipmentId and missing-screen legacy IDs resolve without treating other page IDs as facilities", async () => {
  await fixture(async ({ database }) => {
    const resolver = createResearchContentResolver(database);
    assert.equal(resolver.event({ metadata: { equipmentId: 0, contentId: "video-file" } }).contentNameEn, "Current Tai Chi name");
    assert.equal(resolver.event({ metadata: { contentId: 0 } }).contentKind, "equipment");
    assert.equal(resolver.event({ metadata: { screen: "home", contentId: "0" } }).contentKind, "content");
    assert.equal(resolver.event({ metadata: { screen: "home", contentId: "0" } }).contentStatus, "unknown");
    const simple = { eventName: "screen.view", metadata: { screen: "home" } };
    assert.equal(resolver.event(simple), simple);
    const text = { metadata: { contentId: "home-video-uuid", contentType: "text", screen: "home" } };
    assert.equal(resolver.event(text).contentNameZh, "首页目前的视频标题");
  });
});

test("research label additions retain read/export authorization boundaries", async () => {
  await fixture(async ({ request }) => {
    for (const route of ["research-events", "research-analytics", "research-export"]) {
      assert.equal((await request(`/api/admin/${route}`, null)).status, 401);
      assert.equal((await request(`/api/admin/${route}`, "blocked")).status, 403);
    }
    assert.equal((await request("/api/admin/research-export", "reader")).status, 403);
    assert.equal((await request("/api/admin/research-export", "exporter")).status, 200);
  });
});

test("empty or numeric-only maintained labels never become an equipment ID display name", () => {
  const database = createDatabase(":memory:");
  try {
    database.prepare("UPDATE app_equipment_items SET name_zh='0', name_en='' WHERE id='0'").run();
    const resolver = createResearchContentResolver(database);
    const result = resolver.event({ metadata: { screen: "outdoor.detail", contentId: 0 } });
    assert.equal(result.contentNameZh, "太極揉推器");
    assert.equal(result.contentNameEn, "Tai Chi Wheel / Taiji Pushing / Push Hands");
    const video = resolver.video({ contentId: "0", started: 7, completed: 5, contentSources: JSON.stringify([{screen:"outdoor.detail"}, {screen:"outdoor.detail",contentType:"video"}]) });
    assert.equal(video.contentNameZh, "太極揉推器");
    assert.equal(video.started, 7);
    assert.equal(video.completed, 5);
    assert.equal(resolver.video({contentId:"unknown",contentSources:"malformed"}).contentStatus,"unknown");
  } finally { database.close(); }
});
