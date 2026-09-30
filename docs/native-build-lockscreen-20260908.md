# 2026-09-08 锁屏计时 UI 原生构建记录

用户授权：重新 Build Android 和 iOS；不包括 OTA、TestFlight 提交或商店发布。

## 构建前检查

- 版本：1.1.2，runtime 采用 appVersion 策略。
- Android：dky2004/outdoor-rehab-fit，preview，APK，沿用现有签名。
- iOS：maxcch.c/outdoor-rehab-fit，production，新增 OutdoorFitTimerWidget 扩展。
- 最新已完成的旧版本为 Android 1.1.1 Build 5（db608769-e6ad-41a0-8fd2-5368a78c2b76）、iOS 1.1.1 Build 15。它们不作为本轮锁屏 UI 交付。
- 本地未发现 EAS 构建/更新进程；两项目最新任务均已完成。
- app.json 与遗留 android-build-backup 只有 owner、projectId、updates URL 三处差别。已恢复 iOS 项目，完整配置与备份语义一致；遗留备份移到 workspace-artifacts/native-build-lockscreen-20260908/app-ios-recovered-backup.json，可恢复，没有删除。
- 构建前 iOS 配置 SHA-256：1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C。
- 前置验证见 lockscreen-timer-ui-20260908.md：375 项 Jest、10 项插件测试、类型检查及三端导出通过；本轮需要新的真实原生编译验证。

## 进度

- Android：1.1.2 Build 6，构建 ID `583106e2-800b-4410-a5f9-1ce106e4a0b4`，`FINISHED`。
- Android 构建页面：https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/583106e2-800b-4410-a5f9-1ce106e4a0b4
- Android 新布局资源编译通过；2026-09-08 10:49:01 UTC，`:session-timer-notification:compileReleaseKotlin` 以及后续 Java 编译通过，最终 `BUILD SUCCESSFUL`。
- Android 上传后 app.json 已恢复 iOS 项目，SHA-256 与构建前一致，无活动构建备份。
- iOS：原 API Key 通过 Apple 只读校验，原证书有效且团队匹配；新 `.timer-widget` 标识及其独立 App Store profile `Y38NW8SLWK` 已建立，并复用原证书。创建后重新查询确认主证书及主描述文件 ID 不变；未生成或吊销任何证书/API Key。
- iOS 已分配 1.1.2 Build 16，正式构建命令通过主 APP 和 Widget 双 target 签名检查，使用 `--freeze-credentials`。333 MB 源码上传完成（6 分 36 秒）。
- iOS 构建 ID：`0598d2ac-a228-44d3-b16d-52276cb0a8d4`。
- iOS 构建页面：https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/builds/0598d2ac-a228-44d3-b16d-52276cb0a8d4
- iOS 云端 Xcode：10:52:20 UTC Widget 链接成功，10:52:23 Widget 签名，10:52:46 SessionTimerNotification 原生库打包，10:53:36 主 APP 签名，10:53:37 Archive Succeeded；最终 `FINISHED`。
- 双 target 确认使用相同原证书（有效至 2027-08-28），主 profile `XRU2669S2R` 与新 widget profile `Y38NW8SLWK` 均 active。

## 最终安装包

- Android APK：https://expo.dev/artifacts/eas/Bq5_pWy_WHVTvESsCsCZRNBAvu2gf3qdhARaFFt6KrY.apk
- Android 完成：2026-09-08 18:54:26（香港时间），大小 204231212 字节，约 194.77 MiB，HEAD 验证 HTTP 200。
- iOS IPA：https://expo.dev/artifacts/eas/Pg3aBOUr8SrF4wsQofLYjkMjFjrgfxpcN3djLN3kxGA.ipa
- iOS 完成：2026-09-08 18:53:59（香港时间），大小 171137651 字节，约 163.21 MiB，HEAD 验证 HTTP 200。
- 主代理通过 EAS 再次核对两端 `FINISHED`、版本 1.1.2、构建编号 6/16 及以上下载地址。
- 本次仅完成 Build，没有执行 TestFlight 提交、商店发布或 OTA。iOS App Store IPA 不能像 Android APK 一样直接安装，下一步需要提交 TestFlight。
- 本地配置仍是 maxcch.c iOS 项目，原配置哈希保持一致。保留已核对的旧备份副本。
- 真实原生编译已通过；锁屏显示、Always-On、各机型通知设置、字体及点击链路仍需安装后真机验收。

## 后续 TestFlight 提交（用户另行授权）

- 用户随后明确授权将 Build 16 提交到 TestFlight。
- 已再次核对版本 1.1.2、Build 16、iOS project 1d1f05e7-ef12-456a-9c53-31bce530f5b3、bundle com.polyu.rs.outdoorrehabfit、ASC App ID 6742685136。
- 提交前 EAS 只有旧 Build 14 的完成记录，未发现 Build 16 重复提交。
- 使用指定 build ID 0598d2ac-a228-44d3-b16d-52276cb0a8d4，而非 --latest；复用 EAS 中现有提交 API Key。
- 未设置测试群组、未自动创建 TestFlight 群组，未发布正式商店或 OTA。
- 提交 ID：35a444c5-e1ef-4d0d-8857-847b941ec6c8。
- 提交页面：https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/submissions/35a444c5-e1ef-4d0d-8857-847b941ec6c8
- 最终 EAS 提交状态：FINISHED，error = null，已成功上传到 App Store Connect。
- 上传完成后又通过现有 API Key 只读查询 Apple：最新可见 TestFlight 构建仍为 1.1.0 (14)，暂未列出 1.1.2 (16)；因此不能声称 Build 16 已完成 Apple 处理或已可供测试者安装。
- 正式 App Store 版本仍为 1.0 (2)，没有新增正式审核或待发布版本。本轮未变更测试群组。
