import { appText } from "../../../utils/appText";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, FlatList, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getEquipmentLocations } from "../../../utils/api";
import { openExternalMap } from "../../../utils/openExternalMap";
import { equipmentLocationReturnTarget } from "../../../utils/equipmentLocationRoutes";

function firstParam(value) {
	return String(Array.isArray(value) ? value[0] : value || "").trim();
}

const EquipmentMap = () => {
	const { locale, i18n } = useContext(LocaleContext);
	const route = useLocalSearchParams();
	const equipmentId = firstParam(route.equipmentId);
	const returnTargetKey = JSON.stringify(equipmentLocationReturnTarget(route));
	const [locations, setLocations] = useState([]);
	const bundledItems = i18n.t("equipmentList", { returnObjects: true });
	const bundledItem = Array.isArray(bundledItems) ? bundledItems.find((item) => String(item.id) === equipmentId) : null;
	const namedLocation = locations.find((item) => String(item.equipmentId) === equipmentId);
	const equipmentName = firstParam(locale === "zh" ? namedLocation?.equipmentNameZh || route.equipmentNameZh : namedLocation?.equipmentNameEn || route.equipmentNameEn)
		|| bundledItem?.name || firstParam(route.equipmentName);
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const loadGeneration = useRef(0);

	useFocusEffect(useCallback(() => {
		if (Platform.OS !== "android") return undefined;
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			router.replace(JSON.parse(returnTargetKey));
			return true;
		});
		return () => subscription.remove();
	}, [returnTargetKey]));

	const loadLocations = useCallback(async () => {
		const generation = ++loadGeneration.current;
		setLoading(true);
		setError("");
		try {
			const result = await getEquipmentLocations(equipmentId);
			if (generation !== loadGeneration.current) return;
			setLocations(Array.isArray(result.locations) ? result.locations : []);
		} catch (loadError) {
			if (generation !== loadGeneration.current) return;
			setLocations([]);
			setError(loadError?.status === 404 ? "" : (appText(locale, "inline.equipmentLocations.unableToLoadFacilityLocationsPleaseTryAgain", {"zh":"暫時無法讀取設施位置，請稍後再試。","en":"Unable to load facility locations. Please try again later."})));
		} finally {
			if (generation === loadGeneration.current) setLoading(false);
		}
	}, [equipmentId, locale]);

	useEffect(() => {
		loadLocations();
		return () => { loadGeneration.current += 1; };
	}, [loadLocations]);

	const filtered = useMemo(() => {
		const keyword = search.trim().toLocaleLowerCase();
		if (!keyword) return locations;
		return locations.filter((item) => {
			const values = locale === "zh"
				? [item.regionZh, item.equipmentNameZh]
				: [item.regionEn, item.equipmentNameEn];
			return values.some((value) => String(value || "").toLocaleLowerCase().includes(keyword));
		});
	}, [locations, locale, search]);

	const openInMaps = async (location) => {
		setError("");
		const label = locale === "zh" ? location.regionZh || location.regionEn : location.regionEn || location.regionZh;
		try {
			await openExternalMap({ ...location, label });
		} catch (mapError) {
			setError(mapError?.code === "invalidMapCoordinates"
				? (appText(locale, "inline.equipmentLocations.thisLocationDoesNotHaveValidCoordinates", {"zh":"此位置沒有有效座標，暫時無法導航。","en":"This location does not have valid coordinates."}))
				: (appText(locale, "inline.equipmentLocations.unableToOpenTheSystemMapPleaseInstall", {"zh":"無法開啟系統地圖，請確認手機已安裝地圖應用程式。","en":"Unable to open the system map. Please install a map application."})));
		}
	};

	const emptyText = equipmentId
		? (appText(locale, "inline.equipmentLocations.noLocationsHaveBeenConfiguredForThisFacility", {"zh":"此設施暫未配置位置。","en":"No locations have been configured for this facility yet."}))
		: (appText(locale, "inline.equipmentLocations.noFacilityLocationsHaveBeenConfiguredYet", {"zh":"暫未配置設施位置。","en":"No facility locations have been configured yet."}));

	return <View style={styles.container}>
		<View style={styles.headerPanel}>
			{!!equipmentName && <Text style={styles.equipmentName} numberOfLines={2}>{equipmentName}</Text>}
			<Text style={styles.note}>{appText(locale, "inline.equipmentLocations.chooseALocationToOpenNavigationInYour", {"zh":"選擇地點後，將使用手機的系統地圖開啟導航。","en":"Choose a location to open navigation in your system map."})}</Text>
			<View style={styles.searchRow}>
				<Ionicons name="search" size={20} color="#777" />
				<TextInput
					style={styles.searchInput}
					value={search}
					onChangeText={setSearch}
					placeholder={appText(locale, "inline.equipmentLocations.searchDistrict", {"zh":"搜尋地區","en":"Search district"})}
					placeholderTextColor="#8B8E94"
				/>
			</View>
		</View>

		{loading && <View style={styles.center}><ActivityIndicator size="large" color="#840B1C" /><Text style={styles.statusText}>{appText(locale, "inline.equipmentLocations.loadingLocations", {"zh":"正在讀取位置…","en":"Loading locations…"})}</Text></View>}
		{!loading && !!error && locations.length === 0 && <View style={styles.center}><Text style={styles.error}>{error}</Text><TouchableOpacity style={styles.retryButton} onPress={loadLocations}><Text style={styles.retryText}>{appText(locale, "inline.equipmentLocations.retry", {"zh":"重新載入","en":"Retry"})}</Text></TouchableOpacity></View>}
		{!loading && filtered.length === 0 && (!error || locations.length > 0) && <View style={styles.center}><MaterialCommunityIcons name="map-marker-off-outline" size={RFValue(44)} color="#A3A6AC" /><Text style={styles.statusText}>{search ? (appText(locale, "inline.equipmentLocations.noLocationsMatchYourSearch", {"zh":"沒有符合搜尋條件的位置。","en":"No locations match your search."})) : emptyText}</Text></View>}
		{!loading && filtered.length > 0 && <FlatList
			data={filtered}
			keyExtractor={(item) => String(item.id)}
			contentContainerStyle={styles.list}
			renderItem={({ item }) => {
				const name = locale === "zh" ? item.regionZh || item.regionEn : item.regionEn || item.regionZh;
				const itemEquipmentName = locale === "zh"
					? item.equipmentNameZh || item.equipmentNameEn
					: item.equipmentNameEn || item.equipmentNameZh;
				return <View style={styles.card}>
					<View style={styles.cardHeader}>
						<MaterialCommunityIcons name="map-marker" size={RFValue(28)} color="#840B1C" />
						<View style={styles.cardMain}>
							{!equipmentId && !!itemEquipmentName && <Text style={styles.equipmentLabel} numberOfLines={2}>{itemEquipmentName}</Text>}
							<Text style={styles.name}>{name}</Text>
							<Text style={styles.coordinate}>{Number(item.latitude).toFixed(6)}, {Number(item.longitude).toFixed(6)}</Text>
						</View>
					</View>
					<TouchableOpacity accessibilityRole="button" style={styles.mapButton} onPress={() => openInMaps(item)}>
						<Ionicons name="navigate" size={RFValue(18)} color="#fff" />
						<Text style={styles.mapButtonText}>{appText(locale, "inline.equipmentLocations.navigateWithSystemMap", {"zh":"使用系統地圖導航","en":"Navigate with system map"})}</Text>
					</TouchableOpacity>
				</View>;
			}}
		/>}
		{!loading && !!error && locations.length > 0 && <Text style={styles.inlineError}>{error}</Text>}
	</View>;
};

