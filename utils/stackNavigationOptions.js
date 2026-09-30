import { Platform } from "react-native";

/**
 * Feature stacks use replace for deterministic returns to a known parent.
 * Native Stack otherwise animates REPLACE as PUSH on iOS. Only change that
 * replacement animation: ordinary pushes, pops, and dismissTo keep their native
 * behavior and the existing return destinations remain unchanged.
 *
 * Do not apply this to the root onboarding/auth stack or the session stack:
 * those also use replace to move forward (session routes intentionally use none).
 * @returns {import("@react-navigation/native-stack").NativeStackNavigationOptions}
 */
export function getReturnStackOptions(platform = Platform.OS) {
	return platform === "ios" ? { animationTypeForReplace: "pop" } : {};
}
