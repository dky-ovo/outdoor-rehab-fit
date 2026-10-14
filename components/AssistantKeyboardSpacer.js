import React from "react";
import { View } from "react-native";

// Web uses visualViewport; iOS uses KeyboardAvoidingView. Keep the same body
// hierarchy without loading Android's Activity-wide window-insets controller.
export default function AssistantKeyboardSpacer({ children }) {
	return <View style={{ flex: 1 }}>{children}</View>;
}
