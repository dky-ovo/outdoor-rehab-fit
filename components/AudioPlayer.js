import React, { useEffect, useRef } from "react";
import { AppState, View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Slider from "@react-native-community/slider";
import { MaterialIcons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { ensurePlaybackAudioMode } from "../utils/audioMode";

const AudioPlayer = ({ audioFile, onPlayStart, onPlaybackSample }) => {
	const player = useAudioPlayer(audioFile);
	const status = useAudioPlayerStatus(player);
	const focused = useIsFocused();
	const wasPlaying = useRef(false);
	const seeking = useRef(false);

	const isPlaying = status.playing;
	useEffect(() => {
		if (!focused || AppState.currentState === "background" || AppState.currentState === "inactive" || seeking.current) { wasPlaying.current = false; onPlaybackSample?.("inactive"); return; }
		const state = status.playing && !status.isBuffering ? (wasPlaying.current ? "progress" : "playing") : status.didJustFinish ? "ended" : "paused";
		onPlaybackSample?.(state, { positionMs: status.currentTime * 1000, durationMs: status.duration * 1000 });
		wasPlaying.current = Boolean(status.playing && !status.isBuffering);
	}, [status.currentTime, status.duration, status.playing, status.isBuffering, status.didJustFinish, focused, onPlaybackSample]);
	useEffect(() => {
		const pause = () => { wasPlaying.current = false; onPlaybackSample?.("inactive"); player.pause(); };
		if (!focused) pause();
		const listener = AppState.addEventListener("change", (state) => { if (state !== "active") pause(); });
		return () => { listener.remove(); wasPlaying.current = false; onPlaybackSample?.("inactive"); };
	}, [focused, player, onPlaybackSample]);

	useEffect(() => {
		ensurePlaybackAudioMode();
		if (player) {
			player.volume = 1;
		}
	}, [player]);

	async function playSound() {
		try {
			await Speech.stop();
			await ensurePlaybackAudioMode();
			if (onPlayStart) onPlayStart();
			if (player) {
				player.volume = 1;
			}
			// Replay from start if the audio has finished
			if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.25)) {
				await player.seekTo(0);
			}
			player.play();
		} catch (error) {
			console.warn("Audio play failed", error);
		}
	}

	function pauseSound() {
		player.pause();
	}

	function stopSound() {
		wasPlaying.current = false; onPlaybackSample?.("seeking");
		player.pause();
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
