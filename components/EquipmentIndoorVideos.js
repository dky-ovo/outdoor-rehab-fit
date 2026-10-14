import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Collapsible } from './Collapsible';
import ExerciseVideoGallery from './ExerciseVideoGallery';
import { getPublicContent, sendResearchEvent } from '../utils/api';
import { exerciseVideoCategoryLabel, filterExerciseVideos } from '../utils/exerciseVideoCategories';

export default function EquipmentIndoorVideos(props) {
  return <IndoorVideos key={JSON.stringify([props.equipmentId, props.locale, props.user?.token])} {...props} />;
}
function IndoorVideos({ equipmentId, locale, user, enabled = true, style }) {
  const [result, setResult] = useState(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setFailed(false);
    getPublicContent('exercise_videos').then(data => { if (active) setResult(filterExerciseVideos(data.items, 'indoor', equipmentId)); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [enabled, equipmentId, retry]);
  // Keep unchanged equipment pages uncluttered. Only published, explicitly
  // associated indoor videos appear; a matching title alone is insufficient.
  if (!enabled || !failed && !result?.length) return null;
  const track = (event, item, metadata = {}) => user?.token && sendResearchEvent(user.token, event, {
    screen: 'outdoor.detail', equipmentId: String(equipmentId), contentId: item.id,
    contentType: 'video', videoCategory: 'indoor', title: item.title, ...metadata,
  }).catch(() => {});
  return <View testID="equipment-indoor-videos" style={style}>
    <Collapsible title={exerciseVideoCategoryLabel('indoor', locale)}>
      {failed ? <View style={{ padding: 14, gap: 12 }}><Text>{locale === 'en' ? 'Unable to load indoor videos.' : '暫時無法載入室內運動影片。'}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: '#840B1C', fontSize: 18 }}>{locale === 'en' ? 'Retry' : '重試'}</Text></TouchableOpacity></View>
        : <ExerciseVideoGallery items={result} locale={locale} track={track} embedded />}
    </Collapsible>
  </View>;
}
