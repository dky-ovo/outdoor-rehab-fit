import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";
import { RFValue } from "react-native-responsive-fontsize";

const MIN_HEIGHT = 48;
const MAX_HEIGHT = 128;

export default function AssistantMessageInput({ value, placeholder, style, onChange, onLayout, onContentSizeChange, ...props }) {
	const [contentHeight, setContentHeight] = useState(MIN_HEIGHT);
	const input = useRef(null);
	const measureWeb = element => {
		if (Platform.OS !== 'web' || !element?.style || !Number.isFinite(element.scrollHeight)) return;
		// A fixed-height textarea otherwise reports its previous scrollHeight
		// while deleting lines. Measure its natural content height, then restore.
		const previous = element.style.height;
		element.style.height = '0px';
		const height = element.scrollHeight + 2; // include the two 1px borders
		element.style.height = previous;
		if (height > 0) setContentHeight(Math.ceil(height));
	};
	// Empty inputs still display a possibly wrapped placeholder. Native content
	// size events include it; do not overwrite that measurement with a fixed reset.
	useEffect(() => { measureWeb(input.current); }, [value, placeholder]);
	return <TextInput {...props} ref={input} value={value} placeholder={placeholder} multiline textAlignVertical="top"
		style={[styles.input, style, { height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, contentHeight)) }]}
		scrollEnabled={contentHeight > MAX_HEIGHT}
		onChange={event => { measureWeb(event.currentTarget || event.target); onChange?.(event); }}
		onLayout={event => { measureWeb(input.current); onLayout?.(event); }}
		onContentSizeChange={event => {
			const height = Number(event.nativeEvent.contentSize?.height);
			if (Number.isFinite(height) && height > 0) setContentHeight(Math.ceil(height));
			onContentSizeChange?.(event);
		}} />;
}

const styles = StyleSheet.create({ input: { flex: 1, minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT, borderWidth: 1, borderColor: "#D8D8D8", borderRadius: 23, paddingHorizontal: 16, paddingVertical: 11, fontSize: RFValue(13), backgroundColor: "#FAFAFA" } });
