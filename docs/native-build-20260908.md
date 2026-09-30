# 2026-09-08 原生构建记录

用户授权：构建 Android 和 iOS 新安装包；不包括自动提交 TestFlight、商店发布或 OTA。

- 源码版本：`1.1.1`。本次新增原生计时通知和相机声明，沿用 `appVersion` runtime 策略，将新运行环境与旧 `1.1.0` 区分。
- Android：`dky2004/outdoor-rehab-fit`，preview，APK，versionCode `4`。
- Android 构建：`e6503483-f281-48f7-8894-f4ef37a3e370`。
- Android 进度：https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/e6503483-f281-48f7-8894-f4ef37a3e370
- iOS：`maxcch.c/outdoor-rehab-fit`，production，buildNumber `15`，构建已完成，未提交 TestFlight。
- iOS 构建：`9a4307fc-cca8-488a-be54-35431301fb58`。
- iOS 进度：https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/builds/9a4307fc-cca8-488a-be54-35431301fb58
- 两端沿用现有远程签名；未生成或替换签名密钥。
- Android 源码归档核对含原生模块必需文件，未含 `.env` 或本地签名私钥。
- Android 上传完成后，`app.json` 已精确恢复为 iOS 配置；SHA-256：`6DB91E0DEBF44BBA92499A5FAD2955F5C8AC119AFE9635069218EA17232DA9A2`。
- Android 构建脚本增加 `-NoWait`、`-NonInteractive`，用于上传完成后恢复配置，让两端云端编译可以并行。
- 云端 Android 日志确认 `:session-timer-notification:compileReleaseKotlin`、Java 编译及 library 打包阶段已通过（09:45 UTC）；最终 APK 已生成。这是原生编译验证，不是 JS 单元测试。

## 构建结果

- iOS：`FINISHED`，2026-09-08 09:46:27 UTC 完成，版本 `1.1.1 (15)`。
- iOS IPA：https://expo.dev/artifacts/eas/pl95xKCHxm3Y3dbKc4YModGk9TieaNxN0kF5vvANOaM.ipa
- iOS 链接只读检查返回 HTTP 200；文件大小为 171004026 字节。未下载或安装到本机。
- Android：`FINISHED`，2026-09-08 09:50:21 UTC 完成，版本 `1.1.1 (4)`。
- Android APK：https://expo.dev/artifacts/eas/h5sXfP0GIb86wIZlF2efTYLhQG9bhQroqoaOon3vsoM.apk
- Android 链接只读检查返回 HTTP 200；文件大小为 204223148 字节。未下载或安装到本机。
- 尚未提交 TestFlight、发布商店或发布 OTA。

注意：旧安装包不会自动变成新版；Android 安装新 APK，iOS 后续仍需提交 TestFlight 才能供测试者安装。
