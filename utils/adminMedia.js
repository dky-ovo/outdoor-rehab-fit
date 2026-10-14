export const ADMIN_MEDIA_LIMITS = { image: 12 * 1024 * 1024, video: 250 * 1024 * 1024, file: 250 * 1024 * 1024 };
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function mediaAccept(kind = "") {
	return kind === "gif" ? ".gif,image/gif" : kind === "video" ? ".mp4,.m4v,.mov,.webm,video/mp4,video/quicktime,video/webm" : kind === "image" ? ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif" : "";
}

export function mediaMimeType(file) {
	const supplied = String(file?.type || file?.mimeType || "").toLowerCase();
	if ([...IMAGE_TYPES, ...VIDEO_TYPES].includes(supplied)) return supplied;
	const extension = String(file?.name || file?.fileName || "").split(".").pop().toLowerCase();
	return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" }[extension] || supplied || "application/octet-stream";
}

export function validateAdminMedia(file, kind = "") {
	const mimeType = mediaMimeType(file);
	const size = Number(file?.size ?? file?.fileSize);
	const isVideo = VIDEO_TYPES.includes(mimeType);
	const isImage = IMAGE_TYPES.includes(mimeType), type = isVideo ? "video" : isImage ? "image" : "file";
	if ((kind === "video" && !isVideo) || (kind === "image" && !isImage) || (kind === "gif" && mimeType !== "image/gif") || (kind === "file" && type !== "file")) throw new Error("unsupportedMediaType");
	if (!Number.isFinite(size) || size < 0 || (size === 0 && type !== "file")) throw new Error("emptyMediaFile");
	if (size > ADMIN_MEDIA_LIMITS[type]) throw new Error("mediaFileTooLarge");
	const name = String(file?.name || file?.fileName || "upload");
	if (!name || name.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(name) || [".",".."].includes(name) || name !== name.trim()) throw new Error("invalidStorageName");
	return { mimeType, size, kind: type, name };
}

export function mediaCanSelect(item, kind = "") {
	// Documents stay private attachments; only the explicit Word-import picker
	// can select them. Never expose arbitrary files as public media.
	if (kind === "file") return Boolean(item?.id && item.kind === "file" && item.source === "upload" && !item.archived && !item.deletedAt && /\.docx$/i.test(item.name || "") && Number(item.size) > 0 && Number(item.size) <= 12 * 1024 * 1024);
	if (!item?.url || item.archived || item.deletedAt || item.kind === "folder" || item.kind === "file" || item.selectable === false) return false;
	return kind === "gif" ? item.mimeType === "image/gif" : !kind || item.kind === kind;
}

export function mediaSizeLabel(size) {
	if (!Number.isFinite(Number(size)) || size === null) return "外部引用";
	return Number(size) >= 1024 * 1024 ? `${(Number(size) / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(Number(size) / 1024)} KB`;
}

export function mediaErrorMessage(error) {
	const code = error?.code || error?.message;
	if (error?.status === 401 || error?.status === 403) return "当前账号没有文件上传或访问权限，请联系管理员。";
	if (code === "mediaCategoryExists") return "分类名称已存在，请使用现有分类或换一个名称。";
	if (["mediaCategoryNotFound", "invalidMediaMetadata"].includes(code)) return "文件名称或分类已失效，请刷新文件库并重新选择分类。";
	if (code === "invalidMediaCategory") return "请填写 1 至 80 个字符的分类名称。";
	if (code === "invalidStorageName") return "名称应为 1 至 200 个字符，不能包含斜杠、控制字符或单独的点。";
	if (code === "mediaFolderNotFound") return "文件夹已删除或路径层级过深，请刷新后重新选择。";
	if (code === "mediaFolderExists") return "原位置已有同名文件夹，请先处理同名文件夹再恢复。";
	if (code === "restoreParentFolderFirst") return "请先在回收站恢复上级文件夹，再恢复此文件。";
	if (code === "folderUploadRequiresDesktop") return "任意文件和文件夹上传请使用电脑浏览器；手机可上传相册中的图片和视频。";
	if (code === "invalidFolderPath") return "文件夹路径不正确、层级超过 32 级，或包含无法导入的系统文件。";
	if (error?.status === 404) return "服务器尚未提供文件库，请先部署本次后台更新。";
	if (error?.status === 409) return "此文件仍被 APP 内容使用，不能归档或删除。请先更换相关内容的文件。";
	if (error?.status === 413 || ["mediaFileTooLarge", "fileTooLarge"].includes(code)) return "文件过大：图片及 GIF 不超过 12 MB，视频及其他文件不超过 250 MB。";
	if (code === "uploadCancelled") return "已取消上传。如果文件已传完，可刷新文件库确认；不会自动修改 APP 内容。";
	if (error?.status === 415 || ["unsupportedMediaType", "invalidMediaType", "invalidMedia", "invalidMediaSignature", "emptyMediaFile"].includes(code)) return "文件格式或内容不正确，请选择 JPG、PNG、WebP、GIF 或 MP4/MOV/WebM 视频。仅修改扩展名不能转换格式。";
	return "文件操作失败，请检查网络后重试。上传未确认时，请先刷新文件库，避免重复上传。";
}
