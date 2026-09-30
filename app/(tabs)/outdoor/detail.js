import { appText } from "../../../utils/appText";
import React, { useEffect, useContext, useState, useCallback, useMemo, useRef } from "react";
import { StyleSheet, View, Text, ScrollView, Modal, TouchableOpacity } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Collapsible } from "@/components/Collapsible";
import { ThemedText } from "@/components/ThemedText";
import { useNavigation } from "expo-router";
import { LocaleContext } from "../../../contexts/LocaleContext";
import { AuthContext } from "../../../contexts/AuthContext";
import LearningYoutubePlayer from "../../../components/LearningYoutubePlayer";
import AudioPlayer from "@/components/AudioPlayer";
import TTSButton from "@/components/TTSButton";
import { Ionicons } from "@expo/vector-icons";
import { enSoundFiles, zhSoundFiles, gifFiles1, gifFiles2 } from "../../../constants/Equipments";
import { RFValue } from "react-native-responsive-fontsize";
import { widthPercentageToDP as wp, heightPercentageToDP as hp } from "react-native-responsive-screen";
import { trackIntroLoad, trackAudioPlay } from "../../../utils/usage";
import useEquipmentLearning, { LearningReadContent, LearningReadContext } from "../../../hooks/useEquipmentLearning";
import { showAlert } from "../../../utils/alert";
import { getCachedEquipmentCatalog, loadCachedEquipmentCatalog, getEquipmentCatalog, subscribeEquipmentCatalog, sendResearchEvent } from "../../../utils/api";
import EquipmentImage from "../../../components/EquipmentImage";
import ManagedContent from "../../../components/ManagedContent";
import MediaVideo from "../../../components/MediaVideo";
import useVideoPlaybackEvents from "../../../hooks/useVideoPlaybackEvents";
import { equipmentImageSource, mergeEquipmentCatalog } from "../../../utils/equipmentCatalog";
import { equipmentInstructionParts } from "../../../utils/equipmentInstructions";
import { useAndroidBackTarget } from "../../../hooks/useAndroidBackTarget";
import { equipmentDetailBackTarget } from "../../../utils/equipmentLocationRoutes";
import { YOUTUBE_PLAYER_PLATFORM_PROPS } from "../../../utils/youtubePlayerConfig";
import useFacilityScrollInsets from "../../../hooks/useFacilityScrollInsets";
import FacilityLocationHeaderButton from "../../../components/FacilityLocationHeaderButton";
import useDeferredDetailContent from "../../../hooks/useDeferredDetailContent";

function hasDisplayContent(value) {
	const text = String(value || "").trim();
	return Boolean(text && text !== "/");
}

function StructuredInstructions({ text, i18n }) {
	const { steps, warnings } = equipmentInstructionParts(text);
	if (!steps.length && !warnings.length) return null;
	return <View style={styles.instructions}>
		{steps.length > 0 && <Text style={styles.instructionHeading}>{i18n.t("instructionSteps")}</Text>}
		{steps.map((step, index) => <View key={`step-${index}`} style={styles.instructionRow}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View><Text style={styles.instructionText}>{step}</Text></View>)}
		{warnings.length > 0 && <View style={styles.warningBox}><View style={styles.warningHeading}><Ionicons name="warning" size={RFValue(20)} color="#9A5B00" /><Text style={styles.warningTitle}>{i18n.t("attentionNotes")}</Text></View>{warnings.map((warning, index) => <Text key={`warning-${index}`} style={styles.warningText}>• {warning}</Text>)}</View>}
	</View>;
}

