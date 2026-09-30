import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import AdminMediaLibrary from "../AdminMediaLibrary";
import { getAdminMedia, uploadAdminMedia, updateAdminMedia, createAdminMediaCategory, createAdminMediaFolder, deleteAdminMediaItems, restoreAdminMediaItem } from "../../utils/api";
import { pickAdminMedia } from "../../utils/pickAdminMedia";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("../../utils/api", () => ({ getAdminMedia: jest.fn(), uploadAdminMedia: jest.fn(), updateAdminMedia: jest.fn(), createAdminMediaCategory: jest.fn(), updateAdminMediaCategory: jest.fn(), createAdminMediaFolder:jest.fn(),deleteAdminMediaItems:jest.fn(),restoreAdminMediaItem:jest.fn(),downloadAdminMedia:jest.fn(),resolveApiAssetUrl: (url) => url }));
jest.mock("../../utils/pickAdminMedia", () => ({ pickAdminMedia: jest.fn() }));
const item = { id: "file1", name: "教学视频", url: "/api/media/id/video.mp4", kind: "video", mimeType: "video/mp4", categoryId: "videos", categoryName: "视频", size: 1024, selectable: true };
const page = (items = [item], extra = {}) => ({ items, total: items.length, page: 1, limit: 20, categories: [{ id: "videos", name: "视频" }, { id: "other", name: "其他" }], ...extra });
let tree;
const text = () => tree.root.findAllByType(Text).flatMap((node) => React.Children.toArray(node.props.children)).filter((value) => ["string", "number"].includes(typeof value)).join(" ");
const button = (id) => tree.root.findAllByType(TouchableOpacity).find((node) => node.props.testID === id);
const press = async (id) => { await act(async () => { button(id).props.onPress(); }); };
const input = (id, value) => act(async () => tree.root.findAllByType(TextInput).find((node) => node.props.testID === id).props.onChangeText(value));
const mount = async (props = {}) => { await act(async () => { tree = renderer.create(<AdminMediaLibrary token="token" permissions={["app_maintenance.files.manage"]} {...props} />); }); };
beforeEach(() => { jest.resetAllMocks(); getAdminMedia.mockResolvedValue(page()); uploadAdminMedia.mockResolvedValue({ item }); updateAdminMedia.mockResolvedValue({ item }); createAdminMediaCategory.mockResolvedValue({}); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });

