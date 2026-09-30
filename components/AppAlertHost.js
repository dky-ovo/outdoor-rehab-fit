import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { setAppAlertHandler, dismissAppAlert } from "@/utils/alert";

const PRIMARY_RED = "#a5001e";

export default function AppAlertHost() {
	const [alerts, setAlerts] = useState([]);
	const current = alerts[0] || null;
	const handledAlertId = useRef(0);

	useEffect(() => setAppAlertHandler((alert) => {
		if (alert.replaceAll) handledAlertId.current = Math.max(handledAlertId.current, alert.id - 1);
		setAlerts((items) => alert.replaceAll ? [alert] : [...items, alert]);
	}), []);

	const buttons = useMemo(() => {
		if (!current) return [];
		return [...current.buttons].sort((left, right) => {
			if (left.style === "cancel") return -1;
			if (right.style === "cancel") return 1;
			return 0;
		});
	}, [current]);

	const closeWith = (button) => {
		if (!current || handledAlertId.current >= current.id) return;
		handledAlertId.current = current.id;
		dismissAppAlert(current.id);
		setAlerts((items) => items.filter((alert) => alert.id !== current.id));
		requestAnimationFrame(() => {
			Promise.resolve().then(() => button?.onPress?.()).catch(() => {});
		});
	};

	const closeFromSystem = () => {
		const cancelButton = buttons.find((button) => button.style === "cancel");
		if (cancelButton) closeWith(cancelButton);
	};

	const vertical = buttons.length > 2;

	return (
		<Modal
			// Web portals are ordered when mounted, even while hidden. Mount a new
			// alert above an already-open form, keeping its key during the fade-out.
			key={Platform.OS === "web" ? current?.id ?? handledAlertId.current : "app-alert"}
			visible={Boolean(current)}
			transparent
			animationType="fade"
			statusBarTranslucent
			onRequestClose={closeFromSystem}
		>
			<View style={styles.backdrop}>
				<View style={styles.card} accessibilityViewIsModal>
					<ScrollView
						style={styles.contentScroll}
						contentContainerStyle={styles.contentContainer}
						showsVerticalScrollIndicator
					>
						{current?.title ? <Text style={styles.title}>{current.title}</Text> : null}
						{current?.message ? <Text style={styles.message}>{current.message}</Text> : null}
					</ScrollView>
					<View style={[styles.actions, vertical && styles.verticalActions]}>
						{buttons.map((button, index) => {
							const secondary = button.style === "cancel" || (buttons.length > 1 && index === 0);
							return (
								<Pressable
									key={`${button.text || "button"}-${index}`}
									accessibilityRole="button"
									style={({ pressed }) => [
										styles.button,
										vertical && styles.verticalButton,
										secondary ? styles.secondaryButton : styles.primaryButton,
										pressed && styles.pressedButton,
									]}
									onPress={() => closeWith(button)}
								>
									<Text style={[styles.buttonText, secondary ? styles.secondaryText : styles.primaryText]}>
										{button.text || "OK"}
									</Text>
								</Pressable>
							);
						})}
					</View>
				</View>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
		backgroundColor: "rgba(0, 0, 0, 0.48)",
	},
	card: {
		width: "100%",
		maxWidth: 420,
		maxHeight: "84%",
		paddingHorizontal: 24,
		paddingTop: 26,
		paddingBottom: 20,
		borderRadius: 22,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000000",
		shadowOpacity: 0.2,
		shadowRadius: 18,
		shadowOffset: { width: 0, height: 8 },
		elevation: 12,
	},
	contentScroll: { flexShrink: 1 },
	contentContainer: { paddingBottom: 24 },
	title: {
		color: "#222222",
		fontSize: 21,
		fontWeight: "800",
		textAlign: "center",
		lineHeight: 29,
		marginBottom: 10,
	},
	message: {
		color: "#555555",
		fontSize: 16,
		lineHeight: 24,
		textAlign: "center",
	},
	actions: { flexDirection: "row", gap: 12 },
	verticalActions: { flexDirection: "column" },
	button: {
		flex: 1,
		minHeight: 50,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 14,
		borderRadius: 14,
	},
	verticalButton: { flex: 0, width: "100%" },
	secondaryButton: { backgroundColor: "#ECEDEF" },
	primaryButton: { backgroundColor: PRIMARY_RED },
	pressedButton: { opacity: 0.78 },
	buttonText: { fontSize: 16, fontWeight: "800", textAlign: "center" },
	secondaryText: { color: "#333333" },
	primaryText: { color: "#FFFFFF" },
});
