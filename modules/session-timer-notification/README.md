# 锁屏计时卡片原生模块

此模块是 Expo SDK 54 local module，默认由 `./modules` 自动链接。Android **1.1.5 起使用用户启动的原生前台计时服务**，在前后台统一播放包内音效；旧版本仅使用系统计时卡片/通知闹钟。iOS 通过 `plugins/withSessionTimerLiveActivity.js` 集成 Widget Extension，本次未改变其后台实现。

## Android：归零停止与统一粤语／英语播报

2026-09-10 原生修订：APP 媒体语音与通知授权、铃声模式及旧提醒频道静音解耦。此 Kotlin 修订需要后续新 Android Build；已发行 1.1.6 安装包不会通过仅发布 OTA 自动获得。

- `startTimerAudioServiceAsync(options)`：沿用下述计时卡片字段，增加 `halfwayAt/deadlineAt`（绝对毫秒）、`halfwaySound/completeSound`（四个允许的包内 WAV 文件名）、`halfwayChannel/completeChannel`、`allowStart`。
- 仅 `allowStart=true` 且本 APP 的 Activity 可见/前台、屏幕未锁定时启动服务；已运行的同一计时允许后台刷新，绝不由旧广播或进程恢复自动启动新服务。通知授权对话框短暂失去窗口焦点时可根据原生活动前台状态判断，最终由 Android 执行 FGS 启动限制。
- 首次调用等待服务成功完成 `startForeground` 后才返回 `updated, audioOwned:true`；失败/无启动授权返回 `failed/denied/invalid/needs_start, audioOwned:false` 并清理服务。必须提交服务通知，但 Android 决定是否显示：通知被拒绝或频道被关闭时不会擅自打开它们，也不再因此禁止媒体服务，返回独立的 `notificationStatus:denied, notificationsEnabled:false`。暂停停止服务及音频后，只有通知获准时才显示静态卡片。
- `stopTimerAudioServiceAsync(preserveDue=false)`：放弃/暂停/登出使用 false，立即释放声音、音频焦点、唤醒锁、补助闹钟和服务。自然结束使用 true，只允许**已运行**且刚到点的服务播完结束音，返回 `finishing`；不会创建新服务。已经被原生领取的结束阶段保留所有权直到显式清理/下次开始，避免晚到的 JS 总结同步重复播放 TTS。
- `getTimerAudioServiceStatusAsync()`：返回是否仍拥有音频、是否运行及 `lastPhase/lastCueOutcome`；例如 `playing/played/muted/dnd/call_active/focus_denied/source_missing/late/playback_failed`，用于定位真机无声原因，而不是把“安排成功”当成“用户听到了”。`notificationStatus/notificationsEnabled` 独立说明通知权限/显示情况；服务 `updated` 不等于锁屏可见。`completedTimerId` 只含随机计时 ID，不含身份或健康数据。
- 空闲计时使用 `specialUse` 前台服务类型，并在 Manifest 声明用户可见的计时用途；只有真正播放短音效时增加 `mediaPlayback` 类型，播放前请求短时音频焦点，不接受延后获得焦点。不播放无声音频循环，不调整系统音量/铃声/勿扰，不自动要求电池白名单。
- 半程与结束均由原生单一状态领取，只播放一次。MediaPlayer 回调校验计时令牌和播放代次；过期超过 10 秒不补播，旧准备/完成回调不能恢复已放弃的计时。
- 计时卡片复用既有样式；正数计时保留 System UI Chronometer，倒计时由原生依据单调截止时间更新非负数字，同一秒相同快照去重。常规秒数只更新通知，不重复提升前台服务或写入显示元数据。到期将运行 ID 替换为独立固定“已结束 / 0:00”卡片并移除旧卡，声音服务不中断；播完或失败后清除，不显示负数。API 31+ 请求立即显示。计时卡片自身静音，声音由 MediaPlayer 独占。
- 正数计时不持有 CPU 唤醒锁；倒计时持有上限为用户本次计时（最多 24 小时）加 15 秒收尾的有界部分唤醒锁，暂停/结束/异常时释放。锁屏计时可能增加耗电。
- 仅已获得精确提醒权限时安排 `setExactAndAllowWhileIdle` 作为系统唤醒补助，不使用 `setAlarmClock`、不显示下一闹钟图标、不新弹出精确闹钟授权。**FGS 和唤醒锁不是 Doze 豁免**，系统深度省电会忽略唤醒锁，allow-idle 闹钟仍有同 APP 9 分钟配额，厂商限制也可能延迟提醒；不能保证所有后台场景准点。
- 强行停止、系统停止前台服务、清理 APP 任务或重启后不自动恢复播放。用户需要重新打开 APP，再主动继续计时；无 `BOOT_COMPLETED`/sticky 自动重启。
- 中文为 `countdown_yue_halfway.wav/countdown_yue_complete.wav` 粤语播报，英文沿用 `countdown_en_halfway.wav/countdown_en_complete.wav`。前台降级播放器也播放同一份 WAV，不再调用可能回退普通话的系统 TTS。原生使用 `USAGE_MEDIA + CONTENT_TYPE_SPEECH` 和媒体音量，不再把铃声振动/静音或旧通知频道的声音设置当作媒体静音开关。媒体音量为零、勿扰开启、正在响铃/通话/通信通话或焦点被占用时仍不强行播放，不修改系统设置。
- 如系统深度休眠暂停原生回调，通知可能暂留最后一个非负数字；恢复执行后按真实截止时间完成，不会把延迟累计成负数。语音的十秒迟到上限及系统省电限制仍然存在，不承诺所有手机所有锁屏状态瞬间完成刷新。

