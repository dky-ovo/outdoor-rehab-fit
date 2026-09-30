package expo.modules.offlineassistantvoice;

import java.util.Locale;
import java.util.regex.Pattern;

/** Pure selection policy, executable in a JVM test without an Android device. */
public final class OfflineVoiceSelection {
  private static final Pattern CANTONESE_ID = Pattern.compile("(^|[^a-z])(yue|cantonese)([^a-z]|$)");
  private static final Pattern MANDARIN_ID = Pattern.compile("(^|[^a-z])(cmn|mandarin)([^a-z]|$)");

  private OfflineVoiceSelection() {}

  private static String normalized(String value) {
    return value == null ? "" : value.replace('_', '-').toLowerCase(Locale.ROOT);
  }

  public static boolean requestsCantonese(String language) {
    String value = normalized(language);
    return value.equals("zh") || value.startsWith("zh-") || value.equals("yue") || value.startsWith("yue-");
  }

  /** 2: explicit Yue locale; 1: explicitly named Cantonese voice; 0: not eligible. */
  public static int languageRank(String name, String localeTag, String requestedLanguage) {
    Locale locale = Locale.forLanguageTag(normalized(localeTag));
    String language = locale.getLanguage();
    String id = normalized(name);
    if (id.isEmpty()) return 0;
    if (requestsCantonese(requestedLanguage)) {
      if (MANDARIN_ID.matcher(id).find()) return 0;
      if (language.equals("yue")) return 2;
      // An OEM may label a default Chinese voice zh-HK even when it speaks Mandarin.
      // The region alone is insufficient: require an explicit Cantonese identifier too.
      if (language.equals("zh") && locale.getCountry().equals("HK") && CANTONESE_ID.matcher(id).find()) return 1;
      return 0;
    }
    String requested = normalized(requestedLanguage);
    if ((requested.equals("en") || requested.startsWith("en-")) && language.equals("en")) return 1;
    return 0;
  }

  public static boolean eligible(String name, String localeTag, boolean needsNetwork, boolean notInstalled, String requestedLanguage) {
    return !needsNetwork && !notInstalled && languageRank(name, localeTag, requestedLanguage) > 0;
  }

  /** Engines may reject/substitute a requested voice; inspect the effective voice before speaking. */
  public static boolean confirmsSelection(String wantedName, String wantedLocale, String actualName, String actualLocale,
      boolean actualNeedsNetwork, boolean actualNotInstalled, String requestedLanguage) {
    return wantedName != null && wantedName.equals(actualName)
      && normalized(wantedLocale).equals(normalized(actualLocale))
      && eligible(actualName, actualLocale, actualNeedsNetwork, actualNotInstalled, requestedLanguage);
  }
}
