const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tar = require("tar");
const xcode = require("xcode");
const plist = require("@expo/plist").default;
const plugin = require("../withSessionTimerLiveActivity");
const { TARGET, SOURCES, withExtensionMetadata, configureProject, targetConfigurations } = plugin.__internal;
const root = path.resolve(__dirname, "../..");
const config = () => ({ name: "OUTDOOR-FIT", version: "1.1.0", ios: { bundleIdentifier: "com.polyu.rs.outdoorrehabfit", buildNumber: "37", appleTeamId: "TEAM123" } });
const items = (section) => Object.entries(section || {}).filter(([key, value]) => !key.endsWith("_comment") && value && typeof value === "object");
const unquote = (value) => String(value).replace(/^"|"$/g, "");
const templateChunks = [];
tar.t({ file: path.join(root, "node_modules/expo/template.tgz"), sync: true, onReadEntry: (entry) => {
	if (entry.path === "package/ios/HelloWorld.xcodeproj/project.pbxproj") entry.on("data", (chunk) => templateChunks.push(chunk));
	else entry.resume();
} });
const template = Buffer.concat(templateChunks);
assert.ok(template.length > 1000, "Expo template must contain a real iOS project");
function fixture() {
	const parent = path.join(root, "tmp", "timer-widget-plugin-tests"); fs.mkdirSync(parent, { recursive: true });
	const directory = fs.mkdtempSync(path.join(parent, "case-"));
	const ios = path.join(directory, "ios"); fs.mkdirSync(ios);
	const source = path.join(directory, "modules/session-timer-notification/ios/LiveActivity"); fs.mkdirSync(source, { recursive: true });
	for (const name of SOURCES) fs.writeFileSync(path.join(source, name), `// fixture source ${name}\nimport SwiftUI\n`);
	const file = path.join(ios, "project.pbxproj");
	fs.writeFileSync(file, template);
	const project = xcode.project(file); project.parseSync();
	const app = project.getTarget("com.apple.product-type.application");
	for (const item of targetConfigurations(project, app.target)) Object.assign(item.buildSettings, { IPHONEOS_DEPLOYMENT_TARGET: "15.1", CURRENT_PROJECT_VERSION: "42", MARKETING_VERSION: "1.0.1", DEVELOPMENT_TEAM: "HOSTTEAM" });
	return { directory, ios, source, file, project, app };
}
function widget(project) { return items(project.pbxNativeTargetSection()).find(([, item]) => unquote(item.name) === TARGET); }
function phases(project, target, type) { return target.buildPhases.map((item) => project.hash.project.objects[type]?.[item.value]).filter(Boolean); }
function filePaths(project, phase) { return phase.files.map((item) => unquote(project.pbxFileReferenceSection()[project.pbxBuildFileSection()[item.value].fileRef].path)); }

test("declares EAS signing metadata and main-app live activities without erasing unrelated configuration", () => {
	const original = config(); original.extra = { ownerData: "keep", eas: { projectId: "keep-project", build: { experimental: { ios: { other: "keep", appExtensions: [{ targetName: "ExistingShare", bundleIdentifier: "com.polyu.rs.outdoorrehabfit.share", entitlements: { existing: true } }] } } } } };
	original.ios.infoPlist = { NSCameraUsageDescription: "keep camera" };
	const result = plugin(original);
	assert.equal(result.extra.eas.projectId, "keep-project"); assert.equal(result.extra.ownerData, "keep");
	assert.equal(result.ios.infoPlist.NSCameraUsageDescription, "keep camera"); assert.equal(result.ios.infoPlist.NSSupportsLiveActivities, true);
	assert.equal(result.extra.eas.build.experimental.ios.other, "keep");
	assert.deepEqual(result.extra.eas.build.experimental.ios.appExtensions[1], { targetName: TARGET, bundleIdentifier: "com.polyu.rs.outdoorrehabfit.timer-widget", entitlements: {} });
	withExtensionMetadata(result); assert.equal(result.extra.eas.build.experimental.ios.appExtensions.length, 2);
});

