const fs = require("fs");
const path = require("path");
const plist = require("@expo/plist").default;
const { withInfoPlist, withXcodeProject } = require("@expo/config-plugins");

const TARGET = "OutdoorFitTimerWidget";
const SOURCES = ["OutdoorFitTimerAttributes.swift", "OutdoorFitTimerWidget.swift"];
const unquote = (value) => String(value ?? "").replace(/^"|"$/g, "");
const entries = (section) => Object.entries(section || {}).filter(([key, value]) => !key.endsWith("_comment") && value && typeof value === "object");
const quote = (value) => JSON.stringify(String(value));

function extensionBundleIdentifier(config) {
	const identifier = config.ios?.bundleIdentifier;
	if (typeof identifier !== "string" || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(identifier)) {
		throw new Error("Timer Live Activity requires a valid ios.bundleIdentifier.");
	}
	return `${identifier}.timer-widget`;
}

// EAS reads this before native prebuild so the additional target can be signed.
// No App Group or push entitlement is needed for locally updated Live Activities.
function withExtensionMetadata(config) {
	const bundleIdentifier = extensionBundleIdentifier(config);
	const extra = config.extra || {}; const eas = extra.eas || {}; const build = eas.build || {};
	const experimental = build.experimental || {}; const ios = experimental.ios || {};
	const extensions = ios.appExtensions || [];
	if (!Array.isArray(extensions)) throw new Error("extra.eas.build.experimental.ios.appExtensions must be an array.");
	const existing = extensions.find((item) => item.targetName === TARGET);
	if (extensions.some((item) => item.targetName !== TARGET && item.bundleIdentifier === bundleIdentifier)) {
		throw new Error(`The timer widget bundle identifier is already assigned to another extension: ${bundleIdentifier}`);
	}
	const descriptor = { ...existing, targetName: TARGET, bundleIdentifier, entitlements: existing?.entitlements || {} };
	config.extra = { ...extra, eas: { ...eas, build: { ...build, experimental: { ...experimental, ios: {
		...ios, appExtensions: [...extensions.filter((item) => item.targetName !== TARGET), descriptor],
	} } } } };
	config.ios = { ...config.ios, infoPlist: { ...config.ios?.infoPlist, NSSupportsLiveActivities: true } };
	return config;
}

function putObject(project, sectionName, object, comment) {
	const section = project.hash.project.objects[sectionName] ||= {};
	const id = project.generateUuid(); section[id] = object; section[`${id}_comment`] = comment;
	return id;
}

function targetConfigurations(project, target) {
	const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
	return (list?.buildConfigurations || []).map((item) => project.pbxXCBuildConfigurationSection()[item.value]).filter(Boolean);
}

function ensurePhase(project, target, type, label) {
	const section = project.hash.project.objects[type] || {};
	const existing = target.buildPhases.find((item) => section[item.value]);
	if (existing) return section[existing.value];
	const id = putObject(project, type, { isa: type, buildActionMask: 2147483647, files: [], runOnlyForDeploymentPostprocessing: 0 }, label);
	target.buildPhases.push({ value: id, comment: label });
	return project.hash.project.objects[type][id];
}

function ensureFile(project, group, filePath, type, sourceTree = '"<group>"') {
	const references = project.pbxFileReferenceSection();
	let match = entries(references).find(([, item]) => unquote(item.path) === filePath && item.sourceTree === sourceTree);
	if (!match) {
		const id = putObject(project, "PBXFileReference", { isa: "PBXFileReference", lastKnownFileType: type,
			name: quote(path.posix.basename(filePath)), path: quote(filePath), sourceTree }, path.posix.basename(filePath));
		match = [id, references[id]];
	}
	if (!group.children.some((item) => item.value === match[0])) group.children.push({ value: match[0], comment: path.posix.basename(filePath) });
	return match[0];
}

function ensureBuildFile(project, phase, fileRef, comment, settings) {
	const buildFiles = project.pbxBuildFileSection();
	const existing = phase.files.find((item) => buildFiles[item.value]?.fileRef === fileRef);
	if (existing) {
		if (settings) buildFiles[existing.value].settings = { ...buildFiles[existing.value].settings, ...settings };
		return;
	}
	const id = putObject(project, "PBXBuildFile", { isa: "PBXBuildFile", fileRef, fileRef_comment: comment, ...(settings ? { settings } : {}) }, comment);
	phase.files.push({ value: id, comment });
}

