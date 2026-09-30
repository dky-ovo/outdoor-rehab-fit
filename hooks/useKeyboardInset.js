import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

/**
 * Returns only the part of the software keyboard that still overlaps the app.
 * Android devices differ: some resize the window while others overlay it.  By
 * subtracting the actual window resize, the same screen works in both modes
 * without adding the keyboard height twice.
 */
export function useKeyboardInset() {
	const baselineHeight = useRef(Dimensions.get("window").height);
	const keyboardHeight = useRef(0);
	const [state, setState] = useState({ visible: false, inset: 0 });

	useEffect(() => {
		const update = () => {
			const currentHeight = Dimensions.get("window").height;
			const resizedBy = Math.max(0, baselineHeight.current - currentHeight);
			const inset = Platform.OS === "android" ? Math.max(0, keyboardHeight.current - resizedBy) : 0;
			setState({ visible: keyboardHeight.current > 0, inset });
		};
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
		const show = Keyboard.addListener(showEvent, (event) => {
			keyboardHeight.current = Math.max(0, Number(event.endCoordinates?.height) || 0);
			requestAnimationFrame(update);
		});
		const hide = Keyboard.addListener(hideEvent, () => {
			keyboardHeight.current = 0;
			baselineHeight.current = Math.max(baselineHeight.current, Dimensions.get("window").height);
			setState({ visible: false, inset: 0 });
		});
		const dimensions = Dimensions.addEventListener("change", ({ window }) => {
			if (!keyboardHeight.current) baselineHeight.current = Math.max(baselineHeight.current, window.height);
			update();
		});
		return () => { show.remove(); hide.remove(); dimensions.remove(); };
	}, []);

	return state;
}
