// Explicit identities from Exercise Machine Code 2026.docx, not app-id + 1.
export const EDUCATION_VIDEO_CODES = Object.freeze([
	"1", "2", "3", "4", "5a", "5b", "5c", "5d", "7", "8", "9", "10a", "10b",
	"11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "23", "24", "25", "26", "27",
]);
export const equipmentIdForVideoCode = (code) => {
	const index = EDUCATION_VIDEO_CODES.indexOf(String(code).toLowerCase());
	return index < 0 ? null : String(index);
};
