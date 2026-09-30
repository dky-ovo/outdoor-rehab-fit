import { useCallback, useEffect, useMemo } from "react";
import { videoProgressMetadata } from "../utils/contentVideo";

// A buffering player may emit playing repeatedly. Count each continuous watch
// interval only once, and finish that interval when the player leaves the screen.
export default function useVideoPlaybackEvents(source, onChangeState) {
	const session = useMemo(() => ({ active: true, last: "", metadata: {}, callback: onChangeState }), [source]);
	session.callback = onChangeState;
	const emit = useCallback((state, metadata) => {
		if (!session.active) return;
		session.metadata = { ...session.metadata, ...videoProgressMetadata(metadata) };
		if (state === "progress") return;
		const normalized = ["buffering", "seeking", "loading", "error", "unstarted", "video cued"].includes(state) ? "paused" : state;
		if (!["playing", "paused", "ended"].includes(normalized) || normalized === session.last) return;
		// Errors, loading, leaving a screen, and seeking to the final frame while
		// paused are not completion. Only an actively playing segment can end.
		if ((normalized === "paused" || normalized === "ended") && session.last !== "playing") return;
		session.last = normalized;
		if (Object.keys(session.metadata).length) session.callback?.(normalized, session.metadata);
		else session.callback?.(normalized);
	}, [session]);
	useEffect(() => {
		session.active = true;
		return () => {
			session.active = false;
			if (session.last === "playing") {
				if (Object.keys(session.metadata).length) session.callback?.("paused", session.metadata);
				else session.callback?.("paused");
			}
			session.last = "";
		};
	}, [session]);
	return emit;
}
