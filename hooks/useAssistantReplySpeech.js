import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { createAssistantReplyReader } from '../utils/assistantReplySpeech';

export function useAssistantReplySpeech({ locale, enabled }) {
  const [state, setState] = useState({ status: 'idle', activeMessageId: null, errorCode: null });
  const [autoRead, setAutoRead] = useState(true);
  const ref = useRef(null), allowed = useRef(enabled);
  const foreground = useRef(!AppState.currentState || AppState.currentState === 'active' || AppState.currentState === 'unknown');
  allowed.current = enabled;
  const native = useMemo(() => {
    if (Platform.OS === 'web') return null;
    try { return requireOptionalNativeModule('OfflineAssistantVoice'); } catch { return null; }
  }, []);
  const language = /^en/i.test(String(locale)) ? 'en-US' : 'zh-HK';
  useEffect(() => {
    let mounted = true;
    const reader = createAssistantReplyReader({ native, language, onState: value => { if (mounted) setState(value); } });
    ref.current = reader;
    const subscription = AppState.addEventListener('change', next => { foreground.current = next === 'active'; if (!foreground.current) void reader.stop(); });
    return () => { mounted = false; if (ref.current === reader) ref.current = null; subscription.remove(); void reader.dispose(); };
  }, [native, language]);
  useEffect(() => { if (!enabled) void ref.current?.stop(); }, [enabled]);
  const read = useCallback((id, text) => allowed.current && foreground.current ? ref.current?.read(id, text) : Promise.resolve(false), []);
  const stop = useCallback(() => ref.current?.stop(), []);
  const changeAutoRead = useCallback(value => { setAutoRead(value); if (!value) void ref.current?.stop(); }, []);
  return { ...state, autoRead, setAutoRead: changeAutoRead, read, stop };
}
