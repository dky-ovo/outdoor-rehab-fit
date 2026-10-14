import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Filemanager, Willow } from "@svar-ui/react-filemanager";
import { Locale } from "@svar-ui/react-core";
import { cn as coreChinese } from "@svar-ui/core-locales";
import { cn as fileChinese } from "@svar-ui/filemanager-locales";
import "@svar-ui/react-filemanager/all.css";
import { copyAdminMediaItems, createAdminMediaCategory, createAdminMediaFolder, deleteAdminMediaItems, downloadAdminMedia, getAdminMedia, moveAdminMediaItems, renameAdminMediaFolder, resolveApiAssetUrl, restoreAdminMediaItem, updateAdminMedia, updateAdminMediaCategory, uploadAdminMedia } from "../utils/api";
import { mediaCanSelect, mediaSizeLabel, validateAdminMedia } from "../utils/adminMedia";
import { importAdminMediaBatch } from "../utils/adminMediaBatch";
import { pickAdminMedia, pickAdminMediaBatch } from "../utils/pickAdminMedia";
import { buildExplorerPage, explorerError, explorerPermissions, explorerReferences, explorerSelection, explorerSort, MEDIA_EXPLORER_PAGE_SIZE } from "../utils/adminMediaExplorer";
import { LOCAL_EXPLORER_ICON_CSS, localExplorerFileIcon } from "../utils/adminMediaExplorerIcons";
import MediaVideo from "./MediaVideo";

const WORDS = { ...coreChinese, ...fileChinese, filemanager: { ...fileChinese.filemanager, "My files": "根目录", "Add New": "新建 / 上传", Ok: "确定", Cancel: "取消", Name: "名称", Size: "大小", Date: "修改时间", Count: "数量", Download: "下载到电脑", Cut: "剪切", Rename: "重命名", Found: "找到", "Back to parent folder": "返回上一级", "Enter file name": "输入文件名称", "Enter folder name": "输入文件夹名称", "Multiple files": "多个文件", multiple: "多种类型", Preview: "详情", "New folder": "新建文件夹", "New file": "新建文件", "Select file or folder to view details": "选择文件查看详情", "A miniature file preview": "文件缩略图", "Looks like nothing is here": "此页没有文件", used: "已使用", of: "/" } };
const TYPES = [["", "全部类型"], ["image", "图片"], ["gif", "GIF 动画"], ["video", "视频"], ["file", "其他文件"], ["folder", "仅文件夹"]];
const SORTS = [["name", "名称"], ["modified", "修改时间"], ["size", "大小"], ["kind", "类型"]];
const PAGE_SIZE = MEDIA_EXPLORER_PAGE_SIZE;

function Action({ children, onClick, disabled, primary, testId, ...rest }) {
	return <button type="button" className={primary ? "of-media-button primary" : "of-media-button"} disabled={disabled} onClick={onClick} data-testid={testId} {...rest}>{children}</button>;
}

