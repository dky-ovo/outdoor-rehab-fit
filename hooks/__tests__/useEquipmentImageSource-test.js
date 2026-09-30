import React from "react";
import renderer, { act } from "react-test-renderer";
import useEquipmentImageSource from "../useEquipmentImageSource";
import { hydrateEquipmentImages, pinEquipmentImage, invalidateEquipmentImage } from "../../utils/equipmentOfflineImages";
import { EQUIPMENT_IMAGE_PLACEHOLDER } from "../../utils/equipmentCatalog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockSnapshots, mockDecoded, mockListeners, mockRetired, value, tree;
const mockRelease = jest.fn();
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: v => v.startsWith("/") ? `https://api.outdoorfit.hk${v}` : v }));
jest.mock("../../utils/equipmentOfflineImages", () => ({
  equipmentImageSnapshot: url => mockSnapshots.get(url) ?? null,
  equipmentDecodedImageSnapshot: (url, uri) => mockDecoded.get(JSON.stringify([url, uri])) || null,
  equipmentBundledImageRetired: key => mockRetired.has(key),
  subscribeEquipmentImages: fn => { mockListeners.add(fn); return () => mockListeners.delete(fn); },
  hydrateEquipmentImages: jest.fn(async () => {}),
  pinEquipmentImage: jest.fn(() => mockRelease),
  invalidateEquipmentImage: jest.fn(),
}));
function Probe({ source }) { value = useEquipmentImageSource(source); return null; }
const url = "https://api.outdoorfit.hk/api/equipment-images/new.jpg";
beforeEach(() => { mockSnapshots = new Map(); mockDecoded = new Map(); mockListeners = new Set(); mockRetired = new Set(); jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const render = async source => { await act(async () => { tree = renderer.create(<Probe source={source} />); }); };
const updateFile = async file => { await act(async () => { mockSnapshots.set(url, file); for (const fn of mockListeners) fn(); }); };

test("cold index uses a neutral placeholder then the exact persistent file without a remote phase", async () => {
  await render(url);
  expect(value.source).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
  expect(hydrateEquipmentImages).toHaveBeenCalled();
  await updateFile("file:///private/new.jpg");
  expect(value.source).toEqual({ uri: "file:///private/new.jpg" });
  expect(pinEquipmentImage).toHaveBeenCalledWith("file:///private/new.jpg");
  await act(async () => tree.unmount()); tree = null;
  expect(mockRelease).toHaveBeenCalledTimes(1);
});

test("an index miss falls back to the remote URL and a later download updates the image", async () => {
  mockSnapshots.set(url, ""); await render(url);
  expect(value.source).toEqual({ uri: url });
  expect(value.onError()).toBe(false);
  await updateFile("file:///private/new.jpg");
  expect(value.source.uri).toBe("file:///private/new.jpg");
});

test("a failed local file invalidates only its captured URI, including late old render errors", async () => {
  mockSnapshots.set(url, "file:///private/old-attempt.jpg"); await render(url);
  const oldError = value.onError;
  await updateFile("file:///private/new-attempt.jpg");
  expect(oldError()).toBe(true);
  expect(invalidateEquipmentImage).toHaveBeenLastCalledWith(url, "file:///private/old-attempt.jpg");
  expect(value.onError()).toBe(true);
  expect(invalidateEquipmentImage).toHaveBeenLastCalledWith(url, "file:///private/new-attempt.jpg");
});

test("bundled assets stay bundled and modal file URIs are pinned without URL rewriting", async () => {
  await render(17); expect(value.source).toBe(17);
  expect(hydrateEquipmentImages).not.toHaveBeenCalled();
  expect(pinEquipmentImage).toHaveBeenCalledWith("asset:17");
  await act(async () => tree.update(<Probe source="file:///private/modal.gif" />));
  expect(value.source).toEqual({ uri: "file:///private/modal.gif" });
  expect(pinEquipmentImage).toHaveBeenCalledWith("file:///private/modal.gif");
});

test("a prepared native image is used directly and a new URL cannot receive its old decoded photo", async () => {
  const uri = "file:///private/ready.jpg", decoded = { width: 800, height: 600, nativeRef: "ready" };
  mockSnapshots.set(url, uri);
  mockDecoded.set(JSON.stringify([url, uri]), decoded);
  await render(url);
  expect(value.source).toBe(decoded);
  await act(async () => tree.update(<Probe source="https://api.outdoorfit.hk/api/equipment-images/replaced.jpg" />));
  expect(value.source).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
});

test("a bundled card and horizontal source get only their exact prepared native refs", async () => {
  const card = { width: 600, height: 800, nativeRef: "card" };
  const horizontal = { width: 1024, height: 600, nativeRef: "horizontal" };
  mockDecoded.set(JSON.stringify(["asset:101", "asset:101"]), card);
  mockDecoded.set(JSON.stringify(["asset:102", "asset:102"]), horizontal);
  await render(101); expect(value.source).toBe(card);
  await act(async () => tree.update(<Probe source={102} />));
  expect(value.source).toBe(horizontal);
  expect(hydrateEquipmentImages).not.toHaveBeenCalled();
  await act(async () => tree.update(<Probe source={url} />));
  expect(value.source).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
  await updateFile("file:///private/new.jpg");
  expect(value.source).toEqual({ uri: "file:///private/new.jpg" });
});

test("a removed asset mapping updates subscribed views without retaining the previous ref", async () => {
  const card = { width: 600, height: 800, nativeRef: "old-card" };
  mockDecoded.set(JSON.stringify(["asset:101", "asset:101"]), card);
  await render(101); expect(value.source).toBe(card);
  await act(async () => { mockDecoded.clear(); for (const notify of mockListeners) notify(); });
  expect(value.source).toBe(101);
  await act(async () => tree.update(<Probe source={url} />));
  expect(value.source).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
});

test("catalog retirement blocks the old module even before a mounted page commits its new URL prop", async () => {
  const card = { width: 600, height: 800, nativeRef: "old-card" };
  mockDecoded.set(JSON.stringify(["asset:101", "asset:101"]), card);
  await render(101); expect(value.source).toBe(card);
  await act(async () => { mockRetired.add("asset:101"); for (const notify of mockListeners) notify(); });
  expect(value.source).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
  expect(mockRelease).toHaveBeenCalled();
  await act(async () => { mockDecoded.clear(); for (const notify of mockListeners) notify(); });
  expect(value.source).toBe(EQUIPMENT_IMAGE_PLACEHOLDER);
  await act(async () => tree.update(<Probe source={url} />));
  await updateFile("file:///private/new.jpg");
  expect(value.source).toEqual({ uri: "file:///private/new.jpg" });
});
