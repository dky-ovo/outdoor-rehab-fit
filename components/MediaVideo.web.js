import { appText } from "../utils/appText";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { directVideoUri, videoAspectRatio, videoElementProgress } from "../utils/contentVideo";
import useVideoPlaybackEvents from "../hooks/useVideoPlaybackEvents";

export default function MediaVideo(props) {
	return <MediaVideoInstance key={props.source} {...props} />;
}

function MediaVideoInstance({ source, title = "", locale = "zh", onChangeState, onPlaybackSample, maxViewportHeight, preload = "metadata" }) {
	const uri = directVideoUri(source);
	const player = useRef(null);
	const focused = useIsFocused();
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const [aspectRatio, setAspectRatio] = useState(16 / 9);
	const [playbackState, setPlaybackState] = useState("idle");
	const [slow, setSlow] = useState(false);
	const played = useRef(false);
	const retryPosition = useRef(null);
	// Admin previews can fit tall clips into a dialog; APP teaching stays full width.
	const previewHeight = Number.isFinite(maxViewportHeight) && maxViewportHeight > 0 && maxViewportHeight <= 100 ? maxViewportHeight : null;
	const generation = useMemo(() => ({ active: true }), [uri, attempt]);
	useEffect(() => { generation.active = true; return () => { generation.active = false; }; }, [generation]);
	const emit = useVideoPlaybackEvents(`${uri}:${attempt}`, onChangeState);
	useEffect(() => {
		setSlow(false);
		if (!["loading", "buffering"].includes(playbackState)) return undefined;
		const timer = setTimeout(() => setSlow(true), 12000);
		return () => clearTimeout(timer);
	}, [playbackState, attempt]);
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
	const retry = () => {
		const video = player.current;
		if (video) {
			retryPosition.current = { position: Number.isFinite(video.currentTime) ? video.currentTime : 0, play: !video.paused };
			emitPlayerEvent("paused", { currentTarget: video });
			video.pause();
		}
		onPlaybackSample?.("inactive");
		generation.active = false;
		setFailed(false); setSlow(false); setPlaybackState("loading"); setAttempt(value => value + 1);
	};
	const loadedMetadata = (event) => {
		updateDimensions(event);
		if (!generation.active || !retryPosition.current) return;
		const next = retryPosition.current; retryPosition.current = null;
		const video = event?.currentTarget || player.current;
		if (!video) return;
		if (next.position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(next.position, Math.max(0, video.duration - .05));
		if (next.play && typeof video.play === "function") {
			try { Promise.resolve(video.play()).catch(() => { if (generation.active) setPlaybackState("paused"); }); }
			catch { setPlaybackState("paused"); }
		} else setPlaybackState("paused");
	};
	useEffect(() => {
		const pause = () => { onPlaybackSample?.("inactive"); player.current?.pause(); emit("paused", videoElementProgress(player.current)); };
		if (!focused) pause();
		const onVisibility = () => { if (document.hidden) pause(); };
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
		return () => { if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility); };
	}, [focused, emit, onPlaybackSample]);
	if (!uri || failed) return <View style={{ minHeight: 100, padding: 16, backgroundColor: "#F4F4F4" }}>
		<Text>{appText(locale, "inline.mediaVideo.videoCouldNotBePlayedCheckYourConnection", {"zh":"影片暫時無法播放，請檢查網絡或聯絡管理員確認檔案格式。","en":"Video could not be played. Check your connection or contact the administrator about the file format."})}</Text>
		{!!uri && <TouchableOpacity accessibilityRole="button" onPress={retry} style={{ paddingVertical: 12 }}><Text style={{ color: "#840B1C", fontWeight: "700" }}>{appText(locale, "inline.mediaVideo.retry", {"zh":"重試","en":"Retry"})}</Text></TouchableOpacity>}
	</View>;
	return <View style={{ width: "100%" }}><video key={`${uri}:${attempt}`} ref={player} src={uri} aria-label={title} controls playsInline preload={preload === "none" ? "none" : "metadata"} controlsList="nodownload"
		style={{ display: "block", width: "100%", maxWidth: previewHeight ? `${aspectRatio * previewHeight}vh` : "100%", marginInline: "auto", height: "auto", aspectRatio, objectFit: "contain", background: "#111", WebkitTouchCallout: "none" }}
		onLoadedMetadata={loadedMetadata} onResize={updateDimensions} onContextMenu={(event) => event.preventDefault()}
		onPlay={() => { if (generation.active) setPlaybackState("loading"); }}
		onPlaying={(event) => { if (!generation.active) return; played.current = true; setPlaybackState("playing"); setSlow(false); emitPlayerEvent("playing", event); }}
		onPause={(event) => { if (!generation.active) return; setPlaybackState("paused"); if (!event?.currentTarget?.ended) emitPlayerEvent("paused", event); }}
		onWaiting={(event) => { if (!generation.active) return; setPlaybackState(played.current ? "buffering" : "loading"); emitPlayerEvent("buffering", event); }}
		onStalled={(event) => { if (generation.active && !event?.currentTarget?.paused) { setPlaybackState(played.current ? "buffering" : "loading"); emitPlayerEvent("buffering", event); } }}
		onSeeking={(event) => { if (!generation.active) return; emitPlayerEvent("seeking", event); }}
		onSeeked={(event) => { const video = event.currentTarget; if (generation.active && !video.paused && !video.ended && video.readyState >= 3) { setPlaybackState("playing"); emitPlayerEvent("playing", event); } }}
		onEmptied={(event) => emitPlayerEvent("loading", event)} onTimeUpdate={(event) => emitPlayerEvent("progress", event)}
		onEnded={(event) => { if (!generation.active) return; setPlaybackState("ended"); emitPlayerEvent("ended", event); }}
		onError={(event) => { if (generation.active) { const video = event?.currentTarget || player.current; retryPosition.current = { position: Number.isFinite(video?.currentTime) ? video.currentTime : 0, play: !video?.paused }; emitPlayerEvent("error", event); generation.active = false; setFailed(true); } }} />
		{["loading", "buffering"].includes(playbackState) && <View style={{ paddingVertical: 10 }}>
			<Text accessibilityLiveRegion="polite" testID="media-video-loading-status">{playbackState === "buffering" ? (locale === "en" ? "Buffering video…" : "影片緩衝中…") : (locale === "en" ? "Loading video…" : "載入影片中…")}</Text>
			{slow && <View><Text>{locale === "en" ? "The video is taking longer to load. You can wait or retry." : "影片載入較慢，可以繼續等候或重試。"}</Text><TouchableOpacity accessibilityRole="button" onPress={retry} style={{ paddingVertical: 10 }}><Text style={{ color: "#840B1C", fontWeight: "700" }}>{locale === "en" ? "Retry video" : "重試影片"}</Text></TouchableOpacity></View>}
		</View>}
	</View>;
}
