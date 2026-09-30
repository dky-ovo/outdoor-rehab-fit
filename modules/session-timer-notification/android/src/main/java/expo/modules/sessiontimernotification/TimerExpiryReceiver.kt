package expo.modules.sessiontimernotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TimerExpiryReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "expo.modules.sessiontimernotification.DISMISS") {
      TimerNotificationController.dismissed(context, intent.getStringExtra("timerId"), intent.getStringExtra("displayToken"))
      return
    }
    if (intent.action != "expo.modules.sessiontimernotification.EXPIRE") return
    TimerNotificationController.expire(
      context, intent.getStringExtra("timerId"), intent.getLongExtra("deadlineAt", 0L)
    )
  }
}
