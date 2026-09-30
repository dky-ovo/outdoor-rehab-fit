import { getAdminResearchEvents, getAdminResearchAnalytics, getAdminSystemLogs, getAdminUsers, exportAdminUsers } from "../api";
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 345, page: 16, pageSize: 20, events: [], logs: [] }) }); });
afterEach(() => { global.fetch = originalFetch; });
test.each([[getAdminResearchEvents,"research-events"],[getAdminResearchAnalytics,"research-analytics"],[getAdminSystemLogs,"system-logs"]])("%s requests page and page size instead of a capped single result", async (get, path) => {
	await get("token", { page: 16, pageSize: 20 });
	expect(global.fetch.mock.calls[0][0]).toContain(`/admin/${path}?page=16&pageSize=20`);
	expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
});
test("research filters travel with subsequent raw-event pages", async () => {
	await getAdminResearchEvents("token", { page: 2, userSearch: "参与者", eventName: "video.play", screen: "outdoor.detail" });
	const url = global.fetch.mock.calls[0][0];
	expect(url).toContain("page=2&pageSize=20"); expect(url).toContain("userSearch=%E5%8F%82%E4%B8%8E%E8%80%85"); expect(url).toContain("eventName=video.play&screen=outdoor.detail");
});
test("users send search and real page parameters; export uses a separate complete-result endpoint", async () => {
	await getAdminUsers("token", "Alice", { page: 12, pageSize: 20 });
	expect(global.fetch.mock.calls[0][0]).toContain("/admin/users?search=Alice&page=12&pageSize=20");
	await exportAdminUsers("token", "Alice");
	expect(global.fetch.mock.calls[1][0]).toContain("/admin/users-export?search=Alice");
	expect(global.fetch.mock.calls[1][0]).not.toContain("page=");
});
