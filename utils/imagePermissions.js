import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { showAlert } from "./alert";

// Build 14 lacks the native iOS camera usage description. An OTA cannot add it;
// invoking the native permission API on that binary can terminate the app.
export function canUseNativeCamera(platform = Platform.OS, nativeBuildVersion = Constants.nativeBuildVersion) {
	return platform === "android" || (platform === "ios" && Number(nativeBuildVersion || 0) >= 15);
}

export async function ensureImagePermission(source, i18n, isCurrent = () => true) {
	if (!isCurrent()) return false;
	if (Platform.OS === "web") return source !== "camera";
	if (source === "camera" && !canUseNativeCamera()) {
		showAlert(i18n.t("warning"), i18n.t("cameraRequiresNewBuild"));
		return false;
	}
	const getPermission = source === "camera" ? ImagePicker.getCameraPermissionsAsync : ImagePicker.getMediaLibraryPermissionsAsync;
	const requestPermission = source === "camera" ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
	let permission = await getPermission();
	if (!isCurrent()) return false;
	if (!permission.granted && permission.canAskAgain !== false) permission = await requestPermission();
	if (!isCurrent()) return false;
	if (permission.granted) return true;
	showAlert(i18n.t("warning"), i18n.t(source === "camera" ? "cameraPermissionRequired" : "imageLibraryPermissionRequired"), [
		{ text: i18n.t("cancel"), style: "cancel" },
		{ text: i18n.t("imagePermissionOpenSettings"), onPress: async () => {
			if (!isCurrent()) return;
			try { await Linking.openSettings(); }
			catch { if (isCurrent()) showAlert(i18n.t("warning"), i18n.t("imagePermissionSettingsFailed")); }
		} },
	]);
	return false;
}