export default function AdminMediaLibrary({ token, permissions = [], kind = "", onSelect, multiple = false, initialView = "library", refreshKey = 0 }) {
	const [query, setQuery] = useState({ page: 1, search: "", categoryId: "", kind, folderId: "", archived: false, deleted: false, sort: "name", direction: "asc" });
	const [search, setSearch] = useState("");
	const [result, setResult] = useState(null);
	const [revision, setRevision] = useState(0);
	const [mode, setMode] = useState("table");
	const [selection, setSelection] = useState([]);
	const [clipboard, setClipboard] = useState(null);
	const [busy, setBusy] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(!onSelect && initialView === "upload");
	const [uploadCategory, setUploadCategory] = useState("");
	const [progress, setProgress] = useState(null);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [dialog, setDialog] = useState(null);
	const [categoryPage, setCategoryPage] = useState(1);
	const [categoryEdit, setCategoryEdit] = useState("");
	const [categoryName, setCategoryName] = useState("");
	const [preview, setPreview] = useState(null);
	const [browserReady, setBrowserReady] = useState(false);
	const mounted = useRef(true), operation = useRef(null), currentToken = useRef(token), apiRef = useRef(null), actions = useRef({}), rootElement = useRef(null), modalElement = useRef(null);
	currentToken.current = token;
	const access = explorerPermissions(permissions, { picker: Boolean(onSelect), deleted: query.deleted, busy });
	const permissionKey = JSON.stringify([...permissions].sort());
	const requestKey = JSON.stringify([token, permissionKey, query, revision, refreshKey]);
	const active = result?.key === requestKey ? result : null;
	const data = active?.data;
	const loading = Boolean(token && access.read && !active);
	const page = useMemo(() => buildExplorerPage(data), [data]);
	const selectedItems = selection.map(path => page.byPath.get(path)).filter(Boolean);
	const selectedItem = explorerSelection(selectedItems, kind);
	const selectableBatch = selectedItems.length > 0 && selectedItems.every(item => mediaCanSelect(item, kind));
	const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));
	const categories = data?.categories || [];
	const categoryPages = Math.max(1, Math.ceil(categories.length / PAGE_SIZE));
	const visibleCategories = categories.slice((Math.min(categoryPage, categoryPages) - 1) * PAGE_SIZE, Math.min(categoryPage, categoryPages) * PAGE_SIZE);
	const targetCategory = uploadCategory || (categories.some(item => item.id === (kind === "gif" ? "facilities-gifs" : kind === "video" ? "videos" : kind === "image" ? "facilities-images" : "other")) ? (kind === "gif" ? "facilities-gifs" : kind === "video" ? "videos" : kind === "image" ? "facilities-images" : "other") : categories[0]?.id || "");
	const refresh = () => { setSelection([]); setRevision(value => value + 1); };
	const navigate = folderId => {
		if (operation.current) return;
		setSelection([]); setPreview(null); setSearch("");
		setQuery(old => ({ ...old, folderId, page: 1, search: "" }));
	};
	const changeQuery = values => {
		if (operation.current) return;
		setSelection([]); setPreview(null); setQuery(old => ({ ...old, ...values, page: values.page || 1 }));
	};
	useEffect(() => { mounted.current = true; setBrowserReady(true); return () => { mounted.current = false; operation.current?.abort(); }; }, []);
	useEffect(() => {
		operation.current?.abort(); setSelection([]); setClipboard(null); setDialog(null); setPreview(null); setMessage(""); setError(""); setResult(null);
	}, [token, permissionKey]);
	useEffect(() => { setQuery(old => ({ ...old, kind, page: 1 })); }, [kind]);
	const modalKind = dialog?.type || (preview ? "preview" : "");
	useEffect(() => {
		if (!modalKind || typeof document === "undefined") return;
		const modal = modalElement.current;
		if (!modal) return;
		const previous = document.activeElement;
		const focusable = () => Array.from(modal.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']"));
		focusable()[0]?.focus();
		const handleKey = event => {
			if (event.key === "Escape" && !operation.current) { event.preventDefault(); event.stopPropagation(); setDialog(null); setPreview(null); }
			if (event.key !== "Tab") return;
			const elements = focusable(), first = elements[0], last = elements[elements.length - 1];
			if (!first) { event.preventDefault(); return; }
			if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
			else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
		};
		modal.addEventListener("keydown", handleKey);
		return () => { modal.removeEventListener("keydown", handleKey); if (previous?.isConnected) previous.focus?.(); };
	}, [modalKind]);
	useEffect(() => {
		let current = true;
		if (token && access.read) getAdminMedia(token, { ...query, limit: PAGE_SIZE }).then(response => {
			if (!current) return;
			const last = Math.max(1, Math.ceil((response.total || 0) / PAGE_SIZE));
			if (query.page > last) { setQuery(old => ({ ...old, page: last })); return; }
			setResult({ key: requestKey, data: response });
		}).catch(failure => { if (current) setResult({ key: requestKey, error: failure }); });
		return () => { current = false; };
	}, [requestKey, access.read]);
	useEffect(() => { if (browserReady && data && apiRef.current) apiRef.current.exec("sort-files", { key: "serverOrder", order: "asc", path: page.currentPath, serverApplied: true }); }, [data, browserReady, page.currentPath]);
	const isCurrent = (op, auth) => mounted.current && operation.current === op && currentToken.current === auth && !op.signal.aborted;
	const run = async (fn, success, { upload = false } = {}) => {
		if (!token || operation.current || (upload ? !access.upload : !access.mutate && !access.restore)) return;
		const op = new AbortController(), auth = token;
		operation.current = op; setBusy(true); setError(""); setMessage("");
		try {
			const value = await fn(op, auth);
			if (isCurrent(op, auth)) { setMessage(typeof success === "function" ? success(value) : success); setDialog(null); refresh(); }
			return value;
		} catch (failure) { if (isCurrent(op, auth)) setError(explorerError(failure) + (failure.uploaded !== undefined ? ` 已完成 ${failure.uploaded} 个文件，已完成部分保留。` : "")); }
		finally { if (operation.current === op) { operation.current = null; if (mounted.current) { setBusy(false); setProgress(null); if (currentToken.current === auth) refresh(); } } }
	};
	const upload = async (directory = false, multiple = false) => {
		await run(async (op, auth) => {
			if (directory || multiple) {
				const batch = await pickAdminMediaBatch({ directory, kind: directory ? "" : kind || (query.kind === "folder" ? "" : query.kind) });
				if (!batch || !isCurrent(op, auth)) return null;
				const uploaded = await importAdminMediaBatch({ batch, parentId: query.folderId, categoryId: targetCategory, kind: directory ? "" : kind || (query.kind === "folder" ? "" : query.kind), signal: op.signal,
					createFolder: (name, parentId) => createAdminMediaFolder(auth, name, parentId), uploadFile: (file, options) => uploadAdminMedia(auth, file, options), onProgress: value => { if (isCurrent(op, auth)) setProgress(value); } });
				return `已上传 ${uploaded.uploaded} 个文件，新增 ${uploaded.createdFolders} 个文件夹。${batch.emptyFoldersUnavailable ? "浏览器没有提供空文件夹，可使用新建文件夹补建。" : ""}`;
			}
			const file = await pickAdminMedia(kind || (query.kind === "folder" ? "" : query.kind));
			if (!file || !isCurrent(op, auth)) return null;
			const metadata = validateAdminMedia(file, kind || (query.kind === "folder" ? "" : query.kind));
			const response = await uploadAdminMedia(auth, file.blob || file, { ...metadata, categoryId: targetCategory, folderId: query.folderId, signal: op.signal, onProgress: percent => { if (isCurrent(op, auth)) setProgress({ percent, name: metadata.name }); } });
			if (isCurrent(op, auth) && onSelect && mediaCanSelect(response.item, kind)) onSelect(response.item);
			return "文件已上传到后台现有云端存储；保存相应教学内容后 APP 才会更新。";
		}, value => value || "已取消选择。", { upload: true });
	};
	const chosen = context => {
		const item = context?.media || page.byPath.get(context?.id);
		return item && !selectedItems.some(value => value.id === item.id) ? [item] : selectedItems.length ? selectedItems : item ? [item] : [];
	};
	const putClipboard = (action, items = selectedItems) => {
		if (!access.mutate || !items.length) return;
		if (action === "copy" && items.some(item => item.canCopy === false)) { setError(explorerError(new Error("mediaCopyUnsupported"))); return; }
		setClipboard({ action, items: items.map(item => ({ ...item })) }); setMessage(`已${action === "copy" ? "复制" : "剪切"} ${items.length} 项。打开目标文件夹后点击粘贴。`);
	};
	const paste = target => {
		if (!access.mutate || !clipboard) return;
		const targetId = target?.kind === "folder" ? target.id : query.folderId;
		const saved = clipboard;
		return run(async (_op, auth) => {
			const response = await (saved.action === "copy" ? copyAdminMediaItems : moveAdminMediaItems)(auth, explorerReferences(saved.items), targetId);
			if (saved.action === "move" && currentToken.current === auth) setClipboard(null);
			return response;
		}, saved.action === "copy" ? "复制完成，原文件和 APP 引用保持不变。" : "移动完成，文件原地址及 APP 引用保持不变。");
	};
	const open = item => {
		if (!item || busy) return;
		if (item.kind === "folder") { if (!query.deleted) navigate(item.id); return; }
		if (onSelect && mediaCanSelect(item, kind)) {
			if (multiple) {
				const selectedPath = [...page.byPath].find(([, value]) => value.id === item.id)?.[0];
				if (selectedPath) setSelection(values => values.includes(selectedPath) ? values : [...values, selectedPath]);
			} else onSelect(item);
			return;
		}
		setPreview(item);
	};
	const requestDelete = (items = selectedItems) => { if (access.mutate && items.length) setDialog({ type: "delete", items }); };
	const download = item => { if (!access.read || busy || query.deleted || item?.source !== "upload") return; downloadAdminMedia(token, item).catch(failure => { if (mounted.current && currentToken.current === token) setError(explorerError(failure)); }); };
	const requestRename = item => { if (access.mutate && item) setDialog({ type: "rename", item, name: item.name, categoryId: item.categoryId || "" }); };
	const requestFolder = () => { if (access.mutate) setDialog({ type: "folder", name: "新建文件夹" }); };
	const restore = (items = selectedItems) => run(async (_op, auth) => { for (const item of items) await restoreAdminMediaItem(auth, explorerReferences([item])[0]); }, "已恢复所选内容。若上级也被删除，请先恢复上级文件夹。");
	const saveDialog = () => {
		if (!dialog) return;
		if (dialog.type === "delete") return run((_op, auth) => deleteAdminMediaItems(auth, explorerReferences(dialog.items)), "已移到回收站，可恢复；磁盘文件未永久删除。");
		if (dialog.type === "folder") return run((_op, auth) => createAdminMediaFolder(auth, dialog.name.trim(), query.folderId), "文件夹已创建。");
		if (dialog.type === "rename") return run((_op, auth) => dialog.item.kind === "folder" ? renameAdminMediaFolder(auth, dialog.item.id, dialog.name.trim()) : updateAdminMedia(auth, dialog.item.id, { name: dialog.name.trim(), categoryId: dialog.categoryId }), "名称和分类已保存，文件地址未改变。");
		if (dialog.type === "archive") return run((_op, auth) => updateAdminMedia(auth, dialog.item.id, { archived: !dialog.item.archived }), dialog.item.archived ? "已恢复为可用文件。" : "已归档，原文件保留。");
	};
	const selectAll = () => { const values = (data?.items || []).map(item => [...page.byPath].find(([, entry]) => entry.id === item.id)?.[0]).filter(Boolean); setSelection(values); apiRef.current?.exec("select-file", {}); for (const id of values) apiRef.current?.exec("select-file", { id, toggle: true }); };
	actions.current = { access, busy, page, query, navigate, refresh, open, download, requestDelete, requestRename, requestFolder, upload, putClipboard, paste, restore, chosen, selectedItems, setSelection, changeQuery };
	const init = useCallback(api => {
		apiRef.current = api;
		api.intercept("set-path", ({ id }) => { const current = actions.current; if (!current.busy && id !== current.page.currentPath) { const folder = current.page.byPath.get(id); if (id === "/" || folder?.kind === "folder") current.navigate(id === "/" ? "" : folder.id); } return false; });
		api.intercept("request-data", ({ id }) => { const current = actions.current; if (!current.busy) { const folder = current.page.byPath.get(id); if (folder?.kind === "folder" && id !== current.page.currentPath) current.navigate(folder.id); else current.refresh(); } return false; });
		api.intercept("open-tree-folder", ({ id, mode: expand }) => { const current = actions.current; const folder = current.page.byPath.get(id); if (expand && folder && id !== current.page.currentPath && api.getFile(id)?.lazy) { current.navigate(folder.id); return false; } });
		api.intercept("open-file", ({ id }) => { actions.current.open(actions.current.page.byPath.get(id)); return false; });
		api.intercept("download-file", ({ id }) => { actions.current.download(actions.current.page.byPath.get(id)); return false; });
		// All writes are confirmed by our authenticated API before reloading a page.
		// SVAR must never optimistically rename/delete local paths or upload bytes.
		for (const event of ["create-file", "rename-file", "delete-files", "copy-files", "move-files", "upload-file"]) api.intercept(event, () => false);
		api.intercept("filter-files", () => false);
		api.intercept("sort-files", ({ key, order, serverApplied }) => { if (serverApplied && key === "serverOrder") return; const current = actions.current; const sorting = explorerSort(key, order); if (sorting.sort !== current.query.sort || sorting.direction !== current.query.direction) current.changeQuery(sorting); return false; });
		api.intercept("set-mode", ({ mode: next }) => { if (next !== "cards" && next !== "table") return false; setMode(next); });
		api.on("select-file", () => { const state = api.getState(), next = [...(state.panels[state.activePanel || 0]?.selected || [])]; actions.current.setSelection(previous => [...previous.filter(id => next.includes(id)), ...next.filter(id => !previous.includes(id))]); });
	}, []);
	const menuOptions = useCallback((menu, context) => {
		const current = actions.current, item = context?.id === "/" ? { id: "", kind: "folder", name: "根目录" } : context?.media || current.page.byPath.get(context?.id);
		const option = (id, text, handler, icon = "") => ({ id, text, icon, handler });
		if (current.busy) return [];
		if (menu === "add") return [current.access.mutate && option("app-new-folder", "新建文件夹", () => current.requestFolder(), "wxi-folder"), current.access.upload && option("app-upload", "本地上传文件", () => current.upload(false, false), "wxi-upload")].filter(Boolean);
		if (current.query.deleted) return current.access.restore ? [option("app-restore", "恢复", () => current.restore(current.chosen(context)), "wxi-undo")] : [];
		if (menu === "body") return current.access.mutate ? [option("paste", "粘贴到当前文件夹", () => current.paste(), "wxi-content-paste"), option("app-new-folder", "新建文件夹", () => current.requestFolder(), "wxi-folder")] : [];
		const items = current.chosen(context);
		return [
			item && option("app-open", item.kind === "folder" ? "打开" : onSelect ? "选择 / 查看" : "预览 / 详情", () => current.open(item), "wxi-eye"),
			current.access.mutate && items.length > 0 && items.every(value => value.canCopy !== false) && option("app-copy", "复制", () => current.putClipboard("copy", current.chosen(context)), "wxi-content-copy"),
			current.access.mutate && items.length > 0 && option("app-cut", "剪切", () => current.putClipboard("move", current.chosen(context)), "wxi-content-cut"),
			current.access.mutate && option("paste", "粘贴", () => current.paste(item?.kind === "folder" ? item : null), "wxi-content-paste"),
			current.access.mutate && item && item.id !== "/" && option("app-rename", "重命名 / 分类", () => current.requestRename(item), "wxi-edit"),
			current.access.mutate && items.length > 0 && !items.some(value => value.isReferenced) && option("app-delete", "移到回收站", () => current.requestDelete(current.chosen(context)), "wxi-delete"),
			!onSelect && item?.source === "upload" && option("app-download", "下载到电脑", () => current.download(item), "wxi-download"),
		].filter(Boolean);
	}, [onSelect]);
	const keyDown = event => {
		if (dialog || preview || busy || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName) || event.target?.isContentEditable) return;
		const key = event.key.toLowerCase(), modified = event.ctrlKey || event.metaKey;
		if ((modified && ["a", "c", "x", "v"].includes(key)) || ["delete", "f2"].includes(key)) {
			event.preventDefault(); event.stopPropagation();
			if (key === "a") selectAll();
			else if (key === "c") putClipboard("copy");
			else if (key === "x") putClipboard("move");
			else if (key === "v") paste();
			else if (key === "delete") requestDelete();
			else if (key === "f2" && selectedItems.length === 1) requestRename(selectedItems[0]);
		}
	};
	const panels = useMemo(() => [{ path: page.currentPath, selected: [] }], [page.currentPath, requestKey]);
	const prepareTablePointer = event => {
		if (mode !== "table" || busy || loading || event.button !== 0) return;
		const target = event.target;
		if (target?.closest?.("input,textarea,select,button,a,[contenteditable='true'],[draggable-data],.wx-grip")) return;
		const cell = target?.closest?.(".wx-body [role='gridcell']");
		const grid = cell?.closest?.(".wx-table-box[role='grid']");
		if (!grid || !event.currentTarget.contains(grid)) return;
		// SVAR focuses the entire grid on mousedown without preventScroll. In a
		// nested admin ScrollView this can move a different row under the pointer
		// before mouseup. Pre-focus the same node without scrolling; SVAR retains
		// ownership of selection, Ctrl/Shift modifiers, sorting and double-click.
		grid.focus({ preventScroll: true });
	};
	// Native-web Modal/ScrollView ancestors can transform or clip fixed children.
	// Mount overlays directly on body so viewport centering remains independent.
	const portal = content => browserReady && typeof document !== "undefined" ? createPortal(content, document.body) : null;
	if (!token || !access.read) return <p role="alert">请登录具有文件库访问权限的后台账号。</p>;
	return <section ref={rootElement} className="of-media-explorer" onKeyDownCapture={keyDown} onMouseOver={event => { const label = event.target?.closest?.(".wx-name"); if (label) label.title = label.textContent?.trim() || ""; }} aria-label={onSelect ? "选择媒体文件" : "文件存储"}>
		<style>{EXPLORER_CSS + LOCAL_EXPLORER_ICON_CSS}</style>
		<header className="of-media-heading"><div><h2>{onSelect ? "选择媒体文件" : "文件存储"}</h2><p>后台现有云端存储 · 双击打开，右键操作；Ctrl / Shift 多选。整理目录不会更改 APP 的视频地址。</p></div><Action testId="media-refresh" onClick={refresh} disabled={busy}>刷新</Action></header>
		<div className="of-media-toolbar">
			<Action testId="media-view-table" aria-pressed={mode === "table"} disabled={busy} onClick={() => setMode("table")}>☷ 列表</Action><Action testId="media-view-cards" aria-pressed={mode === "cards"} disabled={busy} onClick={() => setMode("cards")}>▦ 图标</Action>
			{access.manage && !onSelect && <Action testId="media-folder-create" disabled={!access.mutate || loading} onClick={requestFolder}>＋ 新建文件夹</Action>}
			{access.manage && !onSelect && <Action testId="media-upload-toggle" primary disabled={busy || query.deleted} onClick={() => setUploadOpen(value => !value)}>↑ 本地上传</Action>}
			{!onSelect && access.manage && <><Action testId="media-copy" disabled={!access.mutate || !selectedItems.length || selectedItems.some(item => item.canCopy === false)} onClick={() => putClipboard("copy")}>复制</Action><Action testId="media-cut" disabled={!access.mutate || !selectedItems.length} onClick={() => putClipboard("move")}>剪切</Action><Action testId="media-paste" disabled={!access.mutate || !clipboard} onClick={() => paste()}>粘贴{clipboard ? `（${clipboard.items.length}）` : ""}</Action><Action testId="media-rename" disabled={!access.mutate || selectedItems.length !== 1} onClick={() => requestRename(selectedItems[0])}>重命名</Action><Action testId="media-delete-selected" disabled={!access.mutate || !selectedItems.length || selectedItems.some(item => item.isReferenced)} onClick={() => requestDelete()}>删除</Action><Action testId="media-trash" disabled={busy} onClick={() => { setSearch(""); changeQuery({ deleted: !query.deleted, archived: false, folderId: "", search: "" }); }}>{query.deleted ? "返回文件库" : "回收站"}</Action></>}
		</div>
		{!onSelect && uploadOpen && !query.deleted && <div className="of-media-upload"><strong>从电脑导入 → 当前文件夹</strong><p>图片 / GIF 最大 12 MB；视频和其他文件最大 250 MB。保留文件夹层级，不覆盖同名文件。</p><label>上传分类 <select aria-label="上传分类" value={targetCategory} onChange={event => setUploadCategory(event.target.value)} disabled={busy}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><div className="of-media-toolbar"><Action testId="media-upload-file" primary disabled={!access.upload || loading} onClick={() => upload()}>选择本地文件</Action>{access.manage && !onSelect && <><Action testId="media-upload-multiple" disabled={!access.upload || loading} onClick={() => upload(false, true)}>多选文件上传</Action><Action testId="media-upload-directory" disabled={!access.upload || loading} onClick={() => upload(true, true)}>上传整个文件夹</Action></>}{busy && <Action testId="media-upload-cancel" onClick={() => operation.current?.abort()}>取消</Action>}</div>{progress && <div role="status"><progress value={progress.percent || 0} max="100" /> {progress.percent || 0}% {progress.uploaded !== undefined ? ` · ${progress.uploaded} / ${progress.total}` : ""} {progress.name}</div>}</div>}
		<div className="of-media-filters"><form onSubmit={event => { event.preventDefault(); changeQuery({ search: search.trim() }); }}><input aria-label="按文件名称搜索" placeholder="搜索所有文件夹" value={search} onChange={event => setSearch(event.target.value)} disabled={busy} /><Action testId="media-search-submit" disabled={busy} onClick={() => changeQuery({ search: search.trim() })}>搜索</Action></form>{!kind && <select aria-label="文件类型" value={query.kind} onChange={event => changeQuery({ kind: event.target.value })} disabled={busy}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<select aria-label="文件分类" value={query.categoryId} onChange={event => changeQuery({ categoryId: event.target.value })} disabled={busy}><option value="">全部分类</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select aria-label="排序方式" value={query.sort} onChange={event => changeQuery({ sort: event.target.value })} disabled={busy}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Action testId="media-sort-direction" disabled={busy} onClick={() => changeQuery({ direction: query.direction === "asc" ? "desc" : "asc" })}>{query.direction === "asc" ? "↑ 升序" : "↓ 降序"}</Action>{access.manage && !onSelect && !query.deleted && <label><input type="checkbox" checked={query.archived} disabled={busy} onChange={event => changeQuery({ archived: event.target.checked })} /> 已归档</label>}</div>
		{(error || active?.error) && <p className="of-media-error" role="alert">{error || explorerError(active.error)}</p>}{message && <p className="of-media-message" role="status">{message}</p>}
		<div className="of-media-breadcrumb" aria-label="当前路径"><Action testId="media-root" disabled={busy} onClick={() => navigate("")}>{query.deleted ? "回收站" : "根目录"}</Action>{(data?.trail || []).map(folder => <React.Fragment key={folder.id}><span>›</span><Action onClick={() => navigate(folder.id)} disabled={busy}>{folder.name}</Action></React.Fragment>)}</div>
		<div className={`of-media-manager${!access.mutate && !access.upload ? " readonly" : ""}`} aria-busy={busy || loading} onMouseDownCapture={prepareTablePointer}>
			{browserReady && <Locale words={WORDS}><Willow fonts={false}><Filemanager key={token} init={init} data={page.data} panels={panels} mode={mode} readonly={false} menuOptions={menuOptions} icons={localExplorerFileIcon} previews={file => file.media?.kind === "image" && !file.media.deletedAt ? resolveApiAssetUrl(file.media.url) : null} /></Willow></Locale>}
			{(loading || busy) && <div className="of-media-cover" role="status">{loading ? "正在读取文件库…" : progress ? "正在上传，请勿关闭页面…" : "正在处理…"}</div>}
		</div>
		<footer className="of-media-footer"><div><Action testId="media-select-all" disabled={loading || busy} onClick={selectAll}>全选本页</Action><span> 已选择 {selectedItems.length} 项 · 共 {data?.total || 0} 项</span></div><div className="of-media-toolbar"><Action testId="media-previous" disabled={loading || busy || query.page <= 1} onClick={() => changeQuery({ page: query.page - 1 })}>上一页</Action><span>第 {query.page} / {totalPages} 页 · 每页 {PAGE_SIZE} 项</span><Action testId="media-next" disabled={loading || busy || !data || query.page >= totalPages} onClick={() => changeQuery({ page: query.page + 1 })}>下一页</Action></div></footer>
		{onSelect && <div className="of-media-choice"><span>{multiple ? `已选择 ${selectedItems.length} 项，请确认所选均为可用文件` : selectedItem?.name || (kind === "gif" ? "请选择可用的 GIF 动画" : kind === "video" ? "请选择可用的视频" : "请选择可用的媒体文件")}</span><Action testId="media-use-selected" primary disabled={(multiple ? !selectableBatch : !selectedItem) || busy || loading} onClick={() => onSelect(multiple ? selectedItems : selectedItem)}>{multiple ? '使用所选文件' : '使用此文件'}</Action></div>}
		{!onSelect && selectedItems.length > 0 && <div className="of-media-selection-details"><strong>{selectedItems.length === 1 ? selectedItems[0].name : `已选择 ${selectedItems.length} 项`}</strong>{selectedItems.length === 1 && <p>{selectedItems[0].kind === "folder" ? "文件夹" : `${selectedItems[0].categoryName || "未分类"} · ${mediaSizeLabel(selectedItems[0].size)}`}{selectedItems[0].isReferenced ? " · APP 正在使用（不可删除）" : ""}{selectedItems[0].source === "youtube" ? " · 历史 YouTube 引用" : ""}</p>}<div className="of-media-toolbar">{query.deleted ? <Action disabled={!access.restore} onClick={() => restore()}>恢复所选</Action> : selectedItems.length === 1 && <><Action onClick={() => open(selectedItems[0])} disabled={busy}>打开 / 预览</Action>{selectedItems[0].source === "upload" && <Action onClick={() => download(selectedItems[0])} disabled={busy}>下载到电脑</Action>}{access.mutate && selectedItems[0].kind !== "folder" && (!selectedItems[0].isReferenced || selectedItems[0].archived) && <Action onClick={() => setDialog({ type: "archive", item: selectedItems[0] })}>{selectedItems[0].archived ? "恢复可用" : "归档"}</Action>}</>}</div></div>}
		{access.manage && !onSelect && <details className="of-media-categories"><summary>文件分类管理</summary><p>分类不改变文件夹和文件地址；每页最多 {PAGE_SIZE} 个分类。</p><div className="of-media-toolbar"><Action onClick={() => { setCategoryEdit(""); setCategoryName(""); }} disabled={busy}>新增分类</Action>{visibleCategories.map(category => <Action key={category.id} onClick={() => { setCategoryEdit(category.id); setCategoryName(category.name); }} disabled={busy}>{category.name}</Action>)}</div><div className="of-media-toolbar"><Action disabled={categoryPage <= 1 || busy} onClick={() => setCategoryPage(value => value - 1)}>上一页分类</Action><span>{Math.min(categoryPage, categoryPages)} / {categoryPages}</span><Action disabled={categoryPage >= categoryPages || busy} onClick={() => setCategoryPage(value => value + 1)}>下一页分类</Action></div><form onSubmit={event => { event.preventDefault(); if (!categoryName.trim()) return; run((_op, auth) => categoryEdit ? updateAdminMediaCategory(auth, categoryEdit, categoryName.trim()) : createAdminMediaCategory(auth, categoryName.trim()), "分类已保存。"); }}><input aria-label="分类名称" value={categoryName} maxLength={80} onChange={event => setCategoryName(event.target.value)} disabled={busy} /><button className="of-media-button" type="submit" disabled={!categoryName.trim() || busy || query.deleted}>保存分类</button></form></details>}
		{dialog && portal(<div className="of-media-explorer of-media-dialog-backdrop"><section ref={modalElement} className="of-media-dialog" role="dialog" aria-modal="true" aria-label={dialog.type === "delete" ? "确认移到回收站" : "修改文件资料"}><h3>{dialog.type === "delete" ? "移到回收站" : dialog.type === "folder" ? "新建文件夹" : dialog.type === "archive" ? "确认归档状态" : "重命名 / 分类"}</h3>{["rename", "folder"].includes(dialog.type) && <label>名称<input autoFocus value={dialog.name} maxLength={200} onChange={event => setDialog(old => ({ ...old, name: event.target.value }))} disabled={busy} aria-label="文件或文件夹名称" /></label>}{dialog.type === "rename" && dialog.item.kind !== "folder" && <label>分类<select value={dialog.categoryId} onChange={event => setDialog(old => ({ ...old, categoryId: event.target.value }))} disabled={busy}>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}{dialog.type === "delete" && <p>将所选 {dialog.items.length} 项及文件夹内全部内容移到回收站，可恢复。任何内容仍被 APP 使用时，整批删除会被阻止。不会永久删除磁盘文件。</p>}{dialog.type === "archive" && <p>仅修改可用状态，保留原始文件和地址。</p>}<div className="of-media-toolbar"><Action disabled={busy} onClick={() => setDialog(null)}>取消</Action><Action testId="media-dialog-confirm" primary disabled={busy || (["rename", "folder"].includes(dialog.type) && !dialog.name.trim())} onClick={saveDialog}>确认</Action></div>{error && <p className="of-media-error" role="alert">{error}</p>}</section></div>)}
		{preview && portal(<div className="of-media-explorer of-media-dialog-backdrop"><section ref={modalElement} className="of-media-dialog preview" role="dialog" aria-modal="true" aria-label="文件预览"><header className="of-media-heading"><h3>{preview.name}</h3><Action onClick={() => setPreview(null)}>关闭</Action></header>{preview.kind === "video" && mediaCanSelect(preview, "video") ? <MediaVideo source={preview.url} title={preview.name} locale="zh" maxViewportHeight={65} /> : preview.kind === "image" && mediaCanSelect(preview, "image") ? <img src={resolveApiAssetUrl(preview.url)} alt={preview.name} className="of-media-image" /> : <p>此文件不在浏览器内执行。{preview.source === "youtube" ? "历史 YouTube 引用已保留，不能作为新上传视频选用。" : "仅限后台授权下载查看。"}</p>}<p>{preview.categoryName || "未分类"} · {mediaSizeLabel(preview.size)}{preview.isReferenced ? " · APP 正在使用" : ""}</p>{preview.source === "upload" && !query.deleted && <Action onClick={() => download(preview)}>下载到电脑</Action>}</section></div>)}
	</section>;
}

