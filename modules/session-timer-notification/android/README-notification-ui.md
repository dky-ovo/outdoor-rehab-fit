# Android 通知栏与锁屏计时 UI

## 本轮实现

- 使用原生 `Notification.DecoratedCustomViewStyle`，保留系统应用名称、图标、展开按钮和锁屏控制。
- 紧凑布局严格限制为 48dp：左侧模式和状态，右侧最大 28sp 的时间。
- 展开布局突出最大 48sp 的时间，并显示剩余／已计时间、截止信息及返回入口；最长内容高度为 224dp。
- 正数由 `RemoteViews` 中的系统 `Chronometer` 计时。新原生服务的倒数改为每秒更新同样式的纯文本，基准仍是 `SystemClock.elapsedRealtime()`，不依赖 JS；剩余值最小为零，避免系统 Chronometer 越过截止时间后继续显示负数。
- 倒数到期先停掉数字刷新，切换到独立 ID 的“已结束 / 0:00”卡片；Android 在前台服务切换 ID 时移除旧运行卡，不依赖最后一条静态秒数更新被显示。服务保持前台，结束语音播放完毕后清除卡片；无声、超时或播放失败也会清理。暂停、放弃及更换计时会撤销旧刷新，旧回调不能改写新计时。
- 暂停状态使用独立 `TextView` 显示固定时间，防止重新应用 RemoteViews 时，停止的 Chronometer 根据新时间重新计算。
- 主文字采用 Android 系统通知文字样式，适配系统通知背景；品牌红仅用作线条和状态角标，并提供 `values-night` 配色。
- 文本限制行数、末尾截断并配置自动字号。紧凑布局空间有限，超大系统字体或很长的计时值可能缩小显示；展开后可获得更多空间。
- 新安装使用 `session-timer-status-v2` 的普通重要性（`DEFAULT`）渠道，声音和振动关闭。原来的 `LOW` 容易被系统的“隐藏静默通知”设置从锁屏隐藏。
- 已安装用户仅在 Android 10+ 确认旧 `v1` 是应用未被用户修改的低重要性默认值，且无渠道隐私限制时升级到 `v2`。旧渠道被禁用、用户选择过重要性、隐藏内容、改过声音／振动，或 Android 8/9 无法确认用户选择时保留原渠道，不删除或绕过设置。
- 状态查询区分“通知已发布”和“渠道限制锁屏显示”，返回限制原因和实际渠道 ID；设置入口由用户点击打开实际渠道，系统全局及厂商锁屏设置仍由用户控制。
- 点击仍使用同一个、已经验证的 PendingIntent，交给应用校验当前计时器身份，不创建新计时器。
- 复用当前原生前台计时服务，每秒只更新同一张无声倒数卡片。同一秒内相同快照去重，首次／音频类型／完成状态变化才调用 `startForeground`；普通秒数更新用同 ID 的 `notify`。删除意图与显示元数据按计时器、时钟及阶段复用，不再每秒重新生成或写入磁盘。完成卡替换运行卡，不增加同时可见条目或全屏通知。
- 旧 JS 普通通知更新与原生桥接在主线程串行；原生服务运行时不能覆盖其卡片，已完成同一计时器的旧快照不能重新显示最后几秒。提供独立的准点提醒权限查询／设置桥接，设置界面只在用户点击时打开；新服务不主动要求精确闹钟权限。

## 系统限制与验收

锁屏显示依赖用户允许通知、允许锁屏显示，以及系统是否隐藏静默通知。应用不能强行改变这些设置。部分厂商、通知分组及 Android 版本可能限制紧凑卡片或锁屏展开样式。

Android 深度省电可能推迟服务回调，此时倒数卡片会暂留最后一个非负数，而不会继续出现负数；系统允许执行后会按原始截止时间立即结束，不从暂停显示处重新计时。原生服务、有限唤醒锁和已获准的系统提醒不能保证所有厂商或 Doze 场景准点，仍需真机验收。

2026-09-11 收到“后台声音正常但最后停在 5 秒”的反馈。源码检查确认旧实现有每秒重复前台提升／持久化，以及完成状态仍更新同一通知 ID 的风险；没有对应手机日志，不能把系统限流或厂商冻结断言为唯一已复现根因。此次减少重复更新，并让完成阶段移除旧卡。没有改回“Chronometer + setTimeoutAfter”：AOSP 的超时移除排除前台服务通知，因此不能靠此组合保证到期不显示负数。

这是 Android 原生布局变更，需要新 Build 后安装。源码和资源测试可验证 XML、尺寸预算、资源引用、深浅色对比、API 调用约束和单通知架构，不能代替实际 Kotlin 编译与手机视觉验收。

真机建议覆盖：正数运行／暂停／继续／放弃；倒数运行／暂停／到期；亮屏／锁屏；深色／浅色；最大系统字体；中英文；账号切换后点击旧通知；通知设置拒绝或隐藏静默通知。

## 官方文档

- [自定义通知布局及 48dp／252dp 空间限制](https://developer.android.com/develop/ui/views/notifications/custom-notification)
- [RemoteViews 原生 Chronometer 与 elapsedRealtime 基准](https://developer.android.com/reference/android/widget/RemoteViews)
- [Android 系统通知文字样式](https://developer.android.com/reference/android/R.style)
- [通知渠道的重要性、用户修改标记与锁屏隐私](https://developer.android.com/reference/android/app/NotificationChannel)
- [准点提醒权限查询和用户设置入口](https://developer.android.com/develop/background-work/services/alarms)
- [通知更新限流](https://developer.android.com/develop/ui/views/notifications/build-notification#Updating)
- [AOSP：超时移除排除前台服务通知](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/services/core/java/com/android/server/notification/NotificationManagerService.java)
- [AOSP：前台服务通知 ID 改变时移除原通知](https://android.googlesource.com/platform/frameworks/base.git/+/master/services/core/java/com/android/server/am/ActiveServices.java)
