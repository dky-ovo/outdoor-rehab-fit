import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { useAuth } from "../../../contexts/AuthContext";
import { showAlert } from "../../../utils/alert";
import { canUseNativeCamera, ensureImagePermission } from "../../../utils/imagePermissions";

export default function UserProfile() {
	const { i18n } = useContext(LocaleContext);
	const { user, updateProfile, logout } = useAuth();
	const [name, setName] = useState(user?.name || "");
	const [avatarData, setAvatarData] = useState(user?.avatarUrl || "");
	const [avatarChanged, setAvatarChanged] = useState(false);
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [saving, setSaving] = useState(false);
	const [passwordModalVisible, setPasswordModalVisible] = useState(false);
	const [passwordSaving, setPasswordSaving] = useState(false);
	const savingRef = useRef(false);
	const choosingPhotoRef = useRef(false);
	const photoOptionsRef = useRef(false);
	const photoGeneration = useRef(0);
	const isFocused = useIsFocused();
	const focusedRef = useRef(isFocused);
	focusedRef.current = isFocused;
	useEffect(() => {
		photoGeneration.current += 1;
		photoOptionsRef.current = false;
		return () => { photoGeneration.current += 1; };
	}, [isFocused, user?.token]);
	const initials = useMemo(() => String(name || "U").trim().slice(0, 1).toUpperCase(), [name]);

	const pickPhoto = async (source, generation = photoGeneration.current) => {
		const isCurrent = () => focusedRef.current && generation === photoGeneration.current;
		if (!isCurrent() || choosingPhotoRef.current || savingRef.current) return;
		choosingPhotoRef.current = true;
		try {
			if (Platform.OS !== "web" && !(await ensureImagePermission(source, i18n, isCurrent))) return;
			if (!isCurrent()) return;
			const launch = source === "camera" ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
			const result = await launch({
				mediaTypes: ["images"],
				allowsEditing: true,
				allowsMultipleSelection: false,
				selectionLimit: 1,
				aspect: [1, 1],
				quality: 0.3,
				base64: true,
				...(source !== "camera" && Platform.OS === "android" ? { defaultTab: "albums", legacy: false } : {}),
				...(source !== "camera" && Platform.OS === "ios" ? {
					presentationStyle: ImagePicker.UIImagePickerPresentationStyle.FULL_SCREEN,
					preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
				} : {}),
			});
			if (result.canceled || !isCurrent()) return;
			const asset = result.assets?.[0];
			if (!asset?.base64) {
				showAlert(i18n.t("warning"), i18n.t("invalidAvatar"));
				return;
			}
			const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType) ? asset.mimeType : "image/jpeg";
			// The server accepts a decoded image of at most 2 MB. Keep a small
			// margin for the data URL and JSON envelope.
			if (asset.base64.length > 2_600_000) {
				showAlert(i18n.t("warning"), i18n.t("invalidAvatar"));
				return;
			}
			setAvatarData(`data:${mimeType};base64,${asset.base64}`);
			setAvatarChanged(true);
		} catch (error) {
			console.warn("Unable to choose profile photo", error);
			if (isCurrent()) showAlert(i18n.t("warning"), i18n.t(source === "camera" ? "imageCameraFailed" : "photoPickerFailed"));
		} finally { choosingPhotoRef.current = false; }
	};
	const choosePhoto = () => {
		if (!focusedRef.current || choosingPhotoRef.current || photoOptionsRef.current || savingRef.current) return;
		if (Platform.OS === "web") return pickPhoto("library");
		const generation = photoGeneration.current;
		photoOptionsRef.current = true;
		const select = (source) => {
			photoOptionsRef.current = false;
			return pickPhoto(source, generation);
		};
		const cameraEnabled = canUseNativeCamera();
		showAlert(i18n.t("changePhoto"), [i18n.t("imagePhotoSource"), ...(!cameraEnabled ? [i18n.t("cameraRequiresNewBuild")] : [])].join("\n\n"), [
			{ text: i18n.t("cancel"), style: "cancel", onPress: () => { photoOptionsRef.current = false; } },
			...(cameraEnabled ? [{ text: i18n.t("imageTakePhoto"), onPress: () => select("camera") }] : []),
			{ text: i18n.t("imageChoosePhoto"), onPress: () => select("library") },
		]);
	};

	const save = async () => {
		if (savingRef.current) return;
		const trimmedName = name.trim();
		if (!trimmedName) return showAlert(i18n.t("warning"), i18n.t("invalidName"));
		savingRef.current = true;
		setSaving(true);
		const payload = { name: trimmedName };
		if (avatarChanged) payload.avatarData = avatarData;
		const result = await updateProfile(payload);
		savingRef.current = false;
		setSaving(false);
		if (!focusedRef.current || result.error === "sessionChanged") return;
		if (!result.success) {
			const knownErrors = ["invalidCurrentPassword", "passwordTooShort", "invalidAvatar", "invalidName", "networkError"];
			return showAlert(i18n.t("warning"), i18n.t(knownErrors.includes(result.error) ? result.error : "profileUpdateFailed"));
		}
		showAlert(i18n.t("userProfile"), i18n.t("profileSaved"), [{ text: i18n.t("confirm"), onPress: () => router.dismissTo("/(tabs)/setting") }]);
	};

	const closePasswordModal = () => {
		if (passwordSaving) return;
		setPasswordModalVisible(false);
		setCurrentPassword("");
		setNewPassword("");
		setConfirmPassword("");
	};

	const changePassword = async () => {
		if (savingRef.current) return;
		if (!currentPassword) return showAlert(i18n.t("warning"), i18n.t("currentPasswordRequired"));
		if (newPassword.length < 8) return showAlert(i18n.t("warning"), i18n.t("passwordTooShort"));
		if (newPassword !== confirmPassword) return showAlert(i18n.t("warning"), i18n.t("passwordsDoNotMatch"));
		savingRef.current = true;
		setPasswordSaving(true);
		const result = await updateProfile({ currentPassword, newPassword });
		savingRef.current = false;
		setPasswordSaving(false);
		if (!result.success) {
			if (!focusedRef.current || result.error === "sessionChanged") return;
			const knownErrors = ["invalidCurrentPassword", "passwordTooShort", "networkError"];
			return showAlert(i18n.t("warning"), i18n.t(knownErrors.includes(result.error) ? result.error : "profileUpdateFailed"));
		}
		setPasswordModalVisible(false);
		showAlert(i18n.t("changePassword"), i18n.t("passwordChangedLogout"), [{ text: i18n.t("confirm") }]);
		await logout();
	};

	return <><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
		<View style={styles.avatarWrap}>
			<View style={styles.avatar}>{avatarData ? <Image source={{ uri: avatarData }} style={styles.avatarImage} /> : <Text style={styles.initials}>{initials}</Text>}</View>
			<TouchableOpacity style={styles.photoButton} onPress={choosePhoto}><Ionicons name="camera" size={20} color="#fff" /><Text style={styles.photoButtonText}>{i18n.t("changePhoto")}</Text></TouchableOpacity>
			{avatarData ? <TouchableOpacity onPress={() => { setAvatarData(""); setAvatarChanged(true); }}><Text style={styles.removeText}>{i18n.t("removePhoto")}</Text></TouchableOpacity> : null}
			<Text style={styles.hint}>{i18n.t("profilePhotoHint")}</Text>
		</View>
		<Text style={styles.label}>{i18n.t("username")}</Text>
		<TextInput style={styles.input} value={name} onChangeText={setName} maxLength={50} autoCapitalize="words" />
		<TouchableOpacity style={styles.passwordButton} onPress={() => setPasswordModalVisible(true)}><Ionicons name="key-outline" size={22} color="#840B1C" /><View style={styles.passwordButtonText}><Text style={styles.passwordButtonTitle}>{i18n.t("changePassword")}</Text><Text style={styles.passwordButtonHint}>{i18n.t("changePasswordHint")}</Text></View><Ionicons name="chevron-forward" size={22} color="#777" /></TouchableOpacity>
		<TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{i18n.t("saveChanges")}</Text>}</TouchableOpacity>
	</ScrollView>
	<Modal visible={passwordModalVisible} transparent animationType="fade" onRequestClose={closePasswordModal}>
		<KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
			<View style={styles.passwordModal}>
				<View style={styles.modalHeader}><View style={styles.keyCircle}><Ionicons name="key" size={26} color="#840B1C" /></View><View style={{ flex: 1 }}><Text style={styles.modalTitle}>{i18n.t("changePassword")}</Text><Text style={styles.modalHint}>{i18n.t("passwordLogoutHint")}</Text></View></View>
				<Text style={styles.label}>{i18n.t("currentPassword")}</Text>
				<TextInput style={styles.input} value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" autoFocus />
				<Text style={styles.label}>{i18n.t("newPassword")}</Text>
				<TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
				<Text style={styles.label}>{i18n.t("confirmNewPassword")}</Text>
				<TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoCapitalize="none" />
				<View style={styles.modalActions}><TouchableOpacity style={styles.modalCancel} onPress={closePasswordModal} disabled={passwordSaving}><Text style={styles.modalCancelText}>{i18n.t("cancel")}</Text></TouchableOpacity><TouchableOpacity style={[styles.modalConfirm, passwordSaving && styles.disabled]} onPress={changePassword} disabled={passwordSaving}>{passwordSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>{i18n.t("changePassword")}</Text>}</TouchableOpacity></View>
			</View>
		</KeyboardAvoidingView>
	</Modal></>;
}

