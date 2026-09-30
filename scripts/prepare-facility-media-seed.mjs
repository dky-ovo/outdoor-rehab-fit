// Build an explicit public teaching-asset package; never scan user uploads or data.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { BUILT_IN_EQUIPMENT_CATALOG } from "../server/src/equipmentCatalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, process.argv[2] || "workspace-artifacts/media-seed-20260909");
if (!output.startsWith(`${path.join(root, "workspace-artifacts")}${path.sep}`)) throw new Error("Output must be inside workspace-artifacts");
if (fs.existsSync(output)) throw new Error("Output already exists; choose a fresh artifact directory");
const allowedDirectories = new Set(["icon", "equipment", "horizontal", "gif", "new-machines"]);
const labels = { icon: "图标", equipment: "设施照片", horizontal: "横向照片", gif: "动作示范", "new-machines": "新增设施照片" };
const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };
const paths = new Set();
for (const relative of ["constants/Equipments.js", "constants/NewMachines.js"]) {
	const sourceFile = path.join(root, relative);
	for (const match of fs.readFileSync(sourceFile, "utf8").matchAll(/require\(["']([^"']+)["']\)/g)) {
		const source = match[1].startsWith("@/") ? path.join(root, match[1].slice(2)) : path.resolve(path.dirname(sourceFile), match[1]);
		const relativeAsset = path.relative(path.join(root, "assets/images"), source);
		const parts = relativeAsset.split(path.sep);
		if (parts.length === 2 && allowedDirectories.has(parts[0]) && types[path.extname(source).toLowerCase()]) paths.add(source);
	}
}
const items = [];
const assets = [];
for (const source of [...paths].sort()) {
	if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Refusing symlink ${source}`);
	const bytes = fs.readFileSync(source);
	if (bytes.length > 12 * 1024 * 1024) throw new Error(`Image exceeds library limit: ${source}`);
	const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
	const originalExtension = path.extname(source).toLowerCase();
	// A few legacy .jpg assets contain PNG bytes. Normalize only the copy's
	// filename/MIME type; leave the original asset and all pixels unchanged.
	const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? ".png"
		: /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6)) ? ".gif"
			: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? ".jpg"
				: bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? ".webp" : "";
	if (!extension) throw new Error(`Unsupported image bytes: ${source}`);
	const directory = path.basename(path.dirname(source));
	const stem = path.basename(source, originalExtension);
	const equipmentId = directory === "new-machines" ? "28" : String(Number(stem.replace(/[ab]$/, "")) - 1);
	const equipment = BUILT_IN_EQUIPMENT_CATALOG.find((item) => item.id === equipmentId);
	const fileName = `${sha256}${extension}`;
	items.push({ fileName, name: `${equipment?.nameZh || stem} · ${labels[directory]}${directory === "gif" ? (stem.endsWith("a") ? "（左）" : "（右）") : ""}`, mimeType: types[extension], categoryName: directory === "gif" ? "设施动作 GIF" : "设施图片", sha256 });
	assets.push({ source, fileName });
}
fs.mkdirSync(path.join(output, "files"), { recursive: true });
for (const { source, fileName } of assets) {
	const destination = path.join(output, "files", fileName);
	if (!fs.existsSync(destination)) fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ items }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, references: items.length, uniqueFiles: new Set(items.map((item) => item.fileName)).size, bytes: fs.readdirSync(path.join(output, "files")).reduce((total, name) => total + fs.statSync(path.join(output, "files", name)).size, 0) }));
