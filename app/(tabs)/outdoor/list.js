import { appText } from "../../../utils/appText";
import React, { useState, useEffect, useContext, useCallback, useMemo } from "react";
import { View, Text, Image, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import SearchBar from "../../../components/SearchBar";
import { useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useFocusEffect, useNavigation } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getBookmarks, saveBookmarks, subscribeBookmarkChanges } from "../../../utils/bookmarks";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { getCachedEquipmentCatalog, loadCachedEquipmentCatalog, getEquipmentCatalog, subscribeEquipmentCatalog } from "../../../utils/api";
import { mergeEquipmentCatalog, mergeEquipmentCategories, equipmentCategoryLabel } from "../../../utils/equipmentCatalog";
import EquipmentCardImage from "../../../components/EquipmentCardImage";
import { AuthContext } from "../../../contexts/AuthContext";
import { showGuestRestrictionAlert } from "../../../utils/accessControl";
import { getSessions } from "../../../utils/sessions";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { equipmentListBackTarget } from "../../../utils/equipmentLocationRoutes";
import useFacilityScrollInsets from "../../../hooks/useFacilityScrollInsets";

const EquipmentList = () => {
	const scrollInsets = useFacilityScrollInsets(hp("15%"));
	const { i18n, locale, textRevision } = useContext(LocaleContext);
	const { isGuest, canAccessEquipment, user } = useContext(AuthContext);
	const equipmentData = i18n.t("equipmentList", { returnObjects: true });
	const buttons = [
		{ icon: require("@/assets/icons/outdoor/list.png"), text: i18n.t("all") },
		{ icon: require("@/assets/icons/outdoor/muscle.png"), text: i18n.t("muscle") },
		{ icon: require("@/assets/icons/outdoor/flexibility.png"), text: i18n.t("mobility") },
		{ icon: require("@/assets/icons/outdoor/balance.png"), text: i18n.t("balance") },
		{ icon: require("@/assets/icons/outdoor/aerobic.png"), text: i18n.t("aerobic") },
		{ icon: require("@/assets/icons/outdoor/wheelchair.png"), text: i18n.t("wheelchair") },
		{ icon: require("@/assets/icons/outdoor/multi.png"), text: i18n.t("multifunctional") },
		{ icon: require("@/assets/icons/outdoor/relax.png"), text: i18n.t("relaxation") },
		{ icon: require("@/assets/icons/outdoor/upper.png"), text: i18n.t("upper") },
		{ icon: require("@/assets/icons/outdoor/lower.png"), text: i18n.t("lower") },
	];
	const renderCategoryIcons = (categoryIds) => {
		return (
			<View style={styles.iconRow}>
				{(categoryIds || []).map((category) => {
					const button = buttons.find((btn) => btn.text === i18n.t(category));
					return button ? <Image key={category} source={button.icon} style={styles.categoryIcon} /> : <Ionicons key={category} name="shapes-outline" size={RFValue(16)} color="#EB9481" accessibilityLabel={equipmentCategoryLabel(categories.find((entry) => entry.id === category), locale) || category} />;
				})}
			</View>
		);
	};
	const route = useLocalSearchParams();
	const categoryId = String(Array.isArray(route.categoryId) ? route.categoryId[0] : route.categoryId || "");
	const categoryName = String(Array.isArray(route.categoryName) ? route.categoryName[0] : route.categoryName || "");
	const listBackTarget = equipmentListBackTarget(route);
	const originParams = listBackTarget === "/(tabs)/goals" ? { listFrom: "goals" } : {};
	useAndroidBackTarget(listBackTarget);
	const [catalog, setCatalog] = useState(() => getCachedEquipmentCatalog());
	const categories = useMemo(() => mergeEquipmentCategories(catalog?.categories), [catalog]);
	const equipmentList = mergeEquipmentCatalog(equipmentData, catalog?.items || [], locale, { imageCatalogReady: catalog !== null });
	const navigation = useNavigation();
	const [searchQuery, setSearchQuery] = useState("");
	const [bookmarked, setBookmarked] = useState({});
	const [averageIntensityByEquipment, setAverageIntensityByEquipment] = useState({});

	useEffect(() => {
		const category = categories.find((item) => item.id === categoryId);
		navigation.setOptions({
			headerTitle: category ? equipmentCategoryLabel(category, locale) : categoryId === "all" ? i18n.t("all") : categoryName,
			gestureEnabled: false,
			headerLeft: () => <TouchableOpacity accessibilityRole="button" accessibilityLabel={i18n.t("back")} onPress={() => router.replace(listBackTarget)}><Ionicons name="chevron-back" size={RFValue(18)} color="#11181C" /></TouchableOpacity>,
		});
	}, [navigation, categoryName, categoryId, locale, textRevision, categories, listBackTarget, i18n]);

	useFocusEffect(useCallback(() => {
		let active = true;
		const loadBookmarks = async () => {
			try {
				const current = await getBookmarks();
				if (active) setBookmarked(current);
			} catch (error) {
				console.error("Error loading bookmarks", error);
			}
		};

		loadBookmarks();
		const unsubscribe = subscribeBookmarkChanges?.(loadBookmarks);
		return () => { active = false; unsubscribe?.(); };
	}, [user?.id, user?.token, isGuest]));

	useEffect(() => {
		let active = true;
		let receivedFreshCatalog = false;
		const unsubscribe = subscribeEquipmentCatalog?.(result => {
			if (active && Array.isArray(result?.items)) { receivedFreshCatalog = true; setCatalog(result); }
		});
		void loadCachedEquipmentCatalog().then(result => {
			if (active && !receivedFreshCatalog && Array.isArray(result?.items)) setCatalog(result);
		}).catch(() => {});
		getEquipmentCatalog().then(result => {
			if (active && Array.isArray(result?.items)) { receivedFreshCatalog = true; setCatalog(result); }
		}).catch(() => {});
		return () => { active = false; unsubscribe?.(); };
	}, [locale]);

	useFocusEffect(useCallback(() => {
		let active = true;
		setAverageIntensityByEquipment({});
		getSessions(user?.token).then((sessions) => {
			if (!active) return;
			const totals = {};
			for (const session of Array.isArray(sessions) ? sessions : []) {
				for (const exercise of Array.isArray(session?.exercises) ? session.exercises : []) {
					const equipmentId = String(exercise?.equipmentId ?? "").trim();
					const rawIntensity = String(exercise?.intensity ?? "").trim();
					const intensity = Number(rawIntensity);
					if (!equipmentId || !rawIntensity || !Number.isFinite(intensity) || intensity < 0 || intensity > 10) continue;
					const current = totals[equipmentId] || { total: 0, count: 0 };
					totals[equipmentId] = { total: current.total + intensity, count: current.count + 1 };
				}
			}
			setAverageIntensityByEquipment(Object.fromEntries(Object.entries(totals).map(([id, value]) => [id, value.total / value.count])));
		}).catch(() => { if (active) setAverageIntensityByEquipment({}); });
		return () => { active = false; };
	}, [user?.token]));

	const promptLogin = () => showGuestRestrictionAlert(i18n);
	const openEquipment = (item) => {
		if (isGuest && !canAccessEquipment(item.id)) {
			promptLogin();
			return;
		}
		router.push({ pathname: "/outdoor/detail", params: { id: String(item.id), name: item.name, from: "list", categoryId, categoryName, ...originParams } });
	};
	const openLocations = (item) => {
		router.push({ pathname: "/equipmentmap", params: { equipmentId: String(item.id), equipmentName: item.name, equipmentNameZh: item.nameZh || (locale === "zh" ? item.name : ""), equipmentNameEn: item.nameEn || (locale === "en" ? item.name : ""), locationSource: "list", categoryId, categoryName, ...originParams } });
	};

	const toggleBookmark = async (itemId) => {
		if (isGuest && !canAccessEquipment(itemId)) {
			promptLogin();
			return;
		}
		try {
			let updatedBookmarks = { ...bookmarked };
			if (updatedBookmarks[itemId]) {
				delete updatedBookmarks[itemId];
			} else {
				updatedBookmarks[itemId] = true;
			}
			setBookmarked(updatedBookmarks);
			await saveBookmarks(updatedBookmarks, { changedIds: [itemId] });
		} catch (error) {
			console.error("Error updating bookmarks", error);
		}
	};

	const filteredEquipmentList = equipmentList.filter((item) => {
		if (categoryId === "all" || (!categoryId && (categoryName === "Show All" || categoryName === "顯示全部"))) {
			return item.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
		}
		return (item.categories || []).includes(categoryId) && item.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
	});

	return (
		<View style={styles.container}>
			<SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder={i18n.t("searching")} />
			<FlatList
				testID="facility-list-scroll"
				{...scrollInsets}
				data={filteredEquipmentList}
				style={{ flex: 1 }}
				contentContainerStyle={[{ alignItems: "center" }, scrollInsets.contentContainerStyle]}
				keyExtractor={(item) => item.id.toString()}
				showsVerticalScrollIndicator={false}
				renderItem={({ item }) => {
					const locked = isGuest && !canAccessEquipment(item.id);
					const averageIntensity = averageIntensityByEquipment[String(item.id)];
					return (
					<View style={[styles.card, locked && styles.lockedCard]}>
						<TouchableOpacity style={styles.cardContent} onPress={() => openEquipment(item)}>
							<EquipmentCardImage item={item} style={[styles.image, locked && styles.lockedImage]} />
							<View style={styles.info}>
								<Text style={styles.name}>{item.name}</Text>
								{locked && <Text style={styles.lockedLabel}>{i18n.t("guestLocked")}</Text>}
								{averageIntensity !== undefined && <Text style={styles.averageIntensity}>{appText(locale, "inline.facilityList.avgExertion", {"zh":"平均竭力度","en":"Avg. exertion"})} {averageIntensity.toFixed(1)}/10</Text>}
								{renderCategoryIcons(item.categories)}
							</View>
						</TouchableOpacity>
						<View style={styles.actionColumn}>
							<TouchableOpacity accessibilityRole="button" accessibilityLabel={appText(locale, "inline.facilityList.viewFacilityLocations", {"zh":"查看設施位置","en":"View facility locations"})} style={styles.locationButton} onPress={() => openLocations(item)}>
								<Ionicons name="location" size={RFValue(22)} color="#840B1C" />
								<Text style={styles.locationButtonText}>{appText(locale, "inline.facilityList.location", {"zh":"位置","en":"Location"})}</Text>
							</TouchableOpacity>
							<TouchableOpacity style={styles.bookmark} onPress={() => toggleBookmark(item.id)}>
							<Ionicons
								name={locked ? "lock-closed" : bookmarked[item.id] ? "heart" : "heart-outline"}
								size={RFValue(27)}
								color={locked ? "#840B1C" : bookmarked[item.id] ? "red" : "gray"}
							/>
							</TouchableOpacity>
						</View>
					</View>
					);
				}}
			/>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-start",
		paddingVertical: 10,
		position: "relative",
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
		minHeight: hp("20%"),
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
		width: wp("90%"),
	},
	cardContent: {
		flex: 1,
		minWidth: 0,
		flexDirection: "row",
	},
	lockedCard: {
		backgroundColor: "#F3F3F3",
	},
	lockedImage: {
		opacity: 0.42,
	},
	lockedLabel: {
		marginTop: 8,
		fontSize: RFValue(12),
		fontWeight: "700",
		color: "#840B1C",
	},
	averageIntensity: {
		marginTop: 6,
		fontSize: RFValue(11),
		lineHeight: RFValue(16),
		fontWeight: "700",
		color: "#4F535A",
	},
	image: {
		width: wp("32%"),
		height: hp("20%"),
		borderTopLeftRadius: 8,
		borderBottomLeftRadius: 8,
	},
	info: {
		paddingTop: hp("2%"),
		paddingBottom: hp("1.5%"),
		paddingLeft: wp("3%"),
		paddingRight: 4,
		flex: 1,
		minWidth: 0,
	},
	name: {
		fontSize: RFValue(18),
		fontWeight: "bold",
		flexShrink: 1,
	},
	type: {
		fontSize: RFValue(14),
		color: "#666",
	},
	bookmark: {
		width: 44,
		height: 44,
		alignItems: "center",
		justifyContent: "center",
	},
	iconRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		marginTop: "auto",
		paddingTop: 8,
	},
	categoryIcon: {
		width: RFValue(20),
		height: RFValue(20),
		marginRight: 8,
	},
	actionColumn: {
		width: RFValue(62),
		flexShrink: 0,
		alignItems: "center",
		justifyContent: "space-between",
		paddingVertical: 7,
		paddingHorizontal: 4,
	},
	locationButton: {
		minWidth: 52,
		minHeight: 50,
		borderRadius: 9,
		backgroundColor: "#F8ECEF",
		alignItems: "center",
		justifyContent: "center",
		gap: 3,
		paddingHorizontal: 4,
	},
	locationButtonText: {
		color: "#840B1C",
		fontSize: RFValue(9),
		fontWeight: "700",
		textAlign: "center",
	},
});

export default EquipmentList;