const styles = StyleSheet.create({
	page: { padding: 24, paddingBottom: 80, backgroundColor: "#fff" },
	avatarWrap: { alignItems: "center", marginBottom: 24 },
	avatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: "#F0E2E5", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 14 },
	avatarImage: { width: "100%", height: "100%" }, initials: { fontSize: 40, fontWeight: "800", color: "#840B1C" },
	photoButton: { minHeight: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: "#840B1C", flexDirection: "row", alignItems: "center", gap: 8 },
	photoButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 }, removeText: { color: "#B00020", marginTop: 12, fontWeight: "600" },
	hint: { color: "#777", fontSize: 13, marginTop: 8, lineHeight: 19 }, label: { color: "#333", fontSize: 15, fontWeight: "700", marginBottom: 8, marginTop: 14 },
	input: { minHeight: 50, borderWidth: 1, borderColor: "#D8D8D8", borderRadius: 10, paddingHorizontal: 14, fontSize: 16, color: "#222", backgroundColor: "#FAFAFA" },
	passwordButton: { minHeight: 76, marginTop: 24, borderWidth: 1, borderColor: "#E6D5D8", borderRadius: 12, backgroundColor: "#FFF9FA", flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
	passwordButtonText: { flex: 1, marginHorizontal: 13 }, passwordButtonTitle: { fontSize: 16, fontWeight: "800", color: "#333" }, passwordButtonHint: { fontSize: 12, color: "#777", marginTop: 4 },
	saveButton: { height: 54, borderRadius: 12, backgroundColor: "#B00020", alignItems: "center", justifyContent: "center", marginTop: 30 }, saveText: { color: "#fff", fontSize: 18, fontWeight: "800" }, disabled: { opacity: 0.65 },
	modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.46)", justifyContent: "center", padding: 22 },
	passwordModal: { width: "100%", maxWidth: 480, alignSelf: "center", borderRadius: 18, backgroundColor: "#fff", padding: 20 },
	modalHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }, keyCircle: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "#F6E7EA" },
	modalTitle: { fontSize: 20, fontWeight: "900", color: "#222" }, modalHint: { fontSize: 12, lineHeight: 17, color: "#777", marginTop: 3 },
	modalActions: { flexDirection: "row", gap: 10, marginTop: 24 }, modalCancel: { flex: 1, minHeight: 48, borderRadius: 10, backgroundColor: "#EFEFEF", alignItems: "center", justifyContent: "center" }, modalCancelText: { color: "#444", fontSize: 15, fontWeight: "700" },
	modalConfirm: { flex: 1.35, minHeight: 48, borderRadius: 10, backgroundColor: "#B00020", alignItems: "center", justifyContent: "center" }, modalConfirmText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