test("invalid bundle identifiers and conflicting extension bundle IDs fail clearly", () => {
	assert.throws(() => plugin({ ios: { bundleIdentifier: "../../bad" } }), /valid ios.bundleIdentifier/);
	const cfg = config(); cfg.extra = { eas: { build: { experimental: { ios: { appExtensions: [{ targetName: "Other", bundleIdentifier: `${cfg.ios.bundleIdentifier}.timer-widget` }] } } } } };
	assert.throws(() => withExtensionMetadata(cfg), /already assigned/);
});

test("adds one extension, two Swift sources, framework links, resources phase and signed embedding", () => {
	const f = fixture(); const hostSettings = JSON.stringify(targetConfigurations(f.project, f.app.target));
	configureProject(f.project, config(), f.directory, f.ios);
	const [id, target] = widget(f.project); const objects = f.project.hash.project.objects;
	assert.equal(unquote(target.productType), "com.apple.product-type.app-extension");
	assert.deepEqual(filePaths(f.project, phases(f.project, target, "PBXSourcesBuildPhase")[0]), SOURCES.map((name) => `${TARGET}/${name}`));
	assert.equal(phases(f.project, target, "PBXResourcesBuildPhase").length, 1);
	assert.equal(phases(f.project, target, "PBXResourcesBuildPhase")[0].files.length, 0, "Info.plist is processed, not copied as a resource");
	assert.deepEqual(filePaths(f.project, phases(f.project, target, "PBXFrameworksBuildPhase")[0]), ["ActivityKit", "WidgetKit", "SwiftUI"].map((name) => `System/Library/Frameworks/${name}.framework`));
	const embeds = phases(f.project, f.app.target, "PBXCopyFilesBuildPhase").filter((phase) => Number(phase.dstSubfolderSpec) === 13);
	assert.equal(embeds.length, 1); assert.deepEqual(filePaths(f.project, embeds[0]), [`${TARGET}.appex`]);
	assert.deepEqual(objects.PBXBuildFile[embeds[0].files[0].value].settings.ATTRIBUTES, ["CodeSignOnCopy", "RemoveHeadersOnCopy"]);
	assert.equal(f.app.target.dependencies.filter((dep) => objects.PBXTargetDependency[dep.value]?.target === id).length, 1);
	assert.equal(JSON.stringify(targetConfigurations(f.project, f.app.target)), hostSettings, "host deployment/signing settings must remain unchanged");
	for (const item of targetConfigurations(f.project, target)) {
		assert.equal(item.buildSettings.IPHONEOS_DEPLOYMENT_TARGET, "16.2"); assert.equal(item.buildSettings.APPLICATION_EXTENSION_API_ONLY, "YES");
		assert.equal(unquote(item.buildSettings.CURRENT_PROJECT_VERSION), "37"); assert.equal(unquote(item.buildSettings.MARKETING_VERSION), "1.1.0");
		assert.equal(item.buildSettings.DEVELOPMENT_TEAM, "TEAM123"); assert.equal(item.buildSettings.SKIP_INSTALL, "YES");
	}
});

test("copied Swift source is identical and generated Info.plist has extension identity/version variables", () => {
	const f = fixture(); configureProject(f.project, config(), f.directory, f.ios);
	for (const name of SOURCES) assert.equal(fs.readFileSync(path.join(f.ios, TARGET, name), "utf8"), fs.readFileSync(path.join(f.source, name), "utf8"));
	const info = plist.parse(fs.readFileSync(path.join(f.ios, TARGET, "Info.plist"), "utf8"));
	assert.equal(info.NSExtension.NSExtensionPointIdentifier, "com.apple.widgetkit-extension");
	assert.equal(info.CFBundlePackageType, "XPC!"); assert.equal(info.CFBundleVersion, "$(CURRENT_PROJECT_VERSION)");
	assert.equal(info.CFBundleShortVersionString, "$(MARKETING_VERSION)"); assert.equal(info.CFBundleIdentifier, "$(PRODUCT_BUNDLE_IDENTIFIER)");
});

test("repeated prebuild is idempotent after writing and reparsing real Expo Xcode project", () => {
	const f = fixture(); configureProject(f.project, config(), f.directory, f.ios);
	const first = f.project.writeSync(); fs.writeFileSync(f.file, first);
	const second = xcode.project(f.file); second.parseSync(); configureProject(second, config(), f.directory, f.ios);
	assert.equal(second.writeSync(), first);
	configureProject(second, config(), f.directory, f.ios); assert.equal(second.writeSync(), first);
	assert.equal(items(second.pbxNativeTargetSection()).filter(([, item]) => unquote(item.name) === TARGET).length, 1);
});

