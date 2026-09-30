# Android Build 17 本次 OTA

目标固定为 Android 1.2.3（Build 17），`dky2004` 的既有项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`、`preview` 通道、runtime `1.2.3`。本次只有 JavaScript 更新，不生成 APK，不改变 iOS 配置或 API 全局默认。

## 本地导出

等本次客户端源码冻结后，在项目根目录的 Windows PowerShell 执行：

```powershell
.\scripts\android-build17-ota.ps1 -Action Export
```

使用现有依赖离线导出，仅 Android，最多 2 个 worker。导出进程设置 `EXPO_PUBLIC_API_BASE_URL=https://api.outdoorfit.hk/api`，关闭 dotenv 自动读取；临时选择 Android 项目及 runtime。成功或失败都会在 `finally` 中恢复原 `app.json` 的每个字节和本次改动的进程环境变量。

产物固定在 `workspace-artifacts/android-build17-aliyun-fixes-20260924-v1/`。目录已存在时拒绝覆盖；失败导出会保留现场，不要改名旧产物后直接发布。`export/` 为实际 EAS 输入，`release-manifest.json` 记录每个导出文件的大小、SHA256、目标项目/runtime/API，以及相关配置、发布工具和客户端源码哈希。导出前后源码不同则拒绝封存。

## 核验及发布命令

先核验已审核产物：

```powershell
.\scripts\android-build17-ota.ps1 -Action Verify
```

**以下命令会上传并发布到 Android preview，只有决定正式发布本次 OTA 时才执行：**

```powershell
.\scripts\android-build17-ota.ps1 -Action Publish -Message 'Aliyun API, favorites, About and Contact fixes for Android Build 17'
```

发布使用固定 `eas-cli@24.7.0`，指定 `--platform android --channel preview --input-dir <已审核绝对目录> --skip-bundler`。先核验所有哈希，再重新核对解析后的 Android 项目、包名、版本及 runtime；不会重新打包当前工作区或发布 iOS。已登录且无需交互时可加 `-NonInteractive`。旧通用 `publish-android-preview-update.ps1` 保留原行为；本次请使用上述专用入口。

若系统强制终止 PowerShell 导致 `finally` 未执行，保留的 `app.json.android-build17-ota-backup` 是原始配置备份；先停止操作并恢复、核验配置，勿删除备份后盲目重跑。

本说明和脚本的存在只表示交付流程已准备；是否已导出、上传或发布，以实际命令结果为准。
