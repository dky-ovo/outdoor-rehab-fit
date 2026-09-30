import { appText } from "../../../utils/appText";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { getFacilities } from "../../../utils/api";
import { openExternalMap } from "../../../utils/openExternalMap";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";

export default function OfficialFacilityLocations() {
	useAndroidBackTarget("/(tabs)");
	const { locale } = useContext(LocaleContext);
	const [search, setSearch] = useState("");
	const [district, setDistrict] = useState("");
	const [result, setResult] = useState({ facilities: [], districts: [], portalUrl: "", lastUpdatedAt: null });
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const loadGeneration = useRef(0);
	const load = useCallback(async () => {
		const generation = ++loadGeneration.current;
		setLoading(true); setError("");
		try {
			const next = await getFacilities({ search: search.trim(), district });
			if (generation === loadGeneration.current) setResult(next);
		}
		catch { if (generation === loadGeneration.current) setError(appText(locale, "inline.officialLocations.officialHongKongFacilityDataIsTemporarilyUnavailable", {"zh":"暫時無法讀取香港官方設施資料，請稍後再試。","en":"Official Hong Kong facility data is temporarily unavailable."})); }
		finally { if (generation === loadGeneration.current) setLoading(false); }
	}, [district, locale, search]);
	useEffect(() => { const timer = setTimeout(load, 250); return () => { clearTimeout(timer); loadGeneration.current += 1; }; }, [load]);
	const districts = useMemo(() => [{ districtZh: "", districtEn: "" }, ...(result.districts || [])], [result.districts]);
	const openMap = async (item) => {
		const label = locale === "zh" ? item.nameZh || item.nameEn : item.nameEn || item.nameZh;
		try { await openExternalMap({ latitude: item.latitude, longitude: item.longitude, label }); }
		catch { setError(appText(locale, "inline.officialLocations.unableToOpenTheSystemMap", {"zh":"無法開啟手機的系統地圖。","en":"Unable to open the system map."})); }
	};
	const openPortal = async () => {
		try { await Linking.openURL(result.portalUrl); }
		catch { setError(appText(locale, "inline.officialLocations.unableToOpenTheSourcePleaseTryAgain", {"zh":"暫時無法開啟資料來源，請稍後再試。","en":"Unable to open the source. Please try again."})); }
	};
	return <View style={styles.page}>
		<View style={styles.searchPanel}>
			<Text style={styles.source}>{appText(locale, "inline.officialLocations.officialDataFromHongKongLcsd", {"zh":"香港康樂及文化事務署官方資料","en":"Official data from Hong Kong LCSD"})}</Text>
			<View style={styles.searchBox}><Ionicons name="search" size={21} color="#777" /><TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder={appText(locale, "inline.officialLocations.searchFacilityNameOrAddress", {"zh":"搜尋設施名稱或地址","en":"Search facility name or address"})} placeholderTextColor="#888" /></View>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.districtRow}>{districts.map((item, index) => { const value = item.districtZh || item.districtEn; const selected = value === district; return <TouchableOpacity key={`${value}-${index}`} style={[styles.chip, selected && styles.chipSelected]} onPress={() => setDistrict(value)}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{index === 0 ? (appText(locale, "inline.officialLocations.allDistricts", {"zh":"全部地區","en":"All districts"})) : (locale === "zh" ? item.districtZh || item.districtEn : item.districtEn || item.districtZh)}</Text></TouchableOpacity>; })}</ScrollView>
		</View>
		{loading ? <View style={styles.center}><ActivityIndicator size="large" color="#840B1C" /></View> : error && !(result.facilities || []).length ? <View style={styles.center}><Text style={styles.error}>{error}</Text><TouchableOpacity style={styles.retry} onPress={load}><Text style={styles.retryText}>{appText(locale, "inline.officialLocations.retry", {"zh":"重新載入","en":"Retry"})}</Text></TouchableOpacity></View> : <FlatList data={result.facilities || []} keyExtractor={(item) => String(item.id)} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>{appText(locale, "inline.officialLocations.noOfficialFacilitiesMatchYourSearch", {"zh":"沒有符合條件的官方設施。","en":"No official facilities match your search."})}</Text>} renderItem={({ item }) => <View style={styles.card}><View style={styles.titleRow}><MaterialCommunityIcons name="map-marker-radius" size={RFValue(28)} color="#840B1C" /><View style={styles.cardText}><Text style={styles.name}>{locale === "zh" ? item.nameZh || item.nameEn : item.nameEn || item.nameZh}</Text><Text style={styles.district}>{locale === "zh" ? item.districtZh || item.districtEn : item.districtEn || item.districtZh}</Text></View></View><Text style={styles.address}>{locale === "zh" ? item.addressZh || item.addressEn : item.addressEn || item.addressZh}</Text><TouchableOpacity style={styles.navigate} onPress={() => openMap(item)}><Ionicons name="navigate" size={20} color="#fff" /><Text style={styles.navigateText}>{appText(locale, "inline.officialLocations.navigateWithSystemMap", {"zh":"使用系統地圖導航","en":"Navigate with system map"})}</Text></TouchableOpacity></View>} />}
		<View style={styles.footer}>{!!error && <Text style={styles.inlineError}>{error}</Text>}<Text style={styles.updated}>{result.lastUpdatedAt ? `${appText(locale, "inline.officialLocations.officialDataUpdated", {"zh":"官方資料更新：","en":"Official data updated: "})}${new Date(result.lastUpdatedAt).toLocaleString(locale === "zh" ? "zh-HK" : "en-GB")}` : ""}</Text>{!!result.portalUrl && <TouchableOpacity onPress={openPortal}><Text style={styles.portal}>{appText(locale, "inline.officialLocations.viewHongKongGovernmentSource", {"zh":"查看香港政府資料來源","en":"View Hong Kong government source"})}</Text></TouchableOpacity>}</View>
	</View>;
}

