import { Linking, Platform } from "react-native";

function validCoordinate(value, minimum, maximum) {
	if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
	const number = Number(value);
	return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

export function externalMapUrl({ latitude, longitude, label = "Outdoor fitness facility" }, platform = Platform.OS) {
	const lat = validCoordinate(latitude, -90, 90);
	const lng = validCoordinate(longitude, -180, 180);
	if (lat == null || lng == null) return "";
	const destination = `${lat},${lng}`;
	const safeLabel = String(label || "Outdoor fitness facility")
		.normalize("NFC")
		.replace(/[\u0000-\u001F\u007F]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 100);

	if (platform === "android") {
		return `geo:${destination}?q=${encodeURIComponent(`${destination}(${safeLabel})`)}`;
	}
	if (platform === "ios") {
		return `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&q=${encodeURIComponent(safeLabel)}`;
	}
	return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export async function openExternalMap(location) {
	const url = externalMapUrl(location);
	if (!url) {
		const error = new Error("invalidMapCoordinates");
		error.code = "invalidMapCoordinates";
		throw error;
	}
	await Linking.openURL(url);
	return url;
}
