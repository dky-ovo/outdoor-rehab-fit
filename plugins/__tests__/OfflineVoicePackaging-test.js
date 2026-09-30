const { configureAppGradle } = require('../withOfflineVoicePackaging');
test('adds noCompress to the application and verifies the produced APK', () => {
  const base = "apply plugin: 'com.android.application'\nandroid { defaultConfig { versionCode 1 } }\n";
  const modified = configureAppGradle(base);
  expect(modified).toContain("noCompress += ['onnx']");
  expect(modified).toContain("task.name == 'assembleRelease' || task.name == 'assembleDebug'");
  expect(modified).toContain('model.method != java.util.zip.ZipEntry.STORED');
  expect(modified).toContain('model.size != 239233841L');
  expect(modified).toContain(base.trim());
  expect(configureAppGradle(modified)).toBe(modified);
});
test('refuses an incomplete marker or unknown DSL instead of silently dropping model checks', () => {
  expect(() => configureAppGradle('// BEGIN outdoor-fit offline model packaging')).toThrow(/Incomplete/);
  expect(() => configureAppGradle('android {}', 'kotlin')).toThrow(/non-Groovy/);
});
