import React, { useContext } from "react";
import { View, Text, FlatList, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { router } from "expo-router";
import { RFValue } from "react-native-responsive-fontsize";
import { heightPercentageToDP as hp } from "react-native-responsive-screen";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { useAuth } from "../../../contexts/AuthContext";
import EquipmentCardImage from "../../../components/EquipmentCardImage";
import { useFavorites } from "../../../hooks/useFavorites";

const Favourite = () => {
	useAndroidBackTarget("/(tabs)");
	const { i18n, locale, textRevision } = useContext(LocaleContext);
	const { isGuest, canAccessEquipment, user } = useAuth();
	const { bookmarkedItems, bookmarked, learning, loading, toggleBookmark } = useFavorites({ user, isGuest, canAccessEquipment, i18n, locale, textRevision });
	const buttons = [
		{ icon: require("@/assets/icons/outdoor/list.png"), text: i18n.t("all") },
		{ icon: require("@/assets/icons/outdoor/muscle.png"), text: i18n.t("muscle") },
		{ icon: require("@/assets/icons/outdoor/flexibility.png"), text: i18n.t("mobility") },
		{ icon: require("@/assets/icons/outdoor/balance.png"), text: i18n.t("balance") },
		{ icon: require("@/assets/icons/outdoor/aerobic.png"), text: i18n.t("aerobic") },
		{ icon: require("@/assets/icons/outdoor/wheelchair.png"), text: i18n.t("wheelchair") },
		{ icon: require("@/assets/icons/outdoor/multi.png"), text: i18n.t("multifunctional") },
		{ icon: require("@/assets/icons/outdoor/relax.png"), text: i18n.t("relaxation") },
	];
	const renderCategoryIcons = (categories) => {
		return (
			<View style={styles.iconRow}>
				{categories.map((category) => {
					const button = buttons.find((btn) => btn.text === i18n.t(category));
					return button ? <Image key={category} source={button.icon} style={styles.categoryIcon} /> : null;
				})}
			</View>
		);
	};

	return (
		<View style={styles.container}>
			<FlatList
				data={bookmarkedItems}
				contentContainerStyle={{ paddingTop: 16, paddingBottom: hp("15%") }}
				keyExtractor={(item) => item.id.toString()}
				renderItem={({ item }) => (
					<TouchableOpacity
						onPress={() => router.push({ pathname: "/favorite/detail", params: { id: String(item.id), name: item.name, from: "favorite" } })}
						style={styles.card}
					>
						<EquipmentCardImage item={item} style={styles.image} />
						<View style={styles.info}>
							<Text style={styles.name}>{item.name}</Text>
							{/* App Upgrade #10: read / watched / listened badges */}
							<View style={styles.progressRow}>
								<Ionicons
									name={learning[item.id]?.read ? "book" : "book-outline"}
									size={20}
									color={learning[item.id]?.read ? "#2E8B57" : "#bbb"}
								/>
								<Ionicons
									name={learning[item.id]?.watched ? "videocam" : "videocam-outline"}
									size={20}
									color={learning[item.id]?.watched ? "#2E8B57" : "#bbb"}
									style={{ marginLeft: 8 }}
								/>
								<Ionicons
									name={learning[item.id]?.listened ? "volume-high" : "volume-mute-outline"}
									size={20}
									color={learning[item.id]?.listened ? "#2E8B57" : "#bbb"}
									style={{ marginLeft: 8 }}
								/>
							</View>
						</View>
						{renderCategoryIcons(item.categories)}
						<TouchableOpacity style={styles.bookmark} onPress={(event) => { event.stopPropagation(); toggleBookmark(item.id); }}>
							<Ionicons
								name={bookmarked[item.id] ? "heart" : "heart-outline"}
								size={38}
								color={bookmarked[item.id] ? "red" : "gray"}
							/>
						</TouchableOpacity>
					</TouchableOpacity>
				)}
				ListEmptyComponent={() => loading ? <ActivityIndicator style={styles.emptyContainer} /> : (
					<View style={styles.emptyContainer}>
						<Ionicons name="alert-circle-outline" size={50} color="gray" />
						<Text style={styles.emptyText}>{i18n.t("noFavorite")}</Text>
					</View>
				)}
			/>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
		paddingHorizontal: 16,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-start",
		paddingVertical: 10,
		position: "relative",
	},
	headerText: {
		flex: 1,
		textAlign: "center",
		fontSize: 18,
		fontWeight: "bold",
	},
	card: {
		flexDirection: "row",
		backgroundColor: "#fff",
		borderRadius: 8,
		shadowColor: "#000",
		shadowOpacity: 0.1,
		shadowRadius: 10,
		elevation: 5,
		marginBottom: 16,
		height: 180,
		// Shadow for iOS
		shadowColor: "#000",
		shadowOffset: {
			width: 0,
			height: 2,
		},
		shadowOpacity: 0.25,
		shadowRadius: 3.84,
		// Elevation for Android
		elevation: 5,
		width: "99%",
	},
	image: {
		width: "35%",
		height: "100%",
		borderTopLeftRadius: 8,
		borderBottomLeftRadius: 8,
	},
	info: {
		paddingTop: 16,
		width: "65%",
		paddingLeft: 16,
	},
	name: {
		fontSize: 24,
		fontWeight: "bold",
		flexShrink: 1,
	},
	progressRow: {
		flexDirection: "row",
		alignItems: "center",
		marginTop: 8,
	},
	type: {
		fontSize: 14,
		color: "#666",
	},
	bookmark: {
		position: "absolute",
		bottom: 16,
		right: 16,
	},
	iconRow: {
		position: "absolute",
		left: "40%",
		bottom: 20,
		flexDirection: "row",
	},
	categoryIcon: {
		width: 32,
		height: 32,
		marginRight: 8,
	},
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingTop: 16,
	},
	emptyText: {
		marginTop: 16,
		fontSize: 18,
		color: "gray",
	},
});

export default Favourite;
