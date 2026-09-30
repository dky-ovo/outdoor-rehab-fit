# Android APP 内置音效后台计时修订（2026-09-09，运行时 1.1.5）

> 历史 Build 9 交付记录：其中中文提示音和通知倒计时显示已由后续 **1.1.6 归零与粤语播报修订**替代，见 [本轮修订报告](countdown-zero-cantonese-20260909.md)。下文的 APK 链接仍是旧 Build 9，不能用于验证后续修复。

## 本轮范围

针对 Android Build 8（1.1.4）在用户手机仍没有后台声音的问题，改为用户主动开始计时后运行原生前台计时服务，并通过 APP 内的 MediaPlayer 播放包内音频。这里只能确认现有实现依赖通知声音，无法凭截图确定该手机无声的唯一系统原因。

- 删除倒计时设置卡片中“半程及结束提醒使用 Android 系统闹钟……”整段中英文说明，不改变其余界面布局或计时/记录功能。
- 新 Android 路径不再使用 `setAlarmClock`，不再弹出“闹钟和提醒”授权提示。已有精确提醒授权只用于可选的系统唤醒补助；没有授权也可以启动前台计时服务。
- 半程与完成统一由原生服务播放，前台也不会同时调用 JS 语音。旧通知计划先清理，再由新服务接管，避免双声、双通知。
- 中文使用无语言提示音：半程两音下行（1.8 秒）、完成三音上行（2.4 秒）。英文沿用原有两段英语播报。没有把普通话当成粤语。
- 正数计时、倒计时保留系统 Chronometer 通知卡片及锁屏显示；通知卡片本身静音。
- 暂停停止后台服务和音频，保留静态暂停卡片；继续保持原计时器身份，排除暂停时长。放弃、结束、切换用户会释放播放器、音频焦点、唤醒锁及补助提醒。
- 自然结束进入总结时保留已经到点的结束音至播放完成。旧播放器回调、旧提醒令牌和旧异步权限结果不能重开已放弃的计时器。
- 只有原生明确确认启动失败、没有接管音频时，才允许原有的前台新鲜语音回退。后台、已过期或已由原生处理的声音不会在重新打开后补播。
- iOS 继续原有提醒/实时活动实现，本轮没有实现 iOS 常驻背景音频。

## 原生实现与系统边界

计时等待期间使用声明了实际用途的 `specialUse` 前台服务，播放真实音效期间增加 `mediaPlayback` 类型和临时音频焦点。通知保持可见，没有使用循环无声音频保活、强改系统音量、全屏意图、绕过勿扰或自动电池豁免。

倒计时 CPU 唤醒锁严格限制在用户设置的剩余时长加短暂清理窗口内，最长一天；正数计时没有持续 CPU 唤醒锁。后台服务会增加耗电，应在结束或不需要计时时停止。

重要限制：

1. 深度 Doze 可以忽略普通唤醒锁；`setExactAndAllowWhileIdle` 仍有每应用九分钟间隔限制。前台服务并不意味着所有品牌、所有省电模式下都能保证两次提醒准时。
2. 媒体音量为零、静音/勿扰、提醒频道被关闭或静音、通知权限关闭、音频焦点被通话等占用时，不强制出声。
3. 从最近任务中清除 APP、系统前台服务“停止”、强制停止应用、设备重启或进程被终止，不会通过隐藏启动或旧广播自动复活播放。计时时间可以在 APP 重新打开时恢复，但丢失的音频服务需要用户在前台暂停后继续。
4. 本轮没有连接用户手机，也没有本地 JDK/Android SDK/adb。后续 Android Build 9 已通过 EAS 云端 Kotlin/Gradle 发布版编译，但这仍不等于真机锁屏或扬声器播放验证。
5. 如果后续发布 Google Play，需要在 Play Console 申报实际使用的前台服务类型；`specialUse` 用途会受到审核。这里没有操作商店后台。

诊断接口 `getTimerAudioServiceStatusAsync()` 返回 `lastPhase`、`lastCueOutcome`，用来区分已播放、静音、勿扰、资源缺失、焦点拒绝、启动失败和过期丢弃。诊断不记录姓名、运动日志或其他个人内容。

## 验证与交付

