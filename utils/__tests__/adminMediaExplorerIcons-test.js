import { LOCAL_EXPLORER_ICON_CSS, LOCAL_EXPLORER_ICON_NAMES, localExplorerFileIcon } from "../adminMediaExplorerIcons";

test("all visible navigation and menu actions have local vector fallbacks", () => {
	for (const name of ["folder", "file", "arrow-left", "angle-left", "angle-right", "angle-up", "angle-down", "close", "eye", "refresh", "download", "upload", "dots-v", "subtask", "content-copy", "content-cut", "content-paste", "edit", "delete", "undo"]) {
		expect(LOCAL_EXPLORER_ICON_NAMES).toContain(name);
		expect(LOCAL_EXPLORER_ICON_CSS).toContain(`i.wxi-${name}::before`);
	}
	expect(LOCAL_EXPLORER_ICON_CSS).not.toMatch(/@font-face|https?:\/\//);
	expect(LOCAL_EXPLORER_ICON_CSS).toContain("data:image/svg+xml,");
});
test("folder, video, image and generic file icons are bundled and distinguishable", () => {
	const icons = [localExplorerFileIcon({ type: "folder" }), ...["video", "image", "file"].map(kind => localExplorerFileIcon({ type: "file", media: { kind } }))];
	expect(new Set(icons).size).toBe(4);
	for (const icon of icons) expect(icon).toMatch(/^data:image\/svg\+xml,/);
	expect(localExplorerFileIcon({ type: "none" })).toBe(icons[3]);
});
