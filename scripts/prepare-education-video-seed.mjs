// Packages only the explicitly supplied teaching folders. Original files stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_EQUIPMENT_CATALOG } from '../server/src/equipmentCatalog.js';
import { EDUCATION_VIDEO_CODES, equipmentIdForVideoCode } from '../server/src/educationVideoCodes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const source = path.resolve(value('--source', 'D:/下载/outdoor fit 视频'));
const out = path.resolve(value('--out', path.join(root, 'workspace-artifacts/education-video-seed-20260910')));
const wordRows = JSON.parse(fs.readFileSync(value('--rows', path.join(root, 'workspace-artifacts/education-video-20260910/word-rows.json')), 'utf8'));
const ffmpeg = value('--ffmpeg', '');
if (!out.startsWith(path.join(root, 'workspace-artifacts') + path.sep) || fs.existsSync(out)) throw new Error('Choose a NEW workspace-artifacts output directory');
const normalized = (text) => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const mapping = wordRows.slice(1).map(([code, nameZh, nameEn]) => {
	const id = equipmentIdForVideoCode(code), equipment = BUILT_IN_EQUIPMENT_CATALOG.find((item) => item.id === id);
	if (!equipment || normalized(nameEn) !== normalized(equipment.nameEn)) throw new Error(`English name mismatch for ${code}`);
	const docZh = normalized(nameZh), appZh = normalized(equipment.nameZh);
	if (!docZh.includes(appZh) && !appZh.includes(docZh)) throw new Error(`Chinese name mismatch for ${code}`);
	return { code, equipmentId: id, nameZh, nameEn, appNameZh: equipment.nameZh, appNameEn: equipment.nameEn };
});
if (mapping.length !== EDUCATION_VIDEO_CODES.length || new Set(mapping.map((item) => item.code)).size !== mapping.length) throw new Error('Document contains missing or duplicate codes');
const entries = fs.readdirSync(source, { withFileTypes: true });
const zhDir = entries.filter((item) => item.isDirectory() && item.name === 'Education Video Final (Chinese)');
const enDir = entries.filter((item) => item.isDirectory() && item.name.startsWith('Education Video Final (English)'));
if (zhDir.length !== 1 || enDir.length !== 1) throw new Error('Expected exactly one Chinese and English video folder');
const folders = new Set(), pending = [], ignored = [];
const walk = (dir, relative, locale) => {
	folders.add(relative);
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name), rel = relative + '/' + entry.name;
		if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${rel}`);
		if (entry.name.startsWith('._') || entry.name === '.DS_Store') { ignored.push(rel); continue; }
		if (entry.isDirectory()) { walk(full, rel, locale); continue; }
		if (!entry.isFile()) throw new Error(`Unsupported filesystem entry ${rel}`);
		if (!/\.mp4$/i.test(entry.name)) throw new Error(`Unexpected file needs manual review ${rel}`);
		const isOld = relative.split('/').some((segment) => segment.toLowerCase() === 'old') || /\(OLD\)/i.test(entry.name);
		const code = entry.name.match(/^(\d+[a-d]?)(?:\s*\((?:Chi|ENG|OLD)\))?\s*\.mp4$/i)?.[1].toLowerCase();
		const match = mapping.find((item) => item.code === code);
		if (!match) throw new Error(`Unknown code: ${rel}`);
		pending.push({ source: full, relativePath: rel, name: entry.name, folderPath: relative, mimeType: 'video/mp4', categoryName: locale === 'zh' ? '设施教学视频（中文）' : '设施教学视频（英文）', ...(isOld ? { archiveOnly: true } : { code, equipmentId: match.equipmentId, locale }) });
	}
};
for (const [entry, locale] of [[zhDir[0], 'zh'], [enDir[0], 'en']]) walk(path.join(source, entry.name), entry.name, locale);
pending.unshift({ source: path.join(source, 'Exercise Machine Code 2026.docx'), relativePath: 'Exercise Machine Code 2026.docx', name: 'Exercise Machine Code 2026.docx', folderPath: '', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', categoryName: '设施编号文档' });
const keys = pending.filter((item) => item.equipmentId).map((item) => `${item.code}:${item.locale}`);
if (new Set(keys).size !== keys.length) throw new Error('Duplicate current video for the same code and language');
const hashFile = (file) => {
	const hash = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
	try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); } finally { fs.closeSync(fd); }
	return hash.digest('hex');
};
const items = [];
for (const item of pending) {
	const stat = fs.lstatSync(item.source);
	if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid source ${item.relativePath}`);
	let mediaInfo = null;
	if (item.mimeType === 'video/mp4') {
		const fd = fs.openSync(item.source, 'r'), head = Buffer.alloc(32);
		try { fs.readSync(fd, head, 0, 32, 0); } finally { fs.closeSync(fd); }
		if (head.toString('ascii', 4, 8) !== 'ftyp') throw new Error(`Not an MP4: ${item.relativePath}`);
		if (ffmpeg) {
			const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', item.source], { encoding: 'utf8', windowsHide: true });
			const info = probe.stderr || '', duration = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
			if (!duration || !/Video: h264/.test(info) || !/Audio: aac/.test(info)) throw new Error(`Browser compatibility requires review: ${item.relativePath}\n${info}`);
			const verify = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-i', item.source, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
			if (verify.status !== 0) throw new Error(`Decode failed ${item.relativePath}: ${verify.stderr || verify.error}`);
			mediaInfo = { videoCodec: 'h264', audioCodec: 'aac', durationSeconds: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]), fullDecodePassed: true };
		}
	}
	const sha256 = hashFile(item.source), fileName = sha256 + path.extname(item.name).toLowerCase();
	items.push({ ...item, fileName, sha256, size: stat.size, mediaInfo });
	console.log(JSON.stringify({ verified: item.relativePath, size: stat.size, mediaInfo }));
}
// All inputs pass before copying any data. No overwrites or source cleanup.
fs.mkdirSync(path.join(out, 'files'), { recursive: true });
for (const item of items) {
	const target = path.join(out, 'files', item.fileName);
	if (!fs.existsSync(target)) fs.copyFileSync(item.source, target, fs.constants.COPYFILE_EXCL);
	if (hashFile(target) !== item.sha256) throw new Error(`Copy checksum mismatch ${item.relativePath}`);
}
const manifest = { version: 2, importId: 'education-videos-20260910', folders: [...folders], items: items.map(({ source: _source, ...item }) => item) };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
const report = { mapping, missing: mapping.filter((row) => !items.some((item) => item.code === row.code)).map((row) => ({ ...row, action: 'Keep existing content; no supplied replacement' })), formalVideos: keys.length, archivedVideos: items.filter((item) => item.archiveOnly).length, files: items.length, bytes: items.reduce((n, item) => n + item.size, 0), ignoredAppleMetadata: ignored, fullDecodeChecked: Boolean(ffmpeg) };
fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ out, files: report.files, formalVideos: report.formalVideos, archivedVideos: report.archivedVideos, bytes: report.bytes, missing: report.missing.map((item) => item.code), ignoredAppleMetadata: ignored.length }));
