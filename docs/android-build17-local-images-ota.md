# Android Build 17 手机本地图片 OTA v5

本轮将受支持的公开器材主图和左右示范 GIF 持久保存到手机本地，并通过先恢复本地会话、再后台校验减少启动等待。缓存预算为 256 MiB，每文件最多 16 MiB，最多同时下载 2 个文件，收藏主图优先；不会缓存所有视频或私密用户附件。预算、磁盘空间不足或下载失败时暂缓保存，仍可使用当前图片的网络来源，不保证一次下载完整目录。

应用先恢复本地会话与用户目录，再后台校验登录状态；图片同步不阻塞登录和页面显示。登录后后台检查公开器材目录，应用退到系统后台时取消下载，回到前台后恢复并按间隔检查更新。先读取本地图片索引，再按精确图片 URL 选择文件，避免把旧图用作新图的回退。仅准备手机更新，不生成服务器补丁，不修改已冻结 OTA v1–v4 的工具或产物。

目标固定 Android 1.2.3（Build 17）、runtime `1.2.3`、`preview` 通道；项目为 `dky2004` 的 `bcee8c37-e833-4f4d-b660-aa457accd96d`，API 为 `https://api.outdoorfit.hk/api`。不要与任何 Android/iOS 构建或发布脚本并行运行。

已只读核对交付 Build 17 APK（SHA256 `108bd8cb101130f8b4b414e694e0049a39105639109ca483d4040e2234b99b32`）：DEX 类定义和 Expo 生成注册表均包含 `FileSystemModule`、`FileSystemLegacyModule`。现有锁定源码为 `expo-file-system` 19.0.24；APK 不保留该模块补丁版本号，此项原生能力核验不等于真机下载、磁盘或离线体验测试。

## 源码与本说明冻结后导出

在项目根目录的 Windows PowerShell 执行：

```powershell
.\scripts\android-build17-local-images-ota.ps1 -Action Export
```

使用现有依赖离线导出 Android，最多 2 个 worker，不上传。阿里 API 环境变量仅对本次导出进程生效，关闭 dotenv 自动读取。临时选择 Android 项目和 runtime 后，`finally` 恢复原 `app.json` 的完整字节及本次改动的进程环境变量。

独立输出目录为 `workspace-artifacts/android-build17-local-images-20260925-v5/`，已存在则拒绝覆盖。`export/` 为发布输入；`release-manifest.json` 绑定导出文件 SHA256/大小、配置、工具、此说明及客户端源码，检查 Android-only metadata、启动包中的阿里 API 地址和导出前后源码一致性。

## 核验与发布

```powershell
.\scripts\android-build17-local-images-ota.ps1 -Action Verify
.\scripts\android-build17-local-images-ota.ps1 -Action Publish
```

发布固定 `eas-cli@24.7.0`、Android `preview`，显式使用已审核的 `--input-dir` 与 `--skip-bundler`，不会重新导出或发布 iOS。工具准备完成不代表已经导出、上传、发布或安装。发布后仍需在 Build 17 真机验证首次保存、重新打开、图片替换及本地会话恢复后的后台校验；不声称本地检查已证明真机表现。
