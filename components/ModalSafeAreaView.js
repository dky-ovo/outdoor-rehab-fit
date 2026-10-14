import React from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// Native Modals have their own window/frame. Measure inside that root instead
// of reusing the presenting navigation screen's insets (especially on rotation).
// Native SafeAreaView applies padding without waiting for a JS inset rerender.
export default function ModalSafeAreaView(props) {
  return <SafeAreaProvider><SafeAreaView {...props} edges={['top', 'right', 'bottom', 'left']} /></SafeAreaProvider>;
}
