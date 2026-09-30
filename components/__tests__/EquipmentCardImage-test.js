import React from "react";
import renderer, { act } from "react-test-renderer";
import { Image } from "expo-image";
import EquipmentCardImage from "../EquipmentCardImage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockOnFocus;
jest.mock("expo-image", () => ({ Image: "CachedImage" }));
jest.mock("expo-router", () => ({ useFocusEffect: callback => { mockOnFocus = callback; require("react").useEffect(callback, [callback]); } }));
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: value => value.startsWith("/") ? `https://api.outdoorfit.hk${value}` : value }));
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; });
const image = () => tree.root.findByType(Image);

test("a remote catalog picture uses the Ali URL and neutral placeholder, never its replaced bundled photo", async () => {
	await act(async () => { tree = renderer.create(<EquipmentCardImage item={{ id: "one", icon: "/api/equipment-images/one.jpg", fallbackIcon: 42 }} />); });
	expect(image().props.source).toEqual({ uri: "https://api.outdoorfit.hk/api/equipment-images/one.jpg" });
	expect(image().props.placeholder).toEqual(require("../../assets/icons/outdoor.png"));
	expect(image().props.placeholder).not.toBe(42);
	expect(image().props.cachePolicy).toBe("memory-disk");
	expect(image().props.allowDownscaling).toBe(true);
	expect(image().props.transition).toBe(0);
});

test("an unavailable image falls back locally and a new URL clears the failed state", async () => {
	await act(async () => { tree = renderer.create(<EquipmentCardImage item={{ id: "one", icon: "/api/media/old.jpg", fallbackIcon: 42 }} />); });
	const oldKey = image().props.recyclingKey;
	await act(async () => image().props.onError());
	expect(image().props.source).toEqual(require("../../assets/icons/outdoor.png"));
	await act(async () => tree.update(<EquipmentCardImage item={{ id: "one", icon: "/api/media/new.jpg", fallbackIcon: 42 }} />));
	expect(image().props.source).toEqual({ uri: "https://api.outdoorfit.hk/api/media/new.jpg" });
	expect(image().props.recyclingKey).not.toBe(oldKey);
});

test("a reused card clears the previous item's error and does not use a remote placeholder", async () => {
	await act(async () => { tree = renderer.create(<EquipmentCardImage item={{ id: "one", icon: "https://example.test/old.jpg" }} />); });
	await act(async () => image().props.onError());
	await act(async () => tree.update(<EquipmentCardImage item={{ id: "two", icon: "https://example.test/new.jpg", fallbackIcon: "https://example.test/also-slow.jpg" }} />));
	expect(image().props.source).toEqual({ uri: "https://example.test/new.jpg" });
	expect(image().props.placeholder).toEqual(require("../../assets/icons/outdoor.png"));
});

test("returning after a transient failure retries the same image instead of pinning its fallback", async () => {
	await act(async () => { tree = renderer.create(<EquipmentCardImage item={{ id: "one", icon: "/api/media/one.jpg", fallbackIcon: 42 }} />); });
	await act(async () => image().props.onError());
	expect(image().props.source).toEqual(require("../../assets/icons/outdoor.png"));
	await act(async () => mockOnFocus());
	expect(image().props.source).toEqual({ uri: "https://api.outdoorfit.hk/api/media/one.jpg" });
});

test("bundled and serialized local images remain local", async () => {
	await act(async () => { tree = renderer.create(<EquipmentCardImage item={{ id: "one", icon: 12 }} />); });
	expect(image().props.source).toBe(12);
	await act(async () => tree.update(<EquipmentCardImage item={{ id: "one", icon: "13" }} />));
	expect(image().props.source).toBe(13);
});

test("a replaced image's late error cannot remount the healthy new image on the next focus", async () => {
	await act(async () => { tree = renderer.create(<EquipmentCardImage item={{ id: "one", icon: "/api/equipment-images/old.jpg" }} />); });
	const oldError = image().props.onError;
	await act(async () => tree.update(<EquipmentCardImage item={{ id: "one", icon: "/api/equipment-images/new.jpg" }} />));
	const newKey = image().props.recyclingKey;
	await act(async () => { oldError(); mockOnFocus(); });
	expect(image().props.recyclingKey).toBe(newKey);
	expect(image().props.source).toEqual({ uri: "https://api.outdoorfit.hk/api/equipment-images/new.jpg" });
});
