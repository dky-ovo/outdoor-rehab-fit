import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_NAME = /^[a-f0-9-]+\.(?:mp4|mov|webm)$/;
const PUBLIC_MEDIA_URL = /^\/api\/media\/([a-f0-9-]+)\/([a-f0-9-]+\.(?:mp4|mov|webm))$/;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

// A deployment setting, never an HTTP value. No private/signed URL or arbitrary
// path may become a CDN base; only the public playback route is constructed.
export function publicVideoCdnOrigin(value = "") {
  if (!value) return "";
  if (typeof value !== "string" || value.length > 253 || /[\s\\]/.test(value)) throw new Error("INVALID_PUBLIC_VIDEO_CDN_ORIGIN");
  let url;
  try { url = new URL(value); } catch { throw new Error("INVALID_PUBLIC_VIDEO_CDN_ORIGIN"); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || url.pathname !== "/" ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(host)) throw new Error("INVALID_PUBLIC_VIDEO_CDN_ORIGIN");
  return url.origin;
}

function stamp(stat) { return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
function safeFile(root, name, expectedSize) {
  try {
    const rootStat = fs.lstatSync(root), target = path.join(root, name), stat = fs.lstatSync(target);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize) return null;
    return { path: target, stamp: stamp(stat) };
  } catch { return null; }
}
function hashVerifiedFile(root, name, size, expected) {
  const file = safeFile(root, name, size);
  if (!file) return null;
  let fd;
  try {
    fd = fs.openSync(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (stamp(fs.fstatSync(fd)) !== file.stamp) return null;
    const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    if (hash.digest("hex") !== expected || safeFile(root, name, size)?.stamp !== file.stamp) return null;
    return file;
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

// Metadata-only parser shared with deployment checks. Byte hashes still need
// verification on the actual mounted files; parsed claims do not verify bytes.
export function parsePublicVideoManifest(manifest) {
  if (manifest?.version !== 1 || manifest.complete !== true || !Array.isArray(manifest.entries) || manifest.entries.length > 1000) return [];
  const entries = new Map(), duplicated = new Set();
  for (const raw of manifest.entries) {
    const entry = { ...raw };
    if (!SHA256.test(entry.sourceSha256 || "") || !SHA256.test(entry.derivativeSha256 || "") ||
        entry.derivativeStorageName !== `${entry.derivativeSha256}.mp4` ||
        (entry.sourceStorageName !== undefined && !SOURCE_NAME.test(entry.sourceStorageName)) ||
        !Number.isSafeInteger(entry.sourceSizeBytes) || entry.sourceSizeBytes <= 0 || entry.sourceSizeBytes > MAX_VIDEO_BYTES ||
        !Number.isSafeInteger(entry.derivativeSizeBytes) || entry.derivativeSizeBytes <= 0 || entry.derivativeSizeBytes >= entry.sourceSizeBytes ||
        entry.fullDecodePassed !== true || entry.visualReviewPassed !== true || entry.fastStart !== true || entry.videoCodec !== "h264" || entry.audioCodec !== "aac" ||
        !Number.isFinite(entry.sourcePlaybackDurationSeconds) || entry.sourcePlaybackDurationSeconds <= 0 ||
        !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0 ||
        !Number.isFinite(entry.durationDifferenceSeconds) || entry.durationDifferenceSeconds < 0 || entry.durationDifferenceSeconds > 0.1 ||
        !Number.isFinite(entry.totalBitrateMbps) || entry.totalBitrateMbps <= 0 || entry.totalBitrateMbps > 1.5) continue;
    if (entries.has(entry.sourceSha256) || duplicated.has(entry.sourceSha256)) { entries.delete(entry.sourceSha256); duplicated.add(entry.sourceSha256); continue; }
    entries.set(entry.sourceSha256, entry);
  }
  return [...entries.values()];
}

// Read-only deployment data. Hash each candidate once and retain only a small
// stat fingerprint. A replaced/changed source or rendition fails back to the
// original; requests never hash whole videos or trust client filenames.
export function createPublicVideoDelivery({ storageRoot, derivativeRoot, manifestPath, cdnOrigin = "" } = {}) {
  const cdn = publicVideoCdnOrigin(cdnOrigin);
  const entries = new Map(), sources = new Map();
  const root = derivativeRoot && path.resolve(derivativeRoot);
  const originalRoot = path.resolve(storageRoot);
  let manifest;
  try {
    if (!manifestPath || !root) return disabled();
    const manifestStat = fs.lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 2 * 1024 * 1024 || fs.lstatSync(root).isSymbolicLink()) return disabled();
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch { return disabled(); }
  for (const entry of parsePublicVideoManifest(manifest)) {
    const file = hashVerifiedFile(root, entry.derivativeStorageName, entry.derivativeSizeBytes, entry.derivativeSha256);
    if (file) entries.set(entry.sourceSha256, { ...entry, file });
  }
  function disabled() { return { enabled: false, cdnOrigin: "", rendition: () => null, publicUrl: row => row?.url || "", mapEquipment: item => item, mapContent: item => item }; }
  function rendition(row) {
    if (!row || row.source !== "upload" || row.kind !== "video" || row.deleted_at || Number(row.archived) !== 0 || !SOURCE_NAME.test(row.storage_name || "") || !SHA256.test(row.sha256 || "")) return null;
    const entry = entries.get(row.sha256);
    if (!entry || (entry.sourceStorageName && entry.sourceStorageName !== row.storage_name) || Number(row.size_bytes) !== entry.sourceSizeBytes) return null;
    const originalUrl = PUBLIC_MEDIA_URL.exec(row.url || "");
    if (!originalUrl || originalUrl[1] !== row.id || originalUrl[2] !== row.storage_name) return null;
    const cacheKey = `${row.storage_name}:${entry.sourceSha256}`;
    if (!sources.has(cacheKey)) sources.set(cacheKey, hashVerifiedFile(originalRoot, row.storage_name, entry.sourceSizeBytes, entry.sourceSha256));
    const source = sources.get(cacheKey);
    if (!source || safeFile(originalRoot, row.storage_name, entry.sourceSizeBytes)?.stamp !== source.stamp ||
        safeFile(root, entry.derivativeStorageName, entry.derivativeSizeBytes)?.stamp !== entry.file.stamp) return null;
    return { filePath: entry.file.path, fileName: entry.derivativeStorageName, sizeBytes: entry.derivativeSizeBytes,
      localUrl: `/api/media/${row.id}/${entry.derivativeStorageName}`, sourceSha256: entry.sourceSha256, sourceDurationSeconds: entry.sourcePlaybackDurationSeconds };
  }
  function publicUrl(row) { const result = rendition(row); return result ? `${cdn}${result.localUrl}` : row?.url || ""; }
  // Callers supply rows from the current DB snapshot, so delete/private state is
  // checked for every catalogue response and every direct playback request.
  function mapEquipment(item, rows) {
    const map = url => { const match = PUBLIC_MEDIA_URL.exec(url || ""); const row = match && rows.get(match[1]); return row && row.url === url ? publicUrl(row) : url; };
    const duration = url => { const match = PUBLIC_MEDIA_URL.exec(url || ""); const row = match && rows.get(match[1]); return row && row.url === url ? rendition(row)?.sourceDurationSeconds : undefined; };
    return { ...item, videoIdentityUrl: item.videoUrl || "", videoIdentityUrlZh: item.videoUrlZh || "", videoIdentityUrlEn: item.videoUrlEn || "",
      videoIdentityDurationSeconds: duration(item.videoUrl), videoIdentityDurationSecondsZh: duration(item.videoUrlZh), videoIdentityDurationSecondsEn: duration(item.videoUrlEn),
      videoPlaybackUrl: map(item.videoUrl), videoPlaybackUrlZh: map(item.videoUrlZh), videoPlaybackUrlEn: map(item.videoUrlEn),
      additionalVideos: (item.additionalVideos || []).map(video => ({ ...video, videoIdentityUrlZh: video.videoUrlZh || "", videoIdentityUrlEn: video.videoUrlEn || "", videoIdentityDurationSecondsZh: duration(video.videoUrlZh), videoIdentityDurationSecondsEn: duration(video.videoUrlEn), videoPlaybackUrlZh: map(video.videoUrlZh), videoPlaybackUrlEn: map(video.videoUrlEn) })) };
  }
  function mapContent(item, rows) {
    if (item.contentType !== "video") return item;
    const match = PUBLIC_MEDIA_URL.exec(item.value || ""), row = match && rows.get(match[1]);
    return row && row.url === item.value ? { ...item, valueIdentity: item.value, playbackValue: publicUrl(row) } : item;
  }
  return { enabled: entries.size > 0, cdnOrigin: cdn, rendition, publicUrl, mapEquipment, mapContent };
}
