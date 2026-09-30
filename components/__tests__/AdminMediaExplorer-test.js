import React from "react";
import renderer, { act } from "react-test-renderer";
import { createPortal } from "react-dom";
import AdminMediaLibrary from "../AdminMediaLibrary.web";
import * as api from "../../utils/api";
import { pickAdminMedia } from "../../utils/pickAdminMedia";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const originalDocument = global.document;
let mockApi;
jest.mock("react-dom", () => ({ createPortal: jest.fn(children => children) }));
jest.mock("@svar-ui/react-filemanager/all.css", () => ({}));
jest.mock("@svar-ui/core-locales", () => ({ cn: {} }));
jest.mock("@svar-ui/filemanager-locales", () => ({ cn: { filemanager: {} } }));
jest.mock("@svar-ui/react-core", () => ({ Locale: ({ children }) => children }), { virtual: true });
jest.mock("@svar-ui/react-filemanager", () => {
	const React = require("react");
	return { Willow: ({ children }) => children, Filemanager: props => {
		const propsRef = React.useRef(props); propsRef.current = props;
		const gateway = React.useMemo(() => {
			const intercepts = {}, listeners = {}, selected = [];
			const instance = { intercept: (event, fn) => { intercepts[event] = fn; }, on: (event, fn) => { listeners[event] = fn; },
				getState: () => ({ activePanel: 0, panels: [{ selected }] }), getFile: id => propsRef.current.data.find(item => item.id === id),
				exec: async (event, args = {}) => { if (intercepts[event]?.(args) === false) return; if (event === "select-file") { if (!args.toggle) selected.length = 0; if (args.id) selected.push(args.id); } listeners[event]?.(args); },
			}; return instance;
		}, []);
		React.useEffect(() => { mockApi = gateway; props.init(gateway); }, []);
		return React.createElement("mock-filemanager", props);
	} };
}, { virtual: true });
jest.mock("../MediaVideo", () => props => require("react").createElement("mock-video", props));
jest.mock("../../utils/pickAdminMedia", () => ({ pickAdminMedia: jest.fn(), pickAdminMediaBatch: jest.fn() }));
jest.mock("../../utils/api", () => ({ getAdminMedia: jest.fn(), createAdminMediaFolder: jest.fn(), renameAdminMediaFolder: jest.fn(), deleteAdminMediaItems: jest.fn(), moveAdminMediaItems: jest.fn(), copyAdminMediaItems: jest.fn(), restoreAdminMediaItem: jest.fn(), uploadAdminMedia: jest.fn(), updateAdminMedia: jest.fn(), downloadAdminMedia: jest.fn(), createAdminMediaCategory: jest.fn(), updateAdminMediaCategory: jest.fn(), resolveApiAssetUrl: value => value }));
const permission = ["app_maintenance.files.manage"];
const file = { id: "file-uuid", kind: "video", name: "exercise.mp4", mimeType: "video/mp4", categoryId: "videos", url: "/api/media/uuid/file.mp4", source: "upload", canCopy: true };
const folder = { id: "folder-uuid", kind: "folder", name: "Videos", folderId: "", canCopy: true };
const response = (items = [file, folder], extra = {}) => ({ items, total: items.length, limit: 20, page: 1, trail: [], categories: [{ id: "videos", name: "视频" }], ...extra });
let tree;
const mount = async (props = {}) => act(async () => { tree = renderer.create(<AdminMediaLibrary token="auth" permissions={permission} {...props} />); });
const button = id => tree.root.findAllByType("button").find(node => node.props["data-testid"] === id);
const click = async id => act(async () => button(id).props.onClick());
const manager = () => tree.root.findByType("mock-filemanager");
const select = async id => act(async () => mockApi.exec("select-file", { id }));
beforeEach(() => { jest.clearAllMocks(); global.document = { body: { tagName: "BODY" } }; api.getAdminMedia.mockResolvedValue(response()); api.copyAdminMediaItems.mockResolvedValue({}); api.moveAdminMediaItems.mockResolvedValue({}); api.renameAdminMediaFolder.mockResolvedValue({}); api.createAdminMediaFolder.mockResolvedValue({}); api.deleteAdminMediaItems.mockResolvedValue({}); api.restoreAdminMediaItem.mockResolvedValue({}); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; global.document = originalDocument; });

