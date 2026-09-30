# 安卓平板启动兼容性重建（2026-09-23）

## 范围及边界

用户在只读排查后明确要求“直接检查程序并重新 build”。本轮仅构建 Android，保留现有功能与正常界面。没有修改服务器或发布 OTA，不构建 iOS，也不清除用户设备数据。

此前已确认平板“点击图标立即闪退”，但没有设备型号、Android 版本或崩溃堆栈；ADB 已准备，设备列表仍为空。本轮修复的是可复现的启动边界和图片解码风险，不能将自动化测试或 EAS 构建成功当成已确定/修复该平板根因。

## 本轮变更

1. `components/AppUpdateOverlay.js`：前后台状态比较不再对可能为空的值调用 `.match()`，空初始状态不会抛异常。
2. `contexts/LocaleContext.js`：系统语言接口返回空列表、无语言信息或抛错时，沿用中文默认设置，不阻断启动。
3. `app/_layout.js`：启动画面、系统背景、播放模式初始化的同步异常/异步拒绝均捕获；可选字体加载失败时结束启动等待并使用系统回退字体。
4. `app/(tabs)/index.js`：首页原图增加 Android `resizeMethod="resize"`。5378×3586 的原图完整 RGBA 解码约 73.57 MiB；按实际显示区域预缩小解码，降低内存风险。不替换图片、不改变容器、比例或裁切。
5. `app.config.js`：安卓发布项目 `bcee8c37-e833-4f4d-b660-aa457accd96d` 的版本最低升为 1.2.3，沿用 appVersion runtime 规则，避免已发布的 1.2.2 OTA 覆盖新包启动改动。独立 iOS 项目仍为 1.2.2，未来更高版本不会被降级。

原生模块和插件未发现可确认的新启动缺陷，本轮不猜测性改动；未重新加入语音输入模型、录音权限或第三方原生库。

## 验证

- 新增启动组件回归：3 套 22 项通过。
- 首页和平板尺寸回归：2 套 51 项通过；原图 SHA-256 未变。
- 配置/运行时回归：27 项通过，确认安卓 1.2.3、iOS 保持 1.2.2。
- 原生模块契约 99 项、纯 Java 粤语选择 28 条断言、裁剪插件 8 项模板转换测试通过。这些不是 Android 真机测试。
- Expo 依赖兼容性检查通过，没有升级依赖。
- TypeScript 检查、Android Metro/Hermes 预导出通过。
- 全量前端回归：136 套、2034 项全部通过（1 个 snapshot 通过），运行 193 秒。
- EAS 已完成新构建：`5a7aef9b-b429-425d-96dd-b49d5745e7c3`，状态 `FINISHED`，版本 1.2.3 / Build 17 / runtime 1.2.3，2026-09-23 10:54:40 香港时间完成。
- 最终 APK 二进制清单确认包名 `com.maxcch.c.outdoorrehabfit`、版本 1.2.3、versionCode 17、Expo runtime 1.2.3、preview 频道；包含 arm64-v8a 和 armeabi-v7a。
- ZIP 1896 项 CRC 全部通过，粤语/英文的半程及结束共 4 段语音原生资源与源文件字节完全匹配；没有重新加入录音权限或 ASR 资源。
- 48 个 `.so` 文件与 Build 16 的 SHA-256 全部一致；APK v2 证书字节指纹与 Build 16、Build 10–12 一致。此项是证书提取比对，不是完整 APK 签名验签，也不是设备运行验证。
- 只读检查明细：`workspace-artifacts/android-build17-native-verification-20260923.json`、`workspace-artifacts/android-build17-integrity-verification-20260923.json`。

## 构建约束

使用既有 `scripts/build-android-preview.ps1 -NonInteractive -NoWait` 提交，仅切换现有安卓项目并冻结签名凭据；脚本 finally 恢复 iOS 的原始 `app.json`。提交前该文件 SHA-256 为 `D2AC8FCA2075FCE08A9F79AB3E7163A5EB2B84BB8BE521638DBB1197C5D4B1FE`，完成后复核。

构建提交后复核 `app.json` SHA-256 与上述值完全相同，原 iOS 项目配置已恢复。

原 APK 为 1.2.2 / Build 16，本轮 EAS 已确认 1.2.3 / Build 17。安装时应覆盖安装以保留数据；如仍闪退，保留设备状态并采集崩溃日志，不通过清空数据掩盖问题。

## 构建交付

- 构建页面：https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/5a7aef9b-b429-425d-96dd-b49d5745e7c3
- 官方 APK：https://expo.dev/artifacts/eas/LdmEe5qUB6xdyvLXs0gAgy4sYP5vfBU5acSGOvcUh6Y.apk
- 本地已完整下载：`deploy/2026-09-23/outdoor-fit-android-1.2.3-build17.apk`。
- 文件大小：205,761,830 字节（196.23 MiB）。
- APK SHA-256：`108BD8CB101130F8B4B414E694E0049A39105639109CA483D4040E2234B99B32`。
- 本轮不需要服务器 SSH 操作；没有发布 OTA，没有构建或提交 iOS。
