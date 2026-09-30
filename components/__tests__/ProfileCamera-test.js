import React from "react";
import renderer, { act } from "react-test-renderer";
import { Image, Platform, Text, TouchableOpacity } from "react-native";
import UserProfile from "../../app/(tabs)/setting/profile";
import * as ImagePicker from "expo-image-picker";
import { canUseNativeCamera, ensureImagePermission } from "../../utils/imagePermissions";
import { showAlert } from "../../utils/alert";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
let mockUser = { id: "person", token: "token", name: "Tester", avatarUrl: "old-photo" };
const mockUpdateProfile = jest.fn(async () => ({ success: true }));
let tree;
jest.mock("../../contexts/LocaleContext", () => ({ LocaleContext: require("react").createContext({ i18n: { t: (key) => key } }) }));
jest.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, updateProfile: mockUpdateProfile, logout: jest.fn() }) }));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("expo-router", () => ({ router: { dismissTo: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({ launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn(), UIImagePickerPresentationStyle: { FULL_SCREEN: 0 }, UIImagePickerPreferredAssetRepresentationMode: { Compatible: 0 } }));
jest.mock("../../utils/imagePermissions", () => ({ canUseNativeCamera: jest.fn(), ensureImagePermission: jest.fn() }));
jest.mock("../../utils/alert", () => ({ showAlert: jest.fn() }));
const button = (text) => tree.root.findAllByType(TouchableOpacity).find((node) => node.findAllByType(Text).some((item) => item.props.children === text));
const choose = async (key) => { await act(async () => button("changePhoto").props.onPress()); await act(async () => showAlert.mock.calls.at(-1)[2].find((item) => item.text === key).onPress()); };
beforeEach(async () => {
	jest.clearAllMocks(); mockFocused = true; mockUser = { id: "person", token: "token", name: "Tester", avatarUrl: "old-photo" }; Platform.OS = "android";
	canUseNativeCamera.mockReturnValue(true); ensureImagePermission.mockResolvedValue(true);
	ImagePicker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ base64: "camera-picture", mimeType: "image/jpeg" }] });
	ImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ base64: "library-picture", mimeType: "image/jpeg" }] });
	await act(async () => { tree = renderer.create(<UserProfile />); });
});
afterEach(async () => { if (tree) await act(async () => { tree.unmount(); tree = null; }); });

test("mount and photo-source menu do not request camera permission; repeated taps open one menu", async () => {
	expect(ensureImagePermission).not.toHaveBeenCalled();
	await act(async () => { button("changePhoto").props.onPress(); button("changePhoto").props.onPress(); });
	expect(showAlert).toHaveBeenCalledTimes(1);
	expect(ensureImagePermission).not.toHaveBeenCalled();
});
test("take photo requests camera only and the chosen image can be saved as the avatar", async () => {
	await choose("imageTakePhoto");
	expect(ensureImagePermission).toHaveBeenCalledWith("camera", expect.any(Object), expect.any(Function));
	expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ aspect: [1, 1], base64: true, mediaTypes: ["images"] }));
	expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
	await act(async () => button("saveChanges").props.onPress());
	expect(mockUpdateProfile).toHaveBeenCalledWith({ name: "Tester", avatarData: "data:image/jpeg;base64,camera-picture" });
});
test("the existing album path retains single-image editing and Android albums tab", async () => {
	await choose("imageChoosePhoto");
	expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ defaultTab: "albums", allowsEditing: true, allowsMultipleSelection: false, selectionLimit: 1 }));
	expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
});
test("permission denial and camera cancellation preserve the existing avatar", async () => {
	ensureImagePermission.mockResolvedValueOnce(false);
	await choose("imageTakePhoto"); expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
	ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true });
	await choose("imageTakePhoto");
	expect(tree.root.findByType(Image).props.source.uri).toBe("old-photo");
});
test("a late camera result after leaving and returning to the profile is discarded", async () => {
	let resolve;
	ImagePicker.launchCameraAsync.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
	await act(async () => button("changePhoto").props.onPress());
	let pending;
	await act(async () => { pending = showAlert.mock.calls.at(-1)[2].find((item) => item.text === "imageTakePhoto").onPress(); });
	mockFocused = false; await act(async () => tree.update(<UserProfile />));
	mockFocused = true; await act(async () => tree.update(<UserProfile />));
	await act(async () => { resolve({ canceled: false, assets: [{ base64: "late", mimeType: "image/jpeg" }] }); await pending; });
	expect(tree.root.findByType(Image).props.source.uri).toBe("old-photo");
});
test("an outdated photo-source dialog cannot open camera after account change", async () => {
	await act(async () => button("changePhoto").props.onPress());
	const stale = showAlert.mock.calls.at(-1)[2].find((item) => item.text === "imageTakePhoto").onPress;
	mockUser = { ...mockUser, token: "new-account" }; await act(async () => tree.update(<UserProfile />));
	await act(async () => stale());
	expect(ensureImagePermission).not.toHaveBeenCalled();
	expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
});
test("old iOS builds retain albums only with a new-build explanation", async () => {
	Platform.OS = "ios"; canUseNativeCamera.mockReturnValue(false);
	await act(async () => button("changePhoto").props.onPress());
	expect(showAlert.mock.calls.at(-1)[1]).toContain("cameraRequiresNewBuild");
	expect(showAlert.mock.calls.at(-1)[2].some((item) => item.text === "imageTakePhoto")).toBe(false);
});
test("web keeps direct photo library access without a native permission or source modal", async () => {
	Platform.OS = "web";
	await act(async () => button("changePhoto").props.onPress());
	expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
	expect(ensureImagePermission).not.toHaveBeenCalled(); expect(showAlert).not.toHaveBeenCalled();
});
test("invalid large camera image is rejected without replacing avatar", async () => {
	ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: false, assets: [{ base64: "x".repeat(2_600_001), mimeType: "image/jpeg" }] });
	await choose("imageTakePhoto");
	expect(showAlert).toHaveBeenLastCalledWith("warning", "invalidAvatar");
	expect(tree.root.findByType(Image).props.source.uri).toBe("old-photo");
});