function writeIfChanged(file, contents) {
	if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) fs.writeFileSync(file, contents, "utf8");
}

function extensionPlist() {
	return { CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)", CFBundleDisplayName: "OUTDOOR-FIT Timer",
		CFBundleExecutable: "$(EXECUTABLE_NAME)", CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
		CFBundleInfoDictionaryVersion: "6.0", CFBundleName: "$(PRODUCT_NAME)", CFBundlePackageType: "XPC!",
		CFBundleShortVersionString: "$(MARKETING_VERSION)", CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
		NSExtension: { NSExtensionPointIdentifier: "com.apple.widgetkit-extension" } };
}

function configureProject(project, config, projectRoot, iosRoot) {
	const bundleIdentifier = extensionBundleIdentifier(config);
	const objects = project.hash.project.objects;
	const app = project.getTarget("com.apple.product-type.application");
	if (!app) throw new Error("Timer Live Activity could not find the iOS application target.");
	const sourceRoot = path.join(projectRoot, "modules", "session-timer-notification", "ios", "LiveActivity");
	const sourceContents = SOURCES.map((name) => fs.readFileSync(path.join(sourceRoot, name), "utf8"));
	const output = path.join(iosRoot, TARGET);
	fs.mkdirSync(output, { recursive: true });
	SOURCES.forEach((name, index) => writeIfChanged(path.join(output, name), sourceContents[index]));
	writeIfChanged(path.join(output, "Info.plist"), plist.build(extensionPlist()));

	let found = entries(project.pbxNativeTargetSection()).find(([, target]) => unquote(target.name) === TARGET);
	if (found && unquote(found[1].productType) !== "com.apple.product-type.app-extension") {
		throw new Error(`${TARGET} already exists but is not an app-extension target.`);
	}
	if (!found) {
		// Construct the target explicitly instead of xcode.addTarget(), which embeds
		// into the first target and can attach an extension to a test target.
		const configurations = project.addXCConfigurationList(["Debug", "Release"].map((name) => ({ isa: "XCBuildConfiguration", name, buildSettings: {} })), "Release", `Build configuration list for PBXNativeTarget "${TARGET}"`);
		const productRef = putObject(project, "PBXFileReference", { isa: "PBXFileReference", explicitFileType: "wrapper.app-extension", includeInIndex: 0, path: quote(`${TARGET}.appex`), sourceTree: "BUILT_PRODUCTS_DIR" }, `${TARGET}.appex`);
		const target = { isa: "PBXNativeTarget", buildConfigurationList: configurations.uuid, buildPhases: [], buildRules: [], dependencies: [],
			name: quote(TARGET), productName: quote(TARGET), productReference: productRef, productType: quote("com.apple.product-type.app-extension") };
		const id = putObject(project, "PBXNativeTarget", target, TARGET);
		project.getFirstProject().firstProject.targets.push({ value: id, comment: TARGET });
		found = [id, target];
		const products = project.pbxGroupByName("Products") || project.getPBXGroupByKey(project.getFirstProject().firstProject.productRefGroup);
		if (!products) throw new Error("Timer Live Activity could not find the Xcode Products group.");
		products.children.push({ value: productRef, comment: `${TARGET}.appex` });
	}
	const [targetId, target] = found;
	const hostConfigurations = targetConfigurations(project, app.target);
	for (const configuration of targetConfigurations(project, target)) {
		const host = hostConfigurations.find((item) => unquote(item.name) === unquote(configuration.name))?.buildSettings || hostConfigurations[0]?.buildSettings || {};
		Object.assign(configuration.buildSettings, {
			APPLICATION_EXTENSION_API_ONLY: "YES", CLANG_ENABLE_MODULES: "YES", CODE_SIGN_STYLE: "Automatic", GENERATE_INFOPLIST_FILE: "NO",
			INFOPLIST_FILE: quote(`${TARGET}/Info.plist`), IPHONEOS_DEPLOYMENT_TARGET: "16.2", SDKROOT: "iphoneos",
			PRODUCT_BUNDLE_IDENTIFIER: quote(bundleIdentifier), PRODUCT_NAME: quote(TARGET), SKIP_INSTALL: "YES", SWIFT_VERSION: "5.0",
			SUPPORTED_PLATFORMS: quote("iphoneos iphonesimulator"), TARGETED_DEVICE_FAMILY: host.TARGETED_DEVICE_FAMILY || quote("1,2"),
			LD_RUNPATH_SEARCH_PATHS: quote("$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"),
			MARKETING_VERSION: quote(config.ios?.version || config.version || unquote(host.MARKETING_VERSION) || "1.0.0"),
			CURRENT_PROJECT_VERSION: quote(config.ios?.buildNumber || unquote(host.CURRENT_PROJECT_VERSION) || "1"),
			...(config.ios?.appleTeamId || host.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: config.ios?.appleTeamId || host.DEVELOPMENT_TEAM } : {}),
		});
	}
	const firstProject = project.getFirstProject().firstProject;
	const mainGroup = project.getPBXGroupByKey(firstProject.mainGroup);
	let groupEntry = entries(objects.PBXGroup).find(([, group]) => unquote(group.name) === TARGET);
	if (!groupEntry) {
		const id = putObject(project, "PBXGroup", { isa: "PBXGroup", children: [], name: TARGET, sourceTree: '"<group>"' }, TARGET);
		groupEntry = [id, objects.PBXGroup[id]];
	}
	if (!mainGroup.children.some((item) => item.value === groupEntry[0])) mainGroup.children.push({ value: groupEntry[0], comment: TARGET });
	const group = groupEntry[1];
	const sources = ensurePhase(project, target, "PBXSourcesBuildPhase", "Sources");
	const frameworks = ensurePhase(project, target, "PBXFrameworksBuildPhase", "Frameworks");
	ensurePhase(project, target, "PBXResourcesBuildPhase", "Resources");
	for (const name of SOURCES) ensureBuildFile(project, sources, ensureFile(project, group, `${TARGET}/${name}`, "sourcecode.swift"), `${name} in Sources`);
	ensureFile(project, group, `${TARGET}/Info.plist`, "text.plist.xml");
	for (const name of ["ActivityKit", "WidgetKit", "SwiftUI"]) {
		const ref = ensureFile(project, group, `System/Library/Frameworks/${name}.framework`, "wrapper.framework", "SDKROOT");
		ensureBuildFile(project, frameworks, ref, `${name}.framework in Frameworks`);
	}
	objects.PBXTargetDependency ||= {}; objects.PBXContainerItemProxy ||= {};
	if (!(app.target.dependencies || []).some((item) => objects.PBXTargetDependency[item.value]?.target === targetId)) project.addTargetDependency(app.uuid, [targetId]);
	let embed = app.target.buildPhases.map((item) => objects.PBXCopyFilesBuildPhase?.[item.value])
		.find((phase) => phase && Number(phase.dstSubfolderSpec) === 13 && unquote(phase.name) === "Embed App Extensions");
	if (!embed) embed = project.addBuildPhase([], "PBXCopyFilesBuildPhase", "Embed App Extensions", app.uuid, "app_extension").buildPhase;
	ensureBuildFile(project, embed, target.productReference, `${TARGET}.appex in Embed App Extensions`, { ATTRIBUTES: ["CodeSignOnCopy", "RemoveHeadersOnCopy"] });
	return project;
}

function withSessionTimerLiveActivity(config) {
	config = withExtensionMetadata(config);
	config = withInfoPlist(config, (mod) => { mod.modResults.NSSupportsLiveActivities = true; return mod; });
	return withXcodeProject(config, (mod) => {
		configureProject(mod.modResults, mod, mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
		return mod;
	});
}

module.exports = withSessionTimerLiveActivity;
module.exports.__internal = { TARGET, SOURCES, extensionBundleIdentifier, withExtensionMetadata, configureProject, extensionPlist, targetConfigurations };
