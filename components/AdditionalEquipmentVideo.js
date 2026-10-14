import React, { useRef } from "react";
import { Text, View } from "react-native";
import MediaVideo from "./MediaVideo";
import DeferredDetailMedia from "./DeferredDetailMedia";
import useVideoPlaybackEvents from "../hooks/useVideoPlaybackEvents";
import { sendResearchEvent } from "../utils/api";

// Each additional video owns its playback session; it must not inflate the
// existing primary video's learning progress or inherit another video's timer.
export default function AdditionalEquipmentVideo({ video, equipmentId, locale, user, index, style }) {
  const started = useRef(null);
  const onState = useVideoPlaybackEvents(JSON.stringify([equipmentId, video.id, video.videoUrl, locale, user?.token]), (state, metadata = {}) => {
    const track = (event, extra) => user?.token && sendResearchEvent(user.token, event, { screen: "outdoor.detail", equipmentId, contentId: equipmentId, videoId: video.id, ...metadata, ...extra }).catch(() => {});
    if (state === "playing" && started.current === null) { started.current = Date.now(); track("video.play"); }
    if (["paused", "ended"].includes(state) && started.current !== null) {
      track(state === "ended" ? "video.completed" : "video.paused", { watchedMs: Math.max(0, Date.now() - started.current), completed: state === "ended" }); started.current = null;
    }
  });
  const title = video.title || (locale === "en" ? `Additional video ${index + 1}` : `附加影片 ${index + 1}`);
  return <View style={style} testID={`equipment-additional-video-${index}`}><Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 12 }}>{title}</Text><DeferredDetailMedia key={video.videoUrl} locale={locale} label={locale === "en" ? "Load this additional video" : "載入此附加影片"}><MediaVideo source={video.videoUrl} title={title} locale={locale} preload="none" onChangeState={onState} /></DeferredDetailMedia></View>;
}