const styles = StyleSheet.create({
	page:{flex:1,backgroundColor:"#F5F6F8"},searchPanel:{backgroundColor:"#fff",padding:14,borderBottomWidth:1,borderBottomColor:"#E2E4E8"},source:{fontSize:RFValue(11),lineHeight:RFValue(17),color:"#666",marginBottom:9},searchBox:{minHeight:48,flexDirection:"row",alignItems:"center",borderWidth:1,borderColor:"#D6D9DE",borderRadius:12,paddingHorizontal:12},searchInput:{flex:1,minWidth:0,fontSize:RFValue(13),paddingHorizontal:9,color:"#222"},districtRow:{paddingTop:11,gap:8},chip:{borderWidth:1,borderColor:"#D7B8BE",borderRadius:18,paddingHorizontal:13,paddingVertical:8},chipSelected:{backgroundColor:"#840B1C",borderColor:"#840B1C"},chipText:{fontSize:RFValue(11),color:"#840B1C"},chipTextSelected:{color:"#fff",fontWeight:"800"},center:{flex:1,alignItems:"center",justifyContent:"center",padding:28},error:{fontSize:RFValue(12),lineHeight:RFValue(19),color:"#B42318",textAlign:"center"},retry:{marginTop:15,backgroundColor:"#840B1C",borderRadius:10,paddingHorizontal:20,paddingVertical:11},retryText:{color:"#fff",fontWeight:"800"},list:{padding:14,paddingBottom:120},empty:{fontSize:RFValue(13),color:"#777",textAlign:"center",padding:30},card:{backgroundColor:"#fff",borderRadius:15,padding:15,marginBottom:12,borderWidth:1,borderColor:"#E1E3E7"},titleRow:{flexDirection:"row",alignItems:"flex-start"},cardText:{flex:1,minWidth:0,marginLeft:9},name:{fontSize:RFValue(15),lineHeight:RFValue(21),fontWeight:"800",color:"#222"},district:{fontSize:RFValue(11),color:"#777",marginTop:3},address:{fontSize:RFValue(11),lineHeight:RFValue(18),color:"#555",marginTop:10},navigate:{minHeight:48,marginTop:13,borderRadius:10,backgroundColor:"#2E8B57",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8},navigateText:{fontSize:RFValue(12),fontWeight:"800",color:"#fff"},footer:{position:"absolute",left:0,right:0,bottom:0,backgroundColor:"rgba(255,255,255,0.96)",paddingHorizontal:14,paddingVertical:7,borderTopWidth:1,borderTopColor:"#E5E5E5"},updated:{fontSize:RFValue(9),color:"#777",textAlign:"center"},portal:{fontSize:RFValue(10),color:"#840B1C",fontWeight:"700",textAlign:"center",marginTop:4},inlineError:{fontSize:RFValue(10),color:"#B42318",textAlign:"center",marginBottom:4},
});
