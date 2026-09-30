import { ADMIN_MEDIA_LIMITS, mediaAccept, mediaCanSelect, mediaErrorMessage, mediaMimeType, mediaSizeLabel, validateAdminMedia } from "../adminMedia";

test.each([["demo.mp4", "video/mp4", "video"], ["DEMO.GIF", "image/gif", "image"], ["demo.JPG", "image/jpeg", "image"], ["demo.mov", "video/quicktime", "video"]])("detects and validates %s without base64", (name, type, kind) => {
	expect(mediaMimeType({ name })).toBe(type);
	expect(validateAdminMedia({ name, size: 1024 })).toEqual({ name, mimeType: type, kind, size: 1024 });
});
test.each([[{ name: "bad.html", size: 1 }, "video", "unsupportedMediaType"], [{ name: "../secret.txt", size: 1 }, "", "invalidStorageName"], [{ name: "empty.mp4", size: 0 }, "", "emptyMediaFile"], [{ name: "large.gif", size: ADMIN_MEDIA_LIMITS.image + 1 }, "", "mediaFileTooLarge"], [{ name: "large.mp4", size: ADMIN_MEDIA_LIMITS.video + 1 }, "", "mediaFileTooLarge"], [{ name: "image.png", size: 10 }, "gif", "unsupportedMediaType"], [{ name: "image.png", size: 10 }, "video", "unsupportedMediaType"], [{ name: "video.mp4", size: 10 }, "image", "unsupportedMediaType"]])("rejects invalid %j for %s", (file, kind, code) => {
	expect(() => validateAdminMedia(file, kind)).toThrow(code);
});
test("any document including empty text is accepted as attachment but never a media selection",()=>{
	expect(validateAdminMedia({name:"说明.html",type:"text/html",size:100}).kind).toBe("file");
	expect(validateAdminMedia({name:"empty.txt",size:0}).kind).toBe("file");
	expect(mediaCanSelect({kind:"file",url:"/api/media/x/x.bin"})).toBe(false);
	expect(mediaAccept("")).toBe("");
});
test("cannot select archived, historical YouTube, or wrong-kind files", () => {
	const item = { id: "v", url: "/api/media/id/video.mp4", kind: "video", mimeType: "video/mp4", selectable: true };
	expect(mediaCanSelect(item, "video")).toBe(true);
	expect(mediaCanSelect(item, "gif")).toBe(false);
	expect(mediaCanSelect({ ...item, archived: true })).toBe(false);
	expect(mediaCanSelect({ ...item, selectable: false })).toBe(false);
	expect(mediaCanSelect({ ...item, kind: "image", mimeType: "image/gif" }, "gif")).toBe(true);
});
test("labels explicitly describe limits, permissions and non-destructive cancel", () => {
	expect(mediaErrorMessage({ status: 413 })).toContain("250 MB");
	expect(mediaErrorMessage({ status: 403 })).toContain("权限");
	expect(mediaErrorMessage({ status: 409 })).toContain("不能归档");
	expect(mediaErrorMessage({ code: "uploadCancelled" })).toContain("不会自动修改 APP");
	expect(mediaAccept("gif")).toBe(".gif,image/gif");
	expect(mediaSizeLabel(1024 * 1024)).toBe("1.0 MB");
	expect(mediaSizeLabel(null)).toBe("外部引用");
});
test("server category/signature failures use correct labels instead of generic permission or in-use errors", () => {
	expect(mediaErrorMessage({ status: 409, code: "mediaCategoryExists" })).toContain("分类名称已存在");
	expect(mediaErrorMessage({ status: 404, code: "mediaCategoryNotFound" })).toContain("重新选择分类");
	expect(mediaErrorMessage({ status: 415, code: "invalidMediaSignature" })).toContain("仅修改扩展名不能转换格式");
});
