import React, { useEffect, useMemo, useRef, useState } from 'react';
import { directVideoUri, videoElementProgress } from '../utils/contentVideo';
import { previewFrameTime } from '../utils/exerciseVideoPresentation';

export default function ExerciseVideoSurface(props) {
  return <Surface key={JSON.stringify([props.source, !!props.preview])} {...props} />;
}
function Surface({ source, title, locale = 'zh', preview = false, active = true, onChangeState }) {
  const video = useRef(null), target = useRef(0);
  const [readyGeneration, setReadyGeneration] = useState(null), [failed, setFailed] = useState(false), [resume, setResume] = useState(false), [attempt, setAttempt] = useState(0);
  const uri = directVideoUri(source);
  const generation = useMemo(() => ({ active: true }), [attempt, active]);
  const ready = readyGeneration === generation;
  const emit = (state, element) => { if (generation.active && !preview) onChangeState?.(state, videoElementProgress(element || video.current)); };
  useEffect(() => {
    generation.active = true;
    const element = video.current;
    if (!preview && active && element) {
      try { Promise.resolve(element.play()).catch(() => { if (generation.active) setResume(true); }); }
      catch { setResume(true); }
    }
    return () => { generation.active = false; element?.pause(); };
  }, [generation, preview, active]);
  const readyFrame = event => { const element = event.currentTarget; if (generation.active && element.readyState >= 2 && Math.abs(element.currentTime - target.current) < .15) setReadyGeneration(generation); };
  const button = { padding: 18, background: '#840B1C', color: '#fff', border: '2px solid white', borderRadius: 12, fontSize: 20, cursor: 'pointer' };
  return <div style={{ width: '100%', height: '100%', position: 'relative', background: '#152019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {active && uri && !failed && <video key={attempt} ref={video} src={uri} aria-label={preview ? undefined : title} aria-hidden={preview || undefined} tabIndex={preview ? -1 : undefined}
      muted={preview} controls={!preview} autoPlay={!preview} playsInline preload="metadata" controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback
      style={{ width: '100%', height: '100%', display: 'block', objectFit: preview ? 'cover' : 'contain', pointerEvents: preview ? 'none' : 'auto' }}
      onLoadedMetadata={event => { if (!generation.active || !preview) return; target.current = previewFrameTime(event.currentTarget.duration); try { event.currentTarget.currentTime = target.current; } catch {} readyFrame(event); }}
      onLoadedData={readyFrame} onSeeked={event => { if (preview) readyFrame(event); else if (!event.currentTarget.paused && !event.currentTarget.ended && event.currentTarget.readyState >= 3) emit('playing', event.currentTarget); }}
      onPlay={event => { if (preview) event.currentTarget.pause(); }}
      onPlaying={event => { if (!generation.active) return; setResume(false); emit('playing', event.currentTarget); }}
      onPause={event => { if (!event.currentTarget.ended) emit('paused', event.currentTarget); }}
      onWaiting={event => emit('buffering', event.currentTarget)} onSeeking={event => emit('seeking', event.currentTarget)}
      onTimeUpdate={event => emit('progress', event.currentTarget)} onEnded={event => emit('ended', event.currentTarget)}
      onError={event => { if (!generation.active) return; emit('error', event.currentTarget); generation.active = false; setFailed(true); }} onContextMenu={event => event.preventDefault()} />}
    {preview && (!ready || !active || failed || !uri) && <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'white', pointerEvents: 'none' }}>{failed || !uri ? (locale === 'en' ? 'Preview unavailable' : '暫無預覽') : active ? (locale === 'en' ? 'Loading preview…' : '載入預覽…') : ''}</div>}
    {!preview && (failed || !uri) && <div role="status" style={{ color: 'white', textAlign: 'center', padding: 20 }}><p>{locale === 'en' ? 'Video unavailable. Check your connection.' : '影片暫時無法載入，請檢查網絡。'}</p>{!!uri && <button style={button} onClick={() => { setFailed(false); setResume(false); setAttempt(value => value + 1); }}>{locale === 'en' ? 'Retry' : '重試'}</button>}</div>}
    {!preview && resume && !failed && <button style={{ ...button, position: 'absolute' }} onClick={() => { try { Promise.resolve(video.current?.play()).catch(() => setResume(true)); } catch { setResume(true); } }}>{locale === 'en' ? 'Play video' : '播放影片'}</button>}
  </div>;
}
