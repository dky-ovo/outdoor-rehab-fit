import React, { useContext } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Image } from "react-native";
import { router } from "expo-router";
import { FontAwesome, Ionicons } from "@expo/vector-icons";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { useAuth } from "../../../contexts/AuthContext";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { showAlert } from "../../../utils/alert";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

const Setting = () => {
	useAndroidBackTarget("/(tabs)");
	const { i18n, changeLanguage } = useContext(LocaleContext);
	const { user, isGuest, isUser, isAuthenticated, logout, resetOnboarding } = useAuth();

	const handleLogout = () => {
		showAlert(i18n.t("logout"), i18n.t("logoutConfirm"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{
				text: i18n.t("confirm"),
				style: "destructive",
				onPress: async () => {
					await logout();
				},
			},
		]);
	};

	const handleResetOnboarding = () => {
		showAlert(i18n.t("resetOnboarding"), i18n.t("resetOnboardingConfirm"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{
				text: i18n.t("confirm"),
				style: "destructive",
				onPress: async () => {
					await resetOnboarding();
				},
			},
		]);
	};

	const handleLoginNow = () => {
		router.push({ pathname: "/login", params: { from: "settings" } });
	};

	const handleRegister = () => {
		router.push({ pathname: "/register", params: { from: "settings" } });
	};

	const showLogout = isUser || (isAuthenticated && !isGuest && user?.name !== "guest");

	return (
		<ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
			<View style={styles.accountCard}>
				<View style={styles.accountText}>
				<Text style={styles.accountLabel}>
					{isGuest || user?.name === "guest" ? i18n.t("guestMode") : i18n.t("loggedInAs")}
				</Text>
				<Text style={styles.accountName}>{isGuest ? i18n.t("guestMode") : user?.name ?? "-"}</Text>
				{!isGuest && user?.phone ? (
					<Text style={styles.accountMeta}>
						{i18n.t("accountPhone")}: {user.phone}
					</Text>
				) : null}
				{!isGuest && user?.profileRole ? (
					<Text style={styles.accountMeta}>
						{i18n.t("accountRole")}: {i18n.t(`profileRole_${user.profileRole}`)}
					</Text>
				) : null}
				{isGuest && <Text style={styles.accountHint}>{i18n.t("loginNowHint")}</Text>}
				</View>
				{!isGuest ? (
					<View style={styles.accountAvatar}>
						{user?.avatarUrl ? <Image source={{ uri: user.avatarUrl }} style={styles.accountAvatarImage} /> : <Ionicons name="person" size={34} color="#840B1C" />}
					</View>
				) : null}
			</View>

			{showLogout ? (
				<>
				<TouchableOpacity style={styles.profileBar} onPress={() => router.push("/setting/profile")}>
					<FontAwesome name="user-circle" size={RFValue(24)} color="#840B1C" />
					<View style={styles.profileBarText}>
						<Text style={styles.profileBarTitle}>{i18n.t("userProfile")}</Text>
						<Text style={styles.profileBarHint}>{i18n.t("editProfile")}</Text>
					</View>
					<Ionicons name="chevron-forward" size={24} color="#777" />
				</TouchableOpacity>
				<TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout}>
					<FontAwesome name="sign-out" size={RFValue(30)} color="white" />
					<Text style={styles.buttonText}>{i18n.t("logout")}</Text>
				</TouchableOpacity>
				</>
			) : (
				<>
					<TouchableOpacity style={[styles.button, styles.loginNowButton]} onPress={handleLoginNow}>
						<FontAwesome name="sign-in" size={RFValue(30)} color="white" />
						<Text style={styles.buttonText}>{i18n.t("loginNow")}</Text>
					</TouchableOpacity>
					<TouchableOpacity style={[styles.button, styles.registerButton]} onPress={handleRegister}>
						<FontAwesome name="user-plus" size={RFValue(30)} color="white" />
						<Text style={styles.buttonText}>{i18n.t("registerButton")}</Text>
					</TouchableOpacity>
				</>
			)}

			<TouchableOpacity style={styles.button} onPress={changeLanguage}>
				<FontAwesome name="language" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("changeLanguage")}</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.button}
				accessibilityRole="button"
				onPress={() => router.push("/setting/contact")}
			>
				<FontAwesome name="envelope" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("contactUs")}</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.button}
				onPress={() => {
					router.push(`/setting/about`);
				}}
				testID="settings-about-app"
				accessibilityRole="button"
			>
				<FontAwesome name="info-circle" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("aboutApp")}</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.button}
				onPress={() => {
					router.push(`/setting/info`);
				}}
				testID="settings-about-team"
				accessibilityRole="button"
			>
				<FontAwesome name="users" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("aboutTeam")}</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.button}
				onPress={() => {
					router.push(`/setting/disclaimer`);
				}}
			>
				<FontAwesome name="exclamation-triangle" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("settingDisclaimer")}</Text>
			</TouchableOpacity>
			<TouchableOpacity
				style={styles.button}
				testID="settings-privacy-policy"
				accessibilityRole="button"
				onPress={() => router.push("/setting/privacy")}
			>
				<FontAwesome name="shield" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("privacyPolicy")}</Text>
			</TouchableOpacity>
			<TouchableOpacity style={[styles.button, styles.resetButton]} onPress={handleResetOnboarding}>
				<FontAwesome name="refresh" size={RFValue(30)} color="white" />
				<Text style={styles.buttonText}>{i18n.t("resetOnboarding")}</Text>
			</TouchableOpacity>
		</ScrollView>
	);
};

const styles = StyleSheet.create({
	container: {
		alignItems: "center",
		paddingBottom: hp("15%"),
		paddingTop: hp("1%"),
	},
	accountCard: {
		width: wp("80%"),
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#f8f9fa",
		borderRadius: 12,
		padding: 16,
		marginVertical: 10,
	},
	accountText: { flex: 1, paddingRight: 12 },
	accountAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#F2E4E7", alignItems: "center", justifyContent: "center", overflow: "hidden" },
	accountAvatarImage: { width: "100%", height: "100%" },
	profileBar: { width: wp("80%"), minHeight: 76, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E6D5D8", flexDirection: "row", alignItems: "center", paddingHorizontal: 18, margin: 10 },
	profileBarText: { flex: 1, marginHorizontal: 14 },
	profileBarTitle: { fontSize: RFValue(16), fontWeight: "700", color: "#333" },
	profileBarHint: { fontSize: RFValue(11), color: "#777", marginTop: 4 },
	accountLabel: {
		fontSize: RFValue(12),
		color: "#888",
		marginBottom: 4,
	},
	accountName: {
		fontSize: RFValue(18),
		fontWeight: "bold",
		color: "#333",
	},
	accountMeta: {
		fontSize: RFValue(13),
		color: "#555",
		marginTop: 6,
	},
	accountHint: {
		fontSize: RFValue(12),
		color: "#840B1C",
		marginTop: 8,
		lineHeight: RFValue(18),
	},
	logoutButton: {
		backgroundColor: "#B00020",
	},
	loginNowButton: {
		backgroundColor: "#840B1C",
	},
	registerButton: {
		backgroundColor: "#007BFF",
	},
	resetButton: {
		backgroundColor: "#6C757D",
	},
	button: {
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#007BFF",
		borderRadius: 10,
		padding: 20,
		margin: 10,
		width: wp("80%"),
		height: hp("15%"),
	},
	buttonText: {
		color: "white",
		marginTop: hp("1%"),
		fontSize: RFValue(18),
		fontWeight: "bold",
	},
});

export default Setting;
