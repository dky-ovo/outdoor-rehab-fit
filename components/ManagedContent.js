import React, { useContext, useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import YoutubePlayer from "react-native-youtube-iframe";
import { AuthContext } from "../contexts/AuthContext";
import { LocaleContext } from "../contexts/LocaleContext";
import { getPublicContent, sendResearchEvent } from "../utils/api";
import { YOUTUBE_PLAYER_PLATFORM_PROPS } from "../utils/youtubePlayerConfig";
import MediaVideo from "./MediaVideo";
import { directVideoUri, youtubeVideoId } from "../utils/contentVideo";
import useVideoPlaybackEvents from "../hooks/useVideoPlaybackEvents";

function TrackedContentVideo({ item, pageKey, user, locale, track }) {
	const startedAt = useRef(null);
	const videoId = directVideoUri(item.value) || youtubeVideoId(item.value);
	const onState = useVideoPlaybackEvents(JSON.stringify([pageKey, item.id, item.value, locale, user?.token]), (state, metadata = {}) => {
		if (state === "playing" && startedAt.current == null) {
			startedAt.current = Date.now(); track("video.play", item, { videoId, ...metadata });
		}
		if (state === "paused" || state === "ended") {
			if (startedAt.current == null) return;
			const watchedMs = Math.max(0, Date.now() - startedAt.current);
			track(state === "ended" ? "video.completed" : "video.paused", item, { videoId, watchedMs, completed: state === "ended", ...metadata });
			startedAt.current = null;
		}
	});
	return youtubeVideoId(item.value)
		? <YoutubePlayer {...YOUTUBE_PLAYER_PLATFORM_PROPS} height={220} videoId={youtubeVideoId(item.value)} onChangeState={onState} />
		: <MediaVideo source={item.value} title={item.title} locale={locale} onChangeState={onState} />;
}

export default function ManagedContent({ pageKey }) {
	const { user } = useContext(AuthContext);
	const { i18n, locale } = useContext(LocaleContext);
	return <ManagedContentInstance key={JSON.stringify([pageKey, locale, user?.token])} pageKey={pageKey} user={user} i18n={i18n} locale={locale} />;
}

function ManagedContentInstance({ pageKey, user, i18n, locale }) {
	const [items, setItems] = useState([]);
	useEffect(() => {
		let active = true;
		getPublicContent(pageKey).then((result) => active && setItems(result.items || [])).catch(() => {});
		return () => { active = false; };
	}, [pageKey]);
	const track = (eventName, item, metadata = {}) => user?.token && sendResearchEvent(user.token, eventName, { screen: pageKey, contentId: item.id, contentType: item.contentType, title: item.title, ...metadata }).catch(() => {});
	const openFeature = async (item) => {
		track("content.click", item);
		if (/^https?:\/\//i.test(item.value)) await Linking.openURL(item.value);
		else router.push(item.value.startsWith("/") ? item.value : `/${item.value}`);
	};
	if (!items.length) return null;
	return <View style={styles.container}>{items.map((item) => <View key={item.id} style={styles.card}>
		<Text style={styles.title}>{item.title}</Text>
		{item.contentType === "text" && <TouchableOpacity onPress={() => track("content.click", item)}><Text style={styles.body}>{item.value}</Text></TouchableOpacity>}
		{item.contentType === "feature" && <TouchableOpacity style={styles.button} onPress={() => openFeature(item)}><Text style={styles.buttonText}>{i18n.t("openFeature")}</Text></TouchableOpacity>}
		{item.contentType === "video" && <TrackedContentVideo key={item.value} item={item} pageKey={pageKey} user={user} locale={locale} track={track} />}
	</View>)}</View>;
}
const styles = StyleSheet.create({
	container: { width: "100%", paddingHorizontal: 16, paddingBottom: 18 },
	card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: "#E7E1E2" },
	title: { color: "#222", fontSize: 17, fontWeight: "800", marginBottom: 10 },
	body: { color: "#444", fontSize: 15, lineHeight: 22 },
	button: { backgroundColor: "#840B1C", borderRadius: 9, padding: 12, alignItems: "center" },
	buttonText: { color: "#fff", fontWeight: "800" },
});
