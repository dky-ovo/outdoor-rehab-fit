const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// QA exports, deployment copies and document-conversion profiles are not app
// modules. Do not crawl them (some profiles have restrictive Windows ACLs).
const escapedRoot = __dirname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const previousBlocks = config.resolver.blockList ? [config.resolver.blockList].flat() : [];
config.resolver.blockList = [...previousBlocks, new RegExp(`${escapedRoot}[/\\\\](?:tmp|workspace-artifacts|deploy)[/\\\\].*`)];
config.resolver.resolveRequest = (context, moduleName, platform) => {
	const origin = String(context.originModulePath || "").replace(/\\/g, "/");
	if (platform === "web" && ((moduleName === "./createIconSet" && origin.includes("/node_modules/@expo/vector-icons/build/")) || moduleName === "@expo/vector-icons/build/createIconSet")) {
		return { type: "sourceFile", filePath: path.join(__dirname, "components/createSafeIconSet.web.js") };
	}
	if (platform === "web" && moduleName === "react-native-web-webview") {
		return { type: "sourceFile", filePath: path.join(__dirname, "components/YoutubeWebView.web.js") };
	}
	return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
