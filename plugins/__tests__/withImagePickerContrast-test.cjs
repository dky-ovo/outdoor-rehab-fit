const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tar = require('tar');
const xml2js = require('xml2js');
const plugin = require('../withImagePickerContrast');
const { CROP_ACTIVITY, CROP_THEME, THEME_ITEMS, configureStyles, configureManifest, configureApplication } = plugin.__internal;
const root = path.resolve(__dirname, '../..');
const template = new Map();
tar.t({ file: path.join(root, 'node_modules/expo/template.tgz'), sync: true, onReadEntry(entry) {
  if (['/MainApplication.kt', '/main/res/values/styles.xml', '/main/AndroidManifest.xml'].some((suffix) => entry.path.endsWith(suffix))) {
    const chunks = []; entry.on('data', (chunk) => chunks.push(chunk));
    entry.on('end', () => template.set(entry.path.split('/').at(-1), Buffer.concat(chunks).toString('utf8')));
  } else entry.resume();
} });
const parse = (source) => new xml2js.Parser().parseStringPromise(source);
const clone = (value) => JSON.parse(JSON.stringify(value));

test('the dedicated crop theme has dark toolbar and white back, rotate, crop and action text', async () => {
  const source = await parse(template.get('styles.xml'));
  const originalThemes = clone(source.resources.style);
  const output = configureStyles(source);
  const crop = output.resources.style.find((style) => style.$.name === CROP_THEME);
  assert.equal(crop.$.parent, 'Base.Theme.AppCompat');
  assert.deepEqual(Object.fromEntries(crop.item.map((item) => [item.$.name, item._])), THEME_ITEMS);
  assert.equal(THEME_ITEMS.expoCropToolbarColor, '#222222');
  for (const key of ['expoCropToolbarIconColor', 'expoCropToolbarActionTextColor', 'expoCropBackButtonIconColor']) {
    assert.equal(THEME_ITEMS[key], '#FFFFFF');
  }
  assert.equal(THEME_ITEMS['android:windowLightStatusBar'], 'false');
  assert.equal(THEME_ITEMS['android:windowLightNavigationBar'], 'false');
  assert.deepEqual(output.resources.style.filter((style) => style.$.name !== CROP_THEME), originalThemes);
  assert.deepEqual(configureStyles(output), output);
  assert.equal(output.resources.style.filter((style) => style.$.name === CROP_THEME).length, 1);
});

test('manifest merging affects only the crop activity and keeps existing entries and merge flags', async () => {
  const source = await parse(template.get('AndroidManifest.xml'));
  const app = source.manifest.application[0];
  const originalActivities = clone(app.activity);
  app.activity.push({ $: { 'android:name': CROP_ACTIVITY, 'android:exported': 'false',
    'android:screenOrientation': 'portrait', 'tools:replace': 'android:exported' } });
  const output = configureManifest(source);
  const crop = output.manifest.application[0].activity.find((activity) => activity.$['android:name'] === CROP_ACTIVITY);
  assert.equal(crop.$['android:theme'], `@style/${CROP_THEME}`);
  assert.equal(crop.$['android:exported'], 'false');
  assert.equal(crop.$['android:screenOrientation'], 'portrait');
  assert.equal(crop.$['tools:replace'], 'android:exported,android:theme');
  assert.equal(output.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  assert.deepEqual(output.manifest.application[0].activity.filter((activity) => activity !== crop), originalActivities);
  assert.deepEqual(configureManifest(clone(output)), output);
});

test('a fresh manifest declares one non-exported crop override without changing application theme', async () => {
  const source = await parse(template.get('AndroidManifest.xml'));
  const originalApplication = clone(source.manifest.application[0].$);
  configureManifest(source); configureManifest(source);
  assert.deepEqual(source.manifest.application[0].$, originalApplication);
  const crops = source.manifest.application[0].activity.filter((activity) => activity.$['android:name'] === CROP_ACTIVITY);
  assert.equal(crops.length, 1);
  assert.equal(crops[0].$['android:exported'], 'false');
});

test('real Expo Kotlin template gets one lifecycle contrast correction only for the crop screen', () => {
  const original = template.get('MainApplication.kt');
  assert.ok(original.includes('super.onCreate()'));
  const result = configureApplication(original, 'kt');
  assert.equal(configureApplication(result, 'kt'), result);
  assert.equal((result.match(/registerActivityLifecycleCallbacks/g) || []).length, 1);
  assert.match(result, /if \(activity\.javaClass\.name != "expo\.modules\.imagepicker\.ExpoCropImageActivity"\) return/);
  assert.match(result, /isAppearanceLightStatusBars = false/);
  assert.match(result, /isAppearanceLightNavigationBars = false/);
  assert.ok(result.indexOf('super.onCreate()') < result.indexOf('registerActivityLifecycleCallbacks'));
  // Apart from the generated block, Expo application initialization is untouched.
  const restored = result.replace(/\/\/ @generated begin outdoor-fit-crop-contrast[^\n]*\n[\s\S]*?\/\/ @generated end outdoor-fit-crop-contrast\n/, '');
  assert.equal(restored, original);
  assert.doesNotMatch(result, /setDefaultNightMode|setLocalNightMode|requestPermissions|FLAG_FULLSCREEN/);
});

test('Java applications are supported without imports or duplicate registration', () => {
  const original = 'class MainApplication extends android.app.Application {\n  @Override public void onCreate() {\n    super.onCreate();\n    existingInitialization();\n  }\n}\n';
  const result = configureApplication(original, 'java');
  assert.equal(configureApplication(result, 'java'), result);
  assert.match(result, /getClass\(\)\.getName\(\)\.equals\("expo.modules.imagepicker.ExpoCropImageActivity"\)/);
  assert.match(result, /setAppearanceLightStatusBars\(false\)/);
  assert.match(result, /existingInitialization\(\);/);
  assert.equal((result.match(/registerActivityLifecycleCallbacks/g) || []).length, 1);
});

test('unsupported or unexpected application templates fail instead of silently skipping contrast', () => {
  assert.throws(() => configureApplication('unrelated source', 'swift'), /Kotlin or Java/);
  assert.throws(() => configureApplication('class MainApplication {}', 'kt'), /Failed to match/);
});

test('plugin registers only Android mods and preserves other platform settings', () => {
  const config = { name: 'OUTDOOR-FIT', slug: 'test', ios: { infoPlist: { untouched: true } }, android: { permissions: ['CAMERA'] } };
  const result = plugin(config);
  assert.deepEqual(result.ios, { infoPlist: { untouched: true } });
  assert.deepEqual(result.android.permissions, ['CAMERA']);
  assert.deepEqual(Object.keys(result.mods.android).sort(), ['mainApplication', 'manifest', 'styles']);
  assert.equal(result.mods.ios, undefined);
});

test('installed ImagePicker exposes all palette attributes used by the crop-only theme', () => {
  const file = path.join(root, 'node_modules/expo-image-picker/android/src/main/java/expo/modules/imagepicker/ExpoCropImageUtils.kt');
  const source = fs.readFileSync(file, 'utf8');
  for (const key of Object.keys(THEME_ITEMS).filter((item) => item.startsWith('expoCrop'))) {
    assert.ok(source.includes(`R.attr.${key}`), `${key} must be an actual installed ImagePicker attribute`);
  }
});
