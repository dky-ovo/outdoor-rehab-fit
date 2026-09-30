import { appText } from "../utils/appText";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Text, TouchableOpacity, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { WebView } from "react-native-webview";
import { directVideoHtml, directVideoUri, videoMessageEvent } from "../utils/contentVideo";
import useVideoPlaybackEvents from "../hooks/useVideoPlaybackEvents";

export default function MediaVideo(props) {
	return <MediaVideoInstance key={props.source} {...props} />;
}

function MediaVideoInstance({ source, title = "", height = 220, locale = "zh", onChangeState, onPlaybackSample }) {
	const uri = directVideoUri(source);
	const html = useMemo(() => directVideoHtml(uri, title), [uri, title]);
	const webSource = useMemo(() => ({ html }), [html]);
	const player = useRef(null);
	const focused = useIsFocused();
	const canPlay = useRef(focused && AppState.currentState !== "background" && AppState.currentState !== "inactive");
	canPlay.current = focused && AppState.currentState !== "background" && AppState.currentState !== "inactive";
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [width, setWidth] = useState(0);
	const [aspectRatio, setAspectRatio] = useState(null);
	const fallbackHeight = typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 220;
	const playerHeight = width > 0 ? width / (aspectRatio || 16 / 9) : fallbackHeight;
	const generation = useMemo(() => ({ active: true }), [uri, attempt]);
	useEffect(() => { generation.active = true; return () => { generation.active = false; }; }, [generation]);
	const emit = useVideoPlaybackEvents(`${uri}:${attempt}`, onChangeState);
	useEffect(() => { setFailed(false); }, [uri]);
	useEffect(() => {
		const pause = () => {
			onPlaybackSample?.("inactive");
			player.current?.injectJavaScript("document.querySelector('video')?.pause(); true;");
			emit("paused");
		};
		if (!focused) pause();
		const subscription = AppState.addEventListener("change", (state) => { canPlay.current = focused && state === "active"; if (state !== "active") pause(); });
		return () => subscription.remove();
	}, [focused, emit, onPlaybackSample]);
	if (!uri || failed) return <View style={{ minHeight: 100, padding: 16, backgroundColor: "#F4F4F4" }}>
		<Text>{appText(locale, "inline.mediaVideo.videoCouldNotBePlayedCheckYourConnection", {"zh":"影片暫時無法播放，請檢查網絡或聯絡管理員確認檔案格式。","en":"Video could not be played. Check your connection or contact the administrator about the file format."})}</Text>
		{!!uri && <TouchableOpacity accessibilityRole="button" onPress={() => { setFailed(false); setAspectRatio(null); setAttempt((value) => value + 1); }} style={{ paddingVertical: 12 }}><Text style={{ color: "#840B1C", fontWeight: "700" }}>{appText(locale, "inline.mediaVideo.retry", {"zh":"重試","en":"Retry"})}</Text></TouchableOpacity>}
	</View>;
	return <View testID="facility-video-frame" style={{ width: "100%", height: playerHeight, flexShrink: 0 }} onLayout={(event) => {
		const measuredWidth = event.nativeEvent.layout.width;
		if (typeof measuredWidth === "number" && Number.isFinite(measuredWidth) && measuredWidth > 0) setWidth(measuredWidth);
	}}><WebView key={`${uri}:${attempt}`} ref={player} source={webSource} containerStyle={{ height: playerHeight, flex: 0 }} style={{ height: playerHeight, backgroundColor: "#111" }}
		originWhitelist={["*"]} scrollEnabled={false} allowsInlineMediaPlayback allowsFullscreenVideo
		mediaPlaybackRequiresUserAction allowsPictureInPictureMediaPlayback={false}
		allowsAirPlayForMediaPlayback={false} allowsLinkPreview={false} menuItems={[]} textInteractionEnabled={false}
		onFileDownload={() => {}} onOpenWindow={() => {}} setSupportMultipleWindows
		allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
		javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" thirdPartyCookiesEnabled={false}
		onShouldStartLoadWithRequest={(request) => request.url === "about:blank" || request.url?.startsWith("about:blank#") || (request.isTopFrame === false && request.url === uri)}
		onMessage={(event) => {
			if (!generation.active) return;
			const message = videoMessageEvent(event.nativeEvent.data);
			if (!message) return;
			if (message.state === "dimensions") { setAspectRatio(message.aspectRatio); return; }
			if (canPlay.current) onPlaybackSample?.(message.state, message.metadata);
			if (["playing", "ended"].includes(message.state) && !canPlay.current) return;
			if (message.state === "error") { emit("error", message.metadata); generation.active = false; setFailed(true); }
			else emit(message.state, message.metadata);
		}}
		onError={() => { if (generation.active) { emit("paused"); generation.active = false; setFailed(true); } }} /></View>;
}
