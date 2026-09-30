import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { equipmentImageSource, EQUIPMENT_IMAGE_PLACEHOLDER } from "../utils/equipmentCatalog";
import { equipmentAssetKey } from "../utils/equipmentImageMemory";
import { hydrateEquipmentImages, equipmentImageSnapshot, subscribeEquipmentImages,
	pinEquipmentImage, invalidateEquipmentImage, equipmentDecodedImageSnapshot, equipmentBundledImageRetired } from "../utils/equipmentOfflineImages";

export default function useEquipmentImageSource(value) {
	const source = useMemo(() => equipmentImageSource(value), [value]);
	const remoteUrl = typeof source?.uri === "string" && /^https:\/\//i.test(source.uri) ? source.uri : "";
	const assetKey = equipmentAssetKey(source);
	const getRetired = useCallback(() => assetKey ? equipmentBundledImageRetired?.(assetKey) || false : false, [assetKey]);
	const retired = useSyncExternalStore(subscribeEquipmentImages, getRetired, () => false);
	const getSnapshot = useCallback(() => remoteUrl ? equipmentImageSnapshot(remoteUrl) : "", [remoteUrl]);
	const cached = useSyncExternalStore(subscribeEquipmentImages, getSnapshot, () => "");
	const getDecoded = useCallback(() => assetKey ? equipmentDecodedImageSnapshot?.(assetKey, assetKey) || null
		: cached && remoteUrl ? equipmentDecodedImageSnapshot?.(remoteUrl, cached) || null : null, [cached, remoteUrl, assetKey]);
	const decoded = useSyncExternalStore(subscribeEquipmentImages, getDecoded, () => null);
	useEffect(() => { if (remoteUrl) void hydrateEquipmentImages(); }, [remoteUrl]);
	const localUri = cached || (typeof source?.uri === "string" && source.uri.startsWith("file://") ? source.uri : "");
	const pinnedSource = retired ? "" : localUri || assetKey;
	useEffect(() => pinnedSource ? pinEquipmentImage(pinnedSource) : undefined, [pinnedSource]);
	const onError = useCallback(() => {
		if (!cached || !remoteUrl) return false;
		invalidateEquipmentImage(remoteUrl, cached);
		return true;
	}, [cached, remoteUrl]);
	const rendered = useMemo(() => retired ? EQUIPMENT_IMAGE_PLACEHOLDER : decoded || (cached ? { uri: cached }
		: remoteUrl && cached === null ? EQUIPMENT_IMAGE_PLACEHOLDER : source), [decoded, cached, remoteUrl, source, retired]);
	return { source: rendered, onError };
}
