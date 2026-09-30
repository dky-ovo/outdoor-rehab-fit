package expo.modules.offlineassistantvoice;

/** Dependency-free executable tests for the exact policy called by Android. */
public final class OfflineVoiceSelectionTest {
  private static int count;
  private static void check(boolean value, String message) {
    count++;
    if (!value) throw new AssertionError(message);
  }

  private static boolean accepts(String name, String locale, String requested) {
    return OfflineVoiceSelection.eligible(name, locale, false, false, requested);
  }

  public static void main(String[] args) {
    check(accepts("offline-yue", "yue-HK", "zh-HK"), "Explicit Yue accepted");
    check(accepts("local-voice", "yue-Hant-HK", "zh"), "Yue script locale accepted");
    check(accepts("yue-hk-x-yuf-local", "zh-HK", "zh-HK"), "Explicit Yue identity on legacy zh-HK accepted");
    check(accepts("cantonese-local", "zh-Hant-HK", "yue-HK"), "Explicit Cantonese identity accepted");
    check(accepts("YUE_HK_LOCAL", "zh_HK", "zh_HK"), "Case and underscore normalized");
    check(!accepts("default-chinese", "zh-HK", "zh-HK"), "An HK region alone must not imply Cantonese");
    check(!accepts("zh-hk-language", "zh-HK", "zh-HK"), "Generic HK locale voice is ambiguous");
    check(!accepts("cmn-hk-local", "zh-HK", "zh"), "Mandarin identifier excluded");
    check(!accepts("mandarin-yue-local", "yue-HK", "zh"), "Conflicting Mandarin metadata excluded");
    check(!accepts("yue-hk-local", "zh-CN", "zh"), "Yue name cannot override mainland Chinese locale");
    check(!accepts("generic", "zh-TW", "zh"), "Taiwanese Mandarin not accepted");
    check(!accepts("generic", "zh", "zh"), "Generic Chinese not accepted");
    check(!accepts("fake-notyue", "zh-HK", "zh"), "Yue substring must be a token");
    check(!accepts("", "yue-HK", "zh"), "Blank identity cannot be selected");
    check(!accepts("yue-local", "", "zh"), "Missing locale cannot be selected");
    check(!OfflineVoiceSelection.eligible("yue-local", "yue-HK", true, false, "zh"), "Network voice rejected");
    check(!OfflineVoiceSelection.eligible("yue-local", "yue-HK", false, true, "zh"), "Missing voice pack rejected");
    check(accepts("en-us-local", "en-US", "en-US"), "US English accepted");
    check(accepts("en-gb-local", "en-GB", "en-US"), "Installed English variants accepted");
    check(!accepts("yue-local", "yue-HK", "en-US"), "English request cannot select Cantonese");
    check(!accepts("en-us-local", "en-US", "zh-HK"), "Chinese request cannot select English");
    check(!accepts("english", "en-US", "enterprise"), "Unsupported language prefix rejected");
    check(OfflineVoiceSelection.languageRank("yue-local", "yue-HK", "zh") >
      OfflineVoiceSelection.languageRank("yue-local", "zh-HK", "zh"), "Explicit Yue locale ranks first regardless of vendor quality");
    check(OfflineVoiceSelection.confirmsSelection("yue-local", "yue-HK", "yue-local", "yue-HK", false, false, "zh"), "Effective voice confirmed");
    check(!OfflineVoiceSelection.confirmsSelection("yue-local", "yue-HK", "cmn-local", "zh-CN", false, false, "zh"), "Engine fallback must stop playback");
    check(!OfflineVoiceSelection.confirmsSelection("yue-local", "yue-HK", "yue-local", "zh-HK", false, false, "zh"), "Locale substitution is rejected");
    check(!OfflineVoiceSelection.confirmsSelection("yue-local", "yue-HK", "yue-local", "yue-HK", true, false, "zh"), "Network substitution is rejected");
    check(!OfflineVoiceSelection.confirmsSelection("yue-local", "yue-HK", null, null, false, false, "zh"), "Missing effective voice rejected");
    System.out.println("OfflineVoiceSelection: " + count + " executable assertions passed.");
  }
}
