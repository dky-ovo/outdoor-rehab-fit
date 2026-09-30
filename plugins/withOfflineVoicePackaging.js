const { withAppBuildGradle } = require('@expo/config-plugins');

const BEGIN = '// BEGIN outdoor-fit offline model packaging';
const END = '// END outdoor-fit offline model packaging';
const BLOCK = `${BEGIN}
// Library noCompress does NOT propagate into the final APK. Set it on :app.
android {
    androidResources {
        noCompress += ['onnx']
    }
}

// Check the actual APK, not only the source Gradle configuration. Fail the
// release rather than distributing a compressed 239 MB model again.
tasks.configureEach { task ->
    if (task.name == 'assembleRelease' || task.name == 'assembleDebug') {
        task.doLast {
            def variant = task.name == 'assembleRelease' ? 'release' : 'debug'
            def apkRoot = layout.buildDirectory.dir("outputs/apk/" + variant).get().asFile
            def apks = fileTree(apkRoot).matching { include '**/*.apk' }.files
            if (apks.isEmpty()) throw new GradleException('Offline voice APK verification: no APK found.')
            apks.each { apk ->
                new java.util.zip.ZipFile(apk).withCloseable { zip ->
                    def model = zip.getEntry('assets/offline-assistant-voice/sensevoice/model.int8.onnx')
                    if (model == null || model.size != 239233841L || model.method != java.util.zip.ZipEntry.STORED) {
                        throw new GradleException('Offline voice APK verification: model must exist and be stored UNCOMPRESSED.')
                    }
                }
            }
        }
    }
}
${END}`;

function configureAppGradle(contents, language = 'groovy') {
  if (language !== 'groovy') throw new Error('Offline voice packaging requires review for a non-Groovy app build file.');
  const begin = contents.indexOf(BEGIN), end = contents.indexOf(END);
  if ((begin < 0) !== (end < 0) || (begin >= 0 && end < begin)) throw new Error('Incomplete offline voice Gradle marker');
  if (begin >= 0) return contents.slice(0, begin) + BLOCK + contents.slice(end + END.length);
  return contents.trimEnd() + '\n\n' + BLOCK + '\n';
}

module.exports = config => withAppBuildGradle(config, current => {
  current.modResults.contents = configureAppGradle(current.modResults.contents, current.modResults.language);
  return current;
});
module.exports.configureAppGradle = configureAppGradle;
