import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";
import { useIsFocused } from "@react-navigation/native";

// The native stack fades the screen/header. Only its content scales here;
// transforms do not change the navigator's measured height or move it sideways.
export default function SettingsScreenMotion({ children }) {
	const focused = useIsFocused();
	const scale = useRef(new Animated.Value(0.96)).current;
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
		if (reducedMotion) { scale.setValue(1); return undefined; }
		if (focused) scale.setValue(0.96);
		const animation = Animated.timing(scale, {
			toValue: focused ? 1 : 1.02,
			duration: 150,
			easing: Easing.out(Easing.cubic),
			useNativeDriver: true,
			isInteraction: false,
		});
		animation.start();
		return () => animation.stop();
	}, [focused, reducedMotion, scale]);

	return <Animated.View testID="settings-screen-motion" style={{ flex: 1, transform: [{ scale }] }}>{children}</Animated.View>;
}
