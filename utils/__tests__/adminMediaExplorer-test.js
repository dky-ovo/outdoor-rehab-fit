import { buildExplorerPage, explorerError, explorerPermissions, explorerReferences, explorerSelection, explorerSort } from "../adminMediaExplorer";

const video = { id: "video-1", kind: "video", name: "太极教学.mp4", url: "/api/media/1/2.mp4", source: "upload", mimeType: "video/mp4" };

test("file management mutations require the separate permission; content picker can upload only", () => {
	expect(explorerPermissions(["app_maintenance.equipment.manage"], { picker: true })).toEqual({ read: true, manage: false, upload: true, mutate: false, restore: false });
	expect(explorerPermissions(["app_maintenance.equipment.manage"])).toMatchObject({ read: true, upload: false, mutate: false });
	expect(explorerPermissions(["app_maintenance.files.manage"], { picker: true })).toMatchObject({ upload: true, mutate: false });
});
test("busy and trash do not allow file creation, but trash allows authorized restore", () => {
	expect(explorerPermissions(["app_maintenance.files.manage"], { busy: true })).toMatchObject({ upload: false, mutate: false, restore: false });
	expect(explorerPermissions(["app_maintenance.files.manage"], { deleted: true })).toMatchObject({ upload: false, mutate: false, restore: true });
	expect(explorerPermissions([])).toMatchObject({ read: false, upload: false, mutate: false });
});
test("page mapping keeps ancestors and only supplied page entries", () => {
	const page = buildExplorerPage({ trail: [{ id: "a", name: "中文视频", parentId: "" }], items: [video] });
	expect(page.data).toHaveLength(2); expect(page.currentPath).toBe("/中文视频");
	expect(page.byPath.get("/中文视频/太极教学.mp4")).toBe(video);
	expect(page.folderPaths.get("a")).toBe("/中文视频");
	expect(page.data[1].serverOrder).toBe(0);
});
test("same-name files receive distinct display paths without conflating immutable ids", () => {
	const files = [video, { ...video, id: "other-id" }];
	const page = buildExplorerPage({ items: files });
	expect(new Set(page.data.map(item => item.id)).size).toBe(2);
	expect([...page.byPath.values()].map(item => item.id)).toEqual(["video-1", "other-id"]);
	expect(explorerReferences(files)).toEqual([{ id: "video-1", kind: "file" }, { id: "other-id", kind: "file" }]);
});
test("display names cannot inject hierarchy and invalid dates do not break sorting", () => {
	const page = buildExplorerPage({ items: [{ ...video, name: "one/two\\three", modifiedAt: "invalid" }] });
	expect(page.data[0].id).toBe("/one＿two＿three"); expect(page.data[0].date.getTime()).toBe(0);
});
test("a literal name matching a duplicate-label suffix cannot overwrite its UUID mapping", () => {
	const items = [{ ...video, id: "a", name: "x" }, { ...video, id: "b", name: "x" }, { ...video, id: "c", name: "x〔a〕" }];
	const page = buildExplorerPage({ items }); expect(page.byPath.size).toBe(3); expect(new Set(page.data.map(item => item.id)).size).toBe(3);
	expect([...page.byPath.values()].map(item => item.id)).toEqual(["a", "b", "c"]);
});
test("selection rejects wrong types, multiple files, archived/deleted and legacy links", () => {
	expect(explorerSelection([video], "video")).toBe(video);
	expect(explorerSelection([video], "gif")).toBeNull();
	expect(explorerSelection([video, video])).toBeNull();
	for (const flags of [{ archived: true }, { deletedAt: "now" }, { selectable: false }, { kind: "folder" }, { kind: "file" }]) expect(explorerSelection([{ ...video, ...flags }])).toBeNull();
});
test("sort maps table fields to allowed server fields and resets page", () => {
	expect(explorerSort("date", "desc")).toEqual({ sort: "modified", direction: "desc", page: 1 });
	expect(explorerSort("bad", "bad")).toEqual({ sort: "name", direction: "asc", page: 1 });
});
test("copy conflict/disk errors give specific recovery advice", () => {
	expect(explorerError({ code: "mediaNameConflict", status: 409 })).toContain("不会覆盖");
	expect(explorerError({ code: "mediaCopyUnsupported", status: 409 })).toContain("历史外部");
	expect(explorerError({ code: "mediaStorageFull", status: 507 })).toContain("存储空间不足");
});
