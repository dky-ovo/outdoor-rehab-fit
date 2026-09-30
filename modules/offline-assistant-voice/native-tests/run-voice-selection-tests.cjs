const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const candidates = [process.env.JAVA_HOME, 'C:\\Program Files\\JetBrains\\PyCharm 2023.3.2\\jbr'].filter(Boolean);
const suffix = process.platform === 'win32' ? '.exe' : '';
const javaHome = candidates.find(candidate => fs.existsSync(path.join(candidate, 'bin', `javac${suffix}`)));
const command = name => javaHome ? path.join(javaHome, 'bin', name + suffix) : name;
const tempRoot = fs.realpathSync(os.tmpdir());
const output = fs.mkdtempSync(path.join(tempRoot, 'outdoor-voice-selection-'));
try {
  execFileSync(command('javac'), ['-encoding', 'UTF-8', '-d', output,
    path.resolve(__dirname, '../android/src/main/java/expo/modules/offlineassistantvoice/OfflineVoiceSelection.java'),
    path.join(__dirname, 'OfflineVoiceSelectionTest.java')], { stdio: 'inherit' });
  execFileSync(command('java'), ['-cp', output, 'expo.modules.offlineassistantvoice.OfflineVoiceSelectionTest'], { stdio: 'inherit' });
} finally {
  // This exact directory was created above; refuse cleanup outside its temp parent.
  const actual = fs.realpathSync(output);
  if (path.dirname(actual) !== tempRoot || !path.basename(actual).startsWith('outdoor-voice-selection-')) throw new Error('Unexpected temporary output path');
  fs.rmSync(actual, { recursive: true, force: true });
}
