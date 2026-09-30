import { Linking, Platform } from "react-native";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import { canUseNativeCamera, ensureImagePermission } from "../imagePermissions";
import { showAlert } from "../alert";

jest.mock("expo-constants", () => ({ __esModule: true, default: { nativeBuildVersion: "15" } }));
jest.mock("expo-image-picker", () => ({ getCameraPermissionsAsync: jest.fn(), requestCameraPermissionsAsync: jest.fn(), getMediaLibraryPermissionsAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn() }));
jest.mock("../alert", () => ({ showAlert: jest.fn() }));
const i18n = { t: (key) => key };
beforeEach(() => {
	jest.clearAllMocks(); Platform.OS = "android"; Constants.nativeBuildVersion = "15";
	ImagePicker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
	ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
	ImagePicker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
	jest.spyOn(Linking, "openSettings").mockResolvedValue();
});
afterEach(() => jest.restoreAllMocks());

test.each([["android", "1", true], ["ios", "14", false], ["ios", "15", true], ["ios", null, false], ["web", "15", false]])("camera capability guard for %s build %s", (platform, build, expected) => {
	expect(canUseNativeCamera(platform, build)).toBe(expected);
});
test("camera permission is requested after the explicit action, not at import", async () => {
	expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
	expect(await ensureImagePermission("camera", i18n)).toBe(true);
	expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
	expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
});
test("already granted camera access does not display another permission request", async () => {
	ImagePicker.getCameraPermissionsAsync.mockResolvedValue({ granted: true });
	expect(await ensureImagePermission("camera", i18n)).toBe(true);
	expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
});
test("permanently denied camera permission provides a settings action without another request", async () => {
	ImagePicker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
	expect(await ensureImagePermission("camera", i18n)).toBe(false);
	expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
	expect(showAlert).toHaveBeenCalledWith("warning", "cameraPermissionRequired", expect.any(Array));
	await showAlert.mock.calls[0][2][1].onPress();
	expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});
test("first denial does not silently continue to camera", async () => {
	ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
	expect(await ensureImagePermission("camera", i18n)).toBe(false);
	expect(showAlert).toHaveBeenCalledTimes(1);
});
test("late permission results cannot open prompts or continue after leaving the screen", async () => {
	let current = true;
	ImagePicker.getCameraPermissionsAsync.mockImplementation(async () => { current = false; return { granted: false }; });
	expect(await ensureImagePermission("camera", i18n, () => current)).toBe(false);
	expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
	expect(showAlert).not.toHaveBeenCalled();
});
test("old iOS Build 14 never invokes camera native permission APIs", async () => {
	Platform.OS = "ios"; Constants.nativeBuildVersion = "14";
	expect(await ensureImagePermission("camera", i18n)).toBe(false);
	expect(ImagePicker.getCameraPermissionsAsync).not.toHaveBeenCalled();
	expect(showAlert).toHaveBeenCalledWith("warning", "cameraRequiresNewBuild");
});
test("web photo selection does not request native camera or library permission", async () => {
	Platform.OS = "web";
	expect(await ensureImagePermission("library", i18n)).toBe(true);
	expect(await ensureImagePermission("camera", i18n)).toBe(false);
	expect(ImagePicker.getMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
	expect(ImagePicker.getCameraPermissionsAsync).not.toHaveBeenCalled();
});
test("settings link is ignored after leaving and settings failures have a useful message", async () => {
	let current = true;
	ImagePicker.getCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
	await ensureImagePermission("camera", i18n, () => current);
	const action = showAlert.mock.calls[0][2][1].onPress;
	current = false; await action(); expect(Linking.openSettings).not.toHaveBeenCalled();
	current = true; Linking.openSettings.mockRejectedValueOnce(new Error("not available")); await action();
	expect(showAlert).toHaveBeenLastCalledWith("warning", "imagePermissionSettingsFailed");
});
test("denied photo-library access uses its own permission message", async () => {
	ImagePicker.getMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
	expect(await ensureImagePermission("library", i18n)).toBe(false);
	expect(showAlert).toHaveBeenCalledWith("warning", "imageLibraryPermissionRequired", expect.any(Array));
});
