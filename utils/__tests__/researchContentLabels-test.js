import { researchEventObjectLabel, researchVideoLabel } from "../researchContentLabels";

const current = { contentId: "0", contentKind: "equipment", contentStatus: "current", contentNameZh: "目前器材名稱", contentNameEn: "Current equipment name" };
test.each([["zh-CN", "目前器材名稱"], ["zh-HK", "目前器材名稱"], ["en", "Current equipment name"]])("current equipment name is shown in %s without replacing its internal ID", (locale, expected) => {
  expect(researchVideoLabel(current,locale)).toBe(expected);
  expect(current.contentId).toBe("0");
});
test("language fallback prefers the available maintained name", () => {
  expect(researchVideoLabel({ ...current, contentNameEn: "" }, "en")).toBe("目前器材名稱");
  expect(researchVideoLabel({ ...current, contentNameZh: "" }, "zh-CN")).toBe("Current equipment name");
  expect(researchVideoLabel({ ...current, contentNameZh: "0" })).toBe("Current equipment name");
});
test.each(["zh-CN", "zh-HK", "en"])("deleted and unknown items have descriptive labels in %s, never bare numeric IDs", locale => {
  const deleted = researchVideoLabel({ ...current, contentStatus: "deleted" },locale);
  expect(deleted).toContain(locale === "en" ? "Deleted equipment" : locale === "zh-HK" ? "已刪除器材" : "已删除器材");
  expect(deleted).toContain(locale === "en" ? "Current equipment name" : "目前器材名稱");
  for (const contentKind of ["equipment", "content", "ambiguous", "video"]) {
    const label = researchVideoLabel({ contentKind, contentId: "123", contentStatus: "unknown" },locale);
    expect(label.length).toBeGreaterThan(3);
    expect(label).not.toContain("123");
  }
});
test("event and CSV labels use the same current name ahead of a stale client title", () => {
  const event = { ...current, eventName: "video.completed", metadata: { contentId: "0", title: "旧标题", watchedMs: 1000 } };
  expect(researchEventObjectLabel(event,"en")).toBe(researchVideoLabel(current,"en"));
  expect(event.metadata.title).toBe("旧标题");
  expect(event.metadata.watchedMs).toBe(1000);
});
test("home content titles remain separate from equipment names and event buttons remain readable", () => {
  expect(researchEventObjectLabel({ contentKind: "content", contentNameZh: "首页新标题", eventName: "content.click", metadata: { title: "旧标题" } })).toBe("首页新标题");
  expect(researchEventObjectLabel({ eventName: "screen.tap_batch", metadata: { button: "保存运动日志", count: 2 } })).toBe("保存运动日志");
  expect(researchEventObjectLabel({ eventName: "screen.view", metadata: { screen: "home" } })).toBe("home");
});
test("old backend data gracefully avoids displaying raw identifiers", () => {
  expect(researchVideoLabel({ contentId: "0" })).toBe("未标注或未知视频");
  expect(researchEventObjectLabel({ eventName: "video.completed", metadata: { screen: "outdoor.detail", contentId: 0 } })).toBe("未知或已移除器材");
  expect(researchEventObjectLabel({ eventName: "video.play", metadata: { title: "Home video", contentId: "uuid" } },"en")).toBe("Home video");
  expect(researchEventObjectLabel()).toBe("-");
});
