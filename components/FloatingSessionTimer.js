import { Ionicons } from "@expo/vector-icons";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, PanResponder, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useActiveSession } from "@/contexts/ActiveSessionContext";
import { formatDuration } from "@/utils/dates";
import { sessionPathForMode, sessionReturnPath } from "@/utils/sessionRoutes";
import { publishFloatingTimerObstacle } from "@/utils/floatingVoiceLayout";

export default function FloatingSessionTimer() {
	const pathname = usePathname();
	const currentParams = useGlobalSearchParams();
	const returnTo = sessionReturnPath(pathname, currentParams);
	const { width, height } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const { mode, recordMode, seconds, started, completed, pendingSummary } = useActiveSession();
	const recoverableCountdownDraft = !started && pendingSummary?.recordMode === "countdown" && Boolean(pendingSummary.id);
	const visible = !isCompletedCountdown(completed, recordMode) && ((started && mode) || recoverableCountdownDraft);
	const displaySeconds = recoverableCountdownDraft ? Math.max(0, Number(pendingSummary.durationSec) || 0) : seconds;
	const activeFlowMode = pendingSummary?.recordMode || recordMode;
	const activeSessionPath = sessionPathForMode(activeFlowMode);
	const normalizedPathname = String(pathname || "").replace(/^\/\(tabs\)/, "");
	const isSessionScreen = normalizedPathname === "/session" || normalizedPathname.startsWith("/session/");
	const pan = useRef(new Animated.ValueXY()).current;
	const positionRef = useRef({ x: 0, y: 0 });
	const initializedRef = useRef(false);
	const movedRef = useRef(false);
	const openedSummaryRef = useRef(null);
	const layerRef = useRef(null);
	const layerOrigin = useRef({ x: 0, y: 0 });
	const obstacleOwner = useRef(Symbol("floating-timer"));
	const timerShown = useRef(false); timerShown.current = visible && !isSessionScreen;
	const publishPosition = () => {
		publishFloatingTimerObstacle(obstacleOwner.current, timerShown.current ? {
			x: layerOrigin.current.x + positionRef.current.x,
			y: layerOrigin.current.y + positionRef.current.y, width: 112, height: 54,
		} : null);
	};
	useEffect(() => {
		timerShown.current = visible && !isSessionScreen;
		publishPosition();
		return () => { timerShown.current = false; publishFloatingTimerObstacle(obstacleOwner.current, null); };
	}, [visible, isSessionScreen]);
	const measureLayer = () => layerRef.current?.measureInWindow?.((x, y) => {
		if (Number.isFinite(x) && Number.isFinite(y)) { layerOrigin.current = { x, y }; publishPosition(); }
	});

	useEffect(() => {
		if (!pendingSummary?.id || pendingSummary.recordMode === "countdown" || isSessionScreen) {
			openedSummaryRef.current = null;
			return;
		}
		const attemptKey = `${pendingSummary.id}:${returnTo}`;
		if (openedSummaryRef.current === attemptKey) return;
		openedSummaryRef.current = attemptKey;
		router.push({
			pathname: activeSessionPath,
			params: {
				fromFloating: "1",
				returnTo,
			},
		});
	}, [activeSessionPath, isSessionScreen, pendingSummary?.id, pendingSummary?.recordMode, returnTo]);

	const clampPosition = (x, y) => {
		const minX = 8;
		const maxX = Math.max(minX, width - 120);
		const minY = Math.max(insets.top + 8, 50);
		const maxY = Math.max(minY, height - insets.bottom - 140);
		return {
			x: x + 58 < width / 2 ? minX : maxX,
			y: Math.max(minY, Math.min(maxY, y)),
		};
	};

	useEffect(() => {
		if (!initializedRef.current) {
			const initial = clampPosition(width - 120, height * 0.38);
			positionRef.current = initial;
			pan.setValue(initial);
			initializedRef.current = true;
			publishPosition();
			return;
		}
		const adjusted = clampPosition(positionRef.current.x, positionRef.current.y);
		positionRef.current = adjusted;
		pan.setValue(adjusted);
		publishPosition();
	}, [height, insets.bottom, insets.top, pan, width]);

	const panResponder = useMemo(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => true,
				onMoveShouldSetPanResponder: (_event, gesture) =>
					Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
				onPanResponderGrant: () => {
					movedRef.current = false;
					pan.stopAnimation();
					pan.setOffset(positionRef.current);
					pan.setValue({ x: 0, y: 0 });
				},
				onPanResponderMove: (_event, gesture) => {
					if (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4) movedRef.current = true;
					pan.setValue({ x: gesture.dx, y: gesture.dy });
				},
				onPanResponderRelease: (_event, gesture) => {
					const next = clampPosition(
						positionRef.current.x + gesture.dx,
						positionRef.current.y + gesture.dy,
					);
					pan.flattenOffset();
					positionRef.current = next;
					publishPosition();
					Animated.spring(pan, {
						toValue: next,
						useNativeDriver: false,
						friction: 7,
						tension: 70,
					}).start();
					if (!movedRef.current && visible && !isSessionScreen) {
						router.push({
							pathname: activeSessionPath,
							params: {
								fromFloating: "1",
								returnTo,
							},
						});
					}
				},
				onPanResponderTerminate: (_event, gesture) => {
					const next = clampPosition(
						positionRef.current.x + gesture.dx,
						positionRef.current.y + gesture.dy,
					);
					pan.flattenOffset();
					positionRef.current = next;
					publishPosition();
					pan.setValue(next);
				},
			}),
		[activeSessionPath, height, insets.bottom, insets.top, isSessionScreen, pan, returnTo, visible, width],
	);

	if (!visible || isSessionScreen) return null;

	return (
		<View ref={layerRef} onLayout={measureLayer} pointerEvents="box-none" style={styles.layer}>
			<Animated.View
				{...panResponder.panHandlers}
				accessibilityRole="button"
				accessibilityLabel={`${recoverableCountdownDraft ? "Return to unsaved exercise record" : "Return to active session"}, ${formatDuration(displaySeconds)}`}
				style={[styles.timerBall, { transform: pan.getTranslateTransform() }]}
			>
				<View style={styles.liveDot} />
				<Ionicons name="stopwatch-outline" size={22} color="#FFFFFF" />
				<Text style={styles.time}>{formatDuration(displaySeconds)}</Text>
			</Animated.View>
		</View>
	);
}

function isCompletedCountdown(completed, recordMode) {
	return recordMode === "countdown" && completed === true;
}

const styles = StyleSheet.create({
	layer: {
		...StyleSheet.absoluteFillObject,
		zIndex: 700,
		elevation: 20,
	},
	timerBall: {
		position: "absolute",
		left: 0,
		top: 0,
		width: 112,
		height: 54,
		paddingLeft: 14,
		paddingRight: 12,
		borderRadius: 27,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 6,
		backgroundColor: "#9D001B",
		shadowColor: "#000000",
		shadowOpacity: 0.22,
		shadowRadius: 8,
		shadowOffset: { width: 0, height: 4 },
		elevation: 12,
	},
	liveDot: {
		position: "absolute",
		top: 7,
		left: 12,
		width: 7,
		height: 7,
		borderRadius: 4,
		backgroundColor: "#8DF0B3",
	},
	time: {
		color: "#FFFFFF",
		fontSize: 16,
		fontWeight: "800",
		fontVariant: ["tabular-nums"],
	},
});
