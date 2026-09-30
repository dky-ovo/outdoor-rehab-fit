const { AndroidConfig, withAndroidManifest, withAndroidStyles, withMainApplication } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const CROP_ACTIVITY = 'expo.modules.imagepicker.ExpoCropImageActivity';
const CROP_THEME = 'OutdoorFit.CropImageTheme';
const DARK = '#222222';
const WHITE = '#FFFFFF';
const THEME_ITEMS = {
  expoCropToolbarColor: DARK,
  expoCropToolbarIconColor: WHITE,
  expoCropToolbarActionTextColor: WHITE,
  expoCropBackButtonIconColor: WHITE,
  expoCropBackgroundColor: DARK,
  'android:statusBarColor': DARK,
  'android:navigationBarColor': DARK,
  'android:windowLightStatusBar': 'false',
  'android:windowLightNavigationBar': 'false',
  'android:windowActionModeOverlay': 'true',
  colorAccent: WHITE,
};

function configureStyles(xml) {
  for (const [name, value] of Object.entries(THEME_ITEMS)) {
    xml = AndroidConfig.Styles.setStylesItem({ xml,
      parent: { name: CROP_THEME, parent: 'Base.Theme.AppCompat' },
      item: { $: { name }, _: value },
    });
  }
  return xml;
}

function configureManifest(xml) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(xml);
  application.activity ??= [];
  let crop = application.activity.find((activity) => activity.$?.['android:name'] === CROP_ACTIVITY);
  if (!crop) {
    crop = { $: { 'android:name': CROP_ACTIVITY, 'android:exported': 'false' } };
    application.activity.push(crop);
  }
  crop.$['android:theme'] = `@style/${CROP_THEME}`;
  // The library declares its own theme: only this activity's theme is replaced.
  const replace = new Set(String(crop.$['tools:replace'] || '').split(',').map((item) => item.trim()).filter(Boolean));
  replace.add('android:theme');
  crop.$['tools:replace'] = [...replace].join(',');
  xml.manifest.$ ??= {};
  xml.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  return xml;
}

// ImagePicker 17 applies status-bar icon brightness from system night mode in
// onCreate, overriding theme flags. Correct it only when this dark crop activity
// resumes; never modify MainActivity, global night mode, or the user's settings.
const KOTLIN_CALLBACK = `    registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {
      override fun onActivityResumed(activity: android.app.Activity) {
        if (activity.javaClass.name != "${CROP_ACTIVITY}") return
        activity.window.statusBarColor = 0xFF222222.toInt()
        activity.window.navigationBarColor = 0xFF222222.toInt()
        androidx.core.view.WindowInsetsControllerCompat(activity.window, activity.window.decorView).apply {
          isAppearanceLightStatusBars = false
          isAppearanceLightNavigationBars = false
        }
      }
      override fun onActivityCreated(activity: android.app.Activity, state: android.os.Bundle?) {}
      override fun onActivityStarted(activity: android.app.Activity) {}
      override fun onActivityPaused(activity: android.app.Activity) {}
      override fun onActivityStopped(activity: android.app.Activity) {}
      override fun onActivitySaveInstanceState(activity: android.app.Activity, state: android.os.Bundle) {}
      override fun onActivityDestroyed(activity: android.app.Activity) {}
    })`;

const JAVA_CALLBACK = `    registerActivityLifecycleCallbacks(new android.app.Application.ActivityLifecycleCallbacks() {
      @Override public void onActivityResumed(android.app.Activity activity) {
        if (!activity.getClass().getName().equals("${CROP_ACTIVITY}")) return;
        activity.getWindow().setStatusBarColor(0xFF222222);
        activity.getWindow().setNavigationBarColor(0xFF222222);
        androidx.core.view.WindowInsetsControllerCompat controller = new androidx.core.view.WindowInsetsControllerCompat(activity.getWindow(), activity.getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
      }
      @Override public void onActivityCreated(android.app.Activity activity, android.os.Bundle state) {}
      @Override public void onActivityStarted(android.app.Activity activity) {}
      @Override public void onActivityPaused(android.app.Activity activity) {}
      @Override public void onActivityStopped(android.app.Activity activity) {}
      @Override public void onActivitySaveInstanceState(android.app.Activity activity, android.os.Bundle state) {}
      @Override public void onActivityDestroyed(android.app.Activity activity) {}
    });`;

function configureApplication(contents, language) {
  if (language !== 'kt' && language !== 'java') throw new Error('Crop contrast requires a Kotlin or Java MainApplication');
  return mergeContents({ src: contents, newSrc: language === 'kt' ? KOTLIN_CALLBACK : JAVA_CALLBACK,
    tag: 'outdoor-fit-crop-contrast', anchor: /^\s*super\.onCreate\(\);?\s*$/, offset: 1, comment: '//',
  }).contents;
}

function withImagePickerContrast(config) {
  config = withAndroidStyles(config, (mod) => { mod.modResults = configureStyles(mod.modResults); return mod; });
  config = withAndroidManifest(config, (mod) => { mod.modResults = configureManifest(mod.modResults); return mod; });
  return withMainApplication(config, (mod) => {
    mod.modResults.contents = configureApplication(mod.modResults.contents, mod.modResults.language);
    return mod;
  });
}

module.exports = withImagePickerContrast;
module.exports.__internal = { CROP_ACTIVITY, CROP_THEME, THEME_ITEMS, configureStyles, configureManifest, configureApplication };
