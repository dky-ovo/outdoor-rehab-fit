import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { pickAdminMedia } from "../pickAdminMedia";
jest.mock("expo-image-picker", () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
const originalOs = Platform.OS;
beforeEach(() => { jest.clearAllMocks(); Platform.OS = "android"; ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true }); });
afterEach(() => { Platform.OS = originalOs; });
test("native upload streams a URI body rather than copying video into JavaScript memory", async () => {
	ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///video.mp4", fileName: "video.mp4", mimeType: "video/mp4", fileSize: 200 * 1024 * 1024 }] });
	await expect(pickAdminMedia("video")).resolves.toEqual({ name: "video.mp4", type: "video/mp4", size: 200 * 1024 * 1024, blob: { uri: "file:///video.mp4" } });
});
test("native oversized videos are rejected before reading bytes", async () => {
	ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///video.mp4", fileName: "video.mp4", mimeType: "video/mp4", fileSize: 251 * 1024 * 1024 }] });
	await expect(pickAdminMedia("video")).rejects.toThrow("mediaFileTooLarge");
});
test("native picker denial and cancellation do not upload", async () => {
	ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false });
	await expect(pickAdminMedia("video")).rejects.toThrow("mediaPermissionDenied");
	expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
	ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
	await expect(pickAdminMedia("gif")).resolves.toBeNull();
});
