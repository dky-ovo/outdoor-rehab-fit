const test = require("node:test");
const assert = require("node:assert/strict");

test("installed SVAR store honors serverOrder across numerically named pages", async () => {
	const { DataStore } = await import("@svar-ui/filemanager-store");
	const serverNames = Array.from({ length: 25 }, (_, index) => `${index + 1}.mp4`).sort();
	const seen = [];
	for (let offset = 0; offset < serverNames.length; offset += 20) {
		const data = serverNames.slice(offset, offset + 20).map((name, serverOrder) => ({ id: `/${name}`, type: "file", date: new Date(0), serverOrder }));
		const store = new DataStore(); store.init({ data, mode: "table", activePanel: 0 });
		await store.in.exec("sort-files", { key: "serverOrder", order: "asc", path: "/" });
		seen.push(...store.getState().panels[0]._files.map(item => item.name));
		assert.ok(store.getState().panels[0]._files.length <= 20);
	}
	assert.deepEqual(seen, serverNames);
});

test("installed SVAR interception blocks optimistic mutation before any data changes", async () => {
	const { DataStore } = await import("@svar-ui/filemanager-store");
	const store = new DataStore(); store.init({ data: [{ id: "/video.mp4", type: "file", date: new Date(0) }], mode: "table", activePanel: 0 });
	for (const event of ["rename-file", "delete-files", "copy-files", "move-files", "create-file"]) store.in.intercept(event, () => false);
	await store.in.exec("rename-file", { id: "/video.mp4", name: "wrong.mp4" });
	await store.in.exec("delete-files", { ids: ["/video.mp4"] });
	await store.in.exec("copy-files", { ids: ["/video.mp4"], target: "/" });
	assert.equal(store.getState().panels[0]._files.length, 1);
	assert.equal(store.getState().panels[0]._files[0].name, "video.mp4");
});
