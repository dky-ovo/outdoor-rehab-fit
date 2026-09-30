import crypto from "node:crypto";
import { createEquipmentImageFiles } from "../equipmentImageFiles";

const origin = "https://api.outdoorfit.hk";
const root = "file:///private/documents/equipment-image-files-v1/";
const jpg = Buffer.from([255, 216, 255, 224, 1, 2, 3, 4]);
const gif = Buffer.from("GIF89a1234567890;");
const image = (id, extra = {}) => ({ url: `${origin}/api/equipment-images/${id}.jpg`, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 100; index++) await Promise.resolve(); };
const md5 = bytes => crypto.createHash("md5").update(bytes).digest("hex");

function memoryFs({ manual = false, cancellation = "ack" } = {}) {
  const data = new Map(), directories = new Set(), tasks = [];
  let active = 0, maximumActive = 0;
  const fs = {
    documentDirectory: "file:///private/documents/",
    getInfoAsync: jest.fn(async (uri, options) => {
      if (directories.has(uri)) return { exists: true, isDirectory: true, uri };
      const bytes = data.get(uri);
      return bytes ? { exists: true, isDirectory: false, uri, size: bytes.length, ...(options?.md5 ? { md5: md5(bytes) } : {}) } : { exists: false, isDirectory: false, uri };
    }),
    makeDirectoryAsync: jest.fn(async uri => { directories.add(uri); }),
    readDirectoryAsync: jest.fn(async uri => [...data.keys()].filter(key => key.startsWith(uri) && !key.slice(uri.length).includes("/")).map(key => key.slice(uri.length))),
    readAsStringAsync: jest.fn(async (uri, options) => {
      if (!data.has(uri)) throw new Error("missing synthetic file");
      const bytes = data.get(uri);
      return options?.encoding === "base64" ? bytes.subarray(options.position, options.position + options.length).toString("base64") : bytes.toString("utf8");
    }),
    writeAsStringAsync: jest.fn(async (uri, text) => { data.set(uri, Buffer.from(text)); }),
    moveAsync: jest.fn(async ({ from, to }) => {
      if (!data.has(from) || data.has(to)) throw new Error("synthetic move rejected");
      data.set(to, data.get(from)); data.delete(from);
    }),
    deleteAsync: jest.fn(async uri => { data.delete(uri); }),
    getFreeDiskStorageAsync: jest.fn(async () => 1024 * 1024 * 1024),
    createDownloadResumable: jest.fn((url, uri, options, progress) => {
      const result = deferred(); let live = false, finished = false;
      const ended = () => { if (live) { active--; live = false; } };
      const task = {
        url, uri, options, progress,
        complete(bytes = jpg, changes = {}) {
          if (finished) return;
          finished = true; data.set(uri, bytes); ended();
          result.resolve({ status: 200, uri, md5: md5(bytes), headers: { "Content-Length": String(bytes.length) }, ...changes });
        },
        fail() { if (!finished) { finished = true; ended(); result.reject(new Error("synthetic network failure")); } },
        downloadAsync: jest.fn(() => {
          live = true; active++; maximumActive = Math.max(maximumActive, active);
          if (!manual) Promise.resolve().then(() => task.complete(url.includes(".gif") ? gif : jpg));
          return result.promise;
        }),
        cancelAsync: jest.fn(() => {
          if (cancellation === "hang") return new Promise(() => {});
          if (cancellation === "reject") return Promise.reject(new Error("synthetic cancellation failure"));
          return Promise.resolve(); // native acknowledgement is not completion
        }),
      };
      tasks.push(task); return task;
    }),
  };
  const manager = options => createEquipmentImageFiles({ fileSystem: fs, allowedOrigins: [origin], ...options });
  return { fs, data, tasks, manager, get maximumActive() { return maximumActive; } };
}
afterEach(() => { jest.useRealTimers(); });

test("the dependency-injected module is optional and does not require native APIs at import", async () => {
  const manager = createEquipmentImageFiles();
  const notify = jest.fn(); manager.subscribe(notify);
  expect(manager.get(image("one").url)).toBeNull();
  expect(await manager.hydration()).toMatchObject({ ready: true, available: false });
  expect(await manager.sync([image("one")])).toMatchObject({ status: "unavailable" });
  expect(notify).toHaveBeenCalled();
});

