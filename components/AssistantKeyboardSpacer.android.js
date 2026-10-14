import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import Animated, { KeyboardState, runOnJS, useAnimatedKeyboard, useAnimatedReaction, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { isEdgeToEdge } from "react-native-is-edge-to-edge";

const EDGE_TO_EDGE = isEdgeToEdge();

const KeyboardObserver = memo(function KeyboardObserver({ bottomInset, translation, lastOpenHeight, onInsetChange }) {
	// Build 17 already includes this native IME animation observer. Keep its
	// default edge-to-edge detection so unmount restores older Android windows.
	const keyboard = useAnimatedKeyboard();
	const subscriptionHeight = useSharedValue(-2);
	const observedFreshState = useSharedValue(false);
	const enabled = useSharedValue(true);
	const lastSettledInset = useSharedValue(-1);
	const alive = useRef(true);
	const settleTimer = useRef(null);
	const [snapshot, setSnapshot] = useState(() => ({ visible: Boolean(Keyboard.isVisible?.()), height: Keyboard.metrics?.()?.height || 0 }));
	useEffect(() => {
		const show = Keyboard.addListener("keyboardDidShow", event => setSnapshot({ visible: true, height: event.endCoordinates?.height || Keyboard.metrics?.()?.height || 0 }));
		const hide = Keyboard.addListener("keyboardDidHide", () => setSnapshot({ visible: false, height: 0 }));
		return () => { show.remove(); hide.remove(); };
	}, []);
	useEffect(() => {
		alive.current = true; enabled.value = true;
		return () => {
			alive.current = false; enabled.value = false;
			clearTimeout(settleTimer.current);
			translation.value = 0;
		};
	}, [enabled, translation]);
	const settleInset = useCallback(inset => {
		if (!alive.current) return;
		clearTimeout(settleTimer.current);
		// This is ONLY the inverted list's oldest-message scroll allowance, not
		// the composer position. Coalesce IME panel changes that report OPEN for
		// several frames; they must not re-layout a long list every frame.
		if (inset === 0) onInsetChange?.(0);
		else settleTimer.current = setTimeout(() => { if (alive.current) onInsetChange?.(inset); }, 60);
	}, [onInsetChange]);
	const restingExtra = Math.max(0, bottomInset - 10);
	const initialHeight = Math.max(0, snapshot.height) + (EDGE_TO_EDGE ? bottomInset : 0);
	useAnimatedReaction(
		() => ({ state: keyboard.state.value, height: keyboard.height.value }),
		({ state, height: nativeHeight }) => {
			if (!enabled.value) return;
			if (subscriptionHeight.value === -2) subscriptionHeight.value = lastOpenHeight.value;
			if (state === KeyboardState.OPENING || state === KeyboardState.CLOSING || state === KeyboardState.CLOSED) observedFreshState.value = true;
			let height = nativeHeight;
			// Only suppress an exact replay of the previous subscription's OPEN
			// height. A first OPEN (including disabled/coalesced animation), an
			// observed CLOSED -> OPEN, or a changed height is fresh native input
			// and MUST move immediately even while JS didShow is still queued.
			const staleReplay = state === KeyboardState.OPEN && subscriptionHeight.value >= 0 && nativeHeight === subscriptionHeight.value && !snapshot.visible && !observedFreshState.value;
			if (state === KeyboardState.CLOSED || staleReplay) height = 0;
			else if (state === KeyboardState.UNKNOWN) height = snapshot.visible ? initialHeight : 0;
			else if (state === KeyboardState.OPEN) observedFreshState.value = true;
			if (state === KeyboardState.OPEN) lastOpenHeight.value = nativeHeight;
			else if (state === KeyboardState.CLOSED) lastOpenHeight.value = -1;
			// Composer already reserves its navigation safe area and 10px gutter.
			const inset = Math.max(0, height - restingExtra);
			translation.value = -inset;
			if (state !== KeyboardState.OPENING && state !== KeyboardState.CLOSING && inset !== lastSettledInset.value) {
				lastSettledInset.value = inset;
				runOnJS(settleInset)(inset);
			}
		}, [snapshot.visible, initialHeight, restingExtra, settleInset],
	);
	return null;
});

export default function AssistantKeyboardSpacer({ active, bottomInset = 0, onInsetChange, children }) {
	const translation = useSharedValue(0);
	const lastOpenHeight = useSharedValue(-1);
	const style = useAnimatedStyle(() => ({ transform: [{ translateY: translation.value }] }));
	useEffect(() => {
		if (!active) { translation.value = 0; onInsetChange?.(0); }
	}, [active, onInsetChange, translation]);
	// Transform only the message viewport and composer. Animating height made
	// Fabric/Yoga re-layout the whole long conversation on every keyboard frame.
	// Toolbar stays outside this clipped view; children never remount on blur.
	return <View testID="assistant-keyboard-viewport" style={styles.viewport}>
		<Animated.View testID="assistant-keyboard-body" style={[styles.body, style]}>{children}</Animated.View>
		{active && <KeyboardObserver bottomInset={bottomInset} translation={translation} lastOpenHeight={lastOpenHeight} onInsetChange={onInsetChange} />}
	</View>;
}

const styles = StyleSheet.create({ viewport: { flex: 1, overflow: "hidden" }, body: { flex: 1 } });
