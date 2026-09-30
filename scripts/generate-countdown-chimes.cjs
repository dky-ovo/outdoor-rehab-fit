#!/usr/bin/env node
"use strict";

// Original synthesized cues: no recordings, random input, speech service or dependencies.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SAMPLE_RATE = 24000;
const AUDIO_DIRECTORY = path.resolve(__dirname, "../assets/sounds/notifications");
const CUES = Object.freeze([
	{
		file: "countdown_chime_halfway.wav",
		duration: 1.8,
		// Two descending notes (G5, E5).
		notes: [
			{ start: 0.08, duration: 0.54, frequency: 783.990872 },
			{ start: 0.74, duration: 0.8, frequency: 659.255114 },
		],
	},
	{
		file: "countdown_chime_complete.wav",
		duration: 2.4,
		// Three ascending notes (C5, E5, G5), with a longer final note.
		notes: [
			{ start: 0.08, duration: 0.46, frequency: 523.251131 },
			{ start: 0.66, duration: 0.46, frequency: 659.255114 },
			{ start: 1.24, duration: 0.92, frequency: 783.990872 },
		],
	},
]);

function synthesizeCue(cue) {
	const samples = new Float64Array(Math.round(cue.duration * SAMPLE_RATE));
	for (const note of cue.notes) {
		const first = Math.round(note.start * SAMPLE_RATE);
		const count = Math.round(note.duration * SAMPLE_RATE);
		const attack = Math.round(0.03 * SAMPLE_RATE);
		const release = Math.round(0.18 * SAMPLE_RATE);
		for (let i = 0; i < count; i += 1) {
			const t = i / SAMPLE_RATE;
			const fadeIn = i < attack ? 0.5 - 0.5 * Math.cos(Math.PI * i / attack) : 1;
			const remaining = count - 1 - i;
			const fadeOut = remaining < release ? 0.5 - 0.5 * Math.cos(Math.PI * remaining / release) : 1;
			const envelope = fadeIn * fadeOut * Math.exp(-1.4 * t / note.duration);
			const phase = 2 * Math.PI * note.frequency * t;
			const tone = 0.92 * Math.sin(phase) + 0.08 * Math.sin(2 * phase);
			samples[first + i] += 0.44 * envelope * tone;
		}
	}

	const wave = Buffer.alloc(44 + samples.length * 2);
	wave.write("RIFF", 0);
	wave.writeUInt32LE(wave.length - 8, 4);
	wave.write("WAVEfmt ", 8);
	wave.writeUInt32LE(16, 16);
	wave.writeUInt16LE(1, 20); // Integer PCM.
	wave.writeUInt16LE(1, 22); // Mono.
	wave.writeUInt32LE(SAMPLE_RATE, 24);
	wave.writeUInt32LE(SAMPLE_RATE * 2, 28);
	wave.writeUInt16LE(2, 32);
	wave.writeUInt16LE(16, 34);
	wave.write("data", 36);
	wave.writeUInt32LE(samples.length * 2, 40);
	for (let i = 0; i < samples.length; i += 1) {
		if (Math.abs(samples[i]) >= 1) throw new Error(`Clipping in ${cue.file}`);
		wave.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
	}
	return wave;
}

function main(args) {
	const check = args.includes("--check");
	const force = args.includes("--force");
	if (args.some((arg) => !["--check", "--force"].includes(arg)) || (check && force)) {
		throw new Error("Usage: node scripts/generate-countdown-chimes.cjs [--check | --force]");
	}
	const outputs = CUES.map((cue) => ({ cue, target: path.join(AUDIO_DIRECTORY, cue.file), wave: synthesizeCue(cue) }));
	// Preflight both targets before writing. Existing different assets need explicit --force.
	for (const { target, wave } of outputs) {
		if (check) {
			if (!fs.existsSync(target) || !fs.readFileSync(target).equals(wave)) {
				throw new Error(`Missing or changed generated asset: ${target}`);
			}
		} else if (fs.existsSync(target) && !force && !fs.readFileSync(target).equals(wave)) {
			throw new Error(`Audio already exists with different bytes: ${target}. Use --force to regenerate.`);
		}
	}
	if (!check) fs.mkdirSync(AUDIO_DIRECTORY, { recursive: true });
	for (const { cue, target, wave } of outputs) {
		if (!check && (!fs.existsSync(target) || force)) fs.writeFileSync(target, wave, { flag: force ? "w" : "wx" });
		console.log(JSON.stringify({
			file: cue.file, format: "PCM", sampleRate: SAMPLE_RATE, bitsPerSample: 16,
			channels: 1, durationSeconds: cue.duration, bytes: wave.length,
			sha256: crypto.createHash("sha256").update(wave).digest("hex"),
		}));
	}
}

if (require.main === module) {
	try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { CUES, synthesizeCue };