const Detail = ({ onFavoriteBack } = {}) => {
	const favoriteStack = typeof onFavoriteBack === "function";
	const scrollInsets = useFacilityScrollInsets(RFValue(16));
	const { i18n, locale } = useContext(LocaleContext);
	const { canAccessEquipment, isGuest, user } = useContext(AuthContext);
	const route = useLocalSearchParams();
	const routeId = String(Array.isArray(route.id) ? route.id[0] : route.id || "");
	const secondaryContentReady = useDeferredDetailContent(routeId);
	const openedFrom = favoriteStack ? "favorite" : String(Array.isArray(route.from) ? route.from[0] : route.from || "");
	const categoryId = String(Array.isArray(route.categoryId) ? route.categoryId[0] : route.categoryId || "");
	const categoryName = String(Array.isArray(route.categoryName) ? route.categoryName[0] : route.categoryName || "");
	const listFrom = String(Array.isArray(route.listFrom) ? route.listFrom[0] : route.listFrom || "");
	const externalBackTarget = useMemo(() => equipmentDetailBackTarget({ from: openedFrom, categoryId, categoryName, listFrom }), [openedFrom, categoryId, categoryName, listFrom]);
	useAndroidBackTarget(externalBackTarget, Boolean(externalBackTarget) && !favoriteStack);
	const localItems = i18n.t("equipmentList", { returnObjects: true });
	const [catalogItems, setCatalogItems] = useState(() => getCachedEquipmentCatalog()?.items || null);
	const [catalogFailed, setCatalogFailed] = useState(false);
	// Keep the last authoritative bilingual catalog when changing language or
	// equipment. Resetting to bundled YouTube here could briefly play an old or
	// wrong-language video while a fresh request is still loading.
	const mergedItems = mergeEquipmentCatalog(Array.isArray(localItems) ? localItems : [], catalogItems || [], locale, { imageCatalogReady: catalogItems !== null });
	const resolvedItem = mergedItems.find((entry) => String(entry.id) === routeId);
	const item = resolvedItem || { id: routeId, name: String(route.name || "") };
	const unavailable = catalogItems !== null && !resolvedItem;
	const videoCatalogReady = catalogItems !== null || catalogFailed;
	const navigation = useNavigation();

	const [modalVisible, setModalVisible] = useState(false);
	const [selectedImage, setSelectedImage] = useState(null);
	const videoStartedAt = useRef(null);
	const openLocations = useCallback(() => {
		router.push({ pathname: "/equipmentmap", params: { equipmentId: String(item.id), equipmentName: item.name, equipmentNameZh: item.nameZh || (locale === "zh" ? item.name : ""), equipmentNameEn: item.nameEn || (locale === "en" ? item.name : ""), locationSource: "detail", detailFrom: openedFrom, categoryId, categoryName, ...(listFrom === "goals" ? { listFrom } : {}) } });
	}, [item.id, item.name, item.nameZh, item.nameEn, locale, openedFrom, categoryId, categoryName, listFrom]);

	const openModal = (image) => {
		setSelectedImage(image);
		setModalVisible(true);
	};

	const closeModal = () => {
		setModalVisible(false);
		setSelectedImage(null);
	};

	const soundFile = locale === "en" ? enSoundFiles : zhSoundFiles;

	useEffect(() => {
		let active = true;
		let receivedFreshCatalog = false;
		const unsubscribe = subscribeEquipmentCatalog?.(result => {
			if (!active || !Array.isArray(result?.items)) return;
			receivedFreshCatalog = true;
			setCatalogItems(result.items);
			setCatalogFailed(false);
		});
		setModalVisible(false);
		setSelectedImage(null);
		void loadCachedEquipmentCatalog().then(result => {
			if (active && !receivedFreshCatalog && Array.isArray(result?.items)) setCatalogItems(result.items);
		}).catch(() => {});
		getEquipmentCatalog()
			.then((result) => {
				if (!active || !Array.isArray(result?.items)) return;
				receivedFreshCatalog = true;
				setCatalogItems(result.items);
				setCatalogFailed(false);
			})
			.catch(() => { if (active) setCatalogFailed(true); /* keep the last public catalog and local teaching text offline */ });
		return () => { active = false; unsubscribe?.(); };
	}, [locale, routeId]);

	// Guests can open 40% of the Facility Guide. Locked equipment is protected
	// here as well as in the list so deep links cannot bypass the restriction.
	const hasFullAccess = canAccessEquipment(item.id);

	const promptLogin = () => {
		showAlert(i18n.t("guestRestrictedTitle"), i18n.t("guestRestrictedMessage"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{ text: i18n.t("loginNow"), onPress: () => router.push({ pathname: "/login", params: { from: "settings" } }) },
		]);
	};

	useEffect(() => {
		navigation.setOptions({
			headerTitle: item.name,
			// Favorites owns its own stack and can pop normally. Legacy external
			// Outdoor entries still return to their explicit source, not an old list.
			gestureEnabled: favoriteStack || !externalBackTarget,
			headerLeft: () => <TouchableOpacity onPress={onFavoriteBack || (() => externalBackTarget ? router.replace(externalBackTarget) : router.canGoBack() ? router.back() : router.replace("/(tabs)"))}><Ionicons name="chevron-back" size={RFValue(18)} color="#11181C" /></TouchableOpacity>,
			headerRight: () => <FacilityLocationHeaderButton locale={locale} onPress={openLocations} />,
		});
	}, [navigation, item.name, locale, openLocations, externalBackTarget, favoriteStack, onFavoriteBack]);

	// App Upgrade #4: count loads of exercise introduction pages
	useEffect(() => {
		trackIntroLoad();
	}, []);

	const learning = useEquipmentLearning({ item, locale, enabled: !unavailable && hasFullAccess, blocked: modalVisible, identity: user?.id || user?.token || "guest", bottomOcclusion: scrollInsets.scrollIndicatorInsets.bottom });
	const handleAudioPlay = useCallback(() => {
		trackAudioPlay(); // App Upgrade #4: count audio plays
	}, [item.id]);
	const recordVideoState = useCallback(
		(state, metadata = {}) => {
			const videoId = item.videoUrl || item.youtubeKey;
			if (state === "playing" && videoStartedAt.current == null) { videoStartedAt.current = Date.now(); user?.token && sendResearchEvent(user.token, "video.play", { screen: "outdoor.detail", contentId: item.id, videoId, ...metadata }).catch(() => {}); }
			if (["paused", "ended"].includes(state)) {
				if (state === "paused" && videoStartedAt.current == null) return;
				const watchedMs = videoStartedAt.current != null ? Math.max(0, Date.now() - videoStartedAt.current) : 0;
				user?.token && sendResearchEvent(user.token, state === "ended" ? "video.completed" : "video.paused", { screen: "outdoor.detail", contentId: item.id, videoId, watchedMs, completed: state === "ended", ...metadata }).catch(() => {});
				videoStartedAt.current = null;
			}
		},
		[item.id, item.videoUrl, item.youtubeKey, user?.token]
	);
	const handleVideoStateChange = useVideoPlaybackEvents(
		JSON.stringify([routeId, item.id, item.videoUrl, item.youtubeKey, locale, user?.token, unavailable, hasFullAccess]),
		recordVideoState
	);

	const sectionSpeaker = (section) => (
		<TTSButton key={`${locale}:${item.id}:${section}`} text={item[section]} locale={locale} i18n={i18n} onSpokenRange={(start, end) => learning.text("listened", section, start, end)} inline />
	);
	const headerImage = item.horizontalPic || item.pic || item.icon;
	const audioFile = soundFile[Number(item.id)] ?? soundFile[item.id];
	const firstGif = item.gifLeftUrl ? equipmentImageSource(item.gifLeftUrl) : gifFiles1[item.id];
	const secondGif = item.gifRightUrl ? equipmentImageSource(item.gifRightUrl) : gifFiles2[item.id];
	const hasPracticeContent = Boolean((firstGif && secondGif) || hasDisplayContent(item.details));

	if (unavailable) {
		return <Text>{appText(locale, "inline.facilityDetails.thisFacilityIsCurrentlyUnavailable", {"zh":"此設施暫不可使用。","en":"This facility is currently unavailable."})}</Text>;
	}

	if (isGuest && !hasFullAccess) {
		return <View style={styles.restrictedPage}>
			<Ionicons name="lock-closed" size={RFValue(58)} color="#840B1C" />
			<Text style={styles.restrictedTitle}>{i18n.t("guestRestrictedTitle")}</Text>
			<Text style={styles.restrictedText}>{i18n.t("guestRestrictedMessage")}</Text>
			<TouchableOpacity style={styles.loginButton} onPress={() => router.push({ pathname: "/login", params: { from: "settings" } })}>
				<Text style={styles.loginButtonText}>{i18n.t("loginNow")}</Text>
			</TouchableOpacity>
		</View>;
	}

	return (
		<LearningReadContext.Provider value={learning}>
		<View ref={learning.viewport} collapsable={false} style={styles.page}>
		<ScrollView testID="facility-detail-scroll" {...scrollInsets} style={styles.scroll} contentContainerStyle={[styles.container, scrollInsets.contentContainerStyle]}>
			<Modal visible={modalVisible} transparent={true} onRequestClose={closeModal}>
				<View style={styles.modalContainer}>
					<View style={styles.modalContent}>
						<EquipmentImage source={selectedImage} imageKey={`${item.id}:expanded`} contentFit="contain" style={styles.modalImage} testID="equipment-expanded-image" />
						<TouchableOpacity style={styles.modalCloseButton} onPress={closeModal}>
							<Text style={styles.modalCloseText}>{i18n.t("close")}</Text>
							<Ionicons name="close" size={24} color="black" />
						</TouchableOpacity>
					</View>
				</View>
			</Modal>
			{headerImage ? <EquipmentImage source={headerImage} imageKey={String(item.id)} contentFit="contain" style={styles.image} testID="equipment-detail-image" /> : null}
			<View style={styles.section}>
				<ThemedText style={styles.text}>{i18n.t("introduction")}</ThemedText>
				{hasDisplayContent(item.kinesiologyTip) ? <Collapsible title={i18n.t("tip1")} key={`${item.id}:${locale}:kinesiologyTip`} headerAction={sectionSpeaker("kinesiologyTip")}>
					<LearningReadContent section="kinesiologyTip"><ThemedText style={styles.text}>{item.kinesiologyTip}</ThemedText></LearningReadContent>
				</Collapsible> : null}
				{hasDisplayContent(item.ptTip) ? <Collapsible title={i18n.t("tip2")} key={`${item.id}:${locale}:ptTip`} headerAction={sectionSpeaker("ptTip")}>
					<LearningReadContent section="ptTip"><ThemedText style={styles.text}>{item.ptTip}</ThemedText></LearningReadContent>
				</Collapsible> : null}
				{hasDisplayContent(item.otTip) ? <Collapsible title={i18n.t("tip3")} key={`${item.id}:${locale}:otTip`} headerAction={sectionSpeaker("otTip")}>
					<LearningReadContent section="otTip"><ThemedText style={styles.text}>{item.otTip}</ThemedText></LearningReadContent>
				</Collapsible> : null}
				{item.tcmEnabled && hasDisplayContent(item.tcmTip) ? <Collapsible title={i18n.t("tcmPerspective")} key={`${item.id}:${locale}:tcmTip`} headerAction={sectionSpeaker("tcmTip")}>
					<LearningReadContent section="tcmTip"><ThemedText style={styles.text}>{item.tcmTip}</ThemedText></LearningReadContent>
				</Collapsible> : null}
				{hasDisplayContent(item.careTip) ? <Collapsible title={i18n.t("tip4")} key={`${item.id}:${locale}:careTip`} headerAction={sectionSpeaker("careTip")}>
					<LearningReadContent section="careTip"><ThemedText style={styles.text}>{item.careTip}</ThemedText></LearningReadContent>
				</Collapsible> : null}
			</View>
			{hasPracticeContent ? <View style={styles.section}>
				<ThemedText style={styles.text}>{i18n.t("outdoorPractice")}</ThemedText>
				{firstGif && secondGif ? <View style={styles.gifContainer}>
					<TouchableOpacity style={styles.gifButton} disabled={!secondaryContentReady} onPress={() => openModal(firstGif)}>
						{secondaryContentReady ? <EquipmentImage source={firstGif} imageKey={`${item.id}:left`} style={styles.gif} /> : <View testID="equipment-left-gif-placeholder" style={styles.gif} />}
					</TouchableOpacity>
					<TouchableOpacity style={styles.gifButton} disabled={!secondaryContentReady} onPress={() => openModal(secondGif)}>
						{secondaryContentReady ? <EquipmentImage source={secondGif} imageKey={`${item.id}:right`} style={styles.gif} /> : <View testID="equipment-right-gif-placeholder" style={styles.gif} />}
					</TouchableOpacity>
				</View> : null}
				{hasDisplayContent(item.details) ? <Collapsible title={i18n.t("useTips")} key={`${item.id}:${locale}:details`} headerAction={sectionSpeaker("details")}>
					<LearningReadContent section="details"><StructuredInstructions text={item.details} i18n={i18n} /></LearningReadContent>
				</Collapsible> : null}
			</View> : null}
			{audioFile ? <View style={styles.section}>
				<ThemedText style={styles.text}>{i18n.t("audioTitle")}</ThemedText>
				<View style={styles.section}>
					{hasFullAccess ? (
						secondaryContentReady ? <AudioPlayer key={`${item.id}:${locale}:${user?.id || "guest"}`}
							audioFile={audioFile}
							onPlayStart={handleAudioPlay}
							onPlaybackSample={learning.audio}
						/> : <View testID="equipment-audio-placeholder" style={{ height: 180 }} />
					) : (
						<TouchableOpacity style={styles.lockedBox} onPress={promptLogin}>
							<Ionicons name="lock-closed" size={RFValue(28)} color="#999" />
							<Text style={styles.lockedText}>{i18n.t("guestRestrictedSection")}</Text>
						</TouchableOpacity>
					)}
				</View>
			</View> : null}
			{videoCatalogReady && (item.videoUrl || item.youtubeKey) ? <View style={styles.section}>
				<ThemedText style={styles.text}>{i18n.t("reminderAndTips")}</ThemedText>
				{hasFullAccess ? (
					!secondaryContentReady
						? <View testID="equipment-video-placeholder" style={item.videoUrl ? { width: "100%", aspectRatio: 16 / 9 } : { height: hp("35%") }} />
						: item.videoUrl
						? <MediaVideo key={`${item.id}:${locale}:${user?.id || "guest"}`} source={item.videoUrl} title={item.name} locale={locale} onChangeState={handleVideoStateChange} onPlaybackSample={learning.video} />
						: <LearningYoutubePlayer key={`${item.id}:${locale}:${user?.id || "guest"}`} {...YOUTUBE_PLAYER_PLATFORM_PROPS} height={hp("35%")} play={false} videoId={item.youtubeKey} onChangeState={handleVideoStateChange} />
				) : (
					<TouchableOpacity style={styles.lockedBox} onPress={promptLogin}>
						<Ionicons name="lock-closed" size={RFValue(28)} color="#999" />
						<Text style={styles.lockedText}>{i18n.t("guestRestrictedSection")}</Text>
					</TouchableOpacity>
				)}
			</View> : null}
			{secondaryContentReady && <ManagedContent pageKey="outdoor.detail" />}
		</ScrollView>
		</View>
		</LearningReadContext.Provider>
	);
};

