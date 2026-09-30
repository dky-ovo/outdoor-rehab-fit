// Source/resource contract checks, not Android rendering or device tests.
const fs = require('fs');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

const android = path.join(__dirname, '..', 'android');
const resources = path.join(android, 'src', 'main', 'res');
const moduleSource = fs.readFileSync(path.join(android, 'src/main/java/expo/modules/sessiontimernotification/SessionTimerNotificationModule.kt'), 'utf8');
const viewSource = fs.readFileSync(path.join(android, 'src/main/java/expo/modules/sessiontimernotification/TimerNotificationViews.kt'), 'utf8');
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const remoteWidgets = new Set(['LinearLayout', 'FrameLayout', 'TextView', 'Chronometer', 'ImageView']);

function readXml(relative) {
  const errors = [];
  const doc = new DOMParser({ errorHandler: {
    warning: (message) => errors.push(message),
    error: (message) => errors.push(message),
    fatalError: (message) => errors.push(message),
  } }).parseFromString(fs.readFileSync(path.join(resources, relative), 'utf8'), 'text/xml');
  expect(errors).toEqual([]);
  return doc;
}

function elements(doc) {
  return Array.from(doc.getElementsByTagName('*'));
}

function attr(node, name) {
  return node.getAttributeNS(ANDROID_NS, name);
}

function id(node) {
  return attr(node, 'id').replace('@+id/', '');
}

const layouts = ['session_timer_notification_compact', 'session_timer_notification_expanded'];
const sharedIds = ['session_timer_content', 'session_timer_mode', 'session_timer_status', 'session_timer_running', 'session_timer_paused'];

it.each(layouts)('%s parses and only contains RemoteViews-supported widgets', (name) => {
  const nodes = elements(readXml(`layout/${name}.xml`));
  expect(nodes.length).toBeGreaterThan(5);
  for (const node of nodes) expect(remoteWidgets.has(node.tagName)).toBe(true);
});

it.each(layouts)('%s exposes distinct live and paused clocks with unambiguous shared IDs', (name) => {
  const nodes = elements(readXml(`layout/${name}.xml`));
  for (const required of sharedIds) expect(nodes.filter((node) => id(node) === required)).toHaveLength(1);
  expect(nodes.find((node) => id(node) === 'session_timer_running').tagName).toBe('Chronometer');
  const paused = nodes.find((node) => id(node) === 'session_timer_paused');
  expect(paused.tagName).toBe('TextView');
  expect(attr(paused, 'visibility')).toBe('gone');
});

it('keeps the compact layout at Android 12’s 48dp custom-content limit', () => {
  const root = readXml('layout/session_timer_notification_compact.xml').documentElement;
  expect(attr(root, 'layout_height')).toBe('48dp');
  expect(attr(root, 'orientation')).toBe('horizontal');
});

it('keeps the fully expanded layout within the documented 252dp custom-content budget', () => {
  const root = readXml('layout/session_timer_notification_expanded.xml').documentElement;
  const number = (node, name) => Number.parseFloat(attr(node, name) || '0');
  const childNodes = Array.from(root.childNodes).filter((node) => node.nodeType === 1);
  const total = number(root, 'paddingTop') + number(root, 'paddingBottom') + childNodes.reduce((sum, node) =>
    sum + number(node, 'layout_height') + number(node, 'layout_marginTop') + number(node, 'layout_marginBottom'), 0);
  expect(total).toBe(224);
  expect(total).toBeLessThanOrEqual(252);
});

it.each(layouts)('%s constrains and autosizes text instead of overlapping neighbouring controls', (name) => {
  const nodes = elements(readXml(`layout/${name}.xml`)).filter((node) => ['TextView', 'Chronometer'].includes(node.tagName));
  for (const node of nodes) {
    expect(attr(node, 'autoSizeTextType')).toBe('uniform');
    expect(attr(node, 'ellipsize')).toBe('end');
    expect(Number(attr(node, 'maxLines'))).toBeGreaterThanOrEqual(1);
    expect(Number(attr(node, 'maxLines'))).toBeLessThanOrEqual(2);
    expect(attr(node, 'includeFontPadding')).toBe('false');
  }
});

it('uses system notification text appearances rather than hard-coded black or white body text', () => {
  for (const name of layouts) {
    const nodes = elements(readXml(`layout/${name}.xml`)).filter((node) => ['TextView', 'Chronometer'].includes(node.tagName));
    for (const node of nodes) {
      if (name.endsWith('expanded') && id(node) === 'session_timer_status') {
        expect(attr(node, 'textColor')).toBe('@color/session_timer_accent');
      } else {
        expect(attr(node, 'textAppearance')).toMatch(/^@android:style\/TextAppearance\.Material\.Notification/);
        expect(attr(node, 'textColor')).toBe('');
      }
    }
  }
});