test("JPEG/GIF downloads publish verified private files then an atomic manifest; fresh hydration requires no network or full-file hashes", async () => {
  const f = memoryFs(), manager = f.manager(), first = image("one"), second = { url: `${origin}/api/equipment-images/two.gif` };
  expect(await manager.sync([first, second])).toEqual({ status: "complete", ready: 2, failed: 0, skipped: 0 });
  const firstUri = manager.get(first.url);
  expect(firstUri).toMatch(/^file:\/\/\/private\/documents\/equipment-image-files-v1\/image-.*\.jpg$/);
  expect(f.data.get(firstUri)).toEqual(jpg);
  expect(manager.get(second.url)).toMatch(/\.gif$/);
  const manifestMoves = f.fs.moveAsync.mock.calls.map(([move]) => move).filter(move => move.to.includes("manifest-"));
  expect(manifestMoves.length).toBeGreaterThan(0);
  expect(manifestMoves.every(move => move.from === move.to + ".partial")).toBe(true);
  await flush();
  const restored = f.manager(); f.fs.getInfoAsync.mockClear(); f.fs.createDownloadResumable.mockClear();
  await restored.hydration();
  expect(restored.get(first.url)).toBe(firstUri);
  expect(f.fs.createDownloadResumable).not.toHaveBeenCalled();
  expect(f.fs.getInfoAsync.mock.calls.every(([, options]) => !options?.md5)).toBe(true);
});

test("full URL plus explicit version is the identity; failed replacement preserves old bytes without returning them for the new version", async () => {
  const f = memoryFs(), manager = f.manager(), old = image("old");
  await manager.sync([old]); const oldUri = manager.get(old.url); await flush();
  f.fs.getFreeDiskStorageAsync.mockResolvedValue(0);
  const replacement = image("new");
  expect((await manager.sync([replacement])).failed).toBe(1);
  expect(manager.get(replacement.url)).toBeNull(); expect(manager.get(old.url)).toBe(oldUri); expect(f.data.has(oldUri)).toBe(true);
  expect(manager.get(old.url, "new-version")).toBeNull();
  expect((await manager.sync([{ ...old, version: "new-version" }])).failed).toBe(1);
  expect(manager.get(old.url)).toBe(oldUri);
});

test("deduplicates descriptors and downloads at most two native tasks, highest priority first", async () => {
  const f = memoryFs({ manual: true }), manager = f.manager();
  const syncing = manager.sync([image("low"), image("high", { priority: 30 }), image("mid", { priority: 20 }), image("high", { priority: 1 })]);
  await flush(); expect(f.tasks.map(task => task.url)).toEqual([image("high").url, image("mid").url]);
  f.tasks[0].complete(); await flush(); expect(f.tasks).toHaveLength(3);
  f.tasks[1].complete(); f.tasks[2].complete();
  expect(await syncing).toMatchObject({ ready: 3, failed: 0 }); expect(f.maximumActive).toBe(2);
});

test("rapid full-catalog generations cancel removed work; late old completion neither publishes nor leaks its partial", async () => {
  const f = memoryFs({ manual: true }), manager = f.manager();
  const old = manager.sync([image("old")]); await flush();
  const fresh = manager.sync([image("new")]); await flush();
  expect((await old).status).toBe("cancelled"); expect(f.tasks[0].cancelAsync).toHaveBeenCalledTimes(1);
  f.tasks[1].complete(); expect((await fresh).ready).toBe(1); await flush();
  f.tasks[0].complete(); await flush();
  expect(manager.get(image("old").url)).toBeNull(); expect(manager.get(image("new").url)).not.toBeNull();
  expect([...f.data.keys()].some(uri => uri.endsWith(".partial"))).toBe(false);
  const restored = f.manager(); await restored.hydration(); expect(restored.get(image("old").url)).toBeNull();
});

test("same-URL in-flight work is reused across a priority refresh instead of redownloaded", async () => {
  const f = memoryFs({ manual: true }), manager = f.manager();
  const first = manager.sync([image("same")]); await flush();
  const second = manager.sync([image("same", { priority: 30 })]); await flush();
  expect((await first).status).toBe("cancelled"); expect(f.tasks).toHaveLength(1);
  f.tasks[0].complete(); expect((await second).ready).toBe(1); expect(f.tasks[0].cancelAsync).not.toHaveBeenCalled();
});

