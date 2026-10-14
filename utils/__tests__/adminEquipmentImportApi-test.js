import { confirmAdminEquipmentDocument, EQUIPMENT_DOCX_MAX_BYTES, EQUIPMENT_DOCX_MIME, getAdminEquipmentImportHistory, previewAdminEquipmentDocument, previewStoredAdminEquipmentDocument, validateEquipmentDocumentFile } from "../adminEquipmentImportApi";
jest.mock("../api", () => ({ API_BASE_URL: "/api", ApiError: class ApiError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } } }));
const originalFetch = global.fetch;
const file = { name: "器材.docx", size: 100 };
const draft = { previewId: "id", confirmationKey: "key", fileName: file.name, expiresAt: Date.now() + 1000, canConfirm: true, entries: [], issues: [], skipped: [] };
const confirmed = { ok: true, previewId: "id", equipmentCount: 1, fieldCount: 1 };
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => draft })); });
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });
test("only bounded DOCX file input is accepted", () => {
	for (const invalid of [null, { ...file, name: "word.pdf" }, { ...file, name: "../word.docx" }, { ...file, size: 0 }, { ...file, size: EQUIPMENT_DOCX_MAX_BYTES + 1 }]) expect(() => validateEquipmentDocumentFile(invalid)).toThrow();
	expect(validateEquipmentDocumentFile(file)).toBe(file);
});
test("preview sends raw bytes with DOCX MIME and encoded filename, never auto confirms", async () => {
	await expect(previewAdminEquipmentDocument("AUTH", file)).resolves.toEqual(draft);
	const [url, options] = fetch.mock.calls[0]; expect(url).toBe("/api/admin/equipment/import/preview"); expect(options.body).toBe(file); expect(options.headers).toEqual({ Authorization: "Bearer AUTH", "Content-Type": EQUIPMENT_DOCX_MIME, "X-Document-Name": encodeURIComponent(file.name) }); expect(fetch).toHaveBeenCalledTimes(1);
});
test("stored preview sends only the selected library ID, no local file or URL", async () => {
	await previewStoredAdminEquipmentDocument("AUTH", "stored-docx");
	expect(fetch.mock.calls[0][0]).toBe("/api/admin/equipment/import/preview-stored");
	expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mediaId: "stored-docx" });
	expect(() => previewStoredAdminEquipmentDocument("AUTH", "https://private.invalid/file")).toThrow();
});
test("confirm sends exact explicit selections and same replay key", async () => {
	fetch.mockResolvedValue({ ok: true, status: 200, json: async () => confirmed });
	const input = { previewId: "id", selections: [{ id: "0", fields: ["tcm_en"] }], idempotencyKey: "same-key" };
	await confirmAdminEquipmentDocument("AUTH", input); await confirmAdminEquipmentDocument("AUTH", input);
	expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input); expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
});
test("malformed responses and provider errors never leak raw detail", async () => {
	fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...draft, entries: [null] }) });
	await expect(previewAdminEquipmentDocument("AUTH", file)).rejects.toMatchObject({ code: "invalidImportResponse" });
	fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "importConflict", message: "PRIVATE_PROVIDER_DATA" }) });
	await expect(confirmAdminEquipmentDocument("AUTH", {})).rejects.toMatchObject({ code: "importConflict", message: expect.not.stringContaining("PRIVATE") });
	fetch.mockRejectedValueOnce(new Error("PRIVATE_NETWORK_DATA"));
	await expect(confirmAdminEquipmentDocument("AUTH", {})).rejects.toMatchObject({ code: "importNetworkError", message: expect.stringContaining("保存结果可能已生效") });
});
test("preview and confirmation time out even when fetch ignores abort", async () => {
	jest.useFakeTimers(); fetch.mockImplementation(() => new Promise(() => {}));
	const preview = previewAdminEquipmentDocument("AUTH", file); const previewAssertion = expect(preview).rejects.toMatchObject({ code: "importRequestTimeout" });
	await jest.advanceTimersByTimeAsync(30000); await previewAssertion;
	const confirm = confirmAdminEquipmentDocument("AUTH", {}); const confirmAssertion = expect(confirm).rejects.toMatchObject({ code: "importRequestTimeout", message: expect.stringContaining("勿重复上传") });
	await jest.advanceTimersByTimeAsync(20000); await confirmAssertion;
});
test("caller abort terminates stalled requests and history is GET with bounded page size", async () => {
	fetch.mockImplementationOnce(() => new Promise(() => {})); const controller = new AbortController();
	const request = previewAdminEquipmentDocument("AUTH", file, { signal: controller.signal }); const assertion = expect(request).rejects.toMatchObject({ code: "importRequestCancelled" }); controller.abort(); await assertion;
	fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }) }); await getAdminEquipmentImportHistory("AUTH", 1);
	expect(fetch.mock.calls[1][0]).toBe("/api/admin/equipment/import/history?page=1&pageSize=10"); expect(fetch.mock.calls[1][1].method).toBe("GET");
});
