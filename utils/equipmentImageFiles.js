// Public equipment images only. Native FileSystem is injected by the adapter;
// importing this module never touches disk, React, credentials, or the network.
const MiB = 1024 * 1024;
const FILE = /^image-[0-9a-z]+-[0-9a-z]+-[a-f0-9]{8}\.(jpg|jpeg|png|gif|webp)$/;
const PART = /^image-[0-9a-z]+-[0-9a-z]+-[a-f0-9]{8}\.(jpg|jpeg|png|gif|webp)\.partial$/;
const MANIFEST = /^manifest-([0-9]{1,16})-[a-f0-9]{8}\.json$/;
const TEMP_MANIFEST = /^manifest-[0-9]{1,16}-[a-f0-9]{8}\.json\.partial$/;
const MD5 = /^[a-f0-9]{32}$/;
const MAX_ENTRIES = 512;
const MAX_MANIFEST_BYTES = MiB;
const keyOf = (url, version) => JSON.stringify([url, version]);
const randomTag = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
const noop = () => {};

function imageHeader(base64, extension) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = []; let bits = 0, value = 0;
  for (const character of base64) {
    if (character === "=") break;
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    value = (value << 6) | digit; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
  }
  const text = (start, length) => String.fromCharCode(...bytes.slice(start, start + length));
  if (["jpg", "jpeg"].includes(extension)) return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === "png") return bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (extension === "gif") return ["GIF87a", "GIF89a"].includes(text(0, 6));
  return extension === "webp" && text(0, 4) === "RIFF" && text(8, 4) === "WEBP";
}

/**
 * sync() receives the COMPLETE public catalog image set, highest priority first.
 * UUID URLs are immutable identities; changing bytes behind the same URL is not
 * detected until invalidate(). Never map an old URL/version to a new descriptor.
 * get() is synchronous; UI should pin its returned URI until it stops rendering.
 */
