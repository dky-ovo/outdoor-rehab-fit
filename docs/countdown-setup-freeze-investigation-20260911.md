# 倒计时结束设置与后台停秒排查（2026-09-11）

## 结论和发布状态

- 最新发布状态：用户随后授权推送，Android preview / 1.1.8 OTA 已于 2026-09-11 15:17（香港时间）发布，更新组 `28b2f968-d634-4935-9323-09ef34258615`，更新入口已验证返回该版本。详见 [Android OTA 记录](android-countdown-setup-ota-20260911.md)。未创建新 Build 或部署服务器。
- 最新用户反馈：一加 7T Pro / Android 12 调整 APP 后台权限后，通知停秒和结束语音延迟已解决。这是用户在该设备上的反馈，不代表其他机型均已验收。
- 最新需求只保留结束界面修改：删除“再次开始”，回到初始倒计时时间设置。本次复核没有继续修改后台原生计时逻辑。
- 已修改本地代码：倒计时自然结束或提前结束后，重新显示时间设置，不再显示“再次开始”；仍是独立计时，不弹出运动记录。
- 下文原生防护和诊断属于此前排查期间的本地修改，未在用户手机上部署，不能将后台权限调整后的恢复归功于这些未安装的修改。
- 本报告初次排查及复核时尚未发布；之后只发布了上述界面 OTA。Android 1.1.8 / Build 12 的嵌入界面不包含此修改，需要下载并应用该 OTA。
- 单独的结束界面修改位于 JS，可通过匹配 Build 12 运行时及频道的 Android preview OTA 更新；不依赖下文原生防护，不需要为了这一界面变化部署服务器或重新 Build。若要安装原生防护，仍需另行 Build。
- 本轮没有修改版本、通知权限提示、粤语/英文音频、倒计时通知样式或其他业务功能。

## 结束后的界面

文件：`app/(tabs)/session/index.js`。

- 通过 `showCountdownSetup` 区分正在计时与时间设置界面。
- 结束后滚回设置区域，显示原设定分钟数，支持预设、加减和手动输入；主按钮为“开始”。
- 只有用户明确按“开始”才创建新的计时器。无效的 0 分钟不能启动或覆盖旧计时身份。
- 结束时不会为了显示设置而调用 `resetSession()` 或 `chooseMode()`，避免这些清理操作切断原生结束语音。
- 旧计时在数据层保持已完成、剩余 0 秒；设置区显示的是用户准备下一次使用的时间，不是仍在运行的旧计时。
- 返回主页、独立进入手动记录、恢复已完成倒计时以及结束确认弹窗跨到期均有自动化覆盖。

## 后台 8 秒问题的证据与限制

- 未发现剩余 8 秒时主动停止的 JS 或原生分支。
- 使用真实 `ActiveSessionProvider`、Android 音频管理器和通知计划的集成测试，只模拟底层原生桥接，确认 JS 每秒更新不会每秒重复重建原生服务。
- 模拟 JS 在后台挂起并跨过截止时间，恢复后不会重新启动过期计时；异步通道准备跨截止、新旧计时任务交错也已覆盖。
- 当前倒计时通知使用原生每秒提交的非负文本。它仍依赖原生回调与系统通知处理，以上 JS 测试不能证明手机系统每秒实际重绘。
- 初查时没有设备信息；后续用户补充了一加 7T Pro / Android 12，并确认调整后台权限后恢复。未收集现场原生诊断，仍不能从源码单独推断当时的具体系统调度状态。
- 本机未找到可用 adb / Android SDK，因此没有执行 Android 原生编译、手机锁屏或后台音频验收。

## 本轮原生防护

文件：`TimerAudioService.kt`、`SessionTimerNotificationModule.kt`，均位于 `modules/session-timer-notification/android/src/main/java/expo/modules/sessiontimernotification/`。