## 旧版接口与卡片行为（兼容用途）

- `isSessionTimerNotificationAvailable()`：只检查桥接存在性。旧版安装包以及 Web 返回 `false`；iOS 系统可用性由原生调用进一步检查。
- `updateAsync({ timerId, recordMode, running, startedAt, accumulatedSeconds, targetDurationSec, title, body, url, channelName? })`：返回 `{ status }`，状态为 `updated`、`expired`、`denied`、`invalid` 或 `unavailable`。
- `clearAsync()`：只移除本模块自己的通知，返回 `{ status: 'cleared' }`。
- `getStatusAsync()`：Android 只读返回 `visible/missing/denied`，旧模块返回 `unavailable`。不自动重发用户移除的同状态通知。
- 可选标签字段 `locale/modeLabel/statusLabel/timeLabel/openLabel/finishedLabel` 跟随 APP 中英文。
- 时间戳使用 Unix 毫秒；累计时长和目标时长使用秒。
- 通知只有一个固定 tag/ID，更新替换旧通知，不会每秒推送新通知。
- 正数计时和倒计时使用 Android System UI 的 Chronometer；JS 被挂起后仍由系统显示时间。
- Android 系统装饰布局提供 48dp 紧凑和展开卡片，大号计时、模式、运行/暂停状态，适配深浅主题和字号。
- 暂停显示固定时长，暂停时不安排倒计时结束清除。
- 点击仅允许 `myapp://timer-notification?timerId=...&recordMode=countup|countdown`。应用路由还必须验证当前账号和计时器身份。
- 新装使用无声默认优先级渠道 `session-timer-status-v2`，减少旧 LOW 渠道被锁屏隐藏的情况；不重复播放半程、结束提醒。旧 v1 仅在能确认仍为未修改的默认设置时迁移；用户关闭、静默或隐私限制均保留，并把限制状态反馈给 APP。
- 可选 `prepareNotificationChannelAsync` 在请求通知权限前准备渠道；`checkReminderSettingsAsync` 只读检查准点提醒权限；`openExactAlarmSettingsAsync`、`openNotificationSettingsAsync` 仅在用户点击后打开系统设置。
- 非服务旧版卡片在 Android 8+ 用系统 `setTimeoutAfter` 移除已到期的倒计时，Android 7 使用无声、非精确闹钟清除；服务卡片由服务生命周期移除，不在结束音播放途中超时消失。
- `scheduleCountdownRemindersAsync/clearCountdownRemindersAsync` 是 **1.1.4 的旧原生闹钟接口，仅供兼容**。1.1.5 新路径开始前取消它们，不得与新服务并行安排声音。保留可选 `SCHEDULE_EXACT_ALARM`，不申请自动授予的 `USE_EXACT_ALARM`，不新增推送密钥，不显示姓名、病况等资料。

