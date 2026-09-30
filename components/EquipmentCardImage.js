import React, { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import EquipmentImage from "./EquipmentImage";

// Replaced photos must never reappear as a loading/error fallback. Use a neutral
// icon and cache the full URL so a newly uploaded URL gets a fresh image.
export default function EquipmentCardImage({ item, style }) {
	const identity = JSON.stringify([item.id, item.icon]);
	const currentIdentity = useRef(identity); currentIdentity.current = identity;
	const failed = useRef(null);
	const [retryKey, setRetryKey] = useState(0);
	useFocusEffect(useCallback(() => {
		if (failed.current === currentIdentity.current) setRetryKey(value => value + 1);
		failed.current = null;
	}, []));
	return <EquipmentImage imageKey={String(item.id)} source={item.icon} style={style}
		retryKey={retryKey} onError={() => { if (currentIdentity.current === identity) failed.current = identity; }} />;
}
