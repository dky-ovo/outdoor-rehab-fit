import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { directVideoUri, videoMessageEvent } from '../utils/contentVideo';
import { exerciseVideoHtml } from '../utils/exerciseVideoPresentation';

export default function ExerciseVideoSurface(props) {
  return <Surface key={JSON.stringify([props.source, !!props.preview])} {...props} />;
}
function Surface({ source, title, locale = 'zh', preview = false, active = true, onChangeState }) {
  const [attempt, setAttempt] = useState(0), [failed, setFailed] = useState(false);
  const uri = directVideoUri(source);
  const html = useMemo(() => exerciseVideoHtml(source, { title, locale, preview }), [source, title, locale, preview]);
  const generation = useMemo(() => ({ active: true }), [attempt, active]);
  useEffect(() => { generation.active = true; return () => { generation.active = false; }; }, [generation]);
  if (!active) return <View style={{ flex: 1, backgroundColor: '#152019' }} />;
  if (!uri || failed) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <Text style={{ color: '#fff', fontSize: 18 }}>{locale === 'en' ? 'Video unavailable. Check your connection.' : '影片暫時無法載入，請檢查網絡。'}</Text>
    {!preview && !!uri && <TouchableOpacity accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} style={{ padding: 20 }}><Text style={{ color: '#fff', fontSize: 20 }}>{locale === 'en' ? 'Retry' : '重試'}</Text></TouchableOpacity>}
  </View>;
  return <View style={{ flex: 1 }} pointerEvents={preview ? 'none' : 'auto'} accessibilityElementsHidden={preview} importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}>
    <WebView key={attempt} source={{ html }} style={{ flex: 1, backgroundColor: '#152019' }}
      originWhitelist={['*']} scrollEnabled={false} allowsInlineMediaPlayback allowsFullscreenVideo={!preview}
      mediaPlaybackRequiresUserAction={preview} allowsPictureInPictureMediaPlayback={false} allowsAirPlayForMediaPlayback={false}
      allowsLinkPreview={false} menuItems={[]} textInteractionEnabled={false} onFileDownload={() => {}} onOpenWindow={() => {}} setSupportMultipleWindows
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" thirdPartyCookiesEnabled={false}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url?.startsWith('about:blank#') || (request.isTopFrame === false && request.url === uri)}
      onMessage={event => {
        if (preview || !generation.active) return;
        const message = videoMessageEvent(event.nativeEvent.data);
        if (!message || message.state === 'dimensions') return;
        onChangeState?.(message.state, message.metadata);
        if (message.state === 'error') { generation.active = false; setFailed(true); }
      }}
      onError={() => { if (generation.active) { generation.active = false; if (!preview) onChangeState?.('error'); setFailed(true); } }} />
  </View>;
}