const styles = StyleSheet.create({
	page: {
		flex: 1,
		backgroundColor: "#F3F4F5",
	},
	scroll: { flex: 1, backgroundColor: "#F3F4F5" },
	container: {
		flexGrow: 1,
	},
	titleContainer: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	stepContainer: {
		gap: 8,
		marginBottom: 8,
	},
	section: {
		padding: wp("5%"),
		marginBottom: hp("2%"),
		backgroundColor: "#fff",
	},
	image: {
		width: "100%",
		height: hp("35%"),
		resizeMode: "contain",
	},
	text: {
		fontSize: RFValue(16),
		lineHeight: RFValue(24),
		marginBottom: RFValue(16),
	},
	instructions: {
		paddingRight: 18,
		paddingBottom: 12,
	},
	instructionHeading: {
		fontSize: RFValue(16),
		fontWeight: "800",
		color: "#333",
		marginBottom: 12,
	},
	instructionRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		marginBottom: 13,
	},
	stepNumber: {
		width: RFValue(28),
		height: RFValue(28),
		borderRadius: RFValue(14),
		backgroundColor: "#840B1C",
		alignItems: "center",
		justifyContent: "center",
		marginRight: 10,
	},
	stepNumberText: {
		color: "#fff",
		fontSize: RFValue(12),
		fontWeight: "800",
	},
	instructionText: {
		flex: 1,
		fontSize: RFValue(14),
		lineHeight: RFValue(21),
		color: "#333",
	},
	warningBox: {
		marginTop: 6,
		backgroundColor: "#FFF4D8",
		borderLeftWidth: 4,
		borderLeftColor: "#E09B24",
		borderRadius: 10,
		padding: 13,
	},
	warningHeading: {
		flexDirection: "row",
		alignItems: "center",
		gap: 7,
		marginBottom: 7,
	},
	warningTitle: {
		fontSize: RFValue(14),
		fontWeight: "800",
		color: "#7A4600",
	},
	warningText: {
		fontSize: RFValue(13),
		lineHeight: RFValue(20),
		color: "#684318",
		marginBottom: 4,
	},
	gifContainer: {
		flexShrink: 0,
		flexDirection: "row",
		justifyContent: "space-between",
	},
	gifButton: {
		width: "40%",
	},
	gif: {
		width: "100%", // Adjust the width as needed
		height: hp("40%"), // Adjust the height as needed
		resizeMode: "cover",
	},
	modalContainer: {
		flex: 1,
		backgroundColor: "rgba(0, 0, 0, 0.8)",
		justifyContent: "center",
		alignItems: "center",
	},
	modalContent: {
		marginTop: 80,
		width: wp("90%"),
		height: hp("70%"),
		flexDirection: "column",
		justifyContent: "center",
		alignItems: "center",
	},
	modalImage: {
		width: "100%",
		height: "100%",
		resizeMode: "contain",
	},
	modalCloseButton: {
		position: "absolute",
		top: hp("0%"),
		right: wp("0%"),
		padding: 10,
		backgroundColor: "white",
		borderRadius: 5,
		flexDirection: "row",
		alignItems: "center",
	},
	modalCloseText: {
		color: "black",
		fontSize: 16,
		fontWeight: "bold",
	},
	lockedBox: {
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#f0f0f0",
		borderRadius: 12,
		padding: 24,
		borderWidth: 1,
		borderColor: "#ddd",
		borderStyle: "dashed",
	},
	lockedText: {
		marginTop: 10,
		fontSize: RFValue(13),
		color: "#888",
		textAlign: "center",
		lineHeight: RFValue(20),
	},
	restrictedPage: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#fff",
		paddingHorizontal: wp("10%"),
	},
	restrictedTitle: {
		marginTop: RFValue(18),
		fontSize: RFValue(20),
		fontWeight: "800",
		color: "#840B1C",
		textAlign: "center",
	},
	restrictedText: {
		marginTop: RFValue(10),
		fontSize: RFValue(14),
		lineHeight: RFValue(21),
		color: "#555",
		textAlign: "center",
	},
	loginButton: {
		marginTop: RFValue(22),
		backgroundColor: "#840B1C",
		borderRadius: RFValue(24),
		paddingHorizontal: RFValue(26),
		paddingVertical: RFValue(12),
	},
	loginButtonText: {
		fontSize: RFValue(14),
		fontWeight: "800",
		color: "#fff",
	},
});

export default Detail;
