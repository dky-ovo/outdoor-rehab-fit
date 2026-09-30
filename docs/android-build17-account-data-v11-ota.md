# Android Build 17：账号同步审查修正版 v11

本版修复目标和偏好设置在网络回包丢失后的编辑覆盖问题，并为旧版本保留的登录状态补齐经服务端验证的账号 ID。AI 后台队列的修复需要同时安装后端 v11，不能只发布 OTA。

适用于已经安装 Android 1.2.3 / Build 17 的设备：

- Expo owner：`dky2004`
- Project：`bcee8c37-e833-4f4d-b660-aa457accd96d`
- Android package：`com.maxcch.c.outdoorrehabfit`
- Runtime：`1.2.3`；channel：`preview`
- API：`https://api.outdoorfit.hk/api`

交付导出目录是 `workspace-artifacts/android-build17-account-data-20260930-v11/export`。发布脚本先验证源码、配置及导出清单；发布时仅上传这份导出，并在结束或失败后恢复原始 `app.json` 字节和环境变量。不要改用根目录的默认 iOS 项目发布 Android。

在 Windows PowerShell、项目根目录执行：

```powershell
& .\scripts\android-build17-account-data-v11-ota.ps1 -Action Verify
& .\scripts\android-build17-account-data-v11-ota.ps1 -Action Publish
```

`Publish` 是实际发布操作，需要在后端及网页安装 v11 后由操作者执行。准备交付和推送 GitHub 不代表已经发布 OTA。

首次构建新交付时使用 `-Action Export`。该命令拒绝覆盖已有 v11 导出；旧版 v10 的脚本、清单和导出保留不变。源码继续变化后应创建下一独立版本，不要重新封存或覆盖本版。

后端安装、校验和与上传命令见 `docs/account-data-delivery-20260930-v11.md`。
