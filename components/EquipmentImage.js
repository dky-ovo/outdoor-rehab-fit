import React, { useMemo, useState } from "react";
import { Image } from "expo-image";
import { equipmentImageSource, EQUIPMENT_IMAGE_PLACEHOLDER } from "../utils/equipmentCatalog";
import useEquipmentImageSource from "../hooks/useEquipmentImageSource";

function EquipmentImageView({ source, identity, style, contentFit, onError, testID }) {
	const image = useEquipmentImageSource(source);
	const [failedSource, setFailedSource] = useState(null);
	const failed = failedSource !== null && failedSource === image.source;
	return <Image
		testID={testID}
		source={failed || !image.source ? EQUIPMENT_IMAGE_PLACEHOLDER : image.source}
		placeholder={EQUIPMENT_IMAGE_PLACEHOLDER}
		style={style}
		contentFit={contentFit}
		placeholderContentFit={contentFit}
		cachePolicy="memory-disk"
		allowDownscaling
		transition={0}
		recyclingKey={identity}
		onError={() => {
			if (!image.onError()) {
				setFailedSource(() => image.source);
				onError?.();
			}
		}}
	/>;
}

// Cards, teaching headers, demonstrations and the expanded image all use the
// same native renderer. A decoded local main image can be reused across views.
export default function EquipmentImage({ source, imageKey = "", retryKey = 0, style, contentFit = "cover", onError, testID }) {
	const input = source && typeof source === "object" ? source.uri : source;
	const normalized = useMemo(() => equipmentImageSource(input), [input]);
	const identity = JSON.stringify([imageKey, normalized, retryKey]);
	return <EquipmentImageView key={identity} source={normalized} identity={identity}
		style={style} contentFit={contentFit} onError={onError} testID={testID} />;
}
