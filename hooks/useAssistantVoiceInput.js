import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { ensurePlaybackAudioMode } from '../utils/audioMode';
import { createAssistantVoiceSession, createBrowserVoiceAdapter, voiceRecognitionLanguage } from '../utils/assistantVoiceSession';
import { createOfflineVoiceAdapter } from '../utils/offlineAssistantVoice';
import { setAssistantMicrophoneActive, stopAssistantReaders } from '../utils/assistantAudioCoordination';

let activeSession = null;
function getInstalledVersion() {
  // Read binary metadata, never the OTA's expoConfig version/build values.
  // This optional module is already supplied by Expo and adds no dependency.
  try {
    const application = requireOptionalNativeModule('ExpoApplication');
    return { version: application?.nativeApplicationVersion || '—', build: application?.nativeBuildVersion || '—' };
  } catch { return { version: '—', build: '—' }; }
}
function getAdapter() {
  if (Platform.OS === 'web') {
    return createBrowserVoiceAdapter(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  }
  // Offline models require a new binary. Never silently route private audio
  // through a system/cloud recognizer when this module is absent.
  let module;
  try { module = requireOptionalNativeModule('OfflineAssistantVoice'); } catch { module = null; }
  return createOfflineVoiceAdapter(module);
}

export function useAssistantVoiceInput({ locale, enabled, onTranscript }) {
  const [state, setState] = useState({ status: 'idle', interimText: '', errorCode: null });
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const stateRef = useRef(state);
  stateRef.current = state;
  const controller = useRef(null);
  const startGeneration = useRef(0);
  const foreground = useRef(!AppState.currentState || ['active', 'unknown'].includes(AppState.currentState));
  const audioOwner = useRef({});
  const adapter = useMemo(getAdapter, []);
  const installed = useMemo(getInstalledVersion, []);
  const language = voiceRecognitionLanguage(locale, Platform.OS);
  useEffect(() => {
    let mounted = true;
    const session = createAssistantVoiceSession({ adapter, language,
      onState: (next) => { if (mounted) { setAssistantMicrophoneActive(audioOwner.current, next.status !== 'idle'); stateRef.current = next; setState(next); } },
      onTranscript: (text) => { if (mounted && enabledRef.current) callback.current?.(text); },
      onRelease: () => Platform.OS === 'ios' ? ensurePlaybackAudioMode() : undefined,
    });
    controller.current = session;
    setState({ status: 'idle', interimText: '', errorCode: null });
    const subscription = AppState.addEventListener('change', (next) => {
      // iOS temporarily becomes inactive while displaying its permission prompt.
      foreground.current = next === 'active';
      if (next === 'background' || (next === 'inactive' && stateRef.current.status !== 'requesting')) { ++startGeneration.current; void session.cancel(); }
      // Refresh capability diagnostics on return without opening the microphone.
      if (next === 'active' && mounted) setState(current => ({ ...current }));
    });
    return () => {
      mounted = false;
      ++startGeneration.current;
      setAssistantMicrophoneActive(audioOwner.current, false);
      if (controller.current === session) controller.current = null;
      subscription?.remove();
      void session.dispose().then(() => { if (activeSession === session) activeSession = null; });
    };
  }, [adapter, language]);
  useEffect(() => { if (!enabled) { ++startGeneration.current; void controller.current?.cancel(); } }, [enabled]);
  const start = useCallback(async () => {
    const session = controller.current;
    if (!enabledRef.current || !foreground.current || !session || stateRef.current.status !== 'idle') return false;
    const generation = ++startGeneration.current;
    if (activeSession && activeSession !== session) await activeSession.cancel();
    if (!enabledRef.current || !foreground.current || generation !== startGeneration.current || controller.current !== session) return false;
    setAssistantMicrophoneActive(audioOwner.current, true);
    await stopAssistantReaders();
    if (!enabledRef.current || !foreground.current || generation !== startGeneration.current || controller.current !== session) {
      if (generation === startGeneration.current) setAssistantMicrophoneActive(audioOwner.current, false);
      return false;
    }
    activeSession = session;
    return session.start();
  }, []);
  const stop = useCallback(async () => { ++startGeneration.current; await controller.current?.stop(); if (stateRef.current.status === 'idle') setAssistantMicrophoneActive(audioOwner.current, false); }, []);
  const cancel = useCallback(async () => { ++startGeneration.current; setAssistantMicrophoneActive(audioOwner.current, false); await controller.current?.cancel(); }, []);
  const isSupported = Boolean(adapter?.available());
  const unavailableReason = isSupported ? null : adapter?.unavailableReason?.() || 'speechServiceUnavailable';
  return { ...state, start, stop, cancel, isSupported, unavailableReason,
    readDiagnostics: () => adapter?.readDiagnostics?.() || {},
    diagnostics: {
      platform: Platform.OS,
      osVersion: String(Platform.Version ?? '—'),
      installedVersion: installed.version,
      installedBuild: installed.build,
      nativeModule: Platform.OS === 'web' ? 'notApplicable' : adapter?.nativeModulePresent ? 'available' : 'missing',
      speechService: isSupported ? 'available' : 'unavailable',
      recognitionService: adapter?.servicePackage?.() || '—',
      language,
      engine: adapter?.engine || 'browser',
    },
  };
}