test("uses server pagination and never requests all files to make a fake page", async () => {
	api.getAdminMedia.mockResolvedValue(response([file], { total: 42 })); await mount(); await click("media-next");
	expect(api.getAdminMedia).toHaveBeenLastCalledWith("auth", expect.objectContaining({ page: 2, limit: 20, folderId: "" }));
	expect(manager().props.data.filter(item => item.type === "file")).toHaveLength(1);
});
test("folder double-click and root breadcrumb request the correct parent", async () => {
	await mount(); await act(async () => mockApi.exec("set-path", { id: "/Videos" }));
	expect(api.getAdminMedia).toHaveBeenLastCalledWith("auth", expect.objectContaining({ folderId: "folder-uuid", page: 1 }));
	await click("media-root"); expect(api.getAdminMedia).toHaveBeenLastCalledWith("auth", expect.objectContaining({ folderId: "" }));
});

test("table mousedown prepares grid focus without scrolling or intercepting selection modifiers", async () => {
	await mount();
	const frame = tree.root.findAllByType("div").find(node => node.props.className === "of-media-manager");
	const grid = { focus: jest.fn() };
	const cell = { closest: jest.fn(() => grid) };
	const target = { closest: jest.fn(selector => selector === ".wx-body [role='gridcell']" ? cell : null) };
	const event = { target, currentTarget: { contains: jest.fn(() => true) }, button: 0, ctrlKey: true, shiftKey: true, preventDefault: jest.fn(), stopPropagation: jest.fn() };
	frame.props.onMouseDownCapture(event);
	expect(grid.focus).toHaveBeenCalledWith({ preventScroll: true });
	expect(event.preventDefault).not.toHaveBeenCalled();
	expect(event.stopPropagation).not.toHaveBeenCalled();
	// The focus preparation itself must not choose or open a different item.
	expect(button("media-rename").props.disabled).toBe(true);
	expect(api.getAdminMedia).toHaveBeenCalledTimes(1);
	await act(async () => mockApi.exec("set-path", { id: "/Videos" }));
	expect(api.getAdminMedia).toHaveBeenLastCalledWith("auth", expect.objectContaining({ folderId: folder.id }));
});

