# Offline voice third-party notices

This directory's small Expo bridge is MIT licensed. Third-party engines and
models retain their own licenses; the bridge license does not relicense them.

- sherpa-onnx v1.13.8, k2-fsa: Apache-2.0. Complete unchanged license:
  `licenses/sherpa-onnx-1.13.8-LICENSE.txt`.
  https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.8
- ONNX Runtime: MIT. iOS v1.28.2 package is the dependency explicitly pinned by
  upstream sherpa-onnx v1.13.8. Complete unchanged license and third-party notices:
  `licenses/onnxruntime-1.28.2-LICENSE.txt` and
  `licenses/onnxruntime-1.28.2-ThirdPartyNotices.txt`.
  https://github.com/microsoft/onnxruntime/tree/v1.28.2
- **SenseVoiceSmall** model weights, original model identifiers
  **iic/SenseVoiceSmall** and **FunAudioLLM/SenseVoiceSmall**: original authors
  **FunAudioLLM / Alibaba Group**, as identified by the upstream model card and
  copyright notice. This app uses the k2-fsa/sherpa-onnx INT8 conversion named
  **sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17**. These names and
  author/source attributions must be retained when distributing the model.
  Complete unchanged model terms: `licenses/SenseVoiceSmall-FunASR-MODEL_LICENSE.txt`
  (FunASR Model Open Source License Agreement v1.1, English and Chinese).
  Source-code MIT licensing does **not** relicense the model weights.
  https://huggingface.co/FunAudioLLM/SenseVoiceSmall
  https://www.modelscope.cn/models/iic/SenseVoiceSmall

Section 2.2 of the model agreement requires source/author attribution and retention
of relevant model names. The official SenseVoice documentation, retained unchanged
at `licenses/SenseVoice-upstream-README.md`, links to the maintainers' clarification
that commercial use of official SenseVoiceSmall weights is permitted when the model
terms are followed; Section 3 is a responsibility/risk disclaimer, and fine-tuned
weights may remain private. That clarification explicitly covers the official
weights, not every third-party conversion or bundled artifact. It does not remove
Section 2.2 or any other model-license terms.

`licenses/sources.json` records immutable source commits, the corresponding release
tags, original URLs, byte sizes and SHA-256 values. The five upstream files are
copied in full, without translation or amendments. Do not replace the complete
model agreement with the short URL-only LICENSE from the converted model archive.
All of `licenses/`, this notice, the bridge MIT license, and the original model
archive's LICENSE/README must accompany the distributed native module/model.

The preparation script must also preserve any additional notices/licenses supplied
in the binary archives, as well as the original model license and README beside
`model.int8.onnx`. Android assets and the iOS resource bundle must include
`licenses/`; these files must not exist only on the build developer's computer.
No audio, microphone samples or transcription are transmitted by this module.
Answer requests submitted by users remain subject to the APP's existing AI service.
Native assets are pinned by URL, size and SHA-256 in native-artifacts.json. Do not
replace them with a latest-version URL or execute scripts from downloaded archives.

Answer playback uses installed offline system voices only. It does not download
voices or silently substitute Mandarin for Cantonese. A missing Cantonese/English
voice produces a clear unavailable result instead of uploading answer text.

This attribution and license collection is not a complete security audit, legal
opinion, or guarantee that every transitive binary dependency has been identified.
The full upstream ONNX Runtime notice file is included without attempting to remove
entries based on an unverified binary-dependency assumption. Release owners must
review the relevant conditions and any separately bundled artifacts before public
distribution. No third-party text-to-speech model weights are included here.
