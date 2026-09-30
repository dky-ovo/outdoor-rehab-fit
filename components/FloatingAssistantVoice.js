import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { assistantVoiceCopy } from "../constants/AssistantVoice";
import { clampVoiceDrag, floatingVoiceBounds, getFloatingTimerObstacle, snapVoicePosition, subscribeFloatingTimerObstacle, VOICE_BALL_SIZE } from "../utils/floatingVoiceLayout";

export default function FloatingAssistantVoice({ locale, locked, onPress }) {
  const window = useWindowDimensions(); const insets = useSafeAreaInsets();
  const copy = assistantVoiceCopy(locale); const layer = useRef(null);
  const [frame, setFrame] = useState(null);
  const fallbackHeight = Platform.OS === "ios" ? window.height : window.height - 78 - Math.max(Number(insets.bottom) || 0, 24);
  const scene = frame || { x: 0, y: 0, width: window.width, height: fallbackHeight };
  const bounds = floatingVoiceBounds({ width: scene.width, height: scene.height,
    top: Math.max(8, (Number(insets.top) || 0) - scene.y + 8), bottom: Platform.OS === "ios" ? 78 + (Number(insets.bottom) || 0) + 12 : 12,
    left: Math.max(8, (Number(insets.left) || 0) - scene.x + 8), right: Math.max(8, (Number(insets.right) || 0) + 8) });
  const timer = useSyncExternalStore(subscribeFloatingTimerObstacle, getFloatingTimerObstacle, getFloatingTimerObstacle);
  const obstacle = timer ? { ...timer, x: timer.x - scene.x, y: timer.y - scene.y } : null;
  const layout = useRef({ bounds, obstacle }); layout.current = { bounds, obstacle };
  const pan = useRef(new Animated.ValueXY()).current;
  const position = useRef(null), side = useRef("right"), anchor = useRef(null);
  const moved = useRef(false), dragging = useRef(false), interrupted = useRef(false), suppressUntil = useRef(0), activatedAt = useRef(-Infinity);
  const onPressRef = useRef(onPress); onPressRef.current = onPress;
  const commit = (point, animate = false) => {
    const next = snapVoicePosition(point, layout.current.bounds, layout.current.obstacle);
    position.current = next; side.current = next.x === layout.current.bounds.minX ? "left" : "right";
    pan.flattenOffset();
    if (animate) Animated.spring(pan, { toValue: next, useNativeDriver: false, friction: 8, tension: 80 }).start();
    else { pan.stopAnimation(); pan.setValue(next); }
  };
  const activate = () => {
    const now = Date.now();
    if (now < suppressUntil.current || now - activatedAt.current < 350) return;
    activatedAt.current = now; onPressRef.current?.();
  };
  useEffect(() => {
    if (dragging.current) interrupted.current = true;
    const desired = { x: side.current === "left" ? bounds.minX : bounds.maxX, y: position.current?.y ?? bounds.maxY };
    commit(desired);
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, obstacle?.x, obstacle?.y, obstacle?.width, obstacle?.height]);
  const measure = (event) => {
    const measured = event?.nativeEvent?.layout;
    if (!measured || measured.width <= 0 || measured.height <= 0) return;
    const save = (x = 0, y = 0) => setFrame(current => {
      const next = { x, y, width: measured.width, height: measured.height };
      return current && Object.keys(next).every(key => current[key] === next[key]) ? current : next;
    });
    save(frame?.x || 0, frame?.y || 0);
    layer.current?.measureInWindow?.((x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) save(x, y); });
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      dragging.current = true; interrupted.current = false; moved.current = false;
      anchor.current = position.current || { x: layout.current.bounds.maxX, y: layout.current.bounds.maxY };
      pan.stopAnimation(); pan.setOffset(anchor.current); pan.setValue({ x: 0, y: 0 });
    },
    onPanResponderMove: (_event, gesture) => {
      if (interrupted.current) return;
      if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) moved.current = true;
      const current = clampVoiceDrag({ x: anchor.current.x + gesture.dx, y: anchor.current.y + gesture.dy }, layout.current.bounds);
      pan.setValue({ x: current.x - anchor.current.x, y: current.y - anchor.current.y });
    },
    onPanResponderRelease: (_event, gesture) => {
      const didDrag = moved.current || interrupted.current || Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6;
      const next = interrupted.current ? position.current : { x: anchor.current.x + gesture.dx, y: anchor.current.y + gesture.dy };
      dragging.current = false; commit(next, true);
      if (didDrag) suppressUntil.current = Date.now() + 350;
      else activate();
    },
    onPanResponderTerminate: () => {
      dragging.current = false; suppressUntil.current = Date.now() + 350; commit(position.current);
    },
  }), [pan]);
  return <View ref={layer} testID="home-voice-floating-layer" pointerEvents="box-none" onLayout={measure} style={styles.layer}>
    <Animated.View testID="home-voice-floating-position" {...responder.panHandlers} style={[styles.position, { transform: pan.getTranslateTransform() }]}>
      <TouchableOpacity testID="home-voice-assistant" accessibilityRole="button" accessibilityLabel={copy.openLabel} accessibilityHint={copy.dragHint}
        onPress={activate} style={styles.ball}>
        <Ionicons name="mic" size={28} color="#fff" />
        <Text style={styles.label} maxFontSizeMultiplier={1.15}>{copy.open}</Text>
        {locked && <View style={styles.lock}><Ionicons name="lock-closed" size={13} color="#840B1C" /></View>}
      </TouchableOpacity>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 650, elevation: 15 },
  position: { position: "absolute", left: 0, top: 0, width: VOICE_BALL_SIZE, height: VOICE_BALL_SIZE },
  ball: { width: VOICE_BALL_SIZE, height: VOICE_BALL_SIZE, borderRadius: 38, paddingVertical: 10, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "#840B1C", borderWidth: 2, borderColor: "#fff", elevation: 7, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 5 },
  label: { color: "#fff", fontSize: 14, fontWeight: "700", textAlign: "center" },
  lock: { position: "absolute", top: -2, right: -2, backgroundColor: "#F7E9EC", width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
