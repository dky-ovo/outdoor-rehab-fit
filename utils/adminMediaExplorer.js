import { mediaCanSelect, mediaErrorMessage } from "./adminMedia";

export const MEDIA_EXPLORER_PAGE_SIZE = 20;
const READ_PERMISSIONS = ["app_maintenance.files.manage", "app_maintenance.equipment.manage", "app_maintenance.home.manage"];

export function explorerPermissions(permissions = [], { picker = false, deleted = false, busy = false } = {}) {
	const read = READ_PERMISSIONS.some(permission => permissions.includes(permission));
	const manage = permissions.includes(READ_PERMISSIONS[0]);
	return { read, manage, upload: !busy && !deleted && (manage || (picker && read)), mutate: !busy && !deleted && manage && !picker, restore: !busy && deleted && manage && !picker };
}

export function explorerSelection(items, kind = "") {
	return items.length === 1 && mediaCanSelect(items[0], kind) ? items[0] : null;
}

export function explorerReferences(items = []) {
	return items.map(item => ({ id: item.id, kind: item.kind === "folder" ? "folder" : "file" }));
}

function segment(name) {
	const text = String(name || "未命名").replace(/[\/\\\u0000-\u001f\u007f]/g, "＿");
	return [".", ".."].includes(text) ? `文件${text}` : text;
}

// SVAR IDs are display paths, whereas our API uses immutable UUIDs. Never send
// display paths to the server. Only the current server page is materialized;
// ancestors supply the breadcrumb/tree, not hidden file pages.
export function buildExplorerPage(result = {}) {
	const data = [], byPath = new Map(), folderPaths = new Map([["", "/"]]);
	let path = "";
	for (const folder of result.trail || []) {
		path += `/${segment(folder.name)}`;
		const item = { ...folder, kind: "folder", folderId: folder.parentId || "" };
		data.push({ id: path, type: "folder", date: new Date(0), open: true, media: item });
		byPath.set(path, item); folderPaths.set(folder.id, path);
	}
	const currentPath = path || "/";
	const names = new Map();
	for (const item of result.items || []) names.set(segment(item.name), (names.get(segment(item.name)) || 0) + 1);
	const usedLabels = new Set();
	for (const [serverOrder, item] of (result.items || []).entries()) {
		const name = segment(item.name);
		// Same-name uploads are never overwritten. The short label distinguishes
		// duplicates on a page; all actions still bind the exact immutable ID.
		let label = name;
		if (names.get(name) > 1 || usedLabels.has(label)) {
			const base = `${name}〔${item.id}〕`;
			label = base; let suffix = 2;
			while (names.has(label) || usedLabels.has(label)) label = `${base} (${suffix++})`;
		}
		usedLabels.add(label);
		const id = `${currentPath === "/" ? "" : currentPath}/${label}`;
		const stamp = new Date(item.modifiedAt || item.updatedAt || item.createdAt || 0);
		data.push({ id, type: item.kind === "folder" ? "folder" : "file", size: Number(item.size) || 0, date: Number.isNaN(stamp.getTime()) ? new Date(0) : stamp, lazy: item.kind === "folder", serverOrder, media: item });
		byPath.set(id, item);
		if (item.kind === "folder") folderPaths.set(item.id, id);
	}
	return { data, byPath, folderPaths, currentPath };
}

export function explorerSort(key, direction = "asc") {
	return { sort: ({ name: "name", size: "size", date: "modified", ext: "kind", type: "kind", created: "created" })[key] || "name", direction: direction === "desc" ? "desc" : "asc", page: 1 };
}

export function explorerError(error) {
	const code = error?.code || error?.message;
	if (code === "mediaCopyUnsupported") return "所选内容包含历史外部链接，不能复制。可以移动或使用本地文件替换；本次未复制任何内容。";
	if (["mediaDestinationConflict", "mediaNameConflict"].includes(code)) return "目标目录已有同名内容，请重命名或选择其他目录，不会覆盖原文件。";
	if (["mediaFolderCycle", "mediaInvalidDestination", "invalidMediaDestination"].includes(code)) return "不能把文件夹复制或移动到自身或其子目录，请选择其他位置。";
	if (["mediaOperationTooLarge", "mediaSelectionTooLarge", "mediaCopyTooLarge"].includes(code)) return "本次操作的文件较多或总大小过大，请分批操作。";
	if (code === "mediaFolderTooDeep") return "目标文件夹层级过深，请选择上一级目录。";
	if (code === "mediaStorageFull") return "服务器存储空间不足，请联系管理员；原文件未删除。";
	if (code === "mediaChangedDuringCopy") return "复制期间文件已被其他操作修改，请刷新后重试。";
	if (code === "tooManyMediaCopies") return "服务器正在处理其他复制任务，请稍后重试。";
	return mediaErrorMessage(error);
}
