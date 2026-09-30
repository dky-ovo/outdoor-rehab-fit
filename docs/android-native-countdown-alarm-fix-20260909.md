# Android 后台提醒与正数计时通知修订（2026-09-09）

> 此报告记录 Build 8 / 运行时 1.1.4 的历史实现。用户真机反馈仍无声后，后续 1.1.5 改为 APP 内置音频前台服务，参见 [最新修订与限制](android-background-app-audio-20260909.md)。以下“没有前台服务”和闹钟授权 UI 的说明不代表当前新版本。

## 原因与修订

- 本地 Expo SDK 54 的 `ExpoSchedulingDelegate.kt` 使用 `setExactAndAllowWhileIdle`；Android 官方说明该类提醒在 Doze 中同一应用每 9 分钟最多触发一次。因此短倒计时的半程和结束提醒不能同时依赖这个接口做到准时。无法仅凭本地代码证明用户手机的唯一原因，通知权限、频道声音、勿扰和厂商锁屏配置仍可能影响结果。
- 新增私有原生 `CountdownReminderReceiver`。用户主动启动倒计时时，以 `setAlarmClock` 安排半程、结束两个可见系统闹钟；Android 可能显示下一闹钟图标。原生接收器直接呈现通知，后台不需要 JavaScript 或网络决定声音。
- 开始页和权限说明明确告知系统闹钟及“闹钟和提醒”权限。拒绝时保留系统非精确提醒回退并提示可能延迟，不绕过用户权限。
- 沿用已选择的通知频道，保留用户关闭、静音、声音和隐私设置；无音量调整、勿扰绕过、全屏启动、前台服务或电池白名单。
- 新、旧原生接口能力检测分流：安装旧版或 iOS 继续既有 Expo 提醒；新 Android 先取消旧 Expo 提醒，再安排原生提醒，不并存两套声音。
- 两个 alarm 持久化随机令牌、时刻和完成标志；暂停、放弃、切换用户、保存总结时取消。重复同步不会修改截止时间；旧 receiver 不能影响新计时。精确闹钟授权状态同时进入 JS 和原生计划签名，授权变化后必定重排。原生为低端手机进程冷启动保留 10 秒投递容差，前台语音仍为 2 秒；超过容差的半程直接丢弃，完成保持静默。
- 原生前后台生命周期及屏幕锁定状态用于避免前台语音和后台提醒重复。回到 APP 不补播过期语音。中文后台继续使用用户选择的系统提示音，英文可使用已有内置播报音频；未擅自加入普通话。
- 正数计时通知独立发布，不再等待无关的旧倒计时清理完成。系统 Chronometer 负责通知栏时间变化，JS 挂起后仍由系统绘制。
- 新原生通知区分系统丢失和用户主动划除：系统丢失在下一次前后台/状态同步时修复；主动划除保留，新的开始/继续操作才可恢复。划除事件使用计时 ID 和独立显示令牌防止影响新通知。

## 版本与验证

- 新原生运行时：`1.1.4`。不修改 Android/iOS 既有账号、项目和签名配置；既有 `1.1.3` 英文声音资源门槛保留。
- 计时相关 **10 组 / 252 项 Jest 测试通过**，涵盖调度分流、原生调用契约、取消竞态、静音保留、前后台语音、计时上下级与通知恢复。Android Kotlin/Manifest 契约测试属于源码检查，不等于 Android 设备运行测试。
- 本机未找到 Java、Kotlin 编译器或 adb。本轮没有执行 Android 原生构建、安装、Doze/锁屏实测，也没有发布 OTA 或 iOS Build。原生修改必须通过后续新 Android Build 安装，无法由 Build 7 的 OTA 单独获得。
- Jest 扫描需忽略已有 `tmp` 中带 BOM 的测试 `package.json`（该旧文件未改动）：`--modulePathIgnorePatterns 'workspace-artifacts|[\\/]tmp[\\/]|[\\/]deploy[\\/]'`。

## 真机验收

1. 开启通知、频道提示声音、锁屏通知以及“闹钟和提醒”；开启 1–2 分钟倒计时，按电源键锁屏，确认半程和结束都准时出声。
2. 在另一 APP 前台操作时确认仍有半程/结束通知；回到本 APP 不重复播放。
3. 连续执行开始、暂停、继续、放弃、重开、退出登录：不能收到上一次计时的提醒。
4. 正数计时开始后在通知栏和锁屏查看秒数，暂停后保持固定值，继续时不包含暂停时间，结束/放弃后移除。
5. 主动划除计时通知后不强制恢复；新计时或继续操作可恢复。关闭权限或频道声音后不得擅自打开。
6. 勿扰/静音、厂商限制仍可能影响通知。系统“强行停止”应用会禁止其后台广播/提醒，必须由用户重新打开 APP 后才能恢复。重启设备会清除已安排的系统闹钟，本模块没有启动广播接收器，不会在重启后自动重建；重新打开 APP 后只会恢复仍有效的活动计时及未来提醒，过期提醒不会重新播报。本轮没有增加自动启动/重启恢复功能。

## 官方依据

- [Android Doze 与 App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)：说明 allow-while-idle 频率配额与 AlarmClock 的唤醒行为。
- [Android 安排闹钟](https://developer.android.com/develop/background-work/services/alarms)：说明用户可见、时间敏感提醒和精确闹钟授权。
- [AlarmManager API](https://developer.android.com/reference/android/app/AlarmManager)：`setAlarmClock`、`canScheduleExactAlarms` 与取消接口。
- [Notification.Builder API](https://developer.android.com/reference/android/app/Notification.Builder)：`GROUP_ALERT_SUMMARY` 用于让过期完成通知静默，不修改原有频道声音或隐私配置。
