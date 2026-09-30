# Android 后台提醒修复构建（2026-09-08）

用户授权：只 build 安卓。未授权普通话替代粤语，因此中文后台仍使用系统提示音；英文内置短语音随包交付。未启动 iOS 构建、OTA、TestFlight 提交或正式发布。

## 构建目标

- 项目：dky2004/outdoor-rehab-fit（bcee8c37-e833-4f4d-b660-aa457accd96d）。
- Profile：preview，内部 APK，沿用原 keystore。
- 版本/runtime：1.1.3，远端 versionCode 已从 6 增加到 7。
- 通过现有 scripts/build-android-preview.ps1 单次启动，非交互、冻结原签名、上传后恢复 iOS 配置。
- 构建前 app.json SHA-256：1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C。
- 构建前没有安卓 build/update 配置备份或冲突发布进程。

## 预检

- 已有修复回归：446 项前端／源码资源契约测试、20 项后端测试、10 项 Widget 配置测试、类型检查和三端导出通过。
- 独立只读检查：自动链接实际发现 SessionTimerNotificationModule，7 个桥接与 JS 一致，20 个原生资源引用存在，receiver 全名正确。
- 两个英文 PCM WAV 存在并进入 expo-notifications 插件配置；SCHEDULE_EXACT_ALARM 已声明，用户点击才打开授权页。
- 修复范围及真机边界详见 background-reminder-fix-20260908.md。

## 构建记录

- 已使用原 Android 凭据并分配 Build 7，333 MB 源码上传成功（1 分钟）。
- 构建 ID：83bd5061-e609-41ab-a9e7-9785cbc67bbb。
- 构建页面：https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/83bd5061-e609-41ab-a9e7-9785cbc67bbb
- 上传后 app.json 已恢复 maxcch.c iOS 项目，文件哈希与构建前一致；没有遗留活动备份。
- 2026-09-08 14:11:54 UTC（香港 22:11:54）云端启动构建机；14:12:20 UTC 查询为 IN_PROGRESS，进入 INSTALL_DEPENDENCIES。排队期间未重试、取消或修改签名。
- 云端预构建读取配置确认为 1.1.3 / dky2004，包含 SCHEDULE_EXACT_ALARM 和两个英语 WAV；依赖、Doctor、PREBUILD、JS/Hermes 打包通过。
- 原生证据：14:18:14 UTC 执行 :session-timer-notification:compileReleaseKotlin；14:18:16 Java 编译及 bundleLibCompileToJarRelease；14:18:49 bundleLibRuntimeToDirRelease。Manifest 和资源处理亦通过，等待最终 APK。

## 最终结果：FINISHED

- 14:23:49 UTC：BUILD SUCCESSFUL in 10m 53s；14:23:50 RUN_GRADLEW 成功；14:23:56 APK 上传成功。
- EAS 完成时间：2026-09-08 14:23:58.853 UTC（香港 22:23:58）；主代理和独立检查均确认 FINISHED。
- Android 包名：com.maxcch.c.outdoorrehabfit；版本 1.1.3，Build 7。
- 下载：https://expo.dev/artifacts/eas/6kR9b4jPs95EYzQf4uA_eIAmYXAAMPWwPe9y_BkMnL4.apk
- 下载端点 HEAD 返回 HTTP 200，Content-Length 为 204504924 字节（约 195.03 MiB）。本地完整下载未完成，因此没有提供 APK SHA-256，也没有宣称已解包检查最终 APK。
- 本次仅启动一次 Android 构建，没有构建或提交 iOS，没有 OTA、服务器上传或部署。
- 安装后需允许通知及锁屏显示，并按 APP 提示检查“闹钟和提醒”权限。实际锁屏显示和提醒仍需真机验证，受系统通知、静音及厂商设置影响。
- 中文后台保持系统提示音，英文使用内置短语音；没有加入未经用户确认的普通话替代音频。
