# Android Build 17 设置与图片修复 OTA v4

本轮为 Android 设置页采用轻微缩放与淡入切换，不使用横向位移动画，并保留稳定的标题栏归属与 replace/pop 处理；修复器材目录冷启动和图片回退逻辑，避免已替换器材图短暂显示旧内置图。只更新 JavaScript，不生成 APK，不修改已冻结的 OTA v1–v3 工具或产物。真机过渡与冷启动图片表现仍需实际验证，不能仅凭本地检查保证所有设备均无闪动。

固定 Android 1.2.3（Build 17）、runtime `1.2.3`、`preview` 通道；项目为 `dky2004` 的 `bcee8c37-e833-4f4d-b660-aa457accd96d`，API 为 `https://api.outdoorfit.hk/api`。不要与任何 Android/iOS 构建或发布脚本并行运行。

## 源码冻结后导出

在项目根目录的 Windows PowerShell 执行：

```powershell
.\scripts\android-build17-setting-image-ota.ps1 -Action Export
```

使用现有依赖离线导出 Android，最多 2 个 worker，不上传。API 环境变量只对本次导出进程生效，dotenv 自动读取关闭。临时选择 Android 项目及 runtime 后，`finally` 恢复原 `app.json` 字节和本次改动的进程环境变量。

输出目录独立固定为 `workspace-artifacts/android-build17-setting-image-20260924-v4/`，已存在则拒绝覆盖。`export/` 是发布输入；`release-manifest.json` 绑定本轮标识、导出文件 SHA256/大小、配置、工具及客户端源码，并核验 Android-only metadata、启动包中的阿里 API 地址，以及导出前后源码一致性。

## 核验及发布

先核验已审核产物：

```powershell
.\scripts\android-build17-setting-image-ota.ps1 -Action Verify
```

以下命令会上传并发布，只有决定发布本轮 v4 时才执行：

```powershell
.\scripts\android-build17-setting-image-ota.ps1 -Action Publish -Message 'Restore settings native transition and prevent replaced equipment image flashes'
```

发布使用固定 `eas-cli@24.7.0`，仅 `--platform android --channel preview`，`--input-dir` 指向已核验的绝对目录，明确 `--skip-bundler`，不在发布时重新导出或改发 iOS。已登录且无需交互时可加 `-NonInteractive`。本轮请使用 v4 入口。

专用工作流共同使用 `app.json.android-build17-ota-backup` 保存原始配置并拒绝重叠操作。若进程被强制终止，先核验并恢复备份，不要删除后盲目重跑。失败导出保留现场；成功后不要编辑清单绑定的源码、工具或本说明再发布。

工具准备完成不代表已导出、上传、发布或安装。发布后须在 Build 17 真机观察设置页进入和返回，以及目录未缓存、已缓存和图片加载失败时的器材图片表现。后端交付与此 OTA 独立，本工具不更新服务器。