it.each(['values', 'values-night'])('has a legible brand-accent status badge in %s', (directory) => {
  const colors = Object.fromEntries(elements(readXml(`${directory}/session_timer_colors.xml`))
    .filter((node) => node.tagName === 'color').map((node) => [node.getAttribute('name'), node.textContent.trim()]));
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const foreground = luminance(colors.session_timer_accent);
  const background = luminance(colors.session_timer_accent_soft);
  const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

it('resolves all custom resource references used by the layouts and Kotlin presenter', () => {
  const knownIds = new Set(layouts.flatMap((name) => elements(readXml(`layout/${name}.xml`)).map(id).filter(Boolean)));
  const knownColors = new Set(elements(readXml('values/session_timer_colors.xml')).filter((node) => node.tagName === 'color').map((node) => node.getAttribute('name')));
  for (const match of viewSource.matchAll(/R\.id\.([A-Za-z0-9_]+)/g)) expect(knownIds.has(match[1])).toBe(true);
  for (const match of viewSource.matchAll(/R\.layout\.([A-Za-z0-9_]+)/g)) expect(fs.existsSync(path.join(resources, 'layout', `${match[1]}.xml`))).toBe(true);
  for (const match of viewSource.matchAll(/R\.color\.([A-Za-z0-9_]+)/g)) expect(knownColors.has(match[1])).toBe(true);
  expect(readXml('drawable/session_timer_status_background.xml').documentElement.tagName).toBe('shape');
});

it('keeps count-up and legacy clocks in System UI, but uses nonnegative native text for service countdowns', () => {
  expect(viewSource).toContain('SystemClock.elapsedRealtime()');
  expect(viewSource).toContain('realtime + displayMs else realtime - displayMs');
  expect(viewSource).toContain('views.setChronometerCountDown(R.id.session_timer_running, options.recordMode == "countdown")');
  expect(viewSource).toContain('views.setChronometer(R.id.session_timer_running, base, null, true)');
  expect(viewSource).toContain('val systemClock = options.running && !(nativeCountdown && options.recordMode == "countdown")');
  expect(viewSource).toContain('if (systemClock) {');
  expect(viewSource).toContain('views.setChronometer(R.id.session_timer_running, base, null, false)');
  expect(viewSource).toContain('views.setTextViewText(R.id.session_timer_paused, formatDuration(roundedMs))');
  expect(viewSource).toContain('val displayMs = max(0L, if (countdown) remainingMs else elapsedMs)');
  expect(viewSource).toContain('if (nativeCountdown && options.running) ((displayMs + 999L) / 1000L) * 1000L else displayMs');
  expect(viewSource).not.toMatch(/setInterval|Thread\.sleep|Timer\(|Handler\(/);
});

it('keeps lockscreen privacy and controlled navigation when upgrading the default notification channel', () => {
  expect(moduleSource).toContain('private const val LEGACY_CHANNEL_ID = "session-timer-status-v1"');
  expect(moduleSource).toContain('lockscreenVisibility = Notification.VISIBILITY_PUBLIC');
  expect(viewSource).toContain('.setVisibility(Notification.VISIBILITY_PUBLIC)');
  expect(moduleSource).toContain('uri.host == "timer-notification"');
  expect(moduleSource).toContain('uri.getQueryParameter("timerId") == options.timerId');
  expect(viewSource).toContain('views.setOnClickPendingIntent(R.id.session_timer_content, contentIntent)');
  expect(viewSource).toContain('views.setOnClickPendingIntent(R.id.session_timer_open, contentIntent)');
  const manifest = fs.readFileSync(path.join(android, 'src/main/AndroidManifest.xml'), 'utf8');
  expect(manifest).not.toMatch(/USE_EXACT_ALARM|USE_FULL_SCREEN_INTENT/);
  expect(manifest).toContain('android.permission.SCHEDULE_EXACT_ALARM');
  expect(manifest).toContain('android:name="expo.modules.sessiontimernotification.TimerExpiryReceiver"');
  expect(manifest).toContain('android:exported="false"');
});

it('uses system decorations, one visible clock and the existing expiry mechanism', () => {
  expect(viewSource).toContain('Notification.DecoratedCustomViewStyle()');
  expect(viewSource).toContain('.setCustomContentView(compact)');
  expect(viewSource).toContain('.setCustomBigContentView(expanded)');
  expect(viewSource).toContain('.setShowWhen(false)');
  expect(viewSource).toContain('.setUsesChronometer(false)');
  expect(moduleSource).toContain('if (countdown && Build.VERSION.SDK_INT >= 26 && service == null) builder.setTimeoutAfter(remainingMs)');
  expect(moduleSource).toContain('TimerNotificationViews.apply(context, builder, options, elapsedMs, remainingMs, contentIntent,');
  expect(moduleSource).toContain('nativeCountdown = countdownRemainingMs != null');
});

it('keeps running countdown text identical in size and position to the previous clock', () => {
  for (const name of layouts) {
    const nodes = elements(readXml(`layout/${name}.xml`));
    const live = nodes.find((node) => id(node) === 'session_timer_running');
    const fixed = nodes.find((node) => id(node) === 'session_timer_paused');
    for (const property of ['layout_width', 'layout_height', 'textAppearance', 'fontFamily', 'textStyle',
      'textSize', 'autoSizeMinTextSize', 'autoSizeMaxTextSize', 'gravity']) {
      expect(attr(fixed, property)).toBe(attr(live, property));
    }
  }
});

it('accepts optional app-language labels while preserving compatibility with preceding payloads', () => {
  for (const field of ['locale', 'modeLabel', 'statusLabel', 'timeLabel', 'openLabel', 'finishedLabel']) {
    expect(moduleSource).toContain(`@Field var ${field}: String = ""`);
  }
  expect(viewSource).toContain('options.title.startsWith("Count", ignoreCase = true)');
  for (const field of ['modeLabel', 'statusLabel', 'timeLabel', 'openLabel']) expect(viewSource).toContain(`options.${field}.ifBlank`);
});
