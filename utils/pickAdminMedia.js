import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { mediaAccept, validateAdminMedia } from "./adminMedia";

export function normalizeStorageRelativePath(value) {
	const parts = String(value || "").split("/");
	if (!parts.length || parts.length > 33 || parts.some(part => !part || part.length > 200 || part !== part.trim() || /[\\\u0000-\u001f\u007f]/.test(part) || [".",".."].includes(part))) throw new Error("invalidFolderPath");
	return parts.join("/");
}

// Directory names are logical metadata, never filesystem paths on the server.
// The modern desktop picker includes empty folders; webkitdirectory falls back
// to deriving non-empty folders, while the UI can create any empty folder.
export async function pickAdminMediaBatch({ kind = "", directory = false } = {}) {
	if (Platform.OS !== "web") throw new Error("folderUploadRequiresDesktop");
	if (directory && typeof window.showDirectoryPicker === "function") {
		let root;
		try { root = await window.showDirectoryPicker({ mode: "read" }); }
		catch (error) { if (error?.name === "AbortError") return null; throw error; }
		const files = [], folders = [];
		const read = async (handle, relativePath) => {
			normalizeStorageRelativePath(relativePath);
			if (relativePath.split("/").length > 32 || files.length + folders.length >= 10000) throw new Error("invalidFolderPath");
			folders.push(relativePath);
			for await (const entry of handle.values()) {
				if (entry.name.startsWith("._") || entry.name === ".DS_Store") continue;
				const entryPath = normalizeStorageRelativePath(`${relativePath}/${entry.name}`);
				if (entry.kind === "directory") await read(entry,entryPath);
				else if (entry.kind === "file") files.push({ file:await entry.getFile(),relativePath:entryPath });
				if (files.length + folders.length > 10000) throw new Error("invalidFolderPath");
			}
		};
		await read(root,root.name);
		return {files,folders};
	}
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file"; input.accept = directory ? "" : mediaAccept(kind); input.multiple = true;
		if (directory) input.setAttribute("webkitdirectory", "");
		input.style.display = "none";
		let finished = false, focusTimer;
		const finish = () => {
			if (finished) return; finished = true; clearTimeout(focusTimer); window.removeEventListener("focus",onFocus);
			const files = Array.from(input.files || []).filter(file=>!file.name.startsWith("._") && file.name !== ".DS_Store").map(file=>({file,relativePath:file.webkitRelativePath || file.name}));
			input.remove();
			resolve(files.length ? {files,folders:[],emptyFoldersUnavailable:directory} : null);
		};
		const onFocus = () => { focusTimer = setTimeout(finish,1200); };
		input.onchange = finish; input.oncancel = finish; window.addEventListener("focus",onFocus,{once:true});
		document.body.appendChild(input); input.click();
	});
}

export async function pickAdminMedia(kind = "") {
	if (Platform.OS === "web") {
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file"; input.accept = mediaAccept(kind);
			input.style.display = "none";
			let finished = false; let focusTimer;
			const finish = (file) => {
				if (finished) return;
				finished = true; clearTimeout(focusTimer);
				window.removeEventListener("focus", onFocus);
				input.remove(); resolve(file || null);
			};
			const onFocus = () => { focusTimer = setTimeout(() => finish(input.files?.[0]), 1200); };
			input.onchange = () => finish(input.files?.[0]);
			input.oncancel = () => finish(null);
			window.addEventListener("focus", onFocus, { once: true });
			document.body.appendChild(input); input.click();
		});
	}
	const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
	if (!permission.granted) throw new Error("mediaPermissionDenied");
	const result = await ImagePicker.launchImageLibraryAsync({
		mediaTypes: kind === "video" ? ["videos"] : kind === "image" || kind === "gif" ? ["images"] : ["images", "videos"],
		quality: 1, allowsEditing: false,
	});
	if (result.canceled || !result.assets?.[0]) return null;
	const asset = result.assets[0];
	// Reject known oversized files before loading the bytes into native memory.
	if (asset.fileSize) {
		const file = { name: asset.fileName || "upload", type: asset.mimeType, size: asset.fileSize };
		validateAdminMedia(file, kind);
		// React Native's XHR accepts a URI body and streams it through native
		// networking; avoid materializing a large video as a JavaScript Blob.
		return { ...file, blob: { uri: asset.uri } };
	}
	const blob = await (await fetch(asset.uri)).blob();
	return { blob, name: asset.fileName || "upload", type: asset.mimeType || blob.type, size: asset.fileSize || blob.size };
}
