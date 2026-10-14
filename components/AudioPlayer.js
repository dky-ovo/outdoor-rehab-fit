import React, { useEffect, useRef, useState } from "react";
import { AppState, View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Slider from "@react-native-community/slider";
import { MaterialIcons } from "@expo/vector-icons";
import { ensurePlaybackAudioMode } from "../utils/audioMode";
import { claimFacilityAudio } from "../utils/facilityAudioCoordination";

const AudioPlayer = ({ audioFile, onPlayStart, onPlaybackSample }) => {
	const player = useAudioPlayer(audioFile);
	const status = useAudioPlayerStatus(player);
	const focused = useIsFocused();
	const wasPlaying = useRef(false);
	const seeking = useRef(false);
	const claimRef = useRef(null);
	const lifecycle = useRef({ mounted: true, focused });
	lifecycle.current.focused = focused;
	const sourceRef = useRef(audioFile);
	sourceRef.current = audioFile;
	const statusSourceRef = useRef(audioFile);
	const sampleRef = useRef(onPlaybackSample);
	sampleRef.current = onPlaybackSample;
	const pausedByRequest = useRef(false);
	const [interrupted, setInterrupted] = useState(false);
	// Expo releases a replaced/unmounted shared player before our effect cleanup.
	const pausePlayer = () => { try { player.pause(); } catch { /* Already released. */ } };

	const isPlaying = status.playing && !interrupted;
	useEffect(() => {
		if (status.didJustFinish && !status.playing) claimRef.current?.release();
		if (statusSourceRef.current !== audioFile || !focused || AppState.currentState === "background" || AppState.currentState === "inactive" || seeking.current || pausedByRequest.current) { wasPlaying.current = false; onPlaybackSample?.("inactive"); return; }
		const state = status.playing && !status.isBuffering ? (wasPlaying.current ? "progress" : "playing") : status.didJustFinish ? "ended" : "paused";
		onPlaybackSample?.(state, { positionMs: status.currentTime * 1000, durationMs: status.duration * 1000 });
		wasPlaying.current = Boolean(status.playing && !status.isBuffering);
	}, [audioFile, status.currentTime, status.duration, status.playing, status.isBuffering, status.didJustFinish, focused, onPlaybackSample]);
	useEffect(() => {
		lifecycle.current.mounted = true;
		statusSourceRef.current = audioFile;
		const sample = sampleRef.current;
		const pause = () => {
			try { void claimRef.current?.cancel(); } catch { /* The native player may already have been released. */ }
			pausedByRequest.current = true;
			wasPlaying.current = false; sample?.("inactive");
			pausePlayer();
		};
		if (!focused) pause();
		const listener = AppState.addEventListener("change", (state) => { if (state !== "active") pause(); });
		const visibility = () => { if (document.hidden) pause(); };
		if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
		return () => {
			lifecycle.current.mounted = false;
			listener.remove();
			if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
			pause();
		};
	}, [focused, player, audioFile]);

	async function playSound() {
		if (!lifecycle.current.mounted || !lifecycle.current.focused || sourceRef.current !== audioFile || AppState.currentState === "background" || AppState.currentState === "inactive" || (typeof document !== "undefined" && document.hidden)) return;
		// The second tap also cancels while prepare/play is ahead of the native status event.
		if (claimRef.current?.isCurrent()) {
			void claimRef.current.cancel();
			return;
		}
		let claim;
		try {
			claim = claimFacilityAudio("guidance", () => {
				pausedByRequest.current = true;
				wasPlaying.current = false;
				onPlaybackSample?.("inactive");
				if (lifecycle.current.mounted) setInterrupted(true);
				pausePlayer(); // Keep currentTime so Play resumes from this position.
			});
			claim.pending = true;
			claimRef.current = claim;
			const valid = () => claim.isCurrent() && lifecycle.current.mounted && lifecycle.current.focused && sourceRef.current === audioFile && AppState.currentState !== "background" && AppState.currentState !== "inactive" && !(typeof document !== "undefined" && document.hidden);
			await claim.ready;
			if (!valid()) return;
			await ensurePlaybackAudioMode();
			if (!valid()) return;
			if (player) {
				player.volume = 1;
			}
			// Replay from start if the audio has finished
			if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.25)) {
				await player.seekTo(0);
				if (!valid()) return;
			}
			claim.pending = false;
			pausedByRequest.current = false;
			setInterrupted(false);
			player.play();
			if (onPlayStart) onPlayStart();
		} catch (error) {
			try { void claim?.cancel(); } catch { /* Keep a native teardown error from restarting this request. */ }
			console.warn("Audio play failed", error);
		}
	}

	function pauseSound() {
		void claimRef.current?.cancel();
		pausedByRequest.current = true;
		wasPlaying.current = false; onPlaybackSample?.("inactive");
		pausePlayer();
	}

	function stopSound() {
		void claimRef.current?.cancel();
		pausedByRequest.current = true;
		wasPlaying.current = false; onPlaybackSample?.("seeking");
		pausePlayer();
		player.seekTo(0);
	}

	const seekSound = async (value) => {
		wasPlaying.current = false; onPlaybackSample?.("seeking");
		try { await player.seekTo(value); } finally { seeking.current = false; }
	};

	const formatTime = (seconds) => {
		if (!seconds || seconds < 0) seconds = 0;
		const minutes = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${minutes}:${secs < 10 ? "0" : ""}${secs}`;
	};

	if (!audioFile) {
		return (
			<View style={styles.container}>
				<Text style={styles.missingText}>Audio not available</Text>
			</View>
		);
	}

	return (
		<View style={styles.container}>
			<View style={styles.buttonContainer}>
				<TouchableOpacity style={styles.button} onPress={isPlaying ? pauseSound : playSound}>
					<MaterialIcons name={isPlaying ? "pause-circle-filled" : "play-circle-filled"} size={50} color="#1E90FF" />
				</TouchableOpacity>
				<TouchableOpacity style={styles.button} onPress={stopSound}>
					<MaterialIcons name="stop-circle" size={50} color="#1E90FF" />
				</TouchableOpacity>
			</View>
			<Slider
				style={styles.slider}
				minimumValue={0}
				maximumValue={status.duration || 0}
				value={status.currentTime || 0}
				onSlidingStart={() => { seeking.current = true; wasPlaying.current = false; onPlaybackSample?.("seeking"); }}
				onSlidingComplete={seekSound}
			/>
			<View style={styles.timeContainer}>
				<Text style={styles.timeText}>{formatTime(status.currentTime)}</Text>
				<Text style={styles.timeText}>{formatTime(status.duration)}</Text>
			</View>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		padding: 20,
	},
	buttonContainer: {
		flexDirection: "row",
		justifyContent: "space-around",
		marginBottom: 20,
	},
	button: {},
	buttonText: {
		color: "#fff",
		fontSize: 16,
	},
	slider: {
		width: "100%",
		height: 40,
	},
	timeContainer: {
		flexDirection: "row",
		justifyContent: "space-between",
		marginTop: 10,
	},
	timeText: {
		fontSize: 16,
		color: "#000",
	},
	missingText: {
		fontSize: 14,
		color: "#999",
		textAlign: "center",
	},
});

export default AudioPlayer;