- 本轮全量 Jest **55 组 / 583 项测试、1 项快照通过**；音效与原生资源复制 **8 项 Node 测试通过**；`tsc --noEmit` 通过。原生 Kotlin/Manifest 契约用例属于源码检查，不是 Android 设备执行测试。
- 自动化用例覆盖计时通知计划、权限对话框竞态、音频唯一归属、暂停/恢复、放弃/重开、手动模式隔离、自然完成与总结、账号切换、过期不补播。
- 升级时保留旧版英文半程/结束各自频道的静音选择，基础频道的全局静音仍优先；原生接管后如果刷新失败，只允许尚未到点的后续阶段使用前台语音回退，已经可能由原生播放的阶段不再重复。
- 音效检查包含 PCM 格式、时长、实际非静音内容、平滑波形及确定性生成；调用本机安装的 Expo Android 插件实际复制四段 WAV 到独立测试目录的 `res/raw`，并逐字节核对。
- Android、iOS、Web 的 JS/Hermes 导出目录：`workspace-artifacts/exports/android-timer-audio-20260909`。
- 用户确认上传目标后，已完成 Android Build 9：版本/运行时 `1.1.5`、versionCode `9`、`preview` 配置及频道，项目 `dky2004 / outdoor-rehab-fit`，沿用现有签名。没有构建 iOS、发布 OTA 或修改服务器，不需要新 SSH 部署包。
- EAS 构建 ID：`5687ef2d-3b6c-41dd-aa92-dff0cfbafc16`；状态 `FINISHED`；完成时间为香港时间 **2026-09-09 18:42:40**。云端 `:session-timer-notification:compileReleaseKotlin`、`:app:assembleRelease` 通过，Gradle 结果为 `BUILD SUCCESSFUL in 11m 17s`。
- [构建详情](https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/5687ef2d-3b6c-41dd-aa92-dff0cfbafc16)；[APK 直接下载](https://expo.dev/artifacts/eas/ImWSFaEahQUTsR2X5JFIU1zpXDiO99BYdn4PwLSXYtw.apk)。
- 本地安装包：`deploy/2026-09-09/outdoor-fit-android-1.1.5-build9.apk`，**204,766,400 字节（195.28 MiB）**；SHA-256：`B95409B744D191F1EF583B693CEBE9DFC2BE8218EEA5A0C93DD8FFDA74560610`。
- 已从最终 APK 中读取并校验四段 WAV，与源码音频 SHA-256 全部相同。发布版资源路径被优化为 `res/Aw.wav`（中文结束）、`res/eQ.wav`（中文半程）、`res/g3.wav`（英文结束）、`res/Xa.wav`（英文半程），不使用文件路径变化来判断资源缺失。
- 独立解析最终 APK 的二进制 Manifest：包名 `com.maxcch.c.outdoorrehabfit`、版本 `1.1.5 (9)`、minSdk 24、targetSdk 36；`TimerAudioService` 注册为 `exported=false`、`stopWithTask=true`、`specialUse|mediaPlayback`，用途声明及所需权限齐全。DEX 的 `class_defs` 确认实际定义了计时服务、补助提醒接收器及桥接模块。
- 独立解析 `resources.arsc`，确认四个 `countdown_*` 原始名称仍属于 `raw` 类型，资源 ID 为 `0x7f120039`–`0x7f12003c`，正确映射到上述现存 WAV 文件；原生按资源名查找所需的名称没有因路径优化而丢失。这些属于安装包静态验证，不是手机播放测试。
- 构建脚本执行后 `app.json` 已还原，SHA-256 与构建前一致：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`，保留原 iOS 配置。没有尝试安装到本地模拟器。

在 Windows PowerShell 中重新构建安卓：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -NonInteractive -Message "改用APP内置后台计时音效并移除系统闹钟说明"
```

该命令保留原 Android 账号、项目与签名，非交互模式不尝试安装到本地模拟器。新原生运行时为 1.1.5；不能仅 OTA 到 Build 8 获得此服务。不要卸载旧 APP 以免丢失仅存本地的运动数据，优先使用同签名 APK 覆盖安装。

## 真机验收清单

1. 通知开启、媒体音量可听、非静音/勿扰：1 分钟倒计时，普通后台和锁屏分别检查半程、结束各只响一次。
2. 5、15、20 分钟倒计时，在锁屏及深度省电条件下分别记录准时/延迟/无声，不能把普通锁屏通过当作 Doze 已通过。
3. 半程前后暂停/继续；放弃后立即开启正数计时；两个模式连续重开至少十次。旧音效和旧通知不得残留。
4. 结束音开始时进入总结，声音正常播完；填写并保存运动记录，确认只有一条记录，时间正确。
5. 通知拒绝/恢复、频道静音、媒体音量零、勿扰、蓝牙/耳机、来电抢焦点均不会崩溃或强行出声。
6. 首次安装的通知授权弹窗、后台返回、更换语言、清除最近任务、停止服务、重启应用分别检查上述行为。

## 官方依据

- [Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)：`specialUse` 实际用途声明、`mediaPlayback` 及商店申报。
- [Android 后台播放媒体](https://developer.android.com/media/platform/mediaplayer/background)：服务中管理 MediaPlayer 与资源释放。
- [Android Doze 与 App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)：唤醒锁和补助闹钟的省电限制。
- [Android 音频焦点](https://developer.android.com/media/optimize/audio-focus)：焦点、通话与后台播放约束。
- [用户停止前台服务](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping)：系统停止行为与既有闹钟的区别。
