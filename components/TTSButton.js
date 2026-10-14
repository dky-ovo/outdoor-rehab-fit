// App Upgrade #11: Text to Speech — Chinese content is read in Cantonese (粵語)
import React, { useEffect, useRef, useState } from "react";
import { Animated, AppState, PanResponder, Platform, StyleSheet, TouchableOpacity, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { speechChunks } from "../utils/ttsLearning";
import * as Speech from "expo-speech";
import { Ionicons } from "@expo/vector-icons";
import { RFValue } from "react-native-responsive-fontsize";
import { trackTtsPlay } from "../utils/usage";
import { ensurePlaybackAudioMode } from "../utils/audioMode";
import { showAlert } from "../utils/alert";
import { claimFacilityAudio } from "../utils/facilityAudioCoordination";

const BALL_SIZE = 60;
const EDGE_GAP = 14;

/** iOS / Android Cantonese voice name hints */
const CANTONESE_NAME_HINTS = [
	"sinji", // iOS 粵語女聲
	"meijia", // iOS 粵語女聲
	"cantonese",
	"yue",
	"hong kong",
	"hongkong",
	"粵",
	"广东",
	"廣東",
];

function isCantoneseVoice(voice) {
	const lang = (voice.language || "").toLowerCase();
	const name = `${voice.name || ""} ${voice.identifier || ""}`.toLowerCase();

	if (lang === "yue-hk" || lang === "zh-hk" || lang.startsWith("yue")) {
		return true;
	}
	// zh-HK is usually Cantonese on Apple devices
	if (lang.includes("hk") && lang.startsWith("zh")) {
		return true;
	}
	return CANTONESE_NAME_HINTS.some((hint) => name.includes(hint));
}

async function resolveSpeechOptions(locale) {
	// English UI → English TTS; Chinese UI → always prefer Cantonese
	if (locale !== "zh") {
		return resolveEnglishOptions();
	}

	try {
		const voices = (await Speech.getAvailableVoicesAsync()) || [];

		// 1) Explicit Cantonese voices first
		const cantonese = voices.find(isCantoneseVoice);
		if (cantonese) {
			return { language: cantonese.language || "zh-HK", voice: cantonese.identifier };
		}

		// 2) Language-code preference order for 粵語
		for (const lang of ["yue-HK", "yue", "zh-HK"]) {
			const match = voices.find((v) => (v.language || "").toLowerCase() === lang.toLowerCase());
			if (match) {
				return { language: match.language, voice: match.identifier };
			}
		}

		// 3) Any Hong Kong tagged voice
		const hk = voices.find((v) => /hk/i.test(v.language || "") || /hk/i.test(v.identifier || ""));
		if (hk) {
			return { language: hk.language, voice: hk.identifier };
		}
	} catch (e) {
		console.warn("getAvailableVoicesAsync failed", e);
	}

	// Force Cantonese locale even if no voice list is returned
	return { language: "zh-HK" };
}

async function resolveEnglishOptions() {
	const preferred = ["en-US", "en-GB", "en-AU", "en"];
	try {
		const voices = (await Speech.getAvailableVoicesAsync()) || [];
		for (const lang of preferred) {
			const match = voices.find((v) => (v.language || "").toLowerCase().startsWith(lang.toLowerCase()));
			if (match) {
				return { language: match.language, voice: match.identifier };
			}
		}
	} catch (e) {
		// ignore
	}
	return { language: "en-US" };
}

const TTSButton = ({ text, locale, i18n, onPlay, onSpokenRange, inline = false }) => {
	const focused = useIsFocused();
	const runRef = useRef(null);
	const mounted = useRef(true);
	const currentInput = useRef({ text, locale, focused });
	currentInput.current = { text, locale, focused };
	const [speaking, setSpeaking] = useState(false);
	const { width, height } = useWindowDimensions();
	const position = useRef(new Animated.ValueXY({ x: EDGE_GAP, y: EDGE_GAP })).current;
	const currentPosition = useRef({ x: EDGE_GAP, y: EDGE_GAP });
	const positioned = useRef(false);

	useEffect(() => {
		mounted.current = true;
		setSpeaking(false);
		const stop = () => {
			const run = runRef.current;
			if (run) run.active = false;
			void run?.claim?.cancel().catch(() => {});
			setSpeaking(false);
		};
		if (!focused) stop();
		const subscription = AppState.addEventListener("change", (state) => { if (state !== "active") stop(); });
		const visibility = () => { if (document.hidden) stop(); };
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
		return () => {
			mounted.current = false;
			subscription.remove();
			if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
			const run = runRef.current;
			if (run) run.active = false;
			void run?.claim?.cancel().catch(() => {});
		};
	}, [focused, text, locale]);

	useEffect(() => {
		const maxX = Math.max(EDGE_GAP, width - BALL_SIZE - EDGE_GAP);
		const maxY = Math.max(EDGE_GAP, height - BALL_SIZE - 120);
		const next = positioned.current
			? { x: Math.min(currentPosition.current.x, maxX), y: Math.min(currentPosition.current.y, maxY) }
			: { x: maxX, y: 96 };
		positioned.current = true;
		currentPosition.current = next;
		position.setValue(next);
	}, [height, position, width]);

	const startOrStopSpeech = async () => {
		// A confirmation callback can outlive its screen or the displayed passage.
		if (!mounted.current || !currentInput.current.focused || currentInput.current.text !== text || currentInput.current.locale !== locale || AppState.currentState === "background" || AppState.currentState === "inactive" || (typeof document !== "undefined" && document.hidden)) return;
		if (runRef.current?.claim?.isCurrent()) {
			const run = runRef.current;
			run.active = false;
			await run.claim.cancel().catch(() => {});
			if (mounted.current && runRef.current === run) setSpeaking(false);
			return;
		}
		const content = (text || "").trim();
		if (!content || !focused) return;
		const run = { active: true, claim: null };
		runRef.current = run;
		const valid = () => run.active && run.claim?.isCurrent() && mounted.current && AppState.currentState !== "background" && AppState.currentState !== "inactive" && !(typeof document !== "undefined" && document.hidden);
		const finish = () => { if (!run.active || !run.claim?.isCurrent()) return; run.active = false; run.claim.release(); if (mounted.current) setSpeaking(false); };
		try {
			run.claim = claimFacilityAudio("speech", () => { run.active = false; if (mounted.current) setSpeaking(false); });
			await run.claim.ready;
			if (!valid()) return;
			await ensurePlaybackAudioMode();
			if (!valid()) return;
			setSpeaking(true);
			const options = await resolveSpeechOptions(locale);
			if (!valid()) return;
			const chunks = speechChunks(content);
			let started = false;
			const speakChunk = (index) => {
				if (!valid()) return;
				const chunk = chunks[index];
				Speech.speak(chunk.text, {
					...options,
					rate: Platform.OS === "ios" ? 0.72 : 0.76,
					pitch: 1.0,
					onStart: () => { if (!valid()) return; setSpeaking(true); if (!started) { started = true; trackTtsPlay(); onPlay?.(); } },
					onBoundary: (event) => {
						// The boundary word is ABOUT TO be spoken, so credit only the preceding text.
						if (valid() && started && Number.isFinite(event?.charIndex) && event.charIndex > 0) onSpokenRange?.(chunk.start, Math.min(chunk.end, chunk.start + event.charIndex));
					},
					onDone: () => {
						if (!valid() || !started) return;
						onSpokenRange?.(chunk.start, chunk.end);
						if (index + 1 < chunks.length) speakChunk(index + 1); else finish();
					},
					onStopped: finish,
					onError: (error) => { console.warn("Speech error", error); finish(); },
				});
			};
			speakChunk(0);
		} catch (error) {
			console.warn("TTS failed", error);
			finish();
		}
	};

	const handlePress = () => {
		if (runRef.current?.claim?.isCurrent()) {
			startOrStopSpeech();
			return;
		}
		const content = (text || "").trim();
		if (!content) return;
		showAlert(i18n.t("readConfirmTitle"), i18n.t("readConfirmMessage"), [
			{ text: i18n.t("cancel"), style: "cancel" },
			{ text: i18n.t("confirm"), onPress: startOrStopSpeech },
		]);
	};

	const accessibilityLabel = speaking ? i18n.t("stopReading") : i18n.t("readAloud");
	if (inline) {
		return (
			<TouchableOpacity
				accessible
				accessibilityRole="button"
				accessibilityLabel={accessibilityLabel}
				activeOpacity={0.75}
				onPress={startOrStopSpeech}
				style={[styles.inlineButton, speaking && styles.buttonActive]}
			>
				<Ionicons name={speaking ? "stop" : "volume-high"} size={RFValue(21)} color="#fff" />
			</TouchableOpacity>
		);
	}

	const panResponder = PanResponder.create({
		onStartShouldSetPanResponder: () => true,
		onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
		onPanResponderGrant: () => {
			position.stopAnimation((value) => {
				currentPosition.current = value;
			});
		},
		onPanResponderMove: (_, gesture) => {
			const maxX = Math.max(EDGE_GAP, width - BALL_SIZE - EDGE_GAP);
			const maxY = Math.max(EDGE_GAP, height - BALL_SIZE - 120);
			position.setValue({
				x: Math.max(EDGE_GAP, Math.min(maxX, currentPosition.current.x + gesture.dx)),
				y: Math.max(EDGE_GAP, Math.min(maxY, currentPosition.current.y + gesture.dy)),
			});
		},
		onPanResponderRelease: (_, gesture) => {
			position.stopAnimation((value) => {
				currentPosition.current = value;
			});
			if (Math.abs(gesture.dx) < 5 && Math.abs(gesture.dy) < 5) handlePress();
		},
		onPanResponderTerminate: () => {
			position.stopAnimation((value) => {
				currentPosition.current = value;
			});
		},
	});

	return (
		<Animated.View
			{...panResponder.panHandlers}
			accessible
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel}
			onAccessibilityTap={handlePress}
			style={[styles.button, speaking && styles.buttonActive, { transform: position.getTranslateTransform() }]}
		>
			<Ionicons name={speaking ? "stop" : "volume-high"} size={RFValue(27)} color="#fff" />
		</Animated.View>
	);
};

const styles = StyleSheet.create({
	button: {
		position: "absolute",
		top: 0,
		left: 0,
		width: BALL_SIZE,
		height: BALL_SIZE,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#2E8B57",
		borderRadius: BALL_SIZE / 2,
		borderWidth: 3,
		borderColor: "#fff",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 3 },
		shadowOpacity: 0.3,
		shadowRadius: 6,
		elevation: 10,
		zIndex: 1000,
	},
	buttonActive: {
		backgroundColor: "#B00020",
	},
	inlineButton: {
		width: 46,
		height: 46,
		borderRadius: 23,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#2E8B57",
		borderWidth: 2,
		borderColor: "#fff",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.2,
		shadowRadius: 3,
		elevation: 4,
	},
});

export default TTSButton;