test("table focus preparation leaves inputs, right-clicks, cards and unrelated targets untouched", async () => {
	await mount();
	const frame = () => tree.root.findAllByType("div").find(node => node.props.className === "of-media-manager");
	const grid = { focus: jest.fn() }, cell = { closest: () => grid };
	const target = { closest: selector => selector === ".wx-body [role='gridcell']" ? cell : null };
	const event = { target, currentTarget: { contains: () => true }, button: 0 };
	frame().props.onMouseDownCapture({ ...event, button: 2 });
	frame().props.onMouseDownCapture({ ...event, target: { closest: () => ({ tagName: "INPUT" }) } });
	frame().props.onMouseDownCapture({ ...event, target: { closest: () => null } });
	frame().props.onMouseDownCapture({ ...event, currentTarget: { contains: () => false } });
	await click("media-view-cards");
	frame().props.onMouseDownCapture(event);
	expect(grid.focus).not.toHaveBeenCalled();
});
test("copy and paste across directories keep immutable ids, not display paths", async () => {
	await mount(); await select("/exercise.mp4"); await click("media-copy");
	api.getAdminMedia.mockResolvedValue(response([], { trail: [{ id: folder.id, name: folder.name }] }));
	await act(async () => mockApi.exec("set-path", { id: "/Videos" }));
	await click("media-paste"); expect(api.copyAdminMediaItems).toHaveBeenCalledWith("auth", [{ id: file.id, kind: "file" }], folder.id);
});
test("cut is cleared only after a successful server move", async () => {
	await mount(); await select("/exercise.mp4"); await click("media-cut"); await click("media-paste");
	expect(api.moveAdminMediaItems).toHaveBeenCalledWith("auth", [{ id: file.id, kind: "file" }], ""); expect(button("media-paste").props.disabled).toBe(true);
});
test("delete is confirmed and protects actively referenced media", async () => {
	await mount(); await select("/exercise.mp4"); await click("media-delete-selected"); expect(api.deleteAdminMediaItems).not.toHaveBeenCalled();
	await click("media-dialog-confirm"); expect(api.deleteAdminMediaItems).toHaveBeenCalledWith("auth", [{ id: file.id, kind: "file" }]);
	api.getAdminMedia.mockResolvedValue(response([{ ...file, isReferenced: true }])); await click("media-refresh"); await select("/exercise.mp4"); expect(button("media-delete-selected").props.disabled).toBe(true);
});
test("folder rename uses folder endpoint and cannot accidentally rename a file", async () => {
	await mount(); await select("/Videos"); await click("media-rename");
	await act(async () => tree.root.findAllByType("input").find(node => node.props["aria-label"] === "文件或文件夹名称").props.onChange({ target: { value: "新名称" } }));
	await click("media-dialog-confirm"); expect(api.renameAdminMediaFolder).toHaveBeenCalledWith("auth", folder.id, "新名称"); expect(api.updateAdminMedia).not.toHaveBeenCalled();
});
test("content editor picker has upload but no folder or metadata mutation", async () => {
	await mount({ permissions: ["app_maintenance.equipment.manage"], onSelect: jest.fn(), kind: "video" });
	expect(button("media-folder-create")).toBeUndefined(); expect(button("media-delete-selected")).toBeUndefined();
	const options = manager().props.menuOptions("file", manager().props.data[0]); expect(options.map(item => item.id)).toEqual(["app-open"]);
	for (const event of ["create-file", "rename-file", "delete-files", "copy-files", "move-files", "upload-file"]) await act(async () => mockApi.exec(event, { id: "/exercise.mp4", file: { name: "evil" }, ids: ["/exercise.mp4"] }));
	expect(api.updateAdminMedia).not.toHaveBeenCalled(); expect(api.uploadAdminMedia).not.toHaveBeenCalled();
});
test("wrong video/GIF type cannot be selected by double click or use button", async () => {
	const onSelect = jest.fn(); await mount({ onSelect, kind: "gif" }); await select("/exercise.mp4"); expect(button("media-use-selected").props.disabled).toBe(true);
	await act(async () => mockApi.exec("open-file", { id: "/exercise.mp4" })); expect(onSelect).not.toHaveBeenCalled();
});
test("video preview passes the existing player correct source, title and language props", async () => {
	await mount(); await act(async () => mockApi.exec("open-file", { id: "/exercise.mp4" }));
	expect(tree.root.findByType("mock-video").props).toMatchObject({ source: file.url, title: file.name, locale: "zh", maxViewportHeight: 65 });
	expect(createPortal).toHaveBeenLastCalledWith(expect.objectContaining({ props: expect.objectContaining({ className: "of-media-explorer of-media-dialog-backdrop" }) }), document.body);
});
test("confirmation dialogs are portaled to the document body, outside the native scroll container", async () => {
	await mount(); await select("/exercise.mp4"); await click("media-delete-selected");
	expect(createPortal).toHaveBeenLastCalledWith(expect.objectContaining({ props: expect.objectContaining({ className: "of-media-explorer of-media-dialog-backdrop" }) }), document.body);
	expect(tree.root.findAllByProps({ role: "dialog" })).toHaveLength(1);
});
test("trash disables mutation and restores the stable file id", async () => {
	await mount(); await click("media-trash"); await select("/exercise.mp4");
	expect(button("media-paste").props.disabled).toBe(true);
	const option = manager().props.menuOptions("file", manager().props.data[0])[0]; await act(async () => option.handler());
	expect(api.restoreAdminMediaItem).toHaveBeenCalledWith("auth", { id: file.id, kind: "file" });
});
test("switching account drops the clipboard and ignores older network responses", async () => {
	await mount(); await select("/exercise.mp4"); await click("media-copy");
	let resolveOld; api.getAdminMedia.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })); await click("media-refresh");
	api.getAdminMedia.mockResolvedValue(response([])); await act(async () => tree.update(<AdminMediaLibrary token="new-account" permissions={permission} />));
	await act(async () => resolveOld(response([file]))); expect(manager().props.data).toEqual([]); expect(button("media-paste").props.disabled).toBe(true);
});
test("picker cancellation never uploads a file", async () => {
	pickAdminMedia.mockResolvedValue(null); await mount({ initialView: "upload" }); await click("media-upload-file"); expect(api.uploadAdminMedia).not.toHaveBeenCalled();
});
test("table column sorting requests a server-side sorted first page", async () => {
	await mount(); await act(async () => mockApi.exec("sort-files", { key: "date", order: "desc" }));
	expect(api.getAdminMedia).toHaveBeenLastCalledWith("auth", expect.objectContaining({ page: 1, sort: "modified", direction: "desc", limit: 20 }));
});
test("right-click paste on root targets root even while browsing a nested folder", async () => {
	api.getAdminMedia.mockResolvedValue(response([file], { trail: [{ id: folder.id, name: folder.name }] }));
	await mount(); await select("/Videos/exercise.mp4"); await click("media-copy");
	const rootPaste = manager().props.menuOptions("folder", { id: "/", type: "folder" }).find(option => option.id === "paste");
	await act(async () => rootPaste.handler()); expect(api.copyAdminMediaItems).toHaveBeenCalledWith("auth", [{ id: file.id, kind: "file" }], "");
});
test("same-token permission changes clear clipboard and reload authorized data", async () => {
	await mount(); await select("/exercise.mp4"); await click("media-copy"); api.getAdminMedia.mockClear();
	await act(async () => tree.update(<AdminMediaLibrary token="auth" permissions={["app_maintenance.equipment.manage"]} />));
	expect(api.getAdminMedia).toHaveBeenCalled(); expect(button("media-paste")).toBeUndefined();
	expect(manager().props.menuOptions("file", manager().props.data[0]).map(option => option.id)).not.toContain("app-copy");
});

