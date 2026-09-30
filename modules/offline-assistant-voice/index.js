import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Optional native answer playback only; never acquire microphone access here.
// Retain the module name so the existing reply reader stays compatible.
export default ['android', 'ios'].includes(Platform.OS)
  ? requireOptionalNativeModule('OfflineAssistantVoice')
  : null;
