import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useNavigation } from "expo-router";

// Creating native video/audio views competes with the incoming transition.
// A tab/deep-link entry may have no native transitionEnd, so use a short fallback.
export default function useDeferredDetailContent(contentKey) {
	const navigation = useNavigation();
	const focused = useIsFocused();
	const [readyKey, setReadyKey] = useState(null);
	const ready = Platform.OS === "web" || readyKey === contentKey;
	useEffect(() => {
		if (ready || !focused) return undefined;
		let active = true;
		const finish = () => { if (active) setReadyKey(contentKey); };
		const unsubscribe = navigation.addListener?.("transitionEnd", event => {
			if (!event.data?.closing) finish();
		});
		const timer = setTimeout(finish, 400);
		return () => { active = false; clearTimeout(timer); unsubscribe?.(); };
	}, [navigation, focused, contentKey, ready]);
	// Once created, keep players mounted across blur so their existing focus and
	// AppState handlers can pause playback and close learning/research intervals.
	return ready;
}
