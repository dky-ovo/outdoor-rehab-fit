import { appText } from "../../../utils/appText";
import React, { useCallback, useContext, useRef, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { RFValue } from "react-native-responsive-fontsize";
import CountrySelector from "../../../components/CountrySelector";
import { AuthContext } from "../../../contexts/AuthContext";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { addVolunteerParticipant, getVolunteerParticipants } from "../../../utils/api";
import { formatParticipantWeek } from "../../../utils/participantWeeks";
import { useUsageBack } from "../../../hooks/useUsageBack";

export default function ParticipantUsageScreen() {
	useUsageBack("/(tabs)/other");
	const { view } = useLocalSearchParams();
	const dataView = (Array.isArray(view) ? view[0] : view) === "exercise" ? "exercise" : "usage";
	const { user } = useContext(AuthContext); const { i18n, locale } = useContext(LocaleContext);
	const [countryCode, setCountryCode] = useState("+852"); const [phone, setPhone] = useState("");
	const [participants, setParticipants] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
	const requestRef = useRef(0); const focusedRef = useRef(false); const addingRef = useRef(false); const ownerRef = useRef(user?.token);
	const canViewUsage = ["participant", "volunteer", "caregiver", "staff"].includes(user?.profileRole);
	const canManageParticipants = ["volunteer", "caregiver", "staff"].includes(user?.profileRole);
	const load = useCallback(async () => {
		if (!focusedRef.current) return;
		const request = ++requestRef.current;
		if (ownerRef.current !== user?.token) { ownerRef.current = user?.token; setParticipants([]); }
		if (!user?.token || !canViewUsage) { setParticipants([]); setLoading(false); return; }
		setLoading(true);
		try {
			const result = await getVolunteerParticipants(user.token);
			if (request === requestRef.current) { setParticipants(result.participants || []); setError(""); }
		} catch { if (request === requestRef.current) { setParticipants([]); setError(i18n.t("aiChatError")); } }
		finally { if (request === requestRef.current) setLoading(false); }
	}, [canViewUsage, i18n, user?.token]);
	useFocusEffect(useCallback(() => {
		focusedRef.current = true; load();
		return () => { focusedRef.current = false; requestRef.current += 1; };
	}, [load]));
	const add = async () => {
		if (!phone.trim() || addingRef.current || !user?.token || !canManageParticipants) return;
		addingRef.current = true;
		const request = ++requestRef.current;
		setLoading(true); setError("");
		try {
			await addVolunteerParticipant(user.token, phone, countryCode);
			if (request === requestRef.current) { setPhone(""); await load(); }
		} catch (e) {
			if (request === requestRef.current) { setError(e.code === "participantNotFound" ? (appText(locale, "inline.participantUsage.noParticipantIsRegisteredWithThisPhoneNumber", {"zh":"找不到使用此手機號碼註冊的參與者。","en":"No participant is registered with this phone number."})) : i18n.t("aiChatError")); setLoading(false); }
		} finally { addingRef.current = false; }
	};
	if (!canViewUsage) return <View style={styles.center}><Ionicons name="lock-closed" size={54} color="#840B1C" /><Text style={styles.empty}>{i18n.t("participantUsageUnavailable")}</Text></View>;
	return <View style={styles.page}>
		<Stack.Screen options={{ title: i18n.t(dataView === "exercise" ? "participantExerciseData" : "participantUsage") }} />
		{canManageParticipants && <View style={styles.addCard}><Text style={styles.title}>{i18n.t("addParticipantByPhone")}</Text><Text style={styles.hint}>{i18n.t("participantPhoneHint")}</Text><View style={styles.phoneRow}><CountrySelector i18n={i18n} value={countryCode} onChange={setCountryCode} /><TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={i18n.t("phoneNumber")} /><TouchableOpacity style={styles.addButton} onPress={add} disabled={loading}><Ionicons name="person-add" size={21} color="#fff" /></TouchableOpacity></View>{!!error && <Text style={styles.error}>{error}</Text>}</View>}
		<Text style={styles.sectionTitle}>{user?.profileRole === "participant" ? i18n.t(dataView === "exercise" ? "myExerciseData" : "myUsageData") : i18n.t("myParticipants")}</Text>
		{!!error && !canManageParticipants && <Text style={styles.error}>{error}</Text>}
		{loading && !participants.length ? <ActivityIndicator style={{ marginTop: 30 }} color="#840B1C" /> : <FlatList data={participants.filter(Boolean)} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ListEmptyComponent={<Text style={styles.empty}>{i18n.t("noParticipants")}</Text>} renderItem={({ item }) => {
			const dateField = dataView === "exercise" ? "lastExerciseDate" : "lastAppUsageDate";
			const lastDate = Object.prototype.hasOwnProperty.call(item, dateField) ? item[dateField] : item.lastUsageDate;
			return <TouchableOpacity style={styles.card} onPress={() => router.push({ pathname: "/participant-usage/detail", params: { participantId: item.id, view: dataView } })}><View style={styles.avatar}><Ionicons name="person" size={26} color="#840B1C" /></View><View style={{ flex: 1 }}><Text style={styles.name}>{item.name}{item.relationship === "self" ? ` · ${i18n.t(dataView === "exercise" ? "myExerciseData" : "myUsageData")}` : ""}</Text><Text style={styles.phone}>{item.phone}</Text><Text style={styles.last}>{lastDate ? `${i18n.t(dataView === "exercise" ? "weeklyExerciseData" : "weeklyUsage")}: ${formatParticipantWeek(lastDate, locale)}` : i18n.t(dataView === "exercise" ? "noExerciseData" : "noDailyUsage")}</Text></View><Ionicons name="chevron-forward" size={24} color="#888" /></TouchableOpacity>;
		}} />}
	</View>;
}

const styles = StyleSheet.create({
	page:{flex:1,backgroundColor:"#F5F6F8",padding:16},center:{flex:1,alignItems:"center",justifyContent:"center",padding:28},addCard:{backgroundColor:"#fff",borderRadius:16,padding:16,borderWidth:1,borderColor:"#E4E6EA"},title:{fontSize:RFValue(18),fontWeight:"800",color:"#222"},hint:{fontSize:RFValue(11),lineHeight:RFValue(17),color:"#666",marginTop:5},phoneRow:{flexDirection:"row",gap:8,marginTop:13},input:{flex:1,minWidth:0,minHeight:48,borderWidth:1,borderColor:"#D6D9DE",borderRadius:10,paddingHorizontal:12,fontSize:RFValue(13)},addButton:{width:50,borderRadius:10,backgroundColor:"#840B1C",alignItems:"center",justifyContent:"center"},error:{color:"#B42318",fontSize:RFValue(11),marginTop:10},sectionTitle:{fontSize:RFValue(17),fontWeight:"800",marginTop:22,marginBottom:10,color:"#222"},list:{paddingBottom:110},card:{minHeight:92,flexDirection:"row",alignItems:"center",backgroundColor:"#fff",borderRadius:14,padding:14,marginBottom:10,borderWidth:1,borderColor:"#E4E6EA"},avatar:{width:52,height:52,borderRadius:26,backgroundColor:"#F5EDEF",alignItems:"center",justifyContent:"center",marginRight:12},name:{fontSize:RFValue(15),fontWeight:"800",color:"#222"},phone:{fontSize:RFValue(12),color:"#555",marginTop:3},last:{fontSize:RFValue(10),color:"#888",marginTop:5},empty:{fontSize:RFValue(13),lineHeight:RFValue(20),color:"#777",textAlign:"center",padding:28},
});
