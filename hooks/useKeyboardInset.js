import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform, StatusBar } from "react-native";

/**
 * Attach containerRef/onLayout to the outer, unpadded native View when possible.
 * Android measurement and keyboard.screenY have different origins on RN 0.81.
 * Compare CLOSED/current measurements with each other, never with screenY.
 * Web uses visualViewport and DOM rectangles. iOS stays with KeyboardAvoidingView.
 */
export function useKeyboardInset({ nativeAndroid = false } = {}) {
	const containerRef = useRef(null);
	const baseline = useRef(Dimensions.get("window"));
	const closedBottom = useRef(null);
	const frame = useRef(Keyboard.metrics?.() || null);
	const sequence = useRef(0);
	const alive = useRef(false);
	const [state, setState] = useState({ visible: Boolean(Keyboard.isVisible?.()), inset: 0 });
	const webUpdate = useRef(null);
	const update = useCallback(() => {
		if (nativeAndroid && Platform.OS === "android") return;
		if (Platform.OS === 'web') { webUpdate.current?.(); return; }
		const revision = ++sequence.current;
		const metrics = frame.current;
		const visible = Boolean(metrics && metrics.height > 0);
		const commit = inset => {
			if (!alive.current || revision !== sequence.current) return;
			const next = { visible, inset: visible && Platform.OS === "android" ? Math.max(0, Math.round(inset)) : 0 };
			setState(previous => previous.visible === next.visible && previous.inset === next.inset ? previous : next);
		};
		const current = Dimensions.get("window");
		if (!visible || Platform.OS !== "android") {
			commit(0);
			if (!visible && Platform.OS === 'android' && current.height >= baseline.current.height && containerRef.current?.measureInWindow) {
				containerRef.current.measureInWindow((_x, y, _width, height) => {
					if (alive.current && revision === sequence.current && height > 0 && Number.isFinite(y)) {
						const previous = closedBottom.current?.width === current.width ? closedBottom.current.bottom : 0;
						// onLayout can shrink before keyboardDidShow/Dimensions update.
						// Do not misclassify that resized sample as the closed baseline.
						closedBottom.current = { width: current.width, bottom: Math.max(previous, y + height) };
					}
				});
			}
			return;
		}
		const fallback = Math.max(0, metrics.height - Math.max(0, baseline.current.height - current.height));
		if (containerRef.current?.measureInWindow && closedBottom.current?.width === current.width) {
			containerRef.current.measureInWindow((_x, y, _width, height) => {
				// Window resize notifications can lead the actual View layout or
				// describe another native layer. Only the measured View movement
				// proves this composer is already above the keyboard; otherwise
				// subtracting window shrink would remove its needed padding.
				const removed = Math.max(0, closedBottom.current.bottom - (y + height));
				commit(height > 0 && Number.isFinite(height) && Number.isFinite(y) ? Math.max(0, metrics.height - removed) : fallback);
			});
		} else commit(fallback);
	}, [nativeAndroid]);
	useEffect(() => {
		alive.current = true;
		// The chat uses native IME frames. Do not measure or re-render its long
		// history through this older JS resize path at the same time.
		if (nativeAndroid && Platform.OS === "android") return () => { alive.current = false; };
		if (Platform.OS === 'web') {
			const win = globalThis.window;
			const viewport = win?.visualViewport;
			let closedHeight = viewport?.height || win?.innerHeight || 0;
			let viewportWidth = viewport?.width || win?.innerWidth || 0;
			const refresh = () => {
				const element = globalThis.document?.activeElement;
				const focused = ['INPUT', 'TEXTAREA'].includes(element?.tagName) || element?.isContentEditable;
				const viewportHeight = viewport?.height || win?.innerHeight || 0;
				const width = viewport?.width || win?.innerWidth || 0;
				if (width !== viewportWidth) { closedHeight = viewportHeight; viewportWidth = width; }
				if (!focused) closedHeight = Math.max(closedHeight, viewportHeight);
				const bottom = viewportHeight + (viewport?.offsetTop || 0);
				const rect = containerRef.current?.getBoundingClientRect?.();
				const overlap = Math.max(0, (rect?.bottom ?? win?.innerHeight ?? bottom) - bottom);
				// Browser toolbar/zoom changes alone are not an on-screen keyboard.
				const visible = Boolean(viewport && focused && Math.abs((viewport.scale || 1) - 1) < 0.05 && (closedHeight - viewportHeight > 100 || overlap > 100));
				const next = { visible, inset: visible ? Math.round(overlap) : 0 };
				if (alive.current) setState(previous => previous.visible === next.visible && previous.inset === next.inset ? previous : next);
			};
			webUpdate.current = refresh;
			viewport?.addEventListener?.('resize', refresh); viewport?.addEventListener?.('scroll', refresh);
			win?.addEventListener?.('resize', refresh);
			globalThis.document?.addEventListener?.('focusin', refresh); globalThis.document?.addEventListener?.('focusout', refresh);
			refresh();
			return () => {
				alive.current = false; webUpdate.current = null;
				viewport?.removeEventListener?.('resize', refresh); viewport?.removeEventListener?.('scroll', refresh);
				win?.removeEventListener?.('resize', refresh);
				globalThis.document?.removeEventListener?.('focusin', refresh); globalThis.document?.removeEventListener?.('focusout', refresh);
			};
		}
		const resetVisibleBaseline = window => {
			// On a first mount/rotation with IME already open there is no closed
			// View sample. Screen dimensions and screenY share screen coordinates;
			// remove system bars before estimating the native window resize.
			const metrics = frame.current, screen = Dimensions.get('screen');
			const bottomBar = Number.isFinite(metrics?.screenY) ? Math.max(0, screen.height - metrics.screenY - metrics.height) : 0;
			const resize = metrics ? Math.min(metrics.height, Math.max(0, screen.height - window.height - (StatusBar.currentHeight || 0) - bottomBar)) : 0;
			baseline.current = { ...window, height: window.height + resize }; closedBottom.current = null;
		};
		if (frame.current && Platform.OS === 'android') resetVisibleBaseline(Dimensions.get('window'));
		const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", event => {
			frame.current = event.endCoordinates || Keyboard.metrics?.() || null;
			update();
		});
		const change = Keyboard.addListener("keyboardDidChangeFrame", event => {
			frame.current = event.endCoordinates || null;
			update();
		});
		const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
			frame.current = null;
			update();
		});
		const dimensions = Dimensions.addEventListener("change", ({ window }) => {
			// A resize can arrive BEFORE keyboardDidShow. Keep the closed height
			// for legacy callers without a measurement ref, but reset on rotation.
			if (frame.current && Keyboard.metrics?.()) frame.current = Keyboard.metrics();
			if (window.width !== baseline.current.width) resetVisibleBaseline(window);
			else if (!frame.current && window.height >= baseline.current.height) baseline.current = window;
			update();
		});
		update();
		return () => { alive.current = false; sequence.current += 1; show.remove(); change.remove(); hide.remove(); dimensions.remove(); };
	}, [update]);
	return { ...state, containerRef, onLayout: update };
}
