# Android Build 17 设置页动画 OTA v3

本轮调整设置页标题栏的归属，并为 Android 设置页明确指定原生横向切换动画。只更新 JavaScript；不会生成 APK，不修改已冻结的 OTA v1/v2 工具或产物。尚未验证 Android 真机帧率、过渡动画与交互表现，不承诺所有设备均无跳动。

固定 Android 1.2.3（Build 17）、runtime `1.2.3`、`preview` 通道；项目为 `dky2004` 的 `bcee8c37-e833-4f4d-b660-aa457accd96d`，API 为 `https://api.outdoorfit.hk/api`。不要与任何 Android/iOS 构建或发布脚本并行运行。

## 源码冻结后在本机导出

在项目根目录的 Windows PowerShell 执行：

```powershell
.\scripts\android-build17-setting-motion-ota.ps1 -Action Export
```

使用现有依赖离线导出 Android，最多 2 个 worker，不上传。API 环境变量仅对本次导出进程生效，dotenv 自动读取关闭。临时选择 Android 项目及 runtime 后，`finally` 恢复原 `app.json` 字节和本次改动的进程环境变量。

独立输出目录为 `workspace-artifacts/android-build17-setting-motion-20260924-v3/`，已存在时拒绝覆盖。`export/` 是发布输入；`release-manifest.json` 绑定本轮标识、每个导出文件的 SHA256/大小、配置、工具及客户端源码，并检查 Android-only metadata、启动包实际包含阿里 API 地址，以及导出前后源码一致性。

## 核验及发布

先核验已审核产物：

```powershell
.\scripts\android-build17-setting-motion-ota.ps1 -Action Verify
```

以下命令会上传并发布，只有决定发布本轮 v3 时才执行：

```powershell
.\scripts\android-build17-setting-motion-ota.ps1 -Action Publish -Message 'Fix Android settings header jumps and native slide transitions'
```

发布固定使用 `eas-cli@24.7.0`，仅 `--platform android --channel preview`，以 `--input-dir` 指向已核验的绝对目录，明确 `--skip-bundler`，避免发布时重新导出或误发 iOS。已登录且不需交互时可加 `-NonInteractive`。本轮请使用 v3 入口，不要改用旧版本入口。

各专用工作流共同使用 `app.json.android-build17-ota-backup` 保存原始配置并拒绝重叠操作。若进程被强制终止，先核验并恢复该备份，不要删除后盲目重跑。导出失败会保留现场；成功后不要编辑清单绑定的源码、工具或本说明再发布。

准备脚本不代表已导出、上传、发布或安装；以实际命令结果为准。发布后仍需在已安装 Build 17 的 Android 真机观察进入设置子页、返回、手势及键盘相关的过渡表现。
