import React, { useEffect, useRef, useState } from "react";
import { Platform, Text, TouchableOpacity, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";

export default function DeferredDetailMedia(props) {
	return Platform.OS === "web" ? <WebDeferredMedia {...props} /> : props.children;
}

function WebDeferredMedia({ children, locale = "zh", minHeight = 150, testID, label }) {
	const [ready, setReady] = useState(false);
	const host = useRef(null);
	const focused = useIsFocused();
	useEffect(() => {
		if (ready || !focused || typeof IntersectionObserver !== "function" || !host.current) return undefined;
		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) setReady(true);
		}, { rootMargin: "0px", threshold: .01 });
		observer.observe(host.current);
		return () => observer.disconnect();
	}, [ready, focused]);
	// Keep an activated player mounted across scroll/blur. Its own focus handler
	// closes the real playback interval, preserving learning and research events.
	return <View ref={host} collapsable={false} testID={testID} style={{ minHeight: ready ? 0 : minHeight }}>
		{ready ? children : <TouchableOpacity accessibilityRole="button" onPress={() => setReady(true)} style={{ minHeight, justifyContent: "center", alignItems: "center", padding: 12 }}>
			<Text style={{ color: "#840B1C" }}>{label || (locale === "en" ? "Load this media" : "載入此媒體")}</Text>
		</TouchableOpacity>}
	</View>;
}
