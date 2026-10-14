import React, { forwardRef, useEffect, useState } from "react";
import { Text } from "react-native";
import createIconButtonComponent from "@expo/vector-icons/build/vendor/react-native-vector-icons/lib/icon-button";
import { isWebIconFontLoaded, loadWebIconFont, subscribeWebIconFont } from "../utils/webIconFont";

export const DEFAULT_ICON_SIZE = 12;
export const DEFAULT_ICON_COLOR = "black";

// Metro substitutes only the web icon factory. Original Expo exports continue
// to supply their exact glyph maps, font assets and multi-style font names.
export default function createSafeIconSet(glyphMap, fontName, asset, fontStyle = {}) {
	// Start the app's bundled families before navigation mounts its icons.
	if (["ionicons", "material-community", "material", "anticon", "FontAwesome"].includes(fontName)) {
		void loadWebIconFont(fontName, asset, fontStyle);
	}
	const Icon = forwardRef(function SafeWebIcon({ name, size = DEFAULT_ICON_SIZE, color = DEFAULT_ICON_COLOR, style, children, accessibilityLabel, ...props }, ref) {
		const [loaded, setLoaded] = useState(() => isWebIconFontLoaded(fontName, asset, fontStyle));
		useEffect(() => {
			let mounted = true, retry, retries = 0;
			const update = ready => { if (mounted) { setLoaded(ready); if (ready) clearTimeout(retry); } };
			const unsubscribe = subscribeWebIconFont(fontName, asset, fontStyle, update);
			const load = () => { void loadWebIconFont(fontName, asset, fontStyle).then(ready => {
				if (!mounted) return;
				update(ready);
				// Schedule from the failure, not from mount: a slow request may
				// fail long after a startup timer would already have fired.
				if (!ready && retries < 2) { retries++; clearTimeout(retry); retry = setTimeout(load, 2200); }
			}); };
			const online = () => { retries = 0; load(); };
			const visible = () => { if (document.visibilityState === "visible") load(); };
			load();
			window.addEventListener("online", online);
			document.addEventListener("visibilitychange", visible);
			return () => { mounted = false; unsubscribe(); clearTimeout(retry); window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visible); };
		}, []);
		const glyph = glyphMap[name];
		const hasGlyph = typeof glyph === "number" || typeof glyph === "string";
		return <Text {...props} ref={ref} allowFontScaling={props.allowFontScaling ?? false}
			accessibilityLabel={accessibilityLabel || String(name || "icon").replace(/-/g, " ")}
			style={[{ fontSize: size, color, ...fontStyle, width: size, height: size, lineHeight: size, textAlign: "center" }, style,
				{ fontFamily: loaded && hasGlyph ? fontName : "system-ui" }]}
			dataSet={{ ...props.dataSet, iconFont: loaded && hasGlyph ? "loaded" : "pending" }}>
			{loaded && hasGlyph ? (typeof glyph === "number" ? String.fromCodePoint(glyph) : glyph) : "\u2007"}{children}
		</Text>;
	});
	Icon.displayName = `SafeWebIcon(${fontName})`;
	Icon.defaultProps = { size: DEFAULT_ICON_SIZE, color: DEFAULT_ICON_COLOR };
	Icon.glyphMap = glyphMap;
	Icon.font = { [fontName]: asset };
	Icon.getRawGlyphMap = () => glyphMap;
	Icon.getFontFamily = () => fontName;
	Icon.loadFont = () => loadWebIconFont(fontName, asset, fontStyle);
	Icon.Button = createIconButtonComponent(Icon);
	Icon.getImageSource = async (name, size = 12, color = "black") => {
		const loaded = await loadWebIconFont(fontName, asset, fontStyle);
		if (typeof document === "undefined") return null;
		const glyph = glyphMap[name];
		const value = loaded && glyph != null ? (typeof glyph === "number" ? String.fromCodePoint(glyph) : glyph) : "";
		const canvas = document.createElement("canvas");
		const scale = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
		canvas.width = Math.ceil(size * scale); canvas.height = Math.ceil(size * scale);
		const ctx = canvas.getContext("2d");
		if (!ctx) return null;
		ctx.scale(scale, scale); ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.font = `${size}px ${loaded ? JSON.stringify(fontName) : "system-ui"}`;
		ctx.fillText(value, size / 2, size / 2, size);
		return { uri: canvas.toDataURL(), width: size, height: size, scale };
	};
	return Icon;
}
