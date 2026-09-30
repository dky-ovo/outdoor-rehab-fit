import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import { useIsFocused } from "@react-navigation/native";

// Only the incoming detail scales; the Favorites list never transforms, and
// the outgoing detail is never enlarged. The native stack supplies the fade.
export default function FavoriteDetailMotion({ children }) {
	const focused = useIsFocused();
	const scale = useRef(new Animated.Value(1)).current;
	const [reducedMotion, setReducedMotion] = useState(false);
	useEffect(() => {
		let active = true;
		let receivedChange = false;
		const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", value => {
			receivedChange = true;
			if (active) setReducedMotion(Boolean(value));
		});
		void AccessibilityInfo.isReduceMotionEnabled().then(value => {
			if (active && !receivedChange) setReducedMotion(Boolean(value));
		}).catch(() => {});
		return () => { active = false; listener.remove(); };
	}, []);
	useLayoutEffect(() => {
		scale.stopAnimation();
		if (!focused || reducedMotion) { scale.setValue(1); return undefined; }
		scale.setValue(0.96);
		const animation = Animated.timing(scale, {
			toValue: 1, duration: 150, easing: Easing.out(Easing.cubic),
			useNativeDriver: true, isInteraction: false,
		});
		animation.start();
		return () => animation.stop();
	}, [focused, reducedMotion, scale]);
	return <Animated.View testID="favorite-detail-motion" style={{ flex: 1, transform: [{ scale }] }}>{children}</Animated.View>;
}
