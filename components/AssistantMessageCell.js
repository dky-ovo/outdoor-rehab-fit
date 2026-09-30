import React, { createContext, useContext } from "react";
import { View } from "react-native";

export const AssistantReplyLayoutContext = createContext(null);

// Stable component type: do not remount virtualized rows on every expansion.
// Notify the reader only AFTER VirtualizedList records this cell's new height.
export default function AssistantMessageCell({ item, children, style, onLayout, onFocusCapture }) {
  const onReplyMeasured = useContext(AssistantReplyLayoutContext);
  return <View testID={`assistant-message-cell-${item?.id}`} style={style} onFocusCapture={onFocusCapture}
    onLayout={(event) => {
      onLayout?.(event);
      onReplyMeasured?.(item?.id);
    }}>{children}</View>;
}
