import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";

// A WebView compatibility adapter, retaining react-native-youtube-iframe's
// player HTML and message protocol. Each instance accepts only its own iframe.
export function isOwnYoutubeFrameMessage(event, frame, origin) {
	return Boolean(frame?.contentWindow && event.source === frame.contentWindow && event.origin === origin && typeof event.data === "string");
}

export const WebView = forwardRef(function YoutubeWebView({ source, style, onMessage, onLoad, title, scrollEnabled = true }, ref) {
	const frameRef = useRef(null);
	const callbackRef = useRef(onMessage);
	callbackRef.current = onMessage;
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const html = useMemo(() => {
		if (!source?.html || !origin) return source?.html;
		const bridge = `<script>window.ReactNativeWebView={postMessage:function(message){window.parent.postMessage(String(message),${JSON.stringify(origin)})}};</script>`;
		return source.html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + bridge);
	}, [source?.html, origin]);
	useEffect(() => {
		const receive = (event) => {
			if (isOwnYoutubeFrameMessage(event, frameRef.current, origin)) callbackRef.current?.({ nativeEvent: event });
		};
		window.addEventListener("message", receive);
		return () => window.removeEventListener("message", receive);
	}, [origin]);
	useImperativeHandle(ref, () => ({
		postMessage: (message) => frameRef.current?.contentWindow?.postMessage(message, origin),
		injectJavaScript: (script) => {
			// Only the package's local HTML is supported; no cross-origin script access.
			if (source?.html) frameRef.current?.contentWindow?.eval(script);
		},
	}), [origin, source?.html]);
	return React.createElement("iframe", {
		ref: frameRef,
		title: title || "YouTube video",
		src: source?.html ? undefined : source?.uri,
		srcDoc: html,
		style: { width: "100%", height: "100%", borderWidth: 0, ...(scrollEnabled ? { overflow: "hidden" } : {}), ...StyleSheet.flatten(style) },
		allowFullScreen: true,
		frameBorder: "0",
		onLoad,
	});
});

export default WebView;
