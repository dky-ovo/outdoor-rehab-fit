import React from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Confirmation is explicit; selecting a photo never uploads it by itself. */
export default function AssistantPhotoPreview({ photo, locale, onCancel, onSend }) {
  const insets = useSafeAreaInsets();
  if (!photo) return null;
  const en = locale === 'en';
  return <Modal visible animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
    <View style={[styles.page, { paddingTop: Math.max(16, insets.top || 0), paddingBottom: Math.max(16, insets.bottom || 0) }]}>
      <View style={styles.toolbar}>
        <TouchableOpacity testID="assistant-photo-cancel" accessibilityRole="button" accessibilityLabel={en ? 'Cancel' : '取消'} onPress={onCancel} style={styles.button}>
          <Ionicons name="close" size={25} color="#fff" /><Text style={styles.text}>{en ? 'Cancel' : '取消'}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="assistant-photo-send" accessibilityRole="button" accessibilityLabel={en ? 'Send photo' : '發送照片'} onPress={onSend} style={[styles.button, styles.send]}>
          <Ionicons name="send" size={23} color="#fff" /><Text style={styles.text}>{en ? 'Send' : '發送'}</Text>
        </TouchableOpacity>
      </View>
      <Image source={{ uri: photo }} resizeMode="contain" style={styles.image} accessibilityLabel={en ? 'Photo to send' : '準備發送的照片'} />
      <Text style={styles.caption}>{en ? 'Check the photo, then tap Send to identify this facility.' : '確認照片後，點擊「發送」辨識這項設施。'}</Text>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#171A1F', paddingHorizontal: 16 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  button: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: '#353B44' },
  send: { backgroundColor: '#840B1C', borderWidth: 1, borderColor: '#fff' },
  text: { color: '#fff', fontSize: 19, fontWeight: '700' },
  image: { flex: 1, minHeight: 80, width: '100%', marginVertical: 16 },
  caption: { color: '#fff', fontSize: 16, lineHeight: 24, paddingBottom: 8 },
});