## 安装与限制

此功能包含 Kotlin、Swift 和 Widget Extension，必须重新构建并安装 Android/iOS 新包。仅发布 OTA 不能让旧包增加这些原生组件；JS 对旧包安全降级。

通知是否在锁屏显示、是否被系统允许或用户划走，由系统版本和通知设置控制，包括“隐藏静默通知”。Android 7 的非精确清除可能因省电模式延迟，不能保证倒计时通知精确在零秒消失。新服务也不绕过系统限制。若后续上架 Google Play，需要在 Play Console 如实申报 `specialUse/mediaPlayback` 前台服务用途并接受审核。

## iOS 实时活动

- iOS 16.2+ 使用 ActivityKit/WidgetKit 锁屏卡片和灵动岛；主 APP 最低 iOS 15.1 不变，ActivityKit 弱链接且有运行时保护。
- `Text(timerInterval:)` 由系统显示时间，暂停固定数字；倒数区间有界，数字停在零。结束文案依赖系统 stale 刷新，不能保证零秒瞬间更新状态。
- 普通通知权限与实时活动开关独立。旧系统、关闭实时活动或旧安装包降级静态通知，且仅在普通通知授权允许时显示；同一条降级通知不随每次前后台切换重发。
- 新活动仅前台创建；后台返回 `deferred` 待前台重试。用户移除同一计时活动后返回 `suppressed`，不因恢复前台强行重建。APP 内计时仍继续。
- 暂停/继续、放弃、结束、换账号有串行队列与过期请求保护；深链只含随机计时器编号及模式，APP 路由会再次验证账号和计时器身份。
- Live Activity 最长活跃 8 小时，可额外在锁屏保留最多 4 小时，不承诺全天连续显示。
- 扩展 bundle identifier 为主 APP 标识加 `.timer-widget`。EAS 已声明签名元数据，首次新 Build 仍需 Apple 团队配置/签署该扩展的描述文件。
- 无新增 APNs token、App Group 或后台常驻权限。UserDefaults 仅记录本 APP 活动身份，已声明 CA92.1。

2026-09-10 检查发现 Windows 有 PyCharm 自带 JBR 17，但没有 Android SDK、Kotlin 编译器或生成的 Android Gradle 工程；没有执行本次 Kotlin 编译或真机语音验收。源码及资源契约测试、JS/Hermes 导出不能等同原生编译或真机验收。已发行 Android Build 10 / 1.1.6 不包含本次媒体语音解除误拦截修复，需要新的 Android Build。

## 官方依据

- [Expo Autolinking：local modules 默认目录](https://docs.expo.dev/modules/autolinking/)
- [Android Notification.Builder：Chronometer 与 timeout](https://developer.android.com/reference/android/app/Notification.Builder)
- [Android Doze 限制](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Android 前台服务类型及 Play 声明](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Android 后台启动前台服务限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Android 通知权限：启动前台服务不要求 POST_NOTIFICATIONS，但仍必须提供通知](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- [Android 音频焦点：媒体语音、前台服务要求与来电行为](https://developer.android.com/media/optimize/audio-focus)
- [Android 自定义通知布局](https://developer.android.com/develop/ui/views/notifications/custom-notification)
- [Apple Live Activities 与时长限制](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)
- [Expo iOS Extension 签名声明](https://docs.expo.dev/build-reference/app-extensions/)
- [Apple 必要原因 API 声明](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)