const styles = StyleSheet.create({
	container: { flex: 1, backgroundColor: "#F5F6F8" },
	headerPanel: { backgroundColor: "#fff", paddingHorizontal: wp("4%"), paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#E4E6EA" },
	equipmentName: { color: "#25272B", fontSize: RFValue(17), lineHeight: RFValue(23), fontWeight: "800", marginBottom: 5 },
	note: { fontSize: RFValue(11), lineHeight: RFValue(17), color: "#666", marginBottom: 10 },
	searchRow: { minHeight: 46, borderWidth: 1, borderColor: "#D8DCE2", borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
	searchInput: { flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 9, fontSize: RFValue(13), color: "#222" },
	list: { padding: wp("4%"), paddingBottom: hp("15%") },
	card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 11, borderWidth: 1, borderColor: "#E4E6EA" },
	cardHeader: { flexDirection: "row", alignItems: "flex-start" },
	cardMain: { flex: 1, minWidth: 0, marginLeft: 10 },
	equipmentLabel: { fontSize: RFValue(14), lineHeight: RFValue(20), fontWeight: "800", color: "#25272B", marginBottom: 4 },
	name: { fontSize: RFValue(16), lineHeight: RFValue(22), fontWeight: "700", color: "#25272B" },
	coordinate: { fontSize: RFValue(11), color: "#777", marginTop: 5 },
	mapButton: { minHeight: 46, marginTop: 13, backgroundColor: "#840B1C", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
	mapButtonText: { flexShrink: 1, color: "#fff", fontWeight: "700", fontSize: RFValue(12), textAlign: "center" },
	center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
	statusText: { color: "#737780", fontSize: RFValue(13), lineHeight: RFValue(20), textAlign: "center", marginTop: 10 },
	error: { color: "#B42318", fontSize: RFValue(13), lineHeight: RFValue(20), textAlign: "center" },
	inlineError: { position: "absolute", left: 16, right: 16, bottom: 16, borderRadius: 9, padding: 10, backgroundColor: "#FDECEC", color: "#B42318", fontSize: RFValue(11), textAlign: "center" },
	retryButton: { marginTop: 14, minHeight: 44, backgroundColor: "#840B1C", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10, justifyContent: "center" },
	retryText: { color: "#fff", fontWeight: "700" },
});

export default EquipmentMap;
