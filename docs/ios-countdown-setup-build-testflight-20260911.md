# iOS 倒计时设置更新构建与 Apple 提交（2026-09-11）

用户授权：构建当前 iOS 版本并发送到 Apple。范围为 App Store Connect / TestFlight，不发布正式 App Store，不新建测试群组，不发布 OTA。

## 输入及核验

- 项目：`maxcch.c/outdoor-rehab-fit`，ID `1d1f05e7-ef12-456a-9c53-31bce530f5b3`。
- 主应用：`com.polyu.rs.outdoorrehabfit`；Widget：`com.polyu.rs.outdoorrehabfit.timer-widget`。
- production profile / production channel；APP 与 runtime 为 `1.1.8`。
- 远程 buildNumber 已由 16 自动增加到 **17**。
- Apple App ID：`6742685136`。
- 包含倒计时结束后恢复初始时间设置、删除“再次开始”、不弹运动记录，以及项目当前其他已完成修改。
- 本地预检：186 项 Jest 与 18 项插件测试通过（204 项）；9 个必要 Swift、podspec、插件、隐私文件均存在且未被 `.easignore` 排除。
- iOS 使用 ActivityKit 和系统通知提醒；未配置后台 audio mode。Android 原生服务的真机表现不能作为 iOS 音频或锁屏效果的验收。
- 使用 `--freeze-credentials`，沿用现有主应用与 Widget 签名；主描述文件 `XRU2669S2R`、Widget 描述文件 `Y38NW8SLWK` 均 active，证书有效至 2027-08-28。没有创建或吊销签名证书/API Key。
- App Store Connect API Key 已通过只读状态查询：当前正式版本仍为 1.0（2）；旧 TestFlight 1.1.2（16）为 VALID / IN_BETA_TESTING。
- `app.json` SHA-256 保持：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。

## 构建与提交状态

- 已发起一次 iOS production 构建，源码归档约 334 MB，上传完成（59 秒），项目指纹计算完成。
- 构建 ID：`2eb1e7e8-5820-411d-bf5e-0cd1a4202f55`；[iOS Build 17 构建页面](https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/builds/2eb1e7e8-5820-411d-bf5e-0cd1a4202f55)。
- 云端构建已 `FINISHED`，版本 1.1.8 / Build 17，error 为 null；完成于 2026-09-11 17:09:33（香港时间）。
- IPA：[Build 17 产物](https://expo.dev/artifacts/eas/EHoct6D6OSiKqp0ZGC92ZuzjkkWAuTuOdvUwf8mYRBA.ipa)。App Store IPA 不能像 Android APK 一样直接安装，应通过 TestFlight。
- IPA 响应头核验 HTTP 200，171,882,217 字节；本轮未下载到本地磁盘。
- 已指定本次构建 ID 完成 Apple 提交，使用 `--no-auto-testflight-setup --non-interactive --wait`。不使用 `--latest`，不创建测试群组。
- EAS 已安排一次提交：`82656a2f-d854-44f2-a0ec-5f75cbebe00e`；[提交进度](https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/submissions/82656a2f-d854-44f2-a0ec-5f75cbebe00e)。目标 ASC App ID、项目、版本 1.1.8 与 Build 17 均再次核对一致，使用 EAS 中已保存的 API Key。
- EAS 提交最终状态：`FINISHED`，error 为 null；完成于 2026-09-11 17:14:52（香港时间），命令退出码 0。
- 2026-09-11 17:22 再次通过 Apple API 只读核对：1.1.8（17）已列出，`processingState=VALID`、`internalState=IN_BETA_TESTING`、`externalState=READY_FOR_BETA_SUBMISSION`、`expired=false`。
- 因此 Apple 已处理完成并进入内部测试；外部测试尚未提交 Beta 审核。本轮没有创建/修改测试群组或提交外部测试审核。
- 正式 App Store 仍为 1.0（2）/ READY_FOR_DISTRIBUTION，未改变正式商店版本。
- [App Store Connect TestFlight](https://appstoreconnect.apple.com/apps/6742685136/testflight/ios)。已授权的内部测试者可在 TestFlight 查看 1.1.8（17）；未直接验证某一台手机的安装状态。
- 发布后 `app.json` 哈希与构建前一致。未更新 Android OTA、服务器或正式 App Store。

```powershell
node '<已安装的 eas-cli>/bin/run' build --platform ios --profile production --message '倒计时结束返回初始设置及当前APP更新' --freeze-credentials --non-interactive --no-wait
node '<已安装的 eas-cli>/bin/run' submit --platform ios --profile production --id 2eb1e7e8-5820-411d-bf5e-0cd1a4202f55 --no-auto-testflight-setup --non-interactive --wait
```

本记录中的“云端编译成功”“EAS 提交成功”“Apple 处理完成”“测试者可安装”是不同状态，以后续实际查询结果为准。
