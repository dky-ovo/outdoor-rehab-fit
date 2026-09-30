# Android Build 17 性能修复 OTA v2

本轮用于 Contact 按 About 页的方式处理加载与回退、减少启动时重复账户校验，以及收藏图片缓存。只更新 JavaScript，不生成 APK，不修改上一轮已冻结的 OTA v1 脚本或产物。

固定 Android 1.2.3（Build 17）、runtime `1.2.3`、`preview` 通道；项目为 `dky2004` 的 `bcee8c37-e833-4f4d-b660-aa457accd96d`，API 为 `https://api.outdoorfit.hk/api`。不得与任何 Android/iOS 构建或发布脚本并行运行。

## 源码冻结后在本机导出

在项目根目录的 Windows PowerShell 执行：

```powershell
.\scripts\android-build17-performance-ota.ps1 -Action Export
```

使用现有依赖离线导出 Android，最多 2 个 worker，不上传任何更新。API 环境变量只对本次导出进程生效，dotenv 自动读取关闭；临时选择 Android 项目/runtime 后，`finally` 恢复原 `app.json` 字节和已改动的进程环境变量。

独立输出目录为 `workspace-artifacts/android-build17-performance-20260924-v2/`，已存在则拒绝覆盖。`export/` 是发布输入，`release-manifest.json` 绑定本轮标识、每个文件的 SHA256/大小、配置、工具及客户端源码；还会检查 Android-only metadata、启动包实际包含阿里 API 地址，以及导出前后源码一致性。

## 核验及发布

先核验：

```powershell
.\scripts\android-build17-performance-ota.ps1 -Action Verify
```

以下命令会上传并发布，只有决定发布本轮 v2 时才执行：

```powershell
.\scripts\android-build17-performance-ota.ps1 -Action Publish -Message 'Faster startup, favorite images and Contact loading for Android Build 17'
```

使用 `eas-cli@24.7.0`，仅 `--platform android --channel preview`，以 `--input-dir` 指向已核验的绝对目录，并明确 `--skip-bundler`，避免发布时重新导出或误发 iOS。已登录且不需要交互时可加 `-NonInteractive`。本轮请勿使用上一轮 v1 入口。

v1/v2 共同使用 `app.json.android-build17-ota-backup` 保留原始配置并拒绝重叠操作。若进程被系统强制终止，先核验并恢复该备份，不要删除备份后盲目重跑。导出失败保留现场；成功后不要编辑清单绑定的源码、工具或本说明再发布。

脚本准备完成不代表已导出、上传、发布或安装；以对应命令的实际结果为准。