const EXPLORER_CSS = `
.of-media-explorer{font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#282c34;min-width:0;width:100%;font-size:14px;line-height:1.5}
.of-media-explorer *{box-sizing:border-box}.of-media-explorer h2{font-size:22px;margin:0}.of-media-explorer h3{font-size:18px;margin:0 0 12px}.of-media-explorer p{margin:6px 0 12px;color:#616975;overflow-wrap:anywhere}
.of-media-heading,.of-media-toolbar,.of-media-filters,.of-media-footer,.of-media-breadcrumb,.of-media-choice{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.of-media-heading,.of-media-footer,.of-media-choice{justify-content:space-between}.of-media-heading{margin-bottom:12px}.of-media-heading>div{flex:1;min-width:180px}
.of-media-button{font:inherit;background:#fff;border:1px solid #d6dbe2;border-radius:7px;color:#343944;padding:8px 12px;min-height:36px;cursor:pointer;white-space:normal}.of-media-button:hover:not(:disabled){background:#f6f0f1;border-color:#840b1c}.of-media-button.primary{color:#fff;background:#840b1c;border-color:#840b1c}.of-media-button.primary:hover:not(:disabled){background:#650b17}.of-media-button:disabled{opacity:.45;cursor:not-allowed}.of-media-button:focus-visible,.of-media-explorer input:focus-visible,.of-media-explorer select:focus-visible{outline:3px solid #c7929b;outline-offset:2px}
.of-media-filters{margin:12px 0}.of-media-explorer form{display:flex;gap:8px;flex-wrap:wrap}.of-media-filters form{flex:1;min-width:220px}.of-media-explorer input:not([type=checkbox]),.of-media-explorer select{font:inherit;max-width:100%;min-height:38px;border:1px solid #d6dbe2;border-radius:7px;padding:8px;background:#fff;color:#333}.of-media-filters input:not([type=checkbox]){flex:1;min-width:100px}.of-media-filters select{max-width:170px}.of-media-explorer label{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.of-media-upload,.of-media-categories,.of-media-selection-details{padding:14px;border:1px solid #e1e4e9;border-radius:8px;background:#fafbfc;margin-top:12px}.of-media-upload .of-media-toolbar{margin-top:10px}.of-media-upload progress{width:180px}.of-media-breadcrumb{margin:10px 0}.of-media-breadcrumb .of-media-button{padding:3px 8px;min-height:30px;border-color:transparent;background:transparent}.of-media-manager{height:560px;min-height:400px;position:relative;border:1px solid #d6dbe2;border-radius:8px;overflow:hidden}.of-media-manager>.wx-willow-theme,.of-media-manager>div{height:100%}.of-media-manager .wx-filemanager{height:100%;--wx-color-primary:#840b1c;--wx-color-primary-hover:#650b17}.of-media-manager .wx-search-input{display:none}.of-media-manager .wx-modes button:last-child{display:none}.of-media-manager .wx-table .wx-cell{font-size:14px}.of-media-manager .wx-card{min-width:140px}.of-media-cover{position:absolute;inset:0;background:#ffffffc9;display:flex;align-items:center;justify-content:center;z-index:10;font-weight:600;pointer-events:all}.of-media-footer{padding:12px 0;color:#616975}.of-media-footer>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.of-media-choice{padding:12px;background:#f8edef;border-radius:8px}.of-media-choice span{overflow-wrap:anywhere;flex:1;min-width:150px}.of-media-error{color:#8e1328!important;background:#fff0f1;padding:10px;border-radius:7px}.of-media-message{color:#256445!important;background:#eff9f2;padding:10px;border-radius:7px}
.of-media-manager .wx-modes{display:none}.of-media-manager.readonly .wx-sidebar .wx-button{display:none}.of-media-dialog-backdrop{position:fixed;inset:0;background:#17202c75;display:flex;align-items:center;justify-content:center;z-index:100000;padding:20px}.of-media-dialog{width:520px;max-width:100%;max-height:85vh;overflow:auto;background:#fff;border-radius:12px;padding:22px;box-shadow:0 20px 70px #0003}.of-media-dialog.preview{width:840px}.of-media-dialog label{display:block;margin-bottom:14px}.of-media-dialog label input,.of-media-dialog label select{display:block;width:100%;margin-top:6px}.of-media-dialog .of-media-toolbar{justify-content:flex-end;margin-top:16px}.of-media-image{display:block;width:100%;max-height:65vh;object-fit:contain}.of-media-categories summary{cursor:pointer;font-weight:600}.of-media-categories .of-media-toolbar,.of-media-categories form{margin-top:10px}
@media(max-width:680px){.of-media-manager{height:500px}.of-media-filters select{flex:1;max-width:none}.of-media-dialog-backdrop{padding:10px}.of-media-dialog{padding:16px}.of-media-heading h2{font-size:20px}}
.of-media-manager .wx-tree .wx-name{white-space:normal;overflow:visible;overflow-wrap:anywhere;text-overflow:clip;min-width:0;line-height:1.35}.of-media-manager .wx-tree .wx-folder{min-height:34px;height:auto;align-items:flex-start;padding-top:6px;padding-bottom:6px}.of-media-manager .wx-tree i.wxi-folder{color:#b58a2b}.of-media-manager .wx-tree i::before{width:18px;height:18px;min-width:18px}.of-media-manager .wx-tree .wx-toggle{margin-top:1px}
/* Use the available content-column width, including inside media pickers.
   Keep the folder tree and table intact; only their frame scrolls sideways. */
.of-media-explorer{max-width:100%;box-sizing:border-box}
.of-media-explorer:not(.of-media-dialog-backdrop){background:#fff}
.of-media-heading,.of-media-toolbar,.of-media-filters,.of-media-footer,.of-media-breadcrumb,.of-media-choice,.of-media-explorer form{min-width:0;max-width:100%}
.of-media-heading>div{flex:1 1 180px;min-width:0;max-width:100%}
.of-media-heading h2,.of-media-heading h3,.of-media-selection-details strong,.of-media-upload [role=status]{overflow-wrap:anywhere;min-width:0;max-width:100%}
.of-media-button{min-width:0;max-width:100%;min-height:44px;overflow-wrap:anywhere;flex-shrink:1}
.of-media-filters form{flex:1 1 220px;min-width:0;max-width:100%}
.of-media-explorer input:not([type=checkbox]),.of-media-explorer select{min-width:0}
.of-media-filters input:not([type=checkbox]){flex:1 1 140px;min-width:0;max-width:100%}
.of-media-filters select{flex:1 1 140px;max-width:min(170px,100%)}
.of-media-upload progress{max-width:100%}
.of-media-footer>div{min-width:0;max-width:100%}
.of-media-choice span{flex:1 1 150px;min-width:0;max-width:100%}
.of-media-manager{width:100%;max-width:100%;min-width:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain}
.of-media-manager>.wx-willow-theme{min-width:720px}
.of-media-manager .wx-filemanager{min-width:720px;max-width:none}
.of-media-manager>.of-media-cover{min-width:720px}
`;