test("narrow-column shell styles wrap controls while keeping SVAR horizontal scrolling inside the frame", async () => {
	await mount();
	const css = tree.root.findByType("style").props.children;
	const declarations = selector => {
		const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const rules = [...css.matchAll(new RegExp(`(?:^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
		return Object.assign({}, ...rules.map(match => Object.fromEntries(match[1].split(";").filter(Boolean).map(item => {
			const separator = item.indexOf(":"); return [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
		}))));
	};
	expect(declarations(".of-media-heading>div")).toMatchObject({ flex: "1 1 180px", "min-width": "0", "max-width": "100%" });
	expect(declarations(".of-media-filters form")).toMatchObject({ flex: "1 1 220px", "min-width": "0", "max-width": "100%" });
	expect(declarations(".of-media-filters input:not([type=checkbox])")).toMatchObject({ "min-width": "0", "max-width": "100%" });
	// A stable basis makes three filters wrap in a narrow content column instead
	// of distributing the final few pixels as arrow-only select controls.
	expect(declarations(".of-media-filters select")).toMatchObject({ flex: "1 1 140px", "max-width": "min(170px,100%)" });
	expect(declarations(".of-media-button")).toMatchObject({ "min-height": "44px", "max-width": "100%", "overflow-wrap": "anywhere" });
	expect(declarations(".of-media-manager")).toMatchObject({ width: "100%", "max-width": "100%", "overflow-x": "auto", "overflow-y": "hidden" });
	expect(declarations(".of-media-manager>.wx-willow-theme")["min-width"]).toBe("720px");
	expect(declarations(".of-media-manager .wx-filemanager")).toMatchObject({ "min-width": "720px", "max-width": "none" });
	// The busy layer must cover the scrollable canvas too, not only its first
	// viewport; otherwise horizontal scrolling could expose enabled controls.
	expect(declarations(".of-media-manager>.of-media-cover")["min-width"]).toBe("720px");
	expect(declarations(".of-media-explorer").background).toBeUndefined();
	expect(declarations(".of-media-explorer:not(.of-media-dialog-backdrop)").background).toBe("#fff");
	expect(declarations(".of-media-dialog-backdrop").background).toBe("#17202c75");
	expect(api.getAdminMedia).toHaveBeenCalledTimes(1);
	expect(manager().props.readonly).toBe(false);
	await act(async () => mockApi.exec("set-path", { id: "/Videos" }));
	expect(api.getAdminMedia).toHaveBeenLastCalledWith("auth", expect.objectContaining({ folderId: folder.id, page: 1 }));
});
