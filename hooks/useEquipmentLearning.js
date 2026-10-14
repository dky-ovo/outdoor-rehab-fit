import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { AppState, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { getCurrentOwnerKey } from "../utils/userStorage";
import { learningContentKey, learningVideoKey, learningVideoMetadata, recordLearningCoverage } from "../utils/learning";
import { createPlaybackCoverage, createReadingCoverage, learningTextSections, visibleLearningRange } from "../utils/learningCoverage";

export const LearningReadContext = createContext(null);

export function LearningReadContent({ section, children }) {
	const learning = useContext(LearningReadContext);
	const ref = useRef(null);
	useEffect(() => {
		if (!learning) return;
		const entry = { ref, sample: createReadingCoverage((start, end) => learning.text("read", section, start, end, true)) };
		learning.readers.add(entry);
		return () => { learning.readers.delete(entry); };
	}, [learning, section]);
	return <View ref={ref} testID={`learning-read-${section}`} collapsable={false}>{children}</View>;
}

export default function useEquipmentLearning({ item, locale, enabled, blocked, identity, bottomOcclusion = 0 }) {
	const focused = useIsFocused();
	const owner = getCurrentOwnerKey();
	const sections = learningTextSections(item);
	const signature = JSON.stringify([item.id, locale, sections, item.videoIdentityUrl || item.videoUrl || item.youtubeKey, item.videoIdentityDurationSeconds, owner, identity]);
	const session = useMemo(() => {
		const parts = sections.map(({ key, total }) => ({ key, total }));
		const textKey = `${locale}:text:${learningContentKey(JSON.stringify(sections))}`;
		const value = { active: true, allowed: false, readers: new Set(), viewport: { current: null } };
		const save = (field, groupKey, manifest, partKey, start, end) => {
			if (!value.active || !value.allowed) return;
			void recordLearningCoverage({ equipmentId: item.id, owner, field, groupKey, parts: manifest, partKey, start, end }).catch(() => {});
		};
		value.text = (field, partKey, start, end, fraction = false) => {
			const part = parts.find((entry) => entry.key === partKey);
			if (part) save(field, textKey, parts, partKey, fraction ? start * part.total : start, fraction ? end * part.total : end);
		};
		const playback = (field, key) => createPlaybackCoverage((start, end, total) => save(field, `${locale}:${key}:${total}`, [{ key: "media", total }], "media", start, end));
		const video = playback("watched", learningVideoKey(item));
		const audio = playback("listened", `audio:${item.id}`);
		value.video = (state, metadata) => { if (!value.active || !value.allowed) { video("inactive"); return; } video(state, learningVideoMetadata(item, metadata)); };
		value.audio = (state, metadata) => { if (!value.active || !value.allowed) { audio("inactive"); return; } audio(state, metadata); };
		value.reset = () => { video("inactive"); audio("inactive"); value.readers.forEach((reader) => reader.sample(null)); };
		return value;
	// Signature captures immutable content/owner for delayed callbacks.
	}, [signature]);
	session.allowed = Boolean(enabled && focused && !blocked && AppState.currentState !== "background" && AppState.currentState !== "inactive");
	session.bottomOcclusion = Math.max(0, Number(bottomOcclusion) || 0);
	useEffect(() => {
		session.active = true;
		const stateChange = (state) => { session.allowed = Boolean(enabled && focused && !blocked && state === "active"); if (!session.allowed) session.reset(); };
		const subscription = AppState.addEventListener("change", stateChange);
		const visible = () => { if (typeof document !== "undefined" && document.hidden) { session.allowed = false; session.reset(); } else stateChange(AppState.currentState || "active"); };
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
		if (!session.allowed) session.reset();
		const timer = setInterval(() => {
			if (!session.active || !session.allowed || (typeof document !== "undefined" && document.hidden)) { session.reset(); return; }
			session.viewport.current?.measureInWindow?.((x, y, width, height) => {
				if (!session.active || !session.allowed) return;
				const viewport = { x, y, width, height: Math.max(0, height - session.bottomOcclusion) };
				for (const reader of session.readers) reader.ref.current?.measureInWindow?.((cx, cy, cw, ch) => {
					if (session.active && session.allowed && session.readers.has(reader)) reader.sample(visibleLearningRange({ x: cx, y: cy, width: cw, height: ch }, viewport));
				});
			});
		}, 1000);
		return () => { session.active = false; session.reset(); clearInterval(timer); subscription.remove(); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible); };
	}, [session, enabled, focused, blocked]);
	return session;
}
