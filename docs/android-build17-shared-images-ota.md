# Android Build 17 共用图片显示 OTA v6

用户已发布 OTA v5 并重新打开应用，收藏列表小图和详情图仍有加载过程。本轮使用统一的 `EquipmentImage` Expo 图片渲染，覆盖列表、详情、GIF、弹窗和聊天中的器材图片，取消 Android React Native 本地文件图片的默认淡入。公开器材主图可以复用已解码的内存引用，减少从列表进入详情时的重复准备。

预解码缓存最多 12 张、预算 32 MiB；这是该缓存的预算，不是整个 App 的总内存承诺。通过 `Image.loadAsync` 读取本地 `file://` 图片，设置 `maxWidth: 1024`、`maxHeight: 1024`，优先可见主图，其次收藏主图；不批量预解码 GIF，并拒绝将动画引用加入这一缓存。文件下载失败后最多在 5 秒、20 秒后重试两次，退到后台或退出时取消。冷启动、首次图片和缓存未命中仍需实际准备时间，不能承诺真机零延迟。

已只读核对 Build 17 APK：DEX 实际定义并在 Expo 生成模块表注册 `ExpoImageModule`，其 `definition` 方法包含 `ExpoImage` 名称与 `loadAsync` 注册常量；现有 `expo-image` 3.0.11 源码也提供对应接口。本轮使用现有原生能力，不制作新安装包或服务器补丁，不修改已冻结 OTA v1–v5 的工具或产物。

目标固定 Android 1.2.3（Build 17）、runtime `1.2.3`、`preview` 通道；项目为 `dky2004` 的 `bcee8c37-e833-4f4d-b660-aa457accd96d`，API 为 `https://api.outdoorfit.hk/api`。不要与任何 Android/iOS 构建或发布脚本并行运行。

## 源码与本说明冻结后导出

在项目根目录的 Windows PowerShell 执行：

```powershell
.\scripts\android-build17-shared-images-ota.ps1 -Action Export
```

使用现有依赖离线导出 Android，最多 2 个 worker，不上传。阿里 API 环境变量仅对本次导出进程生效，关闭 dotenv 自动读取。临时选择 Android 项目和 runtime 后，`finally` 恢复原 `app.json` 的完整字节及本次改动的进程环境变量。

独立输出目录为 `workspace-artifacts/android-build17-shared-images-20260925-v6/`，已存在则拒绝覆盖。`export/` 为发布输入；`release-manifest.json` 绑定导出文件 SHA256/大小、配置、工具、此说明及客户端源码，检查 Android-only metadata、启动包中的阿里 API 地址和导出前后源码一致性。

## 核验与发布

```powershell
.\scripts\android-build17-shared-images-ota.ps1 -Action Verify
.\scripts\android-build17-shared-images-ota.ps1 -Action Publish
```

发布固定 `eas-cli@24.7.0`、Android `preview`，显式使用已审核的 `--input-dir` 与 `--skip-bundler`，不会重新导出或发布 iOS。工具准备完成不代表已经导出、上传、发布或安装。发布后仍需在 Build 17 真机分别验证冷启动、收藏列表到详情的切换、图片替换、GIF 和网络失败后的恢复；本地语法与合成检查不等于真机表现验证。
