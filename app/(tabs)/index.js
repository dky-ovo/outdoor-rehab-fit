import { useAccountDataRevision } from '../../hooks/useAccountDataRevision';
import { appText } from "../../utils/appText";
import React, { useCallback, useContext, useMemo, useState } from "react";
import { Platform, StyleSheet, View, Text, TouchableOpacity, Image, ScrollView, useWindowDimensions } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LocaleContext } from "../../contexts/LocaleContext";
import { AuthContext } from "../../contexts/AuthContext";
import { FEATURES } from "../../constants/permissions";
import { canAccess } from "../../constants/permissions";
import { guardGuestAccess } from "../../utils/accessControl";
import { RFValue } from "react-native-responsive-fontsize";
import GoalProgressBars from "../../components/GoalProgressBars";
import ManagedContent from "../../components/ManagedContent";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { trackUsageDay } from "../../utils/usage";
import { getWeeklyProgress, getGoalState, getCurrentWeekSmartGoals } from "../../utils/goals";
import { getSessions } from "../../utils/sessions";
import { toDateKey } from "../../utils/dates";
import { savedExerciseDays, savedExerciseWeek } from "../../utils/exerciseWeek";
import { sessionPathForMode } from "../../utils/sessionRoutes";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { homeHeroImageSize, homeHeroPhotoFrame } from "../../utils/homeHeroLayout";

const HOME_HERO_IMAGE = require("@/assets/images/hk.jpg");
// Native asset metadata supplies the original bitmap ratio; retain the known
// dimensions as a fallback for renderers without asset-resolution metadata.
const HOME_HERO_IMAGE_SIZE = homeHeroImageSize(HOME_HERO_IMAGE, Image.resolveAssetSource);

