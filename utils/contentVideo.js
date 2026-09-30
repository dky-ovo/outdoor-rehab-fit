import { resolveApiAssetUrl } from "./api";

// Old records remain playable until an administrator supplies a replacement file.
// Do not interpret arbitrary web pages as a YouTube ID or executable video source.
export function youtubeVideoId(value) {
	const text = String(value || "").trim();
	if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
	try {
		const url = new URL(text);
		if (!["https:", "http:"].includes(url.protocol)) return "";
		const host = url.hostname.toLowerCase();
		let id = "";
		if (["youtu.be", "www.youtu.be"].includes(host)) id = url.pathname.split("/")[1];
		if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(host)) {
			id = url.searchParams.get("v") || (/^\/(?:embed|shorts)\//.test(url.pathname) ? url.pathname.split("/")[2] : "");
		}
		return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : "";
	} catch { return ""; }
}

export function directVideoUri(value) {
	const text = String(value || "").trim();
	if (!text || text.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(text) || youtubeVideoId(text)) return "";
	if (/^\/api\/media\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\.(?:mp4|mov|webm)$/.test(text)) return resolveApiAssetUrl(text);
	try {
		const url = new URL(text);
		if (url.protocol !== "https:" || url.username || url.password || url.hash) return "";
		if (/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|0\.)/i.test(url.hostname)) return "";
		if ([...url.searchParams.keys()].some((key) => /token|key|signature|credential|authorization|secret/i.test(key))) return "";
		if (!/\.(?:mp4|m4v|mov|webm)$/i.test(url.pathname)) return "";
		return url.href;
	} catch { return ""; }
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

// Capture playback position only at player events; this does not issue network
// requests. Invalid/live/unknown durations must not fabricate 100% completion.
export function videoProgressMetadata(value = {}) {
	const position = value?.positionMs;
	const duration = value?.durationMs;
	const result = {};
	if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) result.durationMs = Math.max(1, Math.round(duration));
	if (typeof position === "number" && Number.isFinite(position) && position >= 0) {
		result.positionMs = Math.round(result.durationMs ? Math.min(position, result.durationMs) : position);
		if (result.durationMs) result.progressPercent = Math.round((result.positionMs / result.durationMs) * 10000) / 100;
	}
	return result;
}

export function videoElementProgress(video) {
	return videoProgressMetadata({ positionMs: typeof video?.currentTime === "number" ? video.currentTime * 1000 : undefined, durationMs: typeof video?.duration === "number" ? video.duration * 1000 : undefined });
}

// Use intrinsic dimensions, not the containing screen's height. Unknown or bad
// metadata should leave the player at its loading fallback, never collapse it.
export function videoAspectRatio(value) {
	const width = value?.videoWidth;
	const height = value?.videoHeight;
	if (![width, height].every((dimension) => typeof dimension === "number" && Number.isFinite(dimension) && dimension > 0 && dimension <= 32768)) return null;
	const ratio = width / height;
	return ratio >= 1 / 32 && ratio <= 32 ? ratio : null;
}

export function directVideoHtml(uri, title = "") {
	const safeUri = directVideoUri(uri);
	if (!safeUri) return "";
	return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}video{display:block;width:100%;height:100%;object-fit:contain;-webkit-touch-callout:none}video::-webkit-media-controls-download-button{display:none}</style></head><body><video id="facility-video" controls playsinline webkit-playsinline controlslist="nodownload noremoteplayback" disablepictureinpicture disableremoteplayback preload="metadata" aria-label="${escapeHtml(title)}" src="${escapeHtml(safeUri)}"></video><script>
var video=document.getElementById('facility-video');
function emit(state){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'facility-video',state:state,positionMs:video.currentTime*1000,durationMs:video.duration*1000}));}
function dimensions(){if(window.ReactNativeWebView&&video.videoWidth>0&&video.videoHeight>0)window.ReactNativeWebView.postMessage(JSON.stringify({type:'facility-video',state:'dimensions',videoWidth:video.videoWidth,videoHeight:video.videoHeight}));}
video.addEventListener('loadedmetadata',dimensions);
video.addEventListener('resize',dimensions);
video.addEventListener('playing',function(){emit('playing');});
video.addEventListener('pause',function(){if(!video.ended)emit('paused');});
video.addEventListener('ended',function(){emit('ended');});
video.addEventListener('error',function(){emit('error');});
video.addEventListener('waiting',function(){emit('buffering');});
video.addEventListener('seeking',function(){emit('seeking');});
video.addEventListener('seeked',function(){if(!video.paused&&!video.ended&&video.readyState>=3)emit('playing');});
video.addEventListener('emptied',function(){emit('loading');});
var lastProgress=0;
video.addEventListener('timeupdate',function(){var now=Date.now();if(now-lastProgress>=1000){lastProgress=now;emit('progress');}});
document.addEventListener('visibilitychange',function(){if(document.hidden)video.pause();});
document.addEventListener('contextmenu',function(event){event.preventDefault();});
</script></body></html>`;
}

export function videoMessageState(data) {
	return videoMessageEvent(data)?.state || "";
}

export function videoMessageEvent(data) {
	try {
		const message = JSON.parse(data);
		if (message?.type === "facility-video" && message.state === "dimensions") {
			const aspectRatio = videoAspectRatio(message);
			return aspectRatio ? { state: "dimensions", aspectRatio } : null;
		}
		return message?.type === "facility-video" && ["playing", "paused", "ended", "error", "buffering", "seeking", "loading", "progress"].includes(message.state)
			? { state: message.state, metadata: videoProgressMetadata(message) } : null;
	} catch { return null; }
}