test("timeout settles the caller; late native work remains bounded and its partial is removed", async () => {
  jest.useFakeTimers();
  const f = memoryFs({ manual: true }), manager = f.manager({ timeoutMs: 50 });
  const syncing = manager.sync([image("slow")]); await flush();
  jest.advanceTimersByTime(51); await flush(); expect((await syncing).failed).toBe(1);
  expect(f.tasks[0].cancelAsync).toHaveBeenCalledTimes(1);
  f.tasks[0].complete(); await flush(); expect(manager.get(image("slow").url)).toBeNull();
  expect([...f.data.keys()].some(uri => uri.endsWith(".partial"))).toBe(false);
});

test("a transport that ignores cancellation cannot make later generations exceed two native requests", async () => {
  const f = memoryFs({ manual: true, cancellation: "hang" }), manager = f.manager();
  const first = manager.sync([image("a"), image("b")]); await flush();
  const second = manager.sync([image("c"), image("d")]); await flush();
  expect((await first).status).toBe("cancelled"); expect(f.tasks).toHaveLength(2);
  f.tasks[0].complete(); f.tasks[1].complete(); await flush(); expect(f.tasks).toHaveLength(4);
  f.tasks[2].complete(); f.tasks[3].complete(); expect((await second).ready).toBe(2); expect(f.maximumActive).toBe(2);
});

test("AbortSignal and explicit cancel settle promptly without publishing cancelled work", async () => {
  const f = memoryFs({ manual: true }), manager = f.manager(), controller = new AbortController();
  const syncing = manager.sync([image("cancel")], { signal: controller.signal }); await flush(); controller.abort();
  expect((await syncing).status).toBe("cancelled"); await flush(); f.tasks[0].complete(); await flush();
  expect(manager.get(image("cancel").url)).toBeNull();
  const next = manager.sync([image("cancel2")]); await flush(); manager.cancel(); expect((await next).status).toBe("cancelled");
  f.tasks[1].complete(); await flush();
});

test.each(["status", "signature", "digest", "length", "oversized"])("rejects invalid download %s without exposing a local URI", async kind => {
  const f = memoryFs({ manual: true }), manager = f.manager({ maxFileBytes: 16 });
  const syncing = manager.sync([image("bad")]); await flush();
  const bytes = kind === "signature" ? Buffer.from("<html>bad</html>") : kind === "oversized" ? Buffer.concat([jpg, Buffer.alloc(16)]) : jpg;
  const changes = kind === "status" ? { status: 404 } : kind === "digest" ? { md5: "0".repeat(32) } : kind === "length" ? { headers: { "content-length": "99" } } : {};
  f.tasks[0].complete(bytes, changes); expect((await syncing).failed).toBe(1); await flush();
  expect(manager.get(image("bad").url)).toBeNull(); expect([...f.data.keys()].some(uri => /image-/.test(uri))).toBe(false);
});

test("download progress aborts an over-limit response", async () => {
  const f = memoryFs({ manual: true }), manager = f.manager({ maxFileBytes: 16 });
  const syncing = manager.sync([image("too-big")]); await flush(); f.tasks[0].progress({ totalBytesWritten: 1, totalBytesExpectedToWrite: 100 });
  expect((await syncing).failed).toBe(1); await flush(); expect(f.tasks[0].cancelAsync).toHaveBeenCalled();
  f.tasks[0].complete(); await flush();
});

test("budget and low disk space defer downloads, protecting referenced files and reserving space for both workers", async () => {
  const f = memoryFs(), manager = f.manager({ budgetBytes: 24, maxFileBytes: 16, minFreeBytes: 0 });
  expect((await manager.sync([image("first")])).ready).toBe(1); await flush();
  expect((await manager.sync([image("first"), image("second"), image("third")])).failed).toBeGreaterThan(0);
  await flush(); expect(manager.getStatus().bytes).toBeLessThanOrEqual(24); expect(manager.get(image("first").url)).not.toBeNull();
  f.fs.getFreeDiskStorageAsync.mockResolvedValue(0);
  const count = f.tasks.length; expect((await manager.sync([image("fourth")])).failed).toBe(1); expect(f.tasks).toHaveLength(count);
});

