# Countdown audio assets

These short, bundled WAV files provide cues for the app's countdown player
without needing to initialize a text-to-speech service at the deadline. Playback
and scheduling are handled by the timer integration. Adding files to Android's
packaged native resources requires a new APK; an over-the-air JavaScript update
alone does not add native resources.

Runtime 1.1.6 uses **Cantonese speech** for the Chinese interface and the existing
English speech for English. `utils/countdownAudioAssets.js` supplies the same four
recordings to foreground playback, notifications and the Android native service.
Playback does not contact a speech service or require a phone voice pack. There
is no Mandarin/default-system-language fallback.

The old chimes below are retained only as historical Build 9 source assets and
generator tests; they are not registered as timer sounds in new native builds.

| File | Cue | Duration | Bytes |
| --- | --- | --- | --- |
| `countdown_yue_halfway.wav` | 倒數計時已過一半。 (Cantonese) | 3.432 s | 164814 |
| `countdown_yue_complete.wav` | 倒數計時已結束。 (Cantonese) | 3.024 s | 145230 |
| `countdown_chime_halfway.wav` | Two soft descending notes (G5, E5) | 1.800 s | 86444 |
| `countdown_chime_complete.wav` | Three soft ascending notes (C5, E5, G5) | 2.400 s | 115244 |
| `countdown_en_halfway.wav` | The countdown is halfway complete. | 2.990 s | 143542 |
| `countdown_en_complete.wav` | The countdown has finished. | 2.520 s | 120982 |

All six files contain 24 kHz, 16-bit, mono linear PCM. Every cue is shorter than
five seconds.

The Cantonese source MP3s were generated on 2026-09-09 with the already-installed
`edge-tts 7.2.8`, selecting **zh-HK-HiuMaanNeural** at `-20%` rate via Microsoft's
online read-aloud service. Only the two generic sentences above were sent; no
code or user records were supplied. The interrupted tool return did not mean
the process had produced no files: both completed MP3s were recovered from
`workspace-artifacts/audio/cantonese-countdown-20260909` and decoded locally.
FFmpeg 4.2.2 converted them to 24 kHz mono PCM without another online call.
This is a development-time asset-generation step, not a runtime API dependency.
The [tool's usage documentation](https://github.com/rany2/edge-tts) describes this
online service; Microsoft's [language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)
identifies this voice as Hong Kong Cantonese. The generated voice is synthetic,
not a human recording. Source/PCM hashes, text and voice metadata are recorded in
`speech-manifest.json`. Decode/format/hash checks do not replace a human listening
check or device speaker/lock-screen tests.

The chimes were synthesized offline on 2026-09-09 using the dependency-free Node
script below. They are original, deterministic sine tones with a quiet second
harmonic, a 30 ms raised-cosine attack, a 180 ms raised-cosine release, and silence
at each file boundary. Peak amplitude stays below half of full scale. They use no
external recordings, speech service, generated AI audio, or downloaded assets.

The English files were generated offline on 2026-09-08 using the installed Windows
`Microsoft Zira Desktop` (`en-US`) voice, at rate `-1` and volume `100`; their bytes
have been retained unchanged.

SHA-256:

```text
008eeac438ccd21dd53374961e8cd9c6be5712464e52126c08ee45c821bc5322  countdown_yue_halfway.wav
dc07758ae45bf7917f19fd469b0b33bfb959ce2eefb5bd000ab23ed06dbf534b  countdown_yue_complete.wav
841389796f891172f5726ab4ceb437dc2ffe30daf31895e9f7c6d4d5c39b72ac  countdown_chime_halfway.wav
fac5c8154088031922b83f139d571cf5b5ff298bd083eb3b882cb50a1ebeddd6  countdown_chime_complete.wav
4a2cb554b61b3db4da5c0f949fd15fa5e6a1cbe96438c9072be33d85b1031bcc  countdown_en_halfway.wav
98577de8ba80cbc833becc29ad5d2f45826642821a5a086624375f336d0f4f5d  countdown_en_complete.wav
```

To generate the chimes from the repository root, or verify that the checked-in
files exactly match the generator without writing anything:

```text
node scripts/generate-countdown-chimes.cjs
node scripts/generate-countdown-chimes.cjs --check
node --test scripts/__tests__/countdown-audio-assets-test.cjs
```

The generator will not overwrite different existing files unless passed `--force`.
The tests inspect all four WAV headers and lengths, check that both chimes have
moderate peaks, no abrupt sample steps and silent boundaries, count the audible
notes, and compare their bytes with a fresh in-memory synthesis. These checks do
not replace listening tests on a physical phone at a comfortable media volume.

To regenerate only the English files on Windows with the same voice installed:

```powershell
powershell.exe -NoProfile -STA -File .\scripts\generate-countdown-notification-audio.ps1 -Force
```

Use Windows PowerShell 5.1 for the Windows `System.Speech` interface. A restricted
process can enumerate voices while being unable to activate them; the generator
must be permitted to access the local speech service. The script never downloads
voices, contacts a speech API, or installs system components. It validates the WAV
format and the requirement that each cue is shorter than 30 seconds, and reports
duration and SHA-256. Voice/Windows updates may change the generated bytes.

The local Windows inventory has no Cantonese (`zh-HK` / `yue`) voice. New Chinese
cues therefore use the bundled Cantonese recordings above, not local Windows TTS
or the historical nonverbal chimes. English regeneration remains offline.