- Android 28+ 使用异步主线程 Handler，让计时消息不受界面同步屏障阻塞。所有操作仍在主线程串行；这不等于可以绕过操作系统冻结或实际主线程阻塞。依据：[Android Handler.createAsync](https://developer.android.com/reference/android/os/Handler#createAsync(android.os.Looper))。
- 唤屏、解锁和 Activity 回前台时，由原生直接核对截止时间，不等待 JS 恢复。保留原有 10 秒最大音频延迟门限；超过门限只完成清理，不补播陈旧语音。
- 旧计时器已经过期的桥接请求，不得结束正在运行的另一个新计时器。
- 保留非负文本显示；没有默认启用可能越过零点显示负数的 SystemUI Chronometer 替代方案，没有双通知或循环静音音频。

## 可读取的原生诊断

已有 `getTimerAudioServiceStatusAsync()` 的返回结果新增 `nativeDiagnostics`。查询保持只读，不因查询触发完成或播报。

- 仅一份内存快照，不写文件、不上传、不新增个人或健康数据。
- `remainingMs` / `overdueMs`：原生截止时间与当前时间差。
- `notificationPostCount` / `lastNotificationPostAgeMs`：通知提交次数与距上次提交的时间，不代表系统一定重绘成功。
- `maxGuardDelayMs` / `lastGuardAgeMs`：计时回调最大观察延迟与距上次回调的时间。
- `completionDelayMs`：原生处理完成相对截止时间的延迟，-1 表示尚未处理。
- `wakeLockHeld`、`screenObserverRegistered`、`lifecycle`、`stopReason`：唤醒锁、广播监听与服务结束情况。
- `snapshotFrozen=true` 表示结束时保留的快照；其年龄值不再实时递增。
- 这不是用户界面中的新菜单，当前已安装 Build 12 也没有这些新增诊断。

## 已执行验证

用户确认后台权限解决停秒后，再次只针对结束界面、语音、悬浮计时入口及后台桥接运行回归：4 套、63 项通过。本次未改动原生计时代码，未发布更新。

```powershell
node node_modules/jest/bin/jest.js --config scripts/jest-app-regression.config.cjs --runInBand --watch=false --silent --runTestsByPath contexts/__tests__/SessionRecordLifecycle-test.js contexts/__tests__/CountdownVoice-test.js contexts/__tests__/CountdownBackgroundBridge-test.js components/__tests__/FloatingSessionTimer-test.js
```

此前完整本地验证记录：

```powershell
node node_modules/jest/bin/jest.js --config scripts/jest-app-regression.config.cjs --runInBand --watch=false --silent
node node_modules/typescript/bin/tsc --noEmit
$env:CI = '1'
node node_modules/expo/bin/cli export --platform android --output-dir workspace-artifacts/countdown-setup-20260911/android --max-workers 2
```

- Jest：78 套、870 项测试通过，1 个快照通过。
- 其中 `SessionRecordLifecycle-test.js`：16 项界面/生命周期测试通过。
- 新增 `CountdownBackgroundBridge-test.js`：4 项真实 JS 桥接集成测试通过。
- 原生相关测试包含源码和资源契约检查，不是 Android 设备运行测试。
- TypeScript：通过。
- Android 本地 JS/Hermes 导出：通过，2134 个模块、241 项资源。首次沙箱内导出因 Metro 子进程 `spawn EPERM` 失败，获批在沙箱外重试后成功。
- 导出目录为 `workspace-artifacts/countdown-setup-20260911/android`，不是 APK，不代表 Kotlin 原生代码已编译。

## 设备反馈与后续验收

用户已补充：一加 7T Pro、Android 12；停住的是通知栏，结束语音也未准时播放。因此不能仅按通知绘制问题处理，应同时检查原生消息调度、休眠和后台电量限制。该现象与后台执行挂起相符，但没有设备日志，仍不是已确认的系统省电根因。

现代码的到期回调和每秒通知更新均由原生服务 Handler 调度；部分唤醒锁不保证在 Doze 中生效。补充的 `setExactAndAllowWhileIdle()` 仅在已有精确闹钟权限时设置，而且受每个 APP 的 Doze 调度间隔限制，不能凭它保证相距很近的半程和结束语音均准时。[Android Doze 官方说明](https://developer.android.com/training/monitoring-device-state/doze-standby)。

此前建议在当前 APK 做只针对本 APP 的后台权限对照测试，用户已反馈修改后台权限后问题解决。不要清数据、卸载或更改全部 APP 的限制。具体菜单随 OxygenOS/ColorOS 版本可能不同；一加 Android 12 官方说明列出“设置 > 电池 > 高级设置 > 优化电池使用”，OxygenOS 12 手册也列出应用后台活动管理。[一加 Android 12 说明](https://service.oneplus.com/content/dam/support/user-manuals/en/OnePlus_Android_12_system_introduce_V1.0_20220525.pdf)、[OxygenOS 12 手册](https://service.oneplus.com/content/dam/support/user-manuals/common/OnePlus_10_Pro_User_Manual_EN.pdf)。放开限制会增加后台耗电；该恢复结果不代表此前未部署的原生代码已通过真机测试。

后续新原生包应在该手机上用独立计时参照检查：前台、回桌面、锁屏跨结束、最后 8 秒切换前后台、暂停恢复、放弃重开，以及连续两轮。记录实际到期与语音时间、卡片是否消失/归零、重新进入是否显示时间设置。

该手机的后台停秒项按用户反馈记录为权限调整后解决，不继续改动已经正常的后台机制。结束界面随后已发布 Android OTA，收到界面更新后仍需检查原时长可编辑、自然结束及提前结束后不出现“再次开始”、结束语音不中断。此前原生防护如需安装，仍须重新 Build；单独界面 OTA 不会包含这些原生服务修改。