test("pins protect rendered URIs until release; a successful complete catalog permits exact owned-file cleanup", async () => {
  const f = memoryFs(), manager = f.manager();
  await manager.sync([image("old")]); await flush(); const oldUri = manager.get(image("old").url), release = manager.pin(oldUri);
  f.data.set(root + "unrelated-user-file.txt", Buffer.from("keep"));
  await manager.sync([image("new")]); await flush(); expect(f.data.has(oldUri)).toBe(true);
  release(); release(); await flush(); expect(f.data.has(oldUri)).toBe(false);
  expect(f.data.has(root + "unrelated-user-file.txt")).toBe(true);
  expect(f.fs.deleteAsync.mock.calls.every(([uri]) => uri.startsWith(root))).toBe(true);
});

test("invalidate uses the exact failing URI, not an old error callback, and supports a fresh download", async () => {
  const f = memoryFs(), manager = f.manager(), item = image("same");
  await manager.sync([item]); await flush(); const oldUri = manager.get(item.url);
  const invalidating = manager.invalidate(item.url, "", oldUri); expect(manager.get(item.url)).toBeNull(); expect(await invalidating).toBe(true);
  await manager.sync([item]); await flush(); const freshUri = manager.get(item.url); expect(freshUri).not.toBe(oldUri);
  expect(await manager.invalidate(item.url, "", oldUri)).toBe(false); expect(manager.get(item.url)).toBe(freshUri);
});

test("failed manifest persistence does not publish the new file or destroy an existing working version", async () => {
  const f = memoryFs(), manager = f.manager(); await manager.sync([image("old")]); await flush(); const oldUri = manager.get(image("old").url);
  f.fs.writeAsStringAsync.mockRejectedValueOnce(new Error("synthetic disk full"));
  expect((await manager.sync([image("new")])).failed).toBe(1); await flush();
  expect(manager.get(image("new").url)).toBeNull(); expect(f.data.has(oldUri)).toBe(true);
  const restored = f.manager(); await restored.hydration(); expect(restored.get(image("old").url)).toBe(oldUri);
});

test("bad manifests and outside paths cannot redirect reads or deletions, and missing/truncated files are cache misses", async () => {
  const f = memoryFs(), manager = f.manager(); await manager.sync([image("good")]); await flush(); const goodUri = manager.get(image("good").url);
  f.data.set(root + "manifest-999999999999999-aabbccdd.json", Buffer.from(JSON.stringify({ format: 1, revision: 999999999999999, entries: [{ ...image("bad"), version: "", file: "../../private.txt", size: 8, md5: md5(jpg) }] })));
  f.data.set("file:///private/private.txt", jpg);
  const restored = f.manager(); await restored.hydration(); expect(restored.get(image("good").url)).toBe(goodUri);
  f.data.set(goodUri, Buffer.from([1])); const truncated = f.manager(); await truncated.hydration(); expect(truncated.get(image("good").url)).toBeNull();
  expect(f.fs.readAsStringAsync.mock.calls.every(([uri]) => uri.startsWith(root))).toBe(true);
  expect(f.fs.deleteAsync.mock.calls.every(([uri]) => uri.startsWith(root))).toBe(true);
  expect(f.data.has("file:///private/private.txt")).toBe(true);
});

test("only public managed HTTPS URLs are downloaded without credentials or request headers", async () => {
  const f = memoryFs(), manager = f.manager();
  const rejected = ["http://api.outdoorfit.hk/api/equipment-images/a.jpg", "https://other.test/api/equipment-images/a.jpg", `${origin}/api/private/a.jpg`, `${origin}/api/equipment-images/a.jpg?token=secret`, "https://user:secret@api.outdoorfit.hk/api/equipment-images/a.jpg", `${origin}/api/equipment-images/%2e%2e/a.jpg`];
  const result = await manager.sync([...rejected.map(url => ({ url })), image("good")]);
  expect(result).toMatchObject({ ready: 1, skipped: 6 }); expect(f.tasks).toHaveLength(1);
  expect(f.tasks[0].options.headers).toBeUndefined();
});

test("a generation cancelled while writing its manifest cannot become visible on disk or in memory", async () => {
  const f = memoryFs(), manager = f.manager(), gate = deferred(), original = f.fs.writeAsStringAsync.getMockImplementation();
  f.fs.writeAsStringAsync.mockImplementationOnce(async (...args) => { await gate.promise; return original(...args); });
  const old = manager.sync([image("old")]); await flush();
  const next = manager.sync([image("new")]); gate.resolve(); expect((await old).status).toBe("cancelled"); expect((await next).ready).toBe(1); await flush();
  expect(manager.get(image("old").url)).toBeNull(); const restored = f.manager(); await restored.hydration(); expect(restored.get(image("old").url)).toBeNull();
});