test("lists paginated media and filters before fetching, keeping old account data hidden", async () => {
	getAdminMedia.mockResolvedValue(page([item], { total: 42 }));
	await mount(); await press("media-next");
	expect(getAdminMedia).toHaveBeenLastCalledWith("token", expect.objectContaining({ page: 2 }));
	await press("media-kind-gif");
	expect(getAdminMedia).toHaveBeenLastCalledWith("token", expect.objectContaining({ page: 1, kind: "gif" }));
	await input("media-search", "测试"); await press("media-search-submit");
	expect(getAdminMedia).toHaveBeenLastCalledWith("token", expect.objectContaining({ search: "测试" }));
});
test("an old slow response cannot override new search", async () => {
	let resolveOld;
	getAdminMedia.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
	await mount(); await input("media-search", "新"); await press("media-search-submit");
	await act(async () => resolveOld(page([{ ...item, name: "过期结果" }])));
	expect(text()).not.toContain("过期结果"); expect(text()).toContain("教学视频");
});
test.each([401, 403, 404])("shows error for status %s rather than empty library", async (status) => {
	getAdminMedia.mockRejectedValue({ status }); await mount();
	expect(text()).toContain(status === 404 ? "先部署" : "权限");
	expect(text()).not.toContain("暂无符合条件");
});
test("selection omits historical YouTube and archived assets", async () => {
	getAdminMedia.mockResolvedValue(page([item, { ...item, id: "youtube", selectable: false }, { ...item, id: "archived", archived: true }]));
	const onSelect = jest.fn(); await mount({ onSelect, kind: "video" });
	expect(button("media-select-youtube")).toBeUndefined(); expect(button("media-select-archived")).toBeUndefined();
	await press("media-select-file1"); expect(onSelect).toHaveBeenCalledWith(item);
	expect(button("media-edit-file1")).toBeUndefined();
});
test("upload cancelled in picker performs no network mutation", async () => {
	pickAdminMedia.mockResolvedValue(null); await mount({ initialView: "upload" }); await press("media-upload-file");
	expect(uploadAdminMedia).not.toHaveBeenCalled(); expect(button("media-upload-file").props.disabled).toBe(false);
});
test("upload validates file kind before sending, including GIF-specific input", async () => {
	pickAdminMedia.mockResolvedValue({ name: "wrong.mp4", type: "video/mp4", size: 100 });
	await mount({ initialView: "upload", kind: "gif" }); await press("media-upload-file");
	expect(uploadAdminMedia).not.toHaveBeenCalled(); expect(text()).toContain("格式");
});
test("successful upload chooses media only after server confirmation and suppresses duplicate clicks", async () => {
	let resolveUpload; const onSelect = jest.fn();
	pickAdminMedia.mockResolvedValue({ name: "demo.mp4", type: "video/mp4", size: 100 });
	uploadAdminMedia.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));
	await mount({ initialView: "upload", kind: "video", onSelect }); await press("media-upload-file"); await press("media-upload-file");
	expect(uploadAdminMedia).toHaveBeenCalledTimes(1); expect(onSelect).not.toHaveBeenCalled();
	expect(uploadAdminMedia.mock.calls[0][2]).toMatchObject({ categoryId: "videos", mimeType: "video/mp4" });
	await act(async () => resolveUpload({ item })); expect(onSelect).toHaveBeenCalledWith(item);
});
test("closing while upload pending aborts and never applies late result", async () => {
	let resolveUpload; const onSelect = jest.fn();
	pickAdminMedia.mockResolvedValue({ name: "demo.mp4", size: 100 });
	uploadAdminMedia.mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));
	await mount({ initialView: "upload", kind: "video", onSelect }); await press("media-upload-file");
	const signal = uploadAdminMedia.mock.calls[0][2].signal;
	await act(async () => tree.unmount()); tree = null;
	expect(signal.aborted).toBe(true);
	await act(async () => resolveUpload({ item })); expect(onSelect).not.toHaveBeenCalled();
});
test("management permissions hide metadata tools from equipment-only operator", async () => {
	await mount({ permissions: ["app_maintenance.equipment.manage"] });
	expect(button("media-edit-file1")).toBeUndefined(); expect(button("media-category-save")).toBeUndefined();
	expect(button("media-view-upload")).toBeDefined();
});
test("names and categories save without altering original URL", async () => {
	await mount(); await press("media-edit-file1"); await input("media-edit-name", "新名称"); await press("media-edit-category-other"); await press("media-save");
	expect(updateAdminMedia).toHaveBeenCalledWith("token", "file1", { name: "新名称", categoryId: "other" });
});
test("archive requires explicit confirmation, referenced files have no archive button", async () => {
	await mount(); await press("media-edit-file1"); await press("media-archive");
	expect(updateAdminMedia).not.toHaveBeenCalled(); await press("media-archive-confirm");
	expect(updateAdminMedia).toHaveBeenCalledWith("token", "file1", { archived: true });
	getAdminMedia.mockResolvedValue(page([{ ...item, isReferenced: true }])); await press("media-refresh"); await press("media-edit-file1");
	expect(button("media-archive")).toBeUndefined();
});
test("new file categories are explicit and trimmed", async () => {
	await mount(); await input("media-category-name", " 测试分类 "); await press("media-category-save");
	expect(createAdminMediaCategory).toHaveBeenCalledWith("token", "测试分类");
});

test("folder navigation keeps breadcrumbs and resets page/search; empty folder creation uses current parent",async()=>{
	getAdminMedia.mockResolvedValueOnce(page([{id:"cn",name:"中文",kind:"folder"}])).mockResolvedValue(page([],{trail:[{id:"cn",name:"中文"}]}));
	createAdminMediaFolder.mockResolvedValue({folder:{id:"empty"}});
	await mount();await press("media-open-folder-cn");
	expect(getAdminMedia).toHaveBeenLastCalledWith("token",expect.objectContaining({folderId:"cn",page:1,search:""}));
	await input("media-folder-name"," 新文件夹 ");await press("media-folder-create");
	expect(createAdminMediaFolder).toHaveBeenCalledWith("token","新文件夹","cn");
	await press("media-root");expect(getAdminMedia).toHaveBeenLastCalledWith("token",expect.objectContaining({folderId:""}));
});
test("select all is scoped to this page and excludes referenced files; delete needs confirmation",async()=>{
	getAdminMedia.mockResolvedValue(page([item,{...item,id:"used",isReferenced:true},{id:"folder",name:"目录",kind:"folder"}]));
	deleteAdminMediaItems.mockResolvedValue({recoverable:true});
	await mount();await press("media-select-all");await press("media-delete-selected");expect(deleteAdminMediaItems).not.toHaveBeenCalled();
	await press("media-delete-confirm");expect(deleteAdminMediaItems).toHaveBeenCalledWith("token",[{id:"file1",kind:"file"},{id:"folder",kind:"folder"}]);
	expect(text()).toContain("可恢复");
});
test("recycle bin restores through explicit action and hides file selectors and delete actions",async()=>{
	getAdminMedia.mockResolvedValue(page([{...item,deletedAt:"2026-09-10",selectable:false}]));restoreAdminMediaItem.mockResolvedValue({restored:true});
	await mount();await press("media-trash");expect(button("media-delete-file1")).toBeUndefined();
	await press("media-restore-file1");expect(restoreAdminMediaItem).toHaveBeenCalledWith("token",{id:"file1",kind:"file"});
});