export function createEquipmentImageFiles({ fileSystem: fs, allowedOrigins = [], budgetBytes = 256 * MiB,
  maxFileBytes = 16 * MiB, timeoutMs = 15000, batchTimeoutMs = 120000, minFreeBytes = 32 * MiB, now = Date.now } = {}) {
  const origins = new Set(allowedOrigins.filter(origin => {
    try { const parsed = new URL(origin); return parsed.protocol === "https:" && parsed.origin === origin && !parsed.username && !parsed.password; }
    catch { return false; }
  }));
  const limitsValid = [budgetBytes, maxFileBytes, timeoutMs, batchTimeoutMs, minFreeBytes].every(number => Number.isSafeInteger(number) && number >= 0)
    && maxFileBytes > 0 && maxFileBytes <= budgetBytes && timeoutMs > 0 && batchTimeoutMs > 0;
  const root = typeof fs?.documentDirectory === "string" && /^file:\/\//.test(fs.documentDirectory)
    ? fs.documentDirectory.replace(/\/?$/, "/") + "equipment-image-files-v1/" : null;
  const required = ["getInfoAsync", "readDirectoryAsync", "makeDirectoryAsync", "readAsStringAsync", "writeAsStringAsync", "moveAsync", "deleteAsync", "getFreeDiskStorageAsync", "createDownloadResumable"];
  let available = Boolean(root && limitsValid && origins.size && required.every(name => typeof fs?.[name] === "function"));
  let ready = false, hydrationPromise, serial = Promise.resolve(), revision = 0, sequence = 0, generation = 0;
  let snapshot = Object.freeze({ ready, available, count: 0, bytes: 0 });
  let entries = new Map(), desired = new Map(), batch, pruneAllowed = false, catalogValid = false;
  const files = new Map(), pins = new Map(), listeners = new Set(), jobs = new Map(), manifestNames = new Set(), invalidFiles = new Set(), deleting = new Set();
  let workers = 0, reserved = 0;
  const usedBytes = () => [...files.values()].reduce((total, size) => total + size, 0);
  const emit = () => {
    snapshot = Object.freeze({ ready, available, count: entries.size, bytes: usedBytes() });
    for (const listener of listeners) { try { listener(); } catch { /* observers cannot break storage */ } }
  };
  const mutate = operation => {
    const result = serial.then(operation);
    serial = result.catch(noop);
    return result;
  };
  function descriptor(input) {
    if (!input || typeof input.url !== "string" || input.url.length > 2048 ||
        (input.version !== undefined && (typeof input.version !== "string" || input.version.length > 128))) return null;
    try {
      const url = new URL(input.url);
      if (!origins.has(url.origin) || url.protocol !== "https:" || url.username || url.password || url.hash) return null;
      for (const [name, value] of url.searchParams) if (!["v", "version"].includes(name) || !/^[a-zA-Z0-9._-]{1,128}$/.test(value)) return null;
      // No encoded separators, traversal, arbitrary endpoints, signed URLs or
      // caller headers. Only the two public managed-image routes are eligible.
      if (!/^\/api\/(?:equipment-images\/[a-zA-Z0-9_-]+|media\/[a-f0-9-]+\/[a-f0-9-]+)\.(jpg|jpeg|png|gif|webp)$/.test(url.pathname)) return null;
      const version = input.version ?? "", normalized = url.href;
      return { url: normalized, version, key: keyOf(normalized, version), extension: url.pathname.split(".").pop(), priority: Number.isFinite(input.priority) ? input.priority : 0 };
    } catch { return null; }
  }
  const uri = file => root + file;
  async function removeOwned(file) {
    if (!(FILE.test(file) || PART.test(file) || MANIFEST.test(file) || TEMP_MANIFEST.test(file)) || pins.has(uri(file))) return false;
    try {
      const info = await fs.getInfoAsync(uri(file));
      if ((info.exists && info.isDirectory) || pins.has(uri(file))) return false;
      deleting.add(file);
      try { await fs.deleteAsync(uri(file), { idempotent: true }); }
      finally { deleting.delete(file); }
      files.delete(file); manifestNames.delete(file); invalidFiles.delete(file);
      return true;
    } catch { return false; }
  }
  async function persist(next, canPublish = () => true) {
    if (next.size > MAX_ENTRIES) throw new Error("IMAGE_INDEX_LIMIT");
    const nextRevision = Math.max(revision + 1, now());
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 0) throw new Error("IMAGE_INDEX_CLOCK");
    const name = `manifest-${nextRevision}-${randomTag()}.json`, temporary = name + ".partial";
    const data = JSON.stringify({ format: 1, revision: nextRevision, entries: [...next.values()] });
    if (data.length > MAX_MANIFEST_BYTES / 2) throw new Error("IMAGE_INDEX_LIMIT");
    try {
      await fs.writeAsStringAsync(uri(temporary), data, { encoding: "utf8" });
      if (!canPublish()) throw new Error("IMAGE_SYNC_CANCELLED");
      await fs.moveAsync({ from: uri(temporary), to: uri(name) });
      if (!canPublish()) { await removeOwned(name); throw new Error("IMAGE_SYNC_CANCELLED"); }
    } catch (error) { await removeOwned(temporary); throw error; }
    revision = nextRevision; manifestNames.add(name); entries = next; emit();
    // Immutable manifests avoid delete-then-replace windows on either platform.
    const obsolete = [...manifestNames].sort((a, b) => Number(b.match(MANIFEST)[1]) - Number(a.match(MANIFEST)[1])).slice(2);
    for (const old of obsolete) await removeOwned(old);
  }
  async function prune() {
    if (!ready || !available || !pruneAllowed) return;
    const current = generation;
    const stillCurrent = () => pruneAllowed && current === generation;
    const next = new Map([...entries].filter(([key, entry]) => desired.has(key) || pins.has(uri(entry.file))));
    if (next.size !== entries.size) await persist(next, stillCurrent);
    const referenced = new Set([...entries.values()].map(entry => entry.file));
    for (const file of files.keys()) {
      if (!stillCurrent()) break;
      if (!referenced.has(file) && !pins.has(uri(file))) await removeOwned(file);
    }
    emit();
  }
  async function hydrate() {
    if (!available) { ready = true; emit(); return snapshot; }
    try {
      await fs.makeDirectoryAsync(root, { intermediates: true });
      const names = await fs.readDirectoryAsync(root);
      if (!Array.isArray(names) || names.length > 4096) throw new Error("IMAGE_DIRECTORY_LIMIT");
      for (const name of names) {
        if (MANIFEST.test(name)) manifestNames.add(name);
        if (FILE.test(name)) {
          const info = await fs.getInfoAsync(uri(name));
          if (info.exists && !info.isDirectory && Number.isSafeInteger(info.size) && info.size >= 0) files.set(name, info.size);
        } else if (PART.test(name) || TEMP_MANIFEST.test(name)) await removeOwned(name);
      }
      const candidates = [...manifestNames].sort((a, b) => Number(b.match(MANIFEST)[1]) - Number(a.match(MANIFEST)[1]));
      for (const name of candidates.slice(0, 8)) {
        try {
          const info = await fs.getInfoAsync(uri(name));
          if (!info.exists || info.isDirectory || info.size > MAX_MANIFEST_BYTES) continue;
          const data = JSON.parse(await fs.readAsStringAsync(uri(name), { encoding: "utf8" }));
          if (data.format !== 1 || !Number.isSafeInteger(data.revision) || data.revision !== Number(name.match(MANIFEST)[1]) || !Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES) continue;
          const restored = new Map(), seenFiles = new Set();
          for (const entry of data.entries) {
            const item = descriptor(entry);
            if (!item || !FILE.test(entry.file) || seenFiles.has(entry.file) || restored.has(item.key) ||
                !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > maxFileBytes || !MD5.test(entry.md5)) throw new Error("IMAGE_INDEX_INVALID");
            seenFiles.add(entry.file);
            // Download verified the digest and signature. Hydration only stats
            // private files, avoiding rehashing up to 256 MiB on every launch.
            if (files.get(entry.file) === entry.size) restored.set(item.key, { url: item.url, version: item.version, file: entry.file, size: entry.size, md5: entry.md5 });
          }
          entries = restored; revision = data.revision; break;
        } catch { /* try an earlier atomically committed snapshot */ }
      }
    } catch { available = false; }
    ready = true; emit(); return snapshot;
  }
  function hydration() { return hydrationPromise ??= mutate(hydrate); }
  function get(url, version = "") {
    const item = descriptor({ url, version });
    const entry = item && entries.get(item.key);
    return entry && !invalidFiles.has(entry.file) && !deleting.has(entry.file) ? uri(entry.file) : null;
  }
  function finishBatch() {
    if (!batch || batch.finished || [...batch.keys].some(key => jobs.has(key) && !jobs.get(key).settled)) return;
    const completing = batch;
    completing.finished = true; completing.off();
    const present = key => entries.has(key) && !invalidFiles.has(entries.get(key).file);
    const complete = [...completing.keys].every(present);
    if (complete && completing.skipped === 0 && completing.generation === generation) {
      pruneAllowed = true;
      void mutate(prune).catch(noop);
    }
    completing.resolve({ status: "complete", ready: [...completing.keys].filter(present).length,
      failed: [...completing.keys].filter(key => !present(key)).length, skipped: completing.skipped });
  }
  function settle(job) { job.settled = true; finishBatch(); }
  function stopJob(job) {
    job.cancelled = true; settle(job); job.abort?.();
    if (!job.started && jobs.get(job.item.key) === job) jobs.delete(job.item.key);
  }
  function cancel() {
    generation++; pruneAllowed = false;
    if (batch && !batch.finished) {
      batch.finished = true; batch.off(); batch.resolve({ status: "cancelled", ready: 0, failed: 0, skipped: batch.skipped });
    }
    for (const job of jobs.values()) if (!job.settled) stopJob(job);
  }
  async function reserveSpace(job) {
    if (job.cancelled || !desired.has(job.item.key)) return false;
    let free = await fs.getFreeDiskStorageAsync();
    if (!Number.isFinite(free)) return false;
    const needed = Math.max(usedBytes() + reserved + maxFileBytes - budgetBytes, minFreeBytes + maxFileBytes + reserved - free);
    if (needed > 0) {
      // Make progress near the budget: reclaim obsolete versions before trying
      // their replacements. Visible pins always win; current lower-priority
      // cached images may yield to favorites when the whole catalog cannot fit.
      if (!catalogValid) return reserved ? "defer" : false;
      const current = generation, byFile = new Map([...entries].map(([key, entry]) => [entry.file, key]));
      const candidates = [...files].map(([file, size]) => {
        const key = byFile.get(file), item = desired.get(key);
        return { file, size, key, priority: item?.priority ?? -Infinity };
      }).filter(item => !pins.has(uri(item.file)) && item.key !== job.item.key && item.priority < job.item.priority)
        .sort((a, b) => a.priority - b.priority);
      if (candidates.reduce((total, item) => total + item.size, 0) < needed) return reserved ? "defer" : false;
      const reclaim = new Set(); let bytes = 0;
      for (const candidate of candidates) { reclaim.add(candidate.file); bytes += candidate.size; if (bytes >= needed) break; }
      const stillSafe = () => current === generation && !job.cancelled && catalogValid && [...reclaim].every(file => !pins.has(uri(file)));
      const next = new Map([...entries].filter(([, entry]) => !reclaim.has(entry.file)));
      if (next.size !== entries.size) await persist(next, stillSafe);
      for (const file of reclaim) { if (!stillSafe()) return false; await removeOwned(file); }
      free = await fs.getFreeDiskStorageAsync();
      if (!Number.isFinite(free) || free < minFreeBytes + maxFileBytes + reserved || usedBytes() + reserved + maxFileBytes > budgetBytes) return reserved ? "defer" : false;
      emit();
    }
    reserved += maxFileBytes; job.reserved = true; return true;
  }
  async function download(job) {
    const file = `image-${now().toString(36)}-${(++sequence).toString(36)}-${randomTag()}.${job.item.extension}`;
    const partial = file + ".partial";
    let task, timer, abortResolve, nativeDone, cancelSent = false;
    const aborted = new Promise(resolve => { abortResolve = resolve; });
    job.abort = () => {
      job.cancelled = true;
      abortResolve(null);
      if (task && !cancelSent) {
        // Native cancelAsync only acknowledges requesting cancellation. Keep the
        // worker occupied until downloadAsync itself settles, even after ack.
        cancelSent = true;
        Promise.resolve().then(() => task.cancelAsync()).catch(noop);
      }
    };
    try {
      job.deferred = false;
      const canStart = await mutate(() => reserveSpace(job));
      if (canStart === "defer") { job.deferred = true; return; }
      if (!canStart || job.cancelled) return;
      task = fs.createDownloadResumable(job.item.url, uri(partial), { md5: true, cache: false, sessionType: 1 }, progress => {
        if (progress.totalBytesWritten > maxFileBytes || progress.totalBytesExpectedToWrite > maxFileBytes) job.abort();
      });
      timer = setTimeout(() => { settle(job); job.abort(); }, timeoutMs);
      nativeDone = Promise.resolve().then(() => task.downloadAsync());
      // Reclaim a late partial even if cancellation was requested. Filenames
      // are unique per attempt, so this cannot delete a newer version's bytes.
      nativeDone.finally(() => { if (job.cancelled) void mutate(() => removeOwned(partial)).catch(noop); }).catch(noop);
      const result = await Promise.race([nativeDone, aborted]);
      if (job.cancelled || !result || result.status !== 200 || result.uri !== uri(partial)) return;
      const info = await fs.getInfoAsync(uri(partial), { md5: true });
      const head = await fs.readAsStringAsync(uri(partial), { encoding: "base64", position: 0, length: 16 });
      if (!info.exists || info.isDirectory || !Number.isSafeInteger(info.size) || info.size < 1 || info.size > maxFileBytes ||
          !MD5.test(info.md5 || "") || result.md5 !== info.md5 || !imageHeader(head, job.item.extension)) return;
      const contentLength = Object.entries(result.headers || {}).find(([name]) => name.toLowerCase() === "content-length")?.[1];
      if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || Number(contentLength) !== info.size)) return;
      await mutate(async () => {
        const stillWanted = () => !job.cancelled && desired.has(job.item.key) && jobs.get(job.item.key) === job;
        if (!stillWanted() || (entries.has(job.item.key) && !invalidFiles.has(entries.get(job.item.key).file))) return;
        if (usedBytes() + info.size > budgetBytes) return;
        await fs.moveAsync({ from: uri(partial), to: uri(file) }); files.set(file, info.size);
        const next = new Map(entries);
        next.set(job.item.key, { url: job.item.url, version: job.item.version, file, size: info.size, md5: info.md5 });
        try { await persist(next, stillWanted); }
        catch (error) { await removeOwned(file); throw error; }
      });
    } catch { /* a public cache miss must not reject catalog/login/UI work */ }
    finally {
      clearTimeout(timer); if (!job.deferred) settle(job);
      if (job.cancelled && nativeDone) await nativeDone.catch(noop);
      await mutate(async () => { await removeOwned(partial); if (job.reserved) { reserved -= maxFileBytes; job.reserved = false; } }).catch(noop);
    }
  }
  function pump() {
    if (!ready || !available) return;
    const pending = [...jobs.values()].filter(job => !job.started && !job.settled && !job.cancelled && (!job.deferred || reserved === 0) && desired.has(job.item.key))
      .sort((a, b) => b.item.priority - a.item.priority);
    for (const job of pending) {
      if (workers >= 2) break;
      workers++; job.started = true;
      void download(job).finally(() => {
        workers--; if (job.deferred) job.started = false;
        else if (jobs.get(job.item.key) === job) jobs.delete(job.item.key);
        pump(); finishBatch();
      }).catch(noop);
    }
    finishBatch();
  }
  async function sync(descriptors, { signal } = {}) {
    if (!Array.isArray(descriptors) || descriptors.length > MAX_ENTRIES) return { status: "unavailable", ready: 0, failed: 0, skipped: Array.isArray(descriptors) ? descriptors.length : 0 };
    if (signal?.aborted) return { status: "cancelled", ready: 0, failed: 0, skipped: 0 };
    const current = ++generation; pruneAllowed = false;
    if (batch && !batch.finished) { batch.finished = true; batch.off(); batch.resolve({ status: "cancelled", ready: 0, failed: 0, skipped: batch.skipped }); }
    const next = new Map(); let skipped = 0;
    for (const input of descriptors) {
      const item = descriptor(input);
      if (!item) { skipped++; continue; }
      if (!next.has(item.key) || item.priority > next.get(item.key).priority) next.set(item.key, item);
    }
    desired = next;
    catalogValid = skipped === 0;
    for (const job of jobs.values()) if (!desired.has(job.item.key)) stopJob(job);
    await hydration();
    if (current !== generation || signal?.aborted) return { status: "cancelled", ready: 0, failed: 0, skipped };
    if (!available) return { status: "unavailable", ready: 0, failed: 0, skipped };
    return new Promise(resolve => {
      const abort = () => { if (current === generation) cancel(); };
      const starting = { generation: current, keys: new Set(next.keys()), skipped, resolve, finished: false, timer: null,
        off: () => { signal?.removeEventListener("abort", abort); clearTimeout(starting.timer); } };
      batch = starting;
      signal?.addEventListener("abort", abort, { once: true });
      for (const item of next.values()) {
        const existing = jobs.get(item.key);
        if (entries.has(item.key) && !invalidFiles.has(entries.get(item.key).file)) continue;
        if (existing && !existing.settled && !existing.cancelled) existing.item = item;
        else jobs.set(item.key, { item, started: false, settled: false, cancelled: false });
      }
      // Queued work also has a deadline. Native tasks that never settle retain
      // their physical slots, but cannot leave the caller waiting forever.
      starting.timer = setTimeout(() => {
        if (batch !== starting || starting.finished) return;
        starting.finished = true; starting.off(); pruneAllowed = false;
        const present = [...starting.keys].filter(key => entries.has(key) && !invalidFiles.has(entries.get(key).file)).length;
        starting.resolve({ status: "complete", ready: present, failed: starting.keys.size - present, skipped });
        for (const job of jobs.values()) if (!job.settled) stopJob(job);
      }, batchTimeoutMs);
      pump();
    });
  }
  function pin(localUri) {
    if (typeof localUri !== "string" || !root || !localUri.startsWith(root) || !FILE.test(localUri.slice(root.length)) || deleting.has(localUri.slice(root.length))) return noop;
    pins.set(localUri, (pins.get(localUri) || 0) + 1);
    let active = true;
    return () => {
      if (!active) return; active = false;
      const count = pins.get(localUri) - 1;
      if (count) pins.set(localUri, count); else pins.delete(localUri);
      void mutate(prune).catch(noop);
    };
  }
  function invalidate(url, version = "", localUri) {
    const item = descriptor({ url, version }), entry = item && entries.get(item.key);
    if (!entry || (localUri !== undefined && localUri !== uri(entry.file))) return Promise.resolve(false);
    invalidFiles.add(entry.file); emit();
    return mutate(async () => {
      if (entries.get(item.key)?.file !== entry.file) return false;
      const next = new Map(entries); next.delete(item.key);
      await persist(next); await removeOwned(entry.file); return true;
    }).catch(() => false);
  }
  return { hydration, get, sync, cancel, invalidate, pin, getStatus: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
