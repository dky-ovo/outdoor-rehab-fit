import React from "react";
import renderer, { act } from "react-test-renderer";
import { Image } from "expo-image";
import EquipmentImage from "../EquipmentImage";
import EquipmentCardImage from "../EquipmentCardImage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock("expo-image", () => ({ Image: "SharedImage" }));
jest.mock("expo-router", () => ({ useFocusEffect: callback => require("react").useEffect(callback, [callback]) }));
jest.mock("../../utils/api", () => ({ resolveApiAssetUrl: url => url.startsWith("/") ? `https://api.outdoorfit.hk${url}` : url }));
const mockImages = new Map();
jest.mock("../../hooks/useEquipmentImageSource", () => ({ __esModule: true, default: source => ({
  source: mockImages.get(source?.uri) || source, onError: () => false,
}) }));
let tree;
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = null; mockImages.clear(); });

test("a favorite card and teaching header share the same decoded native photo and disable fade", async () => {
  const url = "https://api.outdoorfit.hk/api/equipment-images/new.jpg";
  const decoded = { width: 900, height: 600, nativeRef: "one-image" };
  mockImages.set(url, decoded);
  await act(async () => { tree = renderer.create(<>
    <EquipmentCardImage item={{ id: "10", icon: url }} />
    <EquipmentImage imageKey="10" source={url} contentFit="contain" />
  </>); });
  const images = tree.root.findAllByType(Image);
  expect(images).toHaveLength(2);
  for (const image of images) {
    expect(image.props.source).toBe(decoded);
    expect(image.props.transition).toBe(0);
    expect(image.props.cachePolicy).toBe("memory-disk");
  }
  expect(images[0].props.contentFit).toBe("cover");
  expect(images[1].props.contentFit).toBe("contain");
});

test("late errors and replacement URLs cannot put the old photo back into the new image", async () => {
  const oldUrl = "https://api.outdoorfit.hk/api/equipment-images/old.jpg";
  const newUrl = "https://api.outdoorfit.hk/api/equipment-images/new.jpg";
  await act(async () => { tree = renderer.create(<EquipmentImage source={oldUrl} imageKey="10" />); });
  const oldError = tree.root.findByType(Image).props.onError;
  await act(async () => tree.update(<EquipmentImage source={newUrl} imageKey="10" />));
  await act(async () => oldError());
  expect(tree.root.findByType(Image).props.source).toEqual({ uri: newUrl });
  await act(async () => tree.root.findByType(Image).props.onError());
  expect(tree.root.findByType(Image).props.source).toBe(require("../../assets/icons/outdoor.png"));
});

test("GIF and expanded local files keep their native source and fitting with no default fade", async () => {
  await act(async () => { tree = renderer.create(<EquipmentImage source="file:///documents/demo.gif" contentFit="contain" />); });
  const image = tree.root.findByType(Image);
  expect(image.props.source).toEqual({ uri: "file:///documents/demo.gif" });
  expect(image.props.contentFit).toBe("contain");
  expect(image.props.transition).toBe(0);
});

test("parent re-renders with the same URL retain an error fallback until an explicit retry", async () => {
  const url = "https://api.outdoorfit.hk/api/equipment-images/missing.jpg";
  await act(async () => { tree = renderer.create(<EquipmentImage source={{ uri: url }} />); });
  await act(async () => tree.root.findByType(Image).props.onError());
  await act(async () => tree.update(<EquipmentImage source={{ uri: url }} style={{ width: 180 }} />));
  expect(tree.root.findByType(Image).props.source).toBe(require("../../assets/icons/outdoor.png"));
  await act(async () => tree.update(<EquipmentImage source={{ uri: url }} retryKey={1} />));
  expect(tree.root.findByType(Image).props.source).toEqual({ uri: url });
});
