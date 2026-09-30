import React from "react";
import renderer, { act } from "react-test-renderer";
import AdminEquipmentImport from "../AdminEquipmentImport";
import * as api from "../../utils/adminEquipmentImportApi";
jest.mock("react-native", () => ({ ActivityIndicator: "ActivityIndicator", Modal: "Modal", ScrollView: "ScrollView", TouchableOpacity: "TouchableOpacity", Text: "Text", View: "View", StyleSheet: { create: (value) => value } }));
jest.mock("../../utils/adminEquipmentImportApi", () => ({ confirmAdminEquipmentDocument: jest.fn(), getAdminEquipmentImportAudit: jest.fn(), getAdminEquipmentImportHistory: jest.fn(), pickEquipmentDocument: jest.fn(), previewAdminEquipmentDocument: jest.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const field = (name, extra = {}) => ({ field: name, label: name, before: "旧内容", after: "新内容", changed: true, emptySkipped: false, ...extra });
const entry = (id) => ({ id, code: id, nameZh: `设施${id}`, nameEn: `Equipment ${id}`, fields: [field("tcm_zh"), field("tcm_en", { after: "", emptySkipped: true }), field("details_zh", { before: "相同", after: "相同", changed: false })] });
const props = { token: "AUTH", permissions: ["app_maintenance.equipment.manage"] };
const makeDraft = (extra = {}) => ({ previewId: "PREVIEW", confirmationKey: "REPLAY-KEY", documentSha256: "HASH", fileName: "Word.docx", expiresAt: Date.now() + 100000, entries: [entry("0"), entry("1")], issues: [], skipped: [], canConfirm: true, ...extra });
let tree;
const text = () => JSON.stringify(tree.toJSON());
const button = (title) => tree.root.findAllByType("TouchableOpacity").find((node) => node.findAllByType("Text").some((child) => child.props.children === title));
const byId = (id) => tree.root.findAllByType("TouchableOpacity").find((node) => node.props.testID === id);
const press = async (node) => { await act(async () => { if (!node.props.disabled) await node.props.onPress(); }); };
const mount = async (extra = {}, openDialog = true) => { await act(async () => { tree = renderer.create(<AdminEquipmentImport {...props} {...extra} />); }); if (openDialog) await press(byId("equipment-import-open")); };
const deferred = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
beforeEach(() => { jest.clearAllMocks(); api.pickEquipmentDocument.mockResolvedValue({ name: "Word.docx" }); api.previewAdminEquipmentDocument.mockResolvedValue(makeDraft()); api.confirmAdminEquipmentDocument.mockResolvedValue({ ok: true, equipmentCount: 2, fieldCount: 2 }); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
test("only a compact entry is mounted until opened; system dismissal clears the dialog without importing", async () => {
	await mount({}, false);
	expect(byId("equipment-import-open")).toBeDefined(); expect(tree.root.findAllByType("Modal")).toHaveLength(0); expect(byId("equipment-import-upload")).toBeUndefined();
	expect(api.pickEquipmentDocument).not.toHaveBeenCalled(); expect(api.getAdminEquipmentImportHistory).not.toHaveBeenCalled();
	await press(byId("equipment-import-open"));
	const modal = tree.root.findByType("Modal"); expect(modal.props.accessibilityLabel).toBe("Word 一键导入设施教学"); expect(tree.root.findByType("ScrollView").props.keyboardShouldPersistTaps).toBe("handled");
	await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(byId("equipment-import-review"));
	// React Native routes Android back and React Native Web routes Escape here.
	await act(async () => { modal.props.onRequestClose(); });
	expect(tree.root.findAllByType("Modal")).toHaveLength(0); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
	await press(byId("equipment-import-open")); expect(text()).not.toContain("Word.docx"); expect(byId("equipment-import-confirm")).toBeUndefined();
});
test("entry cannot open without a token or the equipment permission", async () => {
	await mount({ permissions: [] }, false); expect(byId("equipment-import-open").props.disabled).toBe(true); await press(byId("equipment-import-open")); expect(tree.root.findAllByType("Modal")).toHaveLength(0);
	await act(async () => { tree.update(<AdminEquipmentImport {...props} token="" />); }); expect(byId("equipment-import-open").props.disabled).toBe(true); expect(api.pickEquipmentDocument).not.toHaveBeenCalled();
});
test("preview is read-only with every field unchecked; explicit two-step confirmation imports only eligible selections", async () => {
	await mount(); await press(byId("equipment-import-upload"));
	expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled(); expect(byId("equipment-import-review").props.disabled).toBe(true);
	await press(button("选择全部变更字段")); await press(byId("equipment-import-review")); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled(); await press(byId("equipment-import-confirm"));
	expect(api.confirmAdminEquipmentDocument).toHaveBeenCalledWith("AUTH", { previewId: "PREVIEW", idempotencyKey: "REPLAY-KEY", selections: [{ id: "0", fields: ["tcm_zh"] }, { id: "1", fields: ["tcm_zh"] }] }, expect.any(Object)); expect(text()).toContain("已更新");
});
test("AI draft receives one facility's selected new text, no old content, token or audit", async () => {
	const onAssistantDocument = jest.fn(); await mount({ onAssistantDocument }); await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(button("AI 辅助核对 0 所选文字（不保存）"));
	expect(onAssistantDocument).toHaveBeenCalledTimes(1); const draft = onAssistantDocument.mock.calls[0][0]; expect(draft.entries).toHaveLength(1); expect(draft.entries[0].fields).toEqual([{ field: "tcm_zh", label: "tcm_zh", after: "新内容" }]); expect(JSON.stringify(draft)).not.toMatch(/旧内容|AUTH|before|audit/); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
});
test("unresolved identity errors disable selection, AI and confirmation", async () => {
	api.previewAdminEquipmentDocument.mockResolvedValue(makeDraft({ canConfirm: false, issues: [{ code: "mismatch", severity: "error", message: "名称不匹配" }] }));
	await mount({ onAssistantDocument: jest.fn() }); await press(byId("equipment-import-upload")); expect(button("选择全部变更字段").props.disabled).toBe(true); expect(byId("equipment-import-review").props.disabled).toBe(true); expect(button("AI 辅助核对 0 所选文字（不保存）").props.disabled).toBe(true);
});
test("uncertain network result keeps preview and retries identical confirmation key", async () => {
	api.confirmAdminEquipmentDocument.mockRejectedValueOnce(new Error("网络中断")); await mount(); await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(byId("equipment-import-review")); await press(byId("equipment-import-confirm")); expect(text()).toContain("网络中断"); await press(byId("equipment-import-confirm"));
	expect(api.confirmAdminEquipmentDocument.mock.calls[1][1]).toEqual(api.confirmAdminEquipmentDocument.mock.calls[0][1]);
});
test("saved import survives async list refresh failure without offering duplicate import", async () => {
	await mount({ onImported: jest.fn().mockRejectedValue(new Error("refresh failure")) }); await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(byId("equipment-import-review")); await press(byId("equipment-import-confirm")); expect(text()).toContain("已保存，但列表刷新失败"); expect(byId("equipment-import-confirm")).toBeUndefined(); expect(api.confirmAdminEquipmentDocument).toHaveBeenCalledTimes(1);
});
test("preview pagination shows only five facilities and token changes discard pending data", async () => {
	api.previewAdminEquipmentDocument.mockResolvedValueOnce(makeDraft({ entries: Array.from({ length: 6 }, (_, id) => entry(String(id))) })); await mount(); await press(byId("equipment-import-upload")); expect(text()).not.toContain("设施5"); await press(button("下一页")); expect(text()).toContain("设施5");
	let resolve; api.previewAdminEquipmentDocument.mockImplementationOnce(() => new Promise((done) => { resolve = done; })); let pending;
	await act(async () => { pending = byId("equipment-import-upload").props.onPress(); });
	await act(async () => { tree.update(<AdminEquipmentImport {...props} token="OTHER" />); resolve(makeDraft()); await pending; }); expect(text()).not.toContain("Word.docx"); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
});
test("closing while the picker is open ignores its later selection without uploading", async () => {
	const picked = deferred(); api.pickEquipmentDocument.mockReturnValueOnce(picked.promise); await mount();
	let pending; await act(async () => { pending = byId("equipment-import-upload").props.onPress(); });
	await press(byId("equipment-import-close")); await press(byId("equipment-import-open"));
	await act(async () => { picked.resolve({ name: "Cancelled.docx" }); await pending; });
	expect(api.previewAdminEquipmentDocument).not.toHaveBeenCalled(); expect(byId("equipment-import-upload").props.disabled).toBe(false); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
});
test("closing aborts a preview and its late result cannot replace a new session or clear its busy state", async () => {
	const previous = deferred(); const next = deferred(); api.previewAdminEquipmentDocument.mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise); await mount();
	let firstPending; await act(async () => { firstPending = byId("equipment-import-upload").props.onPress(); });
	const signal = api.previewAdminEquipmentDocument.mock.calls[0][2].signal; expect(signal.aborted).toBe(false);
	await press(byId("equipment-import-close")); expect(signal.aborted).toBe(true); await press(byId("equipment-import-open"));
	let nextPending; await act(async () => { nextPending = byId("equipment-import-upload").props.onPress(); });
	await act(async () => { previous.resolve(makeDraft({ fileName: "Stale.docx" })); await firstPending; });
	expect(text()).not.toContain("Stale.docx"); expect(byId("equipment-import-upload").props.disabled).toBe(true);
	await act(async () => { next.resolve(makeDraft({ fileName: "Current.docx" })); await nextPending; });
	expect(text()).toContain("Current.docx"); expect(byId("equipment-import-upload").props.disabled).toBe(false); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
});
test("confirmation stays open while saving and rejects duplicate presses or system dismissal", async () => {
	const saved = deferred(); const onImported = jest.fn(); api.confirmAdminEquipmentDocument.mockReturnValueOnce(saved.promise); await mount({ onImported });
	await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(byId("equipment-import-review"));
	let pending; await act(async () => { pending = byId("equipment-import-confirm").props.onPress(); });
	expect(byId("equipment-import-close").props.disabled).toBe(true); expect(text()).toContain("正在确认更新，请等待结果后关闭");
	await act(async () => { tree.root.findByType("Modal").props.onRequestClose(); await byId("equipment-import-confirm").props.onPress(); });
	expect(tree.root.findAllByType("Modal")).toHaveLength(1); expect(api.confirmAdminEquipmentDocument).toHaveBeenCalledTimes(1); expect(api.confirmAdminEquipmentDocument.mock.calls[0][2].signal.aborted).toBe(false);
	await act(async () => { saved.resolve({ equipmentCount: 2, fieldCount: 2 }); await pending; });
	expect(onImported).toHaveBeenCalledTimes(1); expect(byId("equipment-import-close").props.disabled).toBe(false); await press(byId("equipment-import-close")); expect(tree.root.findAllByType("Modal")).toHaveLength(0);
});
test("revoking access during confirmation closes the dialog and ignores the late response", async () => {
	const saved = deferred(); const onImported = jest.fn(); api.confirmAdminEquipmentDocument.mockReturnValueOnce(saved.promise); await mount({ onImported });
	await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(byId("equipment-import-review"));
	let pending; await act(async () => { pending = byId("equipment-import-confirm").props.onPress(); });
	const signal = api.confirmAdminEquipmentDocument.mock.calls[0][2].signal;
	await act(async () => { tree.update(<AdminEquipmentImport {...props} permissions={[]} onImported={onImported} />); });
	expect(signal.aborted).toBe(true); expect(tree.root.findAllByType("Modal")).toHaveLength(0);
	await act(async () => { saved.resolve({ equipmentCount: 2, fieldCount: 2 }); await pending; }); expect(onImported).not.toHaveBeenCalled(); expect(text()).not.toContain("已更新");
});
test("history and audit remain available inside the scrollable dialog and closing discards stale errors", async () => {
	api.getAdminEquipmentImportHistory.mockResolvedValueOnce({ items: [{ previewId: "OLD", fileName: "History.docx", equipmentCount: 1, fieldCount: 1, createdAt: Date.now() }], total: 1, page: 1, pageSize: 5 });
	api.getAdminEquipmentImportAudit.mockResolvedValueOnce({ updatedAt: Date.now(), changes: [{ id: "1", field: "tcm_zh", label: "中医", before: "审计旧文字", after: "审计新文字" }] });
	await mount(); await press(button("查看导入记录及旧内容")); await press(button("查看旧内容")); expect(text()).toContain("审计旧文字"); expect(text()).toContain("审计新文字");
	const historyRequest = deferred(); api.getAdminEquipmentImportHistory.mockReturnValueOnce(historyRequest.promise);
	let pending; await act(async () => { pending = button("查看导入记录及旧内容").props.onPress(); });
	const signal = api.getAdminEquipmentImportHistory.mock.calls[1][2].signal;
	await press(byId("equipment-import-close")); expect(signal.aborted).toBe(true); await press(byId("equipment-import-open"));
	await act(async () => { historyRequest.reject(new Error("上一次窗口的错误")); await pending; }); expect(text()).not.toContain("上一次窗口的错误"); expect(text()).not.toContain("审计旧文字"); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
});
test("AI handoff closes the import window on success; a failure preserves the preview for retry", async () => {
	const onAssistantDocument = jest.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(undefined); await mount({ onAssistantDocument });
	await press(byId("equipment-import-upload")); await press(button("选择全部变更字段")); await press(button("AI 辅助核对 0 所选文字（不保存）"));
	expect(text()).toContain("无法打开 AI 文字草稿"); expect(text()).toContain("Word.docx"); expect(byId("equipment-import-close").props.disabled).toBe(false);
	await press(button("AI 辅助核对 0 所选文字（不保存）")); expect(tree.root.findAllByType("Modal")).toHaveLength(0); expect(onAssistantDocument).toHaveBeenCalledTimes(2); expect(api.confirmAdminEquipmentDocument).not.toHaveBeenCalled();
});
