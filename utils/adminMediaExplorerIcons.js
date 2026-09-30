// Local vector artwork: no icon-font, CDN, tracking pixel, or network request.
// SVAR's fonts=false also disables its icon font, so every visible wxi action
// gets a bundled SVG mask instead of depending on a user's installed fonts.
const paths = {
	folder: '<path d="M3 7V5h6l2 2h10v13H3z"/>',
	file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
	"arrow-left": '<path d="m11 5-7 7 7 7M4 12h16"/>',
	"angle-left": '<path d="m15 5-7 7 7 7"/>',
	"angle-right": '<path d="m9 5 7 7-7 7"/>',
	"angle-up": '<path d="m5 15 7-7 7 7"/>',
	"angle-down": '<path d="m5 9 7 7 7-7"/>',
	close: '<path d="m6 6 12 12M18 6 6 18"/>',
	eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
	download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
	upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
	"dots-v": '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
	search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
	subtask: '<path d="M3 4h7v5H3zM14 15h7v5h-7zM6 9v9h8"/>',
	"content-copy": '<path d="M8 8h12v13H8zM4 16V3h12"/>',
	"content-cut": '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="m4 3 12 12M20 3 8 15"/>',
	"content-paste": '<path d="M8 5H5v16h14V5h-3M8 3h8v4H8zM8 11h8M8 15h8"/>',
	edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
	delete: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
	undo: '<path d="M4 4v6h6M4 10a8 8 0 1 1 2 9"/>',
	"view-sequential": '<path d="M4 4h16v4H4zM4 10h16v4H4zM4 16h16v4H4z"/>',
	"view-grid": '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
	"view-column": '<path d="M3 3h7v18H3zM14 3h7v18h-7z"/>',
	"message-question-outline": '<path d="M3 4h18v13H8l-5 4zM10 8a2 2 0 1 1 3 2l-1 1M12 14h.01"/>',
	multiple: '<path d="M7 7h13v14H7zM3 17V3h13"/>',
	none: '<path d="M6 3h8l4 4v14H6zM14 3v5h4"/>',
};

function svg(body, { stroke = "#000", fill = "none", width = 2 } = {}) {
	return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
}

export const LOCAL_EXPLORER_ICON_NAMES = Object.freeze(Object.keys(paths));
export const LOCAL_EXPLORER_ICON_CSS = Object.entries(paths).map(([name, body]) => {
	const uri = svg(body);
	return `i.wxi-${name}::before{content:""!important;display:inline-block;width:1em;height:1em;min-width:1em;background-color:currentColor;-webkit-mask:url("${uri}") center/contain no-repeat;mask:url("${uri}") center/contain no-repeat;vertical-align:middle;}`;
}).join("\n") + '\n.of-media-explorer i[class*="wxi-"]{font-style:normal;flex-shrink:0;}';

const fileIcons = {
	folder: svg('<path fill="#f6c75b" stroke="#b58a2b" d="M2 6V4h7l3 3h10v14H2z"/><path fill="#ffdc80" stroke="#b58a2b" d="M2 9h20v12H2z"/>', { width: 1.3 }),
	video: svg('<path fill="#e9efff" stroke="#5679bf" d="M5 2h10l5 5v15H5z"/><path fill="#5679bf" stroke="none" d="m10 10 7 4-7 4z"/>', { width: 1.3 }),
	image: svg('<rect x="2" y="3" width="20" height="18" rx="2" fill="#e2f3e9" stroke="#3b8766"/><circle cx="8" cy="8" r="2" fill="#3b8766" stroke="none"/><path fill="#86b49e" stroke="#3b8766" d="m3 19 6-6 4 3 4-7 5 10"/>', { width: 1.3 }),
	file: svg('<path fill="#eef0f4" stroke="#6b7688" d="M5 2h10l5 5v15H5zM15 2v6h5"/><path stroke="#6b7688" d="M9 12h7M9 16h7"/>', { width: 1.3 }),
};

export function localExplorerFileIcon(file) {
	if (file?.type === "folder") return fileIcons.folder;
	return fileIcons[file?.media?.kind] || fileIcons.file;
}
