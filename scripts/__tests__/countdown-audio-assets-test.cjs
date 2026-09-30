"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");
const { CUES, synthesizeCue } = require("../generate-countdown-chimes.cjs");

const AUDIO_DIRECTORY = path.resolve(__dirname, "../../assets/sounds/notifications");

function readWave(filename) {
	const buffer = fs.readFileSync(path.join(AUDIO_DIRECTORY, filename));
	assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
	assert.equal(buffer.readUInt32LE(4), buffer.length - 8);
	assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
	let format;
	let audio;
	for (let offset = 12; offset < buffer.length;) {
		assert.ok(offset + 8 <= buffer.length, "complete chunk header");
		const id = buffer.toString("ascii", offset, offset + 4);
		const length = buffer.readUInt32LE(offset + 4);
		const start = offset + 8;
		assert.ok(start + length <= buffer.length, "complete chunk data");
		if (id === "fmt ") {
			assert.ok(length >= 16);
			format = {
				encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2),
				sampleRate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8),
				blockAlign: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14),
			};
		}
		if (id === "data") audio = buffer.subarray(start, start + length);
		offset = start + length + length % 2;
	}
	assert.deepEqual(format, { encoding: 1, channels: 1, sampleRate: 24000, byteRate: 48000, blockAlign: 2, bits: 16 });
	assert.ok(audio && audio.length > 0);
	assert.equal(audio.length % format.blockAlign, 0);
	const samples = Array.from({ length: audio.length / 2 }, (_, index) => audio.readInt16LE(index * 2) / 32768);
	return { buffer, duration: audio.length / format.byteRate, samples };
}

for (const filename of ["countdown_en_halfway.wav", "countdown_en_complete.wav", "countdown_yue_halfway.wav", "countdown_yue_complete.wav", "countdown_chime_halfway.wav", "countdown_chime_complete.wav"]) {
	test(`${filename}: valid short nonempty PCM asset`, () => {
		const { duration, samples } = readWave(filename);
		assert.ok(duration > 0 && duration < 5, "cue is shorter than five seconds");
		assert.ok(samples.some((sample) => Math.abs(sample) > 0.01), "cue is audible data, not silence");
	});
}

for (const [filename, duration, expectedNotes] of [
	["countdown_chime_halfway.wav", 1.8, 2],
	["countdown_chime_complete.wav", 2.4, 3],
]) {
	test(`${filename}: gentle level, silent boundaries and distinct note count`, () => {
		const wave = readWave(filename);
		assert.equal(wave.duration, duration);
		assert.ok(wave.samples.slice(0, 1200).every((sample) => sample === 0), "starts with at least 50 ms of silence");
		assert.ok(wave.samples.slice(-2400).every((sample) => sample === 0), "ends with at least 100 ms of silence");
		let peak = 0;
		let maxStep = 0;
		for (let i = 0; i < wave.samples.length; i += 1) {
			peak = Math.max(peak, Math.abs(wave.samples[i]));
			if (i > 0) maxStep = Math.max(maxStep, Math.abs(wave.samples[i] - wave.samples[i - 1]));
		}
		assert.ok(peak > 0.15 && peak < 0.5, `moderate peak without clipping: ${peak}`);
		assert.ok(maxStep < 0.1, `no abrupt sample discontinuities: ${maxStep}`);
		// Count audible runs in 10 ms RMS windows, independently of the synthesis note plan.
		let active = false;
		let notes = 0;
		for (let offset = 0; offset < wave.samples.length; offset += 240) {
			const window = wave.samples.slice(offset, offset + 240);
			const audible = Math.sqrt(window.reduce((sum, sample) => sum + sample * sample, 0) / window.length) > 0.002;
			if (audible && !active) notes += 1;
			active = audible;
		}
		assert.equal(notes, expectedNotes);
	});
}

test("checked-in chimes match the reproducible offline generator", () => {
	for (const cue of CUES) {
		assert.deepEqual(fs.readFileSync(path.join(AUDIO_DIRECTORY, cue.file)), synthesizeCue(cue));
	}
});

test("every active speech asset matches its language, phase, duration and recorded SHA-256", () => {
	const manifest = require("../../assets/sounds/notifications/speech-manifest.json");
	assert.equal(manifest.cues.length, 4);
	assert.equal(new Set(manifest.cues.map((cue) => `${cue.locale}:${cue.phase}`)).size, 4);
	for (const cue of manifest.cues) {
		const wave = readWave(cue.file);
		assert.equal(wave.buffer.length, cue.bytes);
		assert.equal(wave.duration, cue.durationSeconds);
		assert.equal(crypto.createHash("sha256").update(wave.buffer).digest("hex"), cue.sha256);
		assert.ok(!cue.file.includes("chime"));
		assert.equal(cue.language, cue.locale === "zh" ? "zh-HK" : "en-US");
		assert.ok(cue.text.length > 0);
	}
});

test("Expo's installed Android plugin copies every configured cue into native raw resources", () => {
	const root = path.resolve(__dirname, "../..");
	const configure = require("../../app.config");
	const { setNotificationSounds } = require("expo-notifications/plugin/build/withNotificationsAndroid");
	const result = configure({ config: { version: "1.1.6", plugins: [] } });
	assert.equal(result.version, "1.1.7");
	const sounds = result.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications")[1].sounds;
	const artifacts = path.join(root, "workspace-artifacts");
	fs.mkdirSync(artifacts, { recursive: true });
	const staging = fs.mkdtempSync(path.join(artifacts, "timer-audio-native-resources-"));
	setNotificationSounds(staging, sounds.map((sound) => path.resolve(root, sound)));
	for (const sound of sounds) {
		assert.deepEqual(fs.readFileSync(path.join(staging, "android/app/src/main/res/raw", path.basename(sound))),
			fs.readFileSync(path.resolve(root, sound)));
	}
});

test('native speech and crop changes use a new runtime without downgrading future releases', () => {
	const configure = require('../../app.config');
	for (const version of ['1.1.1', '1.1.2', '1.1.3', '1.1.4', '1.1.5', '1.1.6']) {
		const result = configure({ config: { version, plugins: [] } });
		assert.equal(result.version, '1.1.7');
		assert.ok(result.plugins.includes('./plugins/withImagePickerContrast'));
	}
	for (const version of ['1.1.7', '1.1.8', '1.2.0', '2.0.0']) {
		const first = configure({ config: { version, plugins: [] } });
		const second = configure({ config: first });
		assert.equal(second.version, version);
		assert.equal(second.plugins.filter((plugin) => plugin === './plugins/withImagePickerContrast').length, 1);
	}
});
