import { getAdminMedia, uploadAdminMedia } from "../api";

let xhr;
const originalXhr = global.XMLHttpRequest;
const originalFetch = global.fetch;
beforeEach(() => {
	global.XMLHttpRequest = jest.fn(() => {
		xhr = { upload: {}, open: jest.fn(), setRequestHeader: jest.fn(), send: jest.fn(), abort: jest.fn(() => xhr.onabort?.()) };
		return xhr;
	});
});
afterEach(() => { global.XMLHttpRequest = originalXhr; global.fetch = originalFetch; jest.restoreAllMocks(); });
test("sends raw binary with encoded metadata and reports progress", async () => {
	const file = { name: "教学.mp4", type: "video/mp4" }; const onProgress = jest.fn();
	const task = uploadAdminMedia("token", file, { categoryId: "videos", onProgress });
	expect(xhr.open.mock.calls[0][1]).toContain("/admin/media/upload?name=%E6%95%99%E5%AD%A6.mp4&categoryId=videos");
	expect(xhr.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer token");
	expect(xhr.setRequestHeader).toHaveBeenCalledWith("Content-Type", "application/octet-stream");
	expect(xhr.open.mock.calls[0][1]).toContain("mimeType=video%2Fmp4");
	expect(xhr.send).toHaveBeenCalledWith(file);
	xhr.upload.onprogress({ lengthComputable: true, loaded: 15, total: 100 });
	expect(onProgress).toHaveBeenCalledWith(15);
	xhr.status = 201; xhr.responseText = JSON.stringify({ item: { url: "/api/media/1/demo.mp4" } }); xhr.onload();
	await expect(task).resolves.toEqual({ item: { url: "/api/media/1/demo.mp4" } });
});
test("abort does not retry an upload", async () => {
	const controller = new AbortController();
	const task = uploadAdminMedia("token", { name: "v.mp4" }, { signal: controller.signal });
	controller.abort();
	await expect(task).rejects.toMatchObject({ code: "uploadCancelled" });
	expect(xhr.send).toHaveBeenCalledTimes(1);
});
test.each([[403, '{"error":"permissionDenied"}', "permissionDenied"], [201, "<html>", "invalidUploadResponse"], [201, "{}", "invalidUploadResponse"]])("upload failure %s is not treated as success", async (status, response, code) => {
	const task = uploadAdminMedia("token", { name: "v.mp4" });
	xhr.status = status; xhr.responseText = response; xhr.onload();
	await expect(task).rejects.toMatchObject({ code });
});
test("file listing transmits pagination and GIF filter before server pagination", async () => {
	global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
	await getAdminMedia("token", { kind: "gif", page: 2, search: "左", categoryId: "facilities-gifs" });
	expect(global.fetch.mock.calls[0][0]).toContain("kind=gif&categoryId=facilities-gifs&search=%E5%B7%A6&page=2&limit=20&archived=false");
});