test("build number and signing inherit the matching host configuration when config omits them", () => {
	const f = fixture(); const cfg = config(); delete cfg.ios.buildNumber; delete cfg.ios.appleTeamId;
	configureProject(f.project, cfg, f.directory, f.ios);
	for (const item of targetConfigurations(f.project, widget(f.project)[1])) {
		assert.equal(unquote(item.buildSettings.CURRENT_PROJECT_VERSION), "42"); assert.equal(item.buildSettings.DEVELOPMENT_TEAM, "HOSTTEAM");
	}
});

test("updated version/build values and source contents update only the existing owned extension", () => {
	const f = fixture(); configureProject(f.project, config(), f.directory, f.ios); const id = widget(f.project)[0];
	fs.writeFileSync(path.join(f.source, SOURCES[0]), "// newer shared attributes\n");
	const cfg = config(); cfg.version = "1.2.0"; cfg.ios.buildNumber = "38";
	configureProject(f.project, cfg, f.directory, f.ios);
	assert.equal(widget(f.project)[0], id); assert.equal(fs.readFileSync(path.join(f.ios, TARGET, SOURCES[0]), "utf8"), "// newer shared attributes\n");
	assert.equal(unquote(targetConfigurations(f.project, widget(f.project)[1])[0].buildSettings.CURRENT_PROJECT_VERSION), "38");
});

test("missing Swift source fails before adding a partial Xcode target", () => {
	const f = fixture(); assert.throws(() => configureProject(f.project, config(), path.join(f.directory, "missing"), f.ios), /ENOENT/);
	assert.equal(widget(f.project), undefined);
});

test("extension embeds in the application, not an unrelated first native target", () => {
	const f = fixture(); const objects = f.project.hash.project.objects;
	const otherId = f.project.generateUuid();
	objects.PBXNativeTarget[otherId] = { ...f.app.target, name: '"UnrelatedTests"', productType: '"com.apple.product-type.bundle.unit-test"', buildPhases: [], dependencies: [] };
	objects.PBXNativeTarget[`${otherId}_comment`] = "UnrelatedTests";
	f.project.getFirstProject().firstProject.targets.unshift({ value: otherId, comment: "UnrelatedTests" });
	configureProject(f.project, config(), f.directory, f.ios);
	assert.equal(phases(f.project, objects.PBXNativeTarget[otherId], "PBXCopyFilesBuildPhase").length, 0);
	assert.equal(phases(f.project, f.app.target, "PBXCopyFilesBuildPhase").length, 1);
	assert.equal(objects.PBXNativeTarget[otherId].dependencies.length, 0);
});

test("Expo mod compiler replays the real generated iOS project and current Swift sources twice", async () => {
	const f = fixture();
	tar.x({ file: path.join(root, "node_modules/expo/template.tgz"), cwd: f.directory, sync: true, strip: 1,
		filter: (entryPath) => entryPath.startsWith("package/ios/") });
	for (const name of SOURCES) fs.copyFileSync(path.join(root, "modules/session-timer-notification/ios/LiveActivity", name), path.join(f.source, name));
	const { compileModsAsync } = require("@expo/config-plugins");
	await compileModsAsync(plugin(config()), { projectRoot: f.directory, platforms: ["ios"] });
	const generated = path.join(f.ios, "HelloWorld.xcodeproj/project.pbxproj");
	const first = fs.readFileSync(generated, "utf8");
	await compileModsAsync(plugin(config()), { projectRoot: f.directory, platforms: ["ios"] });
	assert.equal(fs.readFileSync(generated, "utf8"), first);
	const info = plist.parse(fs.readFileSync(path.join(f.ios, "HelloWorld/Info.plist"), "utf8"));
	assert.equal(info.NSSupportsLiveActivities, true);
	for (const name of SOURCES) assert.equal(fs.readFileSync(path.join(f.ios, TARGET, name), "utf8"), fs.readFileSync(path.join(root, "modules/session-timer-notification/ios/LiveActivity", name), "utf8"));
	console.log(`Verified iOS prebuild fixture: ${f.directory}`);
});
