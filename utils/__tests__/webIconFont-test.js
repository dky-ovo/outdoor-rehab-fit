import { loadWebIconFont, isWebIconFontLoaded, subscribeWebIconFont } from "../webIconFont";
jest.mock("expo-asset", () => ({ Asset: { fromModule: value => ({ uri: `/font-${value}.ttf` }) } }));
let originalWindow, originalDocument;
beforeEach(() => { originalWindow = global.window; originalDocument = global.document; });
afterEach(() => { global.window = originalWindow; global.document = originalDocument; jest.useRealTimers(); });

test("a slow icon font is shared, and readiness persists for newly mounted pages", async () => {
  let complete; const face = { load: jest.fn(() => new Promise(resolve => { complete = resolve; })) };
  const Face = jest.fn(() => face); const add = jest.fn();
  global.window = { FontFace: Face }; global.document = { fonts: { add } };
  const notify = jest.fn(), unsubscribe = subscribeWebIconFont("shared-slow", 1, {}, notify);
  const first = loadWebIconFont("shared-slow", 1), second = loadWebIconFont("shared-slow", 1);
  expect(first).toBe(second); expect(isWebIconFontLoaded("shared-slow", 1)).toBe(false); await Promise.resolve();
  expect(Face).toHaveBeenCalledTimes(1); expect(add).not.toHaveBeenCalled();
  complete(face); await expect(first).resolves.toBe(true);
  expect(add).toHaveBeenCalledWith(face); expect(notify).toHaveBeenCalledWith(true);
  expect(isWebIconFontLoaded("shared-slow", 1)).toBe(true);
  expect(loadWebIconFont("shared-slow", 1)).toBe(first); expect(Face).toHaveBeenCalledTimes(1); unsubscribe();
});

test("transient font failure is throttled but can recover and update already mounted icons", async () => {
  jest.useFakeTimers(); const load = jest.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({});
  const Face = jest.fn(() => ({ load }));
  global.window = { FontFace: Face }; global.document = { fonts: { add: jest.fn() } };
  const notify = jest.fn(), removed = jest.fn();
  const unsubscribe = subscribeWebIconFont("retry-test", 2, {}, removed); unsubscribe();
  subscribeWebIconFont("retry-test", 2, {}, notify);
  await expect(loadWebIconFont("retry-test", 2)).resolves.toBe(false);
  await expect(loadWebIconFont("retry-test", 2)).resolves.toBe(false); expect(Face).toHaveBeenCalledTimes(1);
  expect(isWebIconFontLoaded("retry-test", 2)).toBe(false);
  jest.advanceTimersByTime(2001);
  await expect(loadWebIconFont("retry-test", 2)).resolves.toBe(true);
  expect(notify.mock.calls).toEqual([[false], [true]]); expect(removed).not.toHaveBeenCalled();
  expect(isWebIconFontLoaded("retry-test", 2)).toBe(true);
});

test("server rendering and unsupported browsers settle without font requests", async () => {
  global.window = undefined; global.document = undefined;
  await expect(loadWebIconFont("server-test", 3)).resolves.toBe(false);
  global.window = {}; global.document = { fonts: {} };
  await expect(loadWebIconFont("unsupported-test", 4)).resolves.toBe(false);
});

test("different style faces never share a readiness flag", async () => {
  global.window = { FontFace: class { load() { return Promise.resolve(this); } } };
  global.document = { fonts: { add: jest.fn() } };
  await loadWebIconFont("multi-style", 5, { fontWeight: "900" });
  expect(isWebIconFontLoaded("multi-style", 5, { fontWeight: "900" })).toBe(true);
  expect(isWebIconFontLoaded("multi-style", 5, { fontWeight: "400" })).toBe(false);
});
