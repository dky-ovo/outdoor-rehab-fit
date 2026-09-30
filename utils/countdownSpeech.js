import { createAudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { ensurePlaybackAudioMode } from "./audioMode";
import { COUNTDOWN_SPEECH_ASSETS } from "./countdownAudioAssets";
import { isCountdownCueFresh } from "./countdownCueTiming";

export { COUNTDOWN_CUE_MAX_LATENESS_MS, isCountdownCueFresh } from "./countdownCueTiming";

const PLAYER_POLL_MS = 100;
const PLAYER_MAX_LIFETIME_MS = 15_000;

/** One provider-owned recording at a time; never use a device's default language. */
export function createCountdownSpeaker() {
	let generation = 0;
	let ownedPlayback = null;

	return {
		cancel() {
			generation += 1;
			ownedPlayback?.release();
		},
		async speak(phase, locale, isCurrent, cueAt = Date.now()) {
			const request = ++generation;
			ownedPlayback?.release();
			const current = () => request === generation && isCurrent();
			const fresh = () => current() && isCountdownCueFresh(cueAt);
			const source = COUNTDOWN_SPEECH_ASSETS[locale === "en" ? "en" : "zh"]?.[phase];
			if (source == null || !fresh()) return "cancelled";
			let playback;
			try {
				await ensurePlaybackAudioMode();
				if (!fresh()) return "cancelled";
				// Bundled recordings are identical to the native background service's
				// resources. Loading must finish BEFORE play(), otherwise the native
				// player could automatically begin an overdue cue after suspension.
				const player = createAudioPlayer(source, { updateInterval: PLAYER_POLL_MS, downloadFirst: false });
				let subscription;
				let poll;
				let lifetime;
				let settleLoaded;
				let released = false;
				let playRequested = false;
				let observedPlaying = false;
				const loaded = new Promise((resolve) => { settleLoaded = resolve; });
				playback = {
					release() {
						if (released) return;
						released = true;
						if (ownedPlayback === playback) ownedPlayback = null;
						clearInterval(poll);
						clearTimeout(lifetime);
						settleLoaded(false);
						try { subscription?.remove(); } catch { /* Already detached. */ }
						try { player.pause(); } catch { /* A failed player still needs removal. */ }
						try { player.remove(); } catch { /* Native player already released. */ }
					},
				};
				ownedPlayback = playback;
				const checkStatus = (status) => {
					if (released) return;
					try {
						// The provider's validity callback also includes the two-second
						// start deadline. Do not apply it to an already-speaking sentence;
						// explicit cancel/generation changes still stop that sentence.
						if (request !== generation || (!observedPlaying && !fresh())) {
							playback.release();
							return;
						}
						if (status?.didJustFinish || status?.playbackState === "error") {
							playback.release();
							return;
						}
						if (playRequested && status?.playing && !status?.isBuffering) observedPlaying = true;
						// Web's currentStatus reports isLoaded too early; use the actual
						// player property, which is updated after loadeddata instead.
						if (player.isLoaded && !player.isBuffering) settleLoaded(true);
					} catch {
						playback.release();
					}
				};
				// Polling also observes Web's ended state, whose media callback does
				// not always emit a final playbackStatusUpdate in this SDK.
				poll = setInterval(() => {
					try { checkStatus(player.currentStatus); } catch { playback.release(); }
				}, PLAYER_POLL_MS);
				lifetime = setTimeout(() => playback.release(), PLAYER_MAX_LIFETIME_MS);
				subscription = player.addListener("playbackStatusUpdate", checkStatus);
				if (released) {
					try { subscription?.remove(); } catch { /* Synchronous failed load. */ }
				}
				checkStatus(player.currentStatus);
				if (!(await loaded) || released || !fresh()) {
					playback.release();
					return "cancelled";
				}
				// Stop any section TTS reading, but the timer plays its own recording.
				// cancel() touches only this player, never an unrelated new reading.
				await Speech.stop();
				if (released || !fresh()) {
					playback.release();
					return "cancelled";
				}
				playRequested = true;
				player.play();
				checkStatus(player.currentStatus);
				return released ? "cancelled" : "spoken";
			} catch {
				playback?.release();
				// A missing asset or failed player must never block a session summary.
				return fresh() ? "failed" : "cancelled";
			}
		},
	};
}
