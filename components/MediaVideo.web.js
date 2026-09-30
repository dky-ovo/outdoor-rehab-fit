import { appText } from "../utils/appText";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { directVideoUri, videoAspectRatio, videoElementProgress } from "../utils/contentVideo";
import useVideoPlaybackEvents from "../hooks/useVideoPlaybackEvents";

export default function MediaVideo(props) {
	return <MediaVideoInstance key={props.source} {...props} />;
}

function MediaVideoInstance({ source, title = "", locale = "zh", onChangeState, onPlaybackSample, maxViewportHeight }) {
	const uri = directVideoUri(source);
	const player = useRef(null);
	const focused = useIsFocused();
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [aspectRatio, setAspectRatio] = useState(16 / 9);
	// Admin previews can fit tall clips into a dialog; APP teaching stays full width.
	const previewHeight = Number.isFinite(maxViewportHeight) && maxViewportHeight > 0 && maxViewportHeight <= 100 ? maxViewportHeight : null;
	const generation = useMemo(() => ({ active: true }), [uri, attempt]);
	useEffect(() => { generation.active = true; return () => { generation.active = false; }; }, [generation]);
	const emit = useVideoPlaybackEvents(`${uri}:${attempt}`, onChangeState);
	const updateDimensions = (event) => {
		if (!generation.active) return;
		const ratio = videoAspectRatio(event?.currentTarget || player.current);
		if (ratio !== null) setAspectRatio(ratio);
	};
	const emitPlayerEvent = (state, event) => {
		if (!generation.active) return;
		if (focused && !(typeof document !== "undefined" && document.hidden)) onPlaybackSample?.(state, videoElementProgress(event?.currentTarget || player.current));
		if (["playing", "ended"].includes(state) && (!focused || (typeof document !== "undefined" && document.hidden))) return;
		emit(state, videoElementProgress(event?.currentTarget || player.current));
	};
	useEffect(() => { setFailed(false); }, [uri]);
	useEffect(() => {
		const pause = () => { onPlaybackSample?.("inactive"); player.current?.pause(); emit("paused", videoElementProgress(player.current)); };
		if (!focused) pause();
		const onVisibility = () => { if (document.hidden) pause(); };
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
		return () => { if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility); };
	}, [focused, emit, onPlaybackSample]);
	if (!uri || failed) return <View style={{ minHeight: 100, padding: 16, backgroundColor: "#F4F4F4" }}>
		<Text>{appText(locale, "inline.mediaVideo.videoCouldNotBePlayedCheckYourConnection", {"zh":"影片暫時無法播放，請檢查網絡或聯絡管理員確認檔案格式。","en":"Video could not be played. Check your connection or contact the administrator about the file format."})}</Text>
		{!!uri && <TouchableOpacity accessibilityRole="button" onPress={() => { setFailed(false); setAttempt((value) => value + 1); }} style={{ paddingVertical: 12 }}><Text style={{ color: "#840B1C", fontWeight: "700" }}>{appText(locale, "inline.mediaVideo.retry", {"zh":"重試","en":"Retry"})}</Text></TouchableOpacity>}
	</View>;
	return <video key={`${uri}:${attempt}`} ref={player} src={uri} aria-label={title} controls playsInline preload="metadata" controlsList="nodownload"
		style={{ display: "block", width: "100%", maxWidth: previewHeight ? `${aspectRatio * previewHeight}vh` : "100%", marginInline: "auto", height: "auto", aspectRatio, objectFit: "contain", background: "#111", WebkitTouchCallout: "none" }}
		onLoadedMetadata={updateDimensions} onResize={updateDimensions} onContextMenu={(event) => event.preventDefault()}
		onPlaying={(event) => emitPlayerEvent("playing", event)} onPause={(event) => { if (!event.currentTarget.ended) emitPlayerEvent("paused", event); }}
		onWaiting={(event) => emitPlayerEvent("buffering", event)} onSeeking={(event) => emitPlayerEvent("seeking", event)}
		onSeeked={(event) => { const video = event.currentTarget; if (!video.paused && !video.ended && video.readyState >= 3) emitPlayerEvent("playing", event); }}
		onEmptied={(event) => emitPlayerEvent("loading", event)} onTimeUpdate={(event) => emitPlayerEvent("progress", event)}
		onEnded={(event) => emitPlayerEvent("ended", event)} onError={(event) => { if (generation.active) { emitPlayerEvent("error", event); generation.active = false; setFailed(true); } }} />;
}
