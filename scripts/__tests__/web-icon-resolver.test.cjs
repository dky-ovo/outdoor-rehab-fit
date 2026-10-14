const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const configModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'metro.config.js'), 'utf8'), {
  __dirname: root, module: configModule,
  require: name => name === 'expo/metro-config' ? { getDefaultConfig: () => ({ resolver: {} }) } : require(name),
});
const resolve = configModule.exports.resolver.resolveRequest;

test('only web Expo factory uses the safe implementation; native and other relative imports delegate', () => {
  let calls = 0;
  const context = { originModulePath: path.join(root, 'node_modules/@expo/vector-icons/build/Ionicons.js'), resolveRequest: () => { calls++; return 'original'; } };
  assert.equal(resolve(context, './createIconSet', 'web').filePath, path.join(root, 'components/createSafeIconSet.web.js'));
  assert.equal(resolve(context, './createIconSet', 'android'), 'original');
  assert.equal(resolve(context, './createIconSet', 'ios'), 'original');
  assert.equal(resolve(context, './createIconSet', undefined), 'original');
  context.originModulePath = path.join(root, 'components/unrelated.js');
  assert.equal(resolve(context, './createIconSet', 'web'), 'original');
  assert.equal(calls, 4);
});

test('existing YouTube web bridge and public icon imports preserve their resolver paths', () => {
  const context = { resolveRequest: (_context, name) => name };
  assert.equal(resolve(context, 'react-native-web-webview', 'web').filePath, path.join(root, 'components/YoutubeWebView.web.js'));
  assert.equal(resolve(context, '@expo/vector-icons', 'web'), '@expo/vector-icons');
  assert.equal(resolve(context, '@expo/vector-icons/Ionicons', 'web'), '@expo/vector-icons/Ionicons');
});
