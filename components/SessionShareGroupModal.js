import { Ionicons } from "@expo/vector-icons";
import React, { useContext, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthContext } from "@/contexts/AuthContext";
import { LocaleContext } from "@/contexts/LocaleContext";
import { getChatConversations, sendConversationMessage } from "@/utils/api";
import { showAlert } from "@/utils/alert";
import { buildSessionSummary } from "@/utils/share";

export default function SessionShareGroupModal({ visible, session, onClose }) {
	const { user } = useContext(AuthContext);
	const { i18n, locale } = useContext(LocaleContext);
	const insets = useSafeAreaInsets();
	const [recipients, setRecipients] = useState([]);
	const [loading, setLoading] = useState(false);
	const [sendingId, setSendingId] = useState(null);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!visible) return undefined;
		let active = true;
		setLoading(true);
		setError("");
		getChatConversations(user?.token)
			.then((result) => {
				if (!active) return;
				// Every conversation the signed-in user belongs to is a valid share
				// destination. Participants may share to their groups and to a direct
				// conversation even though only staff can create those conversations.
				setRecipients(
					(result.conversations || []).filter(
						(conversation) => conversation?.id && ["group", "direct"].includes(conversation.type),
					),
				);
			})
			.catch(() => active && setError(i18n.t("shareRecipientLoadFailed")))
			.finally(() => active && setLoading(false));
		return () => {
			active = false;
		};
	}, [i18n, user?.token, visible]);

	const sendToRecipient = async (recipient) => {
		if (!session || sendingId) return;
		setSendingId(recipient.id);
		setError("");
		try {
			const summary = await buildSessionSummary(session, i18n, locale);
			await sendConversationMessage(user.token, recipient.id, { type: "text", text: summary });
			onClose();
			showAlert("", i18n.t("sessionSharedToNamedRecipient", { name: recipient.otherUserName || recipient.title }));
		} catch {
			setError(i18n.t("shareRecipientFailed"));
		} finally {
			setSendingId(null);
		}
	};

	return (
		<Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
			<View style={styles.overlay}>
				<TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
				<View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
					<View style={styles.handle} />
					<View style={styles.header}>
						<View style={styles.titleWrap}>
							<Text style={styles.title}>{i18n.t("selectShareRecipient")}</Text>
							<Text style={styles.hint}>{i18n.t("selectShareRecipientHint")}</Text>
						</View>
						<TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityRole="button">
							<Ionicons name="close" size={25} color="#444" />
						</TouchableOpacity>
					</View>

					{loading ? (
						<View style={styles.statusBox}>
							<ActivityIndicator size="large" color="#840B1C" />
							<Text style={styles.statusText}>{i18n.t("loadingShareRecipients")}</Text>
						</View>
					) : (
						<FlatList
							data={recipients}
							keyExtractor={(item) => item.id}
							contentContainerStyle={recipients.length ? styles.list : styles.emptyList}
							ListEmptyComponent={
								<View style={styles.statusBox}>
									<Ionicons name="chatbubbles-outline" size={44} color="#AAA" />
									<Text style={styles.emptyTitle}>{i18n.t("noShareRecipients")}</Text>
									<Text style={styles.statusText}>{i18n.t("noShareRecipientsHint")}</Text>
								</View>
							}
							renderItem={({ item }) => {
								const sending = sendingId === item.id;
								const isGroup = item.type === "group";
								const displayName = isGroup ? item.title : item.otherUserName || item.title;
								return (
									<TouchableOpacity
										style={[styles.groupRow, sendingId && !sending && styles.disabledRow]}
										onPress={() => sendToRecipient(item)}
										disabled={!!sendingId}
									>
										<View style={styles.groupIcon}>
											<Ionicons name={isGroup ? "people" : "person"} size={24} color="#840B1C" />
										</View>
										<View style={styles.groupInfo}>
											<Text style={styles.groupTitle}>{displayName}</Text>
											<Text style={styles.groupMeta}>
												{isGroup ? i18n.t("groupMemberCount", { count: item.memberCount || 0 }) : i18n.t("directConversation")}
											</Text>
										</View>
										{sending ? <ActivityIndicator color="#840B1C" /> : <Ionicons name="chevron-forward" size={22} color="#999" />}
									</TouchableOpacity>
								);
							}}
						/>
					)}
					{!!error && <Text style={styles.error}>{error}</Text>}
				</View>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.38)" },
	backdrop: { ...StyleSheet.absoluteFillObject },
	sheet: { maxHeight: "72%", minHeight: 330, backgroundColor: "#FFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18 },
	handle: { width: 46, height: 5, borderRadius: 3, backgroundColor: "#D5D5D5", alignSelf: "center", marginTop: 10, marginBottom: 12 },
	header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
	titleWrap: { flex: 1 },
	title: { fontSize: 22, lineHeight: 29, fontWeight: "800", color: "#222" },
	hint: { marginTop: 5, fontSize: 13, lineHeight: 19, color: "#707070" },
	closeButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "#F3F3F3", marginLeft: 12 },
	list: { paddingVertical: 5 },
	emptyList: { flexGrow: 1, justifyContent: "center" },
	groupRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 12, marginBottom: 9, borderRadius: 14, borderWidth: 1, borderColor: "#E6E0E1", backgroundColor: "#FFF" },
	disabledRow: { opacity: 0.5 },
	groupIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#F5E9EB", marginRight: 12 },
	groupInfo: { flex: 1, minWidth: 0 },
	groupTitle: { fontSize: 16, fontWeight: "700", color: "#222" },
	groupMeta: { marginTop: 4, fontSize: 12, color: "#777" },
	statusBox: { alignItems: "center", justifyContent: "center", paddingHorizontal: 24, paddingVertical: 34 },
	emptyTitle: { marginTop: 12, fontSize: 17, fontWeight: "700", color: "#444" },
	statusText: { marginTop: 8, fontSize: 13, lineHeight: 19, textAlign: "center", color: "#777" },
	error: { marginTop: 8, marginBottom: 6, padding: 10, borderRadius: 9, textAlign: "center", color: "#A3132B", backgroundColor: "#FCECEF" },
});
