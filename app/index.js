import React, { useContext, useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, View, Animated, TouchableOpacity, Text, ImageBackground } from "react-native";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { RFValue } from "react-native-responsive-fontsize";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { LocaleContext } from "@/contexts/LocaleContext";

export default function HomeScreen() {
	const { ready, isAuthenticated } = useAuth();
	const { i18n } = useContext(LocaleContext);
	// null = still deciding, true = show Start cover
	const [displayStart, setDisplayStart] = useState(null);

	// Keep the Start screen, but skip it when the user already has a valid session
	// (logged-in or guest). If onboarding is done but not logged in, go to login.
	useEffect(() => {
		if (!ready) return;

		const decide = async () => {
			try {
				const agreed = await AsyncStorage.getItem("userAgreed");

				if (isAuthenticated) {
					// Already signed in (user or guest) → enter the app directly
					router.replace("/(tabs)");
					return;
				}

				if (agreed) {
					// Onboarding finished, but no session → login
					router.replace("/login");
					return;
				}

				// First launch: show Start cover
				setDisplayStart(true);
			} catch (error) {
				console.error("Error checking start-screen routing", error);
				setDisplayStart(true);
			}
		};

		decide();
	}, [ready, isAuthenticated]);

	const fadeAnim = useRef(new Animated.Value(0)).current;
	const scaleAnim = useRef(new Animated.Value(0.5)).current;
	useEffect(() => {
		if (!displayStart) return;
		Animated.parallel([
			Animated.timing(fadeAnim, {
				toValue: 1,
				duration: 1000,
				useNativeDriver: true,
			}),
			Animated.timing(scaleAnim, {
				toValue: 1,
				duration: 1000,
				useNativeDriver: true,
			}),
		]).start();
	}, [fadeAnim, scaleAnim, displayStart]);

	// While auth/onboarding is being checked, only show the background (avoid flash)
	if (!displayStart) {
		return <ImageBackground source={require("@/assets/images/background.png")} resizeMethod="cover" style={styles.background} />;
	}

	return (
		<ImageBackground source={require("@/assets/images/background.png")} resizeMethod="cover" style={styles.background}>
			<View style={styles.container}>
				<Animated.Image
					source={require("@/assets/images/logo.png")}
					style={[
						styles.logo,
						{
							opacity: fadeAnim,
							transform: [{ scale: scaleAnim }],
						},
					]}
				/>
				{/* replace so Start is not left under the navigation stack */}
				<TouchableOpacity style={styles.button} onPress={() => router.replace("/firstdisclaimer")}>
					<Text style={styles.buttonText}>{i18n.t("start")}</Text>
				</TouchableOpacity>
				<Text style={styles.appVersionText}>App version 1.0.0</Text>
			</View>
		</ImageBackground>
	);
}

const styles = StyleSheet.create({
	background: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	container: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	logo: {
		width: wp("80%"),
		resizeMode: "contain",
		marginTop: hp("10%"),
	},
	button: {
		marginTop: "auto",
		marginBottom: hp("2%"),
		paddingVertical: hp("2%"),
		paddingHorizontal: wp("35%"),
		backgroundColor: "#840B1C",
		borderRadius: 50,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.1,
		shadowRadius: 6,
		elevation: 3,
	},
	buttonText: {
		color: "white",
		width: "100%",
		fontSize: RFValue(14),
		alignSelf: "center",
	},
	appVersionText: {
		marginBottom: hp("10%"),
	},
});
