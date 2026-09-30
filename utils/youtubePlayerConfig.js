import { Platform } from "react-native";

// Native builds retain their existing native WebView and remote player HTML.
export const YOUTUBE_PLAYER_PLATFORM_PROPS = Platform.OS === "web" ? { useLocalHTML: true } : {};
