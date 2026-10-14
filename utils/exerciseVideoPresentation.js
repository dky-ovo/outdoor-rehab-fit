import { directVideoUri } from './contentVideo';

export const EXERCISE_VIDEO_RATIO = 16 / 9;
export function previewFrameTime(duration) {
  return Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 4) : 0;
}
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Separate documents: a cover can never autoplay or report a watched segment.
// Only a player opened by an explicit card press receives autoplay permission.
export function exerciseVideoHtml(source, { title = '', locale = 'zh', preview = false } = {}) {
  const uri = directVideoUri(source);
  if (!uri) return '';
  const loading = locale === 'en' ? 'Loading preview…' : '載入預覽…';
  const unavailable = locale === 'en' ? 'Preview unavailable' : '暫無預覽';
  const play = locale === 'en' ? 'Play video' : '播放影片';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#152019;color:#fff;font:18px sans-serif}video{display:block;width:100%;height:100%;object-fit:${preview ? 'cover' : 'contain'};-webkit-touch-callout:none}#notice{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#152019}#resume{display:none;position:absolute;inset:35% 15%;background:#840b1c;color:white;border:2px solid white;border-radius:14px;font:700 22px sans-serif}video::-webkit-media-controls-download-button{display:none}
</style></head><body><video id="video" ${preview ? 'muted' : 'controls autoplay'} playsinline webkit-playsinline preload="metadata" controlslist="nodownload noremoteplayback" disablepictureinpicture disableremoteplayback aria-label="${escape(title)}" src="${escape(uri)}"></video>
${preview ? `<div id="notice">${loading}</div>` : `<button id="resume">${play}</button>`}<script>
var video=document.getElementById('video');
${preview ? `
var notice=document.getElementById('notice'),target=0;
function ready(){if(video.readyState>=2&&Math.abs(video.currentTime-target)<0.15)notice.style.display='none';}
video.addEventListener('loadedmetadata',function(){target=Number.isFinite(video.duration)&&video.duration>0?Math.min(1,video.duration/4):0;try{video.currentTime=target;}catch(e){}ready();});
video.addEventListener('loadeddata',ready);video.addEventListener('seeked',ready);
video.addEventListener('play',function(){video.pause();});
video.addEventListener('error',function(){notice.textContent=${JSON.stringify(unavailable)};notice.style.display='flex';});
` : `
var resume=document.getElementById('resume');
function emit(state){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'facility-video',state:state,positionMs:video.currentTime*1000,durationMs:video.duration*1000}));}
function start(){try{var promise=video.play();if(promise&&promise.catch)promise.catch(function(){resume.style.display='block';});}catch(e){resume.style.display='block';}}
resume.addEventListener('click',start);video.addEventListener('canplay',function(){if(!video.dataset.attempted){video.dataset.attempted='yes';start();}});
video.addEventListener('playing',function(){resume.style.display='none';emit('playing');});
video.addEventListener('pause',function(){if(!video.ended)emit('paused');});
video.addEventListener('ended',function(){emit('ended');});
video.addEventListener('error',function(){emit('error');});
video.addEventListener('waiting',function(){emit('buffering');});
video.addEventListener('seeking',function(){emit('seeking');});
video.addEventListener('seeked',function(){if(!video.paused&&!video.ended&&video.readyState>=3)emit('playing');});
var last=0;video.addEventListener('timeupdate',function(){if(Date.now()-last>1000){last=Date.now();emit('progress');}});
`}
document.addEventListener('visibilitychange',function(){if(document.hidden)video.pause();});
document.addEventListener('contextmenu',function(event){event.preventDefault();});
</script></body></html>`;
}
