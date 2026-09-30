import { appText } from "./appText";
import { showAlert } from "./alert";
export function showAccountDeletedNotice(locale) {
  showAlert(
    appText(locale, "inline.auth.accountDeletedTitle", { zh: "帳戶已被刪除", en: "Account deleted" }),
    appText(locale, "inline.auth.accountDeletedMessage", { zh: "您的帳戶已由管理員刪除，已為您登出。如有疑問，請聯絡項目人員。", en: "Your account has been deleted by an administrator and you have been signed out. Please contact the project team if you need help." }),
    undefined,
    { sessionEnded: true },
  );
}