test("a newer full catalog cancels a queued prune before it can retire a referenced image", async () => {
  const f = memoryFs(), manager = f.manager(), gate = deferred();
  await manager.sync([image("one"), image("two")]); await flush();
  const firstUri = manager.get(image("one").url), secondUri = manager.get(image("two").url);
  const write = f.fs.writeAsStringAsync.getMockImplementation();
  f.fs.writeAsStringAsync.mockImplementationOnce(async (...args) => { await gate.promise; return write(...args); });
  await manager.sync([image("one")]); await flush();
  const latest = manager.sync([image("one"), image("two")]); gate.resolve(); await latest; await flush();
  expect(manager.get(image("one").url)).toBe(firstUri); expect(manager.get(image("two").url)).toBe(secondUri);
  expect(f.data.has(secondUri)).toBe(true);
});

test("a full small budget can replace two obsolete images without stalling behind its own download reservations", async () => {
  const f = memoryFs(), manager = f.manager({ budgetBytes: 24, maxFileBytes: 16, minFreeBytes: 0 });
  expect((await manager.sync([image("old-a"), image("old-b")])).ready).toBe(2); await flush();
  const oldUris = [manager.get(image("old-a").url), manager.get(image("old-b").url)];
  expect((await manager.sync([image("new-a"), image("new-b")]))).toMatchObject({ ready: 2, failed: 0 }); await flush();
  expect(manager.getStatus().bytes).toBe(16); expect(oldUris.every(uri => !f.data.has(uri))).toBe(true);
});

test("budget pressure yields unpinned lower-priority cache space to a favorite but cannot evict a visible pin", async () => {
  const f = memoryFs(), manager = f.manager({ budgetBytes: 16, maxFileBytes: 16, minFreeBytes: 0 });
  await manager.sync([image("old")]); await flush(); const oldUri = manager.get(image("old").url), release = manager.pin(oldUri);
  const plan = [image("old"), image("favorite", { priority: 30 })];
  expect((await manager.sync(plan)).failed).toBe(1); expect(f.data.has(oldUri)).toBe(true);
  release(); await flush(); expect((await manager.sync(plan)).ready).toBe(1); await flush();
  expect(manager.get(image("favorite").url)).not.toBeNull(); expect(manager.get(image("old").url)).toBeNull();
  expect(manager.getStatus().bytes).toBe(8);
});

test("acknowledged cancellation does not release native slots; queued callers have a bounded batch deadline", async () => {
  jest.useFakeTimers();
  const f = memoryFs({ manual: true }), manager = f.manager({ timeoutMs: 50, batchTimeoutMs: 200 });
  const old = manager.sync([image("old-a"), image("old-b")]); await flush();
  const queued = manager.sync([image("new-a"), image("new-b")]); await flush(); expect((await old).status).toBe("cancelled");
  expect(f.tasks.every(task => task.cancelAsync.mock.calls.length === 1)).toBe(true);
  expect(f.tasks).toHaveLength(2);
  jest.advanceTimersByTime(201); await flush(); expect(await queued).toMatchObject({ ready: 0, failed: 2 });
  f.tasks[0].complete(); f.tasks[1].complete(); await flush(); expect(f.tasks).toHaveLength(2);
  const retry = manager.sync([image("new-a"), image("new-b")]); await flush(); f.tasks[2].complete(); f.tasks[3].complete();
  expect((await retry).ready).toBe(2); expect(f.maximumActive).toBe(2);
});

test("pin added while stat awaits prevents deletion of an image still on screen", async () => {
  const f = memoryFs(), manager = f.manager();
  await manager.sync([image("old")]); await flush(); const oldUri = manager.get(image("old").url);
  const info = f.fs.getInfoAsync.getMockImplementation(), gate = deferred(); let intercepted = false;
  f.fs.getInfoAsync.mockImplementation(async (...args) => {
    if (args[0] === oldUri && !intercepted) { intercepted = true; await gate.promise; }
    return info(...args);
  });
  const replacing = manager.sync([image("new")]); await flush(); expect(intercepted).toBe(true);
  const release = manager.pin(oldUri); gate.resolve(); await replacing; await flush(); expect(f.data.has(oldUri)).toBe(true);
  release(); await flush(); expect(f.data.has(oldUri)).toBe(false);
});