export default function HomeScreen() {
	const accountRevision = useAccountDataRevision(['goals','sessions']);
	const { i18n, locale } = useContext(LocaleContext);
	const { user, isGuest } = useContext(AuthContext);
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const compact = width <= 400;
	const heroHeight = Math.max(insets.top + RFValue(compact ? 142 : 154), RFValue(compact ? 184 : 198));
	const [heroLayout, setHeroLayout] = useState(null);
	const updateHeroLayout = useCallback(({ nativeEvent: { layout } }) => {
		if (!(layout.width > 0 && layout.height > 0)) return;
		setHeroLayout((current) => current?.width === layout.width && current?.height === layout.height
			? current : { width: layout.width, height: layout.height });
	}, []);
	const heroPhotoFrame = homeHeroPhotoFrame({
		width: heroLayout?.width || width,
		height: heroLayout?.height || heroHeight,
		imageWidth: HOME_HERO_IMAGE_SIZE.width,
		imageHeight: HOME_HERO_IMAGE_SIZE.height,
		// Preserve the previous 1.14 zoom and downward focal shift, but express
		// them as image bounds instead of a platform-specific transform chain.
		verticalOffset: RFValue(9) * 1.14,
	});
	const [weekly, setWeekly] = useState(null);
	const [smartGoals, setSmartGoals] = useState([]);
	const [sessions, setSessions] = useState([]);
	const activeDays = useMemo(() => savedExerciseDays(sessions), [sessions]);
	const exerciseWeek = savedExerciseWeek(sessions);
	const [monthOffset, setMonthOffset] = useState(0);
	const [monthExpanded, setMonthExpanded] = useState(false);

	useFocusEffect(
		useCallback(() => {
			let active = true;
			trackUsageDay();
			(async () => {
				const [weeklyData, goalState, loadedSessions] = await Promise.all([
					getWeeklyProgress(user?.token),
					getGoalState(),
					getSessions(user?.token),
				]);
				if (!active) return;
				setWeekly(weeklyData);
				setSmartGoals(getCurrentWeekSmartGoals(goalState));
				setSessions(loadedSessions);
			})().catch((error) => console.warn("Unable to load Home exercise data", error));
			return () => { active = false; };
		}, [isGuest, user?.token, accountRevision])
	);

	const buttons = [
		{
			color: "#F5DEE3",
			text: appText(locale, "inline.home.countdownTimer", {"zh":"倒數計時器","en":"Countdown Timer"}),
			iconName: "timer-sand",
			sessionMode: "countdown",
			feature: FEATURES.SESSION_RECORD,
		},
		{
			color: "#F0E4C2",
			text: i18n.t("outdoor"),
			icon: require("@/assets/icons/outdoor.png"),
			route: "outdoor",
			feature: FEATURES.OUTDOOR_EQUIPMENT,
		},
		{ color: "#D8EAD9", text: i18n.t("exerciseVideos"), iconName: "play-circle-outline", route: "exercise-videos", feature: FEATURES.OUTDOOR_AUDIO_VIDEO },
		{
			color: "#E8CCB0",
			text: i18n.t("goalSetting"),
			iconName: "bullseye-arrow",
			route: "goals",
			feature: FEATURES.GOAL_SETTING,
		},
		{
			color: "#F2CCC0",
			text: i18n.t("location"),
			icon: require("@/assets/icons/map.png"),
			route: "location",
			feature: FEATURES.LOCATION,
		},
		{
			color: "#ECDD93",
			text: i18n.t("aiChat"),
			iconName: "robot-happy-outline",
			route: "chat",
			feature: FEATURES.AI_CHAT,
		},
	];

	const getGreeting = () => {
		const currentHour = new Date().getHours();
		if (currentHour < 12) {
			return i18n.t("morning");
		} else if (currentHour < 18) {
			return i18n.t("afternoon");
		} else {
			return i18n.t("evening");
		}
	};

	const handlePress = (route, feature) => {
		guardGuestAccess(feature, isGuest, i18n, () => {
			if (route === "goals/smart") {
				router.navigate({ pathname: "/(tabs)/goals/smart", params: { from: "home" } });
				return;
			}
			if (route === "session") {
				router.replace("/(tabs)/session/");
				return;
			}
			if (route === "goals") {
				router.navigate("/(tabs)/goals");
				return;
			}
			router.push(`/${route}`);
		});
	};
	const sessionLocked = isGuest && !canAccess(FEATURES.SESSION_RECORD, isGuest);
	const openSessionMode = (recordMode) => {
		guardGuestAccess(FEATURES.SESSION_RECORD, isGuest, i18n, () => {
			router.replace(sessionPathForMode(recordMode));
		});
	};

	const dayLabels = [
		appText(locale, "inline.home.monday", { zh: "一", en: "M" }),
		appText(locale, "inline.home.tuesday", { zh: "二", en: "T" }),
		appText(locale, "inline.home.wednesday", { zh: "三", en: "W" }),
		appText(locale, "inline.home.thursday", { zh: "四", en: "T" }),
		appText(locale, "inline.home.friday", { zh: "五", en: "F" }),
		appText(locale, "inline.home.saturday", { zh: "六", en: "S" }),
		appText(locale, "inline.home.sunday", { zh: "日", en: "S" }),
	];
	const monthData = useMemo(() => {
		const base = new Date();
		const month = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
		const year = month.getFullYear();
		const monthIndex = month.getMonth();
		const leading = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
		const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
		const cells = Array.from({ length: leading }, () => null);
		for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, monthIndex, day));
		while (cells.length % 7) cells.push(null);
		const inMonth = sessions.filter((session) => {
			const date = new Date(session.date);
			return date.getFullYear() === year && date.getMonth() === monthIndex;
		});
		return {
			label: month.toLocaleDateString(locale === "zh" ? "zh-HK" : "en-GB", { year: "numeric", month: "long" }),
			cells,
			count: inMonth.length,
			minutes: Math.round(inMonth.reduce((sum, session) => sum + (Number(session.durationSec) || 0), 0) / 60),
		};
	}, [locale, monthOffset, sessions]);
	const todayKey = toDateKey(new Date());
	const sessionActions = [
		{ key: "manual", icon: "notebook-edit-outline", text: appText(locale, "inline.home.addExerciseRecord", { zh: "新增運動記錄", en: "Add Exercise Record" }) },
	];

	return (
		<View style={styles.page}>
		<ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
			<View testID="home-greeting-hero" onLayout={updateHeroLayout} style={[styles.imageContainer, { height: heroHeight, paddingTop: Math.max(insets.top + 12, hp("4%")) }]}>
				{/* Ask Android to decode to measured bounds: bundled/network assets
				    otherwise skip size-based sampling with the default auto method.
				    The original image, focal position and cover layout stay unchanged. */}
				<Image testID="home-greeting-photo" source={HOME_HERO_IMAGE} style={[styles.photo, heroPhotoFrame]} resizeMode="cover" resizeMethod="resize" accessible={false} />
				<View pointerEvents="none" style={styles.photoShade} />
				<Text style={styles.greeting}>
					{getGreeting()}
					{user ? `, ${isGuest || user.name === "guest" ? i18n.t("guestUser") : user.name || user.username}` : ","}
				</Text>
			</View>

			<View style={[styles.mainContent, compact && styles.mainContentCompact]}>
				{isGuest && (
					<TouchableOpacity style={styles.guestBanner} onPress={() => router.push({ pathname: "/login", params: { from: "settings" } })}>
						<Ionicons name="lock-closed" size={RFValue(16)} color="#840B1C" />
						<Text style={styles.guestBannerText}>{i18n.t("guestModeBanner")}</Text>
					</TouchableOpacity>
				)}

				<View style={styles.sessionActions}>
					{sessionActions.map((action) => (
						<TouchableOpacity
							key={action.key}
							style={[styles.sessionButton, action.key === "manual" && styles.manualSessionButton, sessionLocked && styles.lockedSessionButton]}
							onPress={() => openSessionMode(action.key)}
							accessibilityRole="button"
						>
							<MaterialCommunityIcons name={sessionLocked ? "lock" : action.icon} size={RFValue(24)} color="#fff" />
							<Text style={styles.sessionButtonText} numberOfLines={2}>{action.text}</Text>
						</TouchableOpacity>
					))}
				</View>

				{(
					<>
						<View style={styles.weekCard}>
							<Text style={styles.weekTitle} maxFontSizeMultiplier={1.2}>{appText(locale, "inline.home.thisWeekSGoalProgress", {"zh":"本週目標進度","en":"This Week's Goal Progress"})}</Text>
							<View style={[styles.monthHeader, compact && styles.monthHeaderCompact]}>
								<TouchableOpacity style={styles.monthOverviewButton} onPress={() => { if (monthExpanded) setMonthOffset(0); setMonthExpanded((value) => !value); }} accessibilityRole="button">
									<MaterialCommunityIcons name="calendar-month-outline" size={RFValue(18)} style={styles.monthActionIcon} allowFontScaling={false} color="#840B1C" />
									<Text style={styles.monthOverviewText}>{appText(locale, "inline.home.monthlyExerciseOverview", {"zh":"每月運動概覽","en":"Monthly Exercise Overview"})}</Text>
									<Ionicons name={monthExpanded ? "chevron-up" : "chevron-down"} size={RFValue(16)} style={styles.monthActionChevron} allowFontScaling={false} color="#840B1C" />
								</TouchableOpacity>
								<TouchableOpacity style={[styles.monthLogButton, compact && styles.monthLogButtonCompact]} onPress={() => handlePress("sessionlog", FEATURES.SESSION_LOG)} accessibilityRole="button">
									<MaterialCommunityIcons name="clipboard-text-clock" size={RFValue(18)} style={styles.monthActionIcon} allowFontScaling={false} color="#840B1C" />
									<Text style={styles.monthLogText} maxFontSizeMultiplier={1.15}>{i18n.t("sessionLog")}</Text>
									<Ionicons name="chevron-forward" size={RFValue(16)} style={styles.monthActionChevron} allowFontScaling={false} color="#840B1C" />
								</TouchableOpacity>
							</View>
							{monthExpanded && <>
								<View style={styles.monthToolbar}>
									<TouchableOpacity style={styles.monthArrowButton} onPress={() => setMonthOffset((value) => value - 1)}><Ionicons name="chevron-back" size={RFValue(20)} color="#840B1C" /></TouchableOpacity>
									<Text style={styles.monthLabel}>{monthData.label}</Text>
									<TouchableOpacity style={styles.monthArrowButton} onPress={() => setMonthOffset((value) => Math.min(0, value + 1))} disabled={monthOffset >= 0}><Ionicons name="chevron-forward" size={RFValue(20)} color={monthOffset >= 0 ? "#ccc" : "#840B1C"} /></TouchableOpacity>
								</View>
								<View style={styles.monthGrid}>
									{dayLabels.map((label, index) => <Text key={`label-${index}`} style={styles.monthDayLabel}>{label}</Text>)}
									{monthData.cells.map((date, index) => {
										if (!date) return <View key={`blank-${index}`} style={styles.monthDay} />;
										const key = toDateKey(date);
										const hasSession = activeDays[key];
										const isToday = key === todayKey;
										const isFuture = date > new Date();
										return <TouchableOpacity key={key} disabled={isFuture} onPress={() => router.push({ pathname: "/sessionlog", params: { date: key } })} style={[styles.monthDay, isToday && styles.monthDayToday, isFuture && styles.monthDayDisabled]}><Text style={[styles.monthDayText, isToday && styles.monthDayTextToday]}>{date.getDate()}</Text>{hasSession && <View style={styles.sessionDayDot} />}</TouchableOpacity>;
									})}
								</View>
							</>}
							{weekly && (
								<View style={{ marginTop: hp("1.2%"), marginBottom: 12 }}>
									<GoalProgressBars i18n={i18n} progress={weekly.progress} targets={weekly.targets} />
								</View>
							)}
							<View style={styles.monthSummary}>
								<Text style={styles.monthSummaryText}>{i18n.t("monthlySessions", { count: monthData.count })}</Text>
								<Text style={styles.monthSummaryText}>{i18n.t("monthlyMinutes", { count: monthData.minutes })}</Text>
							</View>
							<View style={styles.savedWeekRow} testID="saved-exercise-week">
								{exerciseWeek.map((day, index) => <View key={day.date} style={styles.savedWeekDay} accessible accessibilityLabel={`${day.date} ${day.completed ? appText(locale, "inline.home.exerciseRecorded", { zh: "已記錄運動", en: "Exercise recorded" }) : appText(locale, "inline.home.noExerciseRecord", { zh: "未記錄運動", en: "No exercise record" })}`}>
									<Text style={styles.savedWeekLabel}>{dayLabels[index]}</Text>
									<Ionicons testID={`saved-exercise-${day.date}`} name={day.completed ? "checkmark-circle" : "ellipse-outline"} size={RFValue(23)} color={day.completed ? "#2E8B57" : "#C7C7C7"} allowFontScaling={false} />
								</View>)}
							</View>
						</View>

						<TouchableOpacity style={styles.smartCard} onPress={() => handlePress("goals/smart", FEATURES.GOAL_SETTING)}>
							<View style={styles.smartHeader}>
								<MaterialCommunityIcons name="bullseye-arrow" size={RFValue(18)} color="#840B1C" />
								<Text style={styles.smartTitle}>{i18n.t("smartGoals")}</Text>
								<Ionicons name="chevron-forward" size={RFValue(16)} color="#999" style={{ marginLeft: "auto" }} />
							</View>
							{smartGoals.length === 0 ? (
								<Text style={styles.smartEmpty}>{i18n.t("noSmartGoals")}</Text>
							) : (
								smartGoals.slice(0, 3).map((goal) => (
									<View key={goal.id} style={styles.smartRow}>
										<Ionicons
											name={goal.done ? "checkmark-circle" : "ellipse-outline"}
											size={RFValue(16)}
											color={goal.done ? "#2E8B57" : "#bbb"}
										/>
										<Text style={[styles.smartText, goal.done && styles.smartDone]}>
											{goal.text}
										</Text>
									</View>
								))
							)}
						</TouchableOpacity>
					</>
				)}

				<View style={styles.buttonsContainer}>
					{buttons.map((button, index) => {
						const locked = isGuest && !canAccess(button.feature, isGuest);
						return (
							<View key={index} style={styles.buttonWrapper}>
								<TouchableOpacity
									onPress={() => button.sessionMode ? openSessionMode(button.sessionMode) : handlePress(button.route, button.feature)}
									accessibilityRole="button"
									accessibilityLabel={button.text}
									style={[styles.button, { backgroundColor: button.color }, locked && styles.lockedButton]}
								>
									{button.iconName ? <MaterialCommunityIcons name={button.iconName} size={RFValue(52)} color="#555" /> : <Image source={button.icon} style={[styles.icon, locked && styles.lockedIcon]} />}
									{button.badge > 0 && <View style={styles.bigUnreadBadge}><Text style={styles.unreadBadgeText}>{button.badge > 99 ? "99+" : button.badge}</Text></View>}
									{locked && (
										<View style={styles.lockBadge}>
											<Ionicons name="lock-closed" size={RFValue(14)} color="#fff" />
										</View>
									)}
								</TouchableOpacity>
								<Text style={styles.buttonText}>{button.text}</Text>
								{locked && <Text style={styles.lockedLabel}>{i18n.t("guestLocked")}</Text>}
							</View>
						);
					})}
				</View>
			</View>
			<ManagedContent pageKey="home" />
		</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	page: { flex: 1, backgroundColor: "#fff" },
	savedWeekRow: { flexDirection: "row", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E8E2D9" },
	savedWeekDay: { flex: 1, minWidth: 0, alignItems: "center", gap: 6 },
	savedWeekLabel: { fontSize: RFValue(12), color: "#555", fontWeight: "600" },
	contentContainer: {
		flexGrow: 1,
		backgroundColor: "#fff",
		paddingBottom: hp("12%"),
	},
	imageContainer: {
		position: "relative",
		overflow: "hidden",
		justifyContent: "flex-end",
		backgroundColor: "#59666A",
	},
	photo: {
		position: "absolute",
	},
	photoShade: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(20, 31, 36, 0.12)",
	},
	greeting: {
		zIndex: 2,
		marginHorizontal: wp("5%"),
		marginBottom: RFValue(54),
		fontSize: RFValue(22),
		lineHeight: RFValue(30),
		fontWeight: "bold",
		color: "#fff",
		textShadowColor: "rgba(0, 0, 0, 0.75)",
		textShadowOffset: { width: 0, height: 2 },
		textShadowRadius: 5,
	},
	mainContent: {
		backgroundColor: "#fff",
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		marginTop: hp("-3%"),
		paddingTop: hp("1.5%"),
		paddingHorizontal: wp("5%"),
	},
	mainContentCompact: { paddingHorizontal: 14 },
	guestBanner: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#FBEAEA",
		borderRadius: 12,
		padding: 12,
		marginBottom: hp("1.5%"),
		gap: 8,
	},
	guestBannerText: {
		flex: 1,
		fontSize: RFValue(11),
		color: "#840B1C",
		marginLeft: 6,
		lineHeight: RFValue(16),
	},
	sessionActions: {
		gap: 10,
		marginBottom: hp("2%"),
	},
	sessionButton: {
		minHeight: RFValue(64),
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#840B1C",
		borderRadius: 50,
		paddingVertical: hp("2%"),
		marginBottom: 0,
		gap: 10,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 5,
	},
	lockedSessionButton: {
		backgroundColor: "#A07078",
	},
	sessionButtonText: {
		color: "#fff",
		fontSize: RFValue(18),
		fontWeight: "bold",
		marginLeft: 8,
	},
	weekCard: {
		backgroundColor: "#FAF7F2",
		borderRadius: 16,
		padding: 16,
		marginBottom: hp("1.5%"),
	},
	weekTitle: {
		flexShrink: 1,
		fontSize: RFValue(15),
		fontWeight: "bold",
		color: "#333",
		textAlign: "center",
		marginBottom: 12,
	},
	manualSessionButton: {
		minHeight: RFValue(72),
	},
	monthHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		gap: 10,
		marginBottom: 10,
	},
	monthHeaderCompact: {
		alignItems: "stretch",
		gap: 6,
	},
	monthActionIcon: {
		width: RFValue(20),
		height: RFValue(20),
		lineHeight: RFValue(20),
		textAlign: "center",
		flexShrink: 0,
	},
	monthActionChevron: {
		width: RFValue(16),
		height: RFValue(18),
		lineHeight: RFValue(18),
		textAlign: "center",
		flexShrink: 0,
	},
	monthOverviewButton: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minHeight: 48,
		paddingHorizontal: 10,
		paddingVertical: 7,
		borderRadius: 16,
		backgroundColor: "#F7E9EC",
	},
	monthOverviewText: {
		flex: 1,
		fontSize: RFValue(11),
		lineHeight: RFValue(15),
		fontWeight: "800",
		color: "#840B1C",
	},
	monthLogButton: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 48,
		gap: 4,
		paddingHorizontal: 10,
		paddingVertical: 8,
		borderRadius: 18,
		backgroundColor: "#F7E9EC",
	},
	monthLogButtonCompact: {
		paddingHorizontal: 8,
		maxWidth: "46%",
	},
	monthLogText: {
		flexShrink: 1,
		fontSize: RFValue(11),
		fontWeight: "800",
		color: "#840B1C",
	},
	monthToolbar: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 10,
		paddingVertical: 5,
		borderRadius: 12,
		backgroundColor: "#F1ECE6",
	},
	monthArrowButton: {
		width: RFValue(36),
		height: RFValue(32),
		alignItems: "center",
		justifyContent: "center",
	},
	monthLabel: {
		fontSize: RFValue(11),
		fontWeight: "700",
		color: "#555",
		minWidth: wp("40%"),
		textAlign: "center",
	},
	monthGrid: {
		flexDirection: "row",
		flexWrap: "wrap",
	},
	monthDayLabel: {
		width: "14.2857%",
		fontSize: RFValue(10),
		color: "#888",
		fontWeight: "700",
		textAlign: "center",
		marginBottom: 5,
	},
	monthDay: {
		width: "14.2857%",
		height: RFValue(38),
		alignItems: "center",
		justifyContent: "center",
		borderRadius: RFValue(15),
	},
	monthDayToday: {
		backgroundColor: "#2E8B57",
	},
	monthDayText: {
		fontSize: RFValue(11),
		color: "#444",
	},
	monthDayTextToday: {
		color: "#fff",
		fontWeight: "800",
	},
	sessionDayDot: {
		position: "absolute",
		bottom: 3,
		width: RFValue(6),
		height: RFValue(6),
		borderRadius: RFValue(3),
		backgroundColor: "#F2BE22",
		borderWidth: 1,
		borderColor: "#FFFFFF",
	},
	monthDayDisabled: {
		opacity: 0.35,
	},
	monthSummary: {
		flexDirection: "row",
		justifyContent: "space-between",
		gap: 8,
		marginTop: 8,
		paddingTop: 8,
		borderTopWidth: 1,
		borderTopColor: "#E8E2D9",
	},
	monthSummaryText: {
		flexShrink: 1,
		fontSize: RFValue(11),
		color: "#555",
		fontWeight: "600",
	},
	weekRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginBottom: 6,
	},
	dayCell: {
		alignItems: "center",
		width: wp("10%"),
		paddingVertical: 6,
		borderRadius: 10,
	},
	dayCellToday: {
		backgroundColor: "#840B1C",
	},
	dayLabel: {
		fontSize: RFValue(11),
		color: "#888",
	},
	dayNum: {
		fontSize: RFValue(14),
		fontWeight: "bold",
		color: "#333",
		marginVertical: 2,
	},
	dayLabelToday: {
		color: "#fff",
	},
	dayDot: {
		width: RFValue(16),
		height: RFValue(16),
		borderRadius: RFValue(8),
		backgroundColor: "transparent",
	},
	smartCard: {
		backgroundColor: "#FFF7E6",
		borderRadius: 16,
		padding: 14,
		marginBottom: hp("2%"),
		borderWidth: 1,
		borderColor: "#F0E4C2",
	},
	smartHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 8,
	},
	smartTitle: {
		flexShrink: 1,
		minWidth: 0,
		fontSize: RFValue(14),
		fontWeight: "bold",
		color: "#333",
		marginLeft: 6,
	},
	smartEmpty: {
		fontSize: RFValue(12),
		color: "#999",
	},
	smartRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		paddingVertical: 3,
	},
	smartText: {
		flex: 1,
		flexShrink: 1,
		minWidth: 0,
		fontSize: RFValue(13),
		color: "#444",
		marginLeft: 8,
		...Platform.select({ web: { overflowWrap: "anywhere" } }),
	},
	smartDone: {
		textDecorationLine: "line-through",
		color: "#999",
	},
	bigUnreadBadge: { position: "absolute", top: 12, right: 18, minWidth: 27, height: 27, borderRadius: 14, paddingHorizontal: 6, backgroundColor: "#D60000", borderWidth: 2, borderColor: "#fff", alignItems: "center", justifyContent: "center", zIndex: 10 },
	unreadBadgeText: { color: "#fff", fontSize: RFValue(9), fontWeight: "900" },
	buttonsContainer: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
		paddingHorizontal: wp("2%"),
	},
	buttonWrapper: {
		width: "45%",
		alignItems: "center",
		marginVertical: hp("1%"),
	},
	button: {
		width: wp("36%"),
		height: wp("36%"),
		borderRadius: wp("18%"),
		justifyContent: "center",
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 4,
		elevation: 5,
	},
	buttonText: {
		color: "#000",
		fontSize: RFValue(13),
		textAlign: "center",
		marginTop: hp("1%"),
		fontWeight: "bold",
	},
	icon: {
		width: wp("14%"),
		height: wp("14%"),
		resizeMode: "contain",
	},
	lockedButton: {
		opacity: 0.55,
	},
	lockedIcon: {
		opacity: 0.45,
	},
	lockBadge: {
		position: "absolute",
		right: 10,
		top: 10,
		backgroundColor: "#840B1C",
		borderRadius: 12,
		padding: 4,
	},
	lockedLabel: {
		fontSize: RFValue(9),
		color: "#840B1C",
		fontWeight: "600",
		marginTop: 2,
	},
});
