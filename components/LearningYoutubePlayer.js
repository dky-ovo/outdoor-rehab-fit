import React, { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import YoutubePlayer from "react-native-youtube-iframe";

// Legacy YouTube files have no timeupdate event: sample the official player
// methods while playing. Delayed async results are invalid after pause/leave.
export default function LearningYoutubePlayer({ onPlaybackSample, onChangeState, ...props }) {
	const player = useRef(null);
	const playing = useRef(false);
	const generation = useRef(0);
	const focused = useIsFocused();
	useEffect(() => {
		let active = true; let pending = false;
		const reset = () => { playing.current = false; generation.current += 1; onPlaybackSample?.("inactive"); };
		if (!focused) reset();
		const listener = AppState.addEventListener("change", (state) => { if (state !== "active") reset(); });
		const timer = setInterval(async () => {
			if (!active || pending || !focused || !playing.current || AppState.currentState === "background" || AppState.currentState === "inactive") return;
			const version = generation.current;
			pending = true;
			try {
				const [position, duration] = await Promise.all([player.current?.getCurrentTime?.(), player.current?.getDuration?.()]);
				if (active && focused && playing.current && version === generation.current) onPlaybackSample?.("progress", { positionMs: position * 1000, durationMs: duration * 1000 });
			} catch { onPlaybackSample?.("inactive"); } finally { pending = false; }
		}, 1000);
		return () => { active = false; reset(); clearInterval(timer); listener.remove(); };
	}, [props.videoId, focused, onPlaybackSample]);
	return <YoutubePlayer {...props} ref={player} onChangeState={(state) => {
		playing.current = state === "playing";
		generation.current += 1;
		onPlaybackSample?.(playing.current ? "playing" : "inactive");
		onChangeState?.(state);
	}} />;
}
