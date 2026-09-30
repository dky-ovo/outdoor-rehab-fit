import { useContext, useMemo } from "react";
import { Platform } from "react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

// Only iOS overlays the facility screens with the transparent bottom tab bar.
// Put this clearance INSIDE the scrollable content so its last control can be
// brought above the bar, including after an accordion or portrait video grows.
export default function useFacilityScrollInsets(defaultBottomSpacing = 16) {
	const tabBarHeight = useContext(BottomTabBarHeightContext);
	const safeArea = useContext(SafeAreaInsetsContext);
	const fallbackHeight = 78 + Math.max(0, safeArea?.bottom || 0);
	const overlayHeight = Platform.OS === "ios"
		? (typeof tabBarHeight === "number" && Number.isFinite(tabBarHeight) && tabBarHeight >= 0 ? tabBarHeight : fallbackHeight)
		: 0;
	const paddingBottom = Platform.OS === "ios" ? overlayHeight + 16 : defaultBottomSpacing;
	return useMemo(() => ({
		// The native stack already lays out below its opaque header. Explicit
		// bottom padding also avoids adding a second automatic tab-bar inset.
		contentInsetAdjustmentBehavior: "never",
		automaticallyAdjustsScrollIndicatorInsets: false,
		scrollIndicatorInsets: { bottom: overlayHeight },
		contentContainerStyle: { paddingBottom },
	}), [overlayHeight, paddingBottom]);
}
