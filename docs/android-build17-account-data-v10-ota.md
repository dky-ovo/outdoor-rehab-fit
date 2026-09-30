# Android Build17 帐户资料同步 v10

适用于已安装 Android 1.2.3 / Build17，runtime 1.2.3、preview 通道。仅 JavaScript 更新，无需重装 APK。先完成阿里云 v10 后端更新，再发布本次已导出的 OTA。

Windows PowerShell：

```powershell
Set-Location 'D:\polyu work\outdoor-rehab-fit-anesthesia'
powershell -ExecutionPolicy Bypass -File .\scripts\android-build17-account-data-v10-ota.ps1 -Action Verify
powershell -ExecutionPolicy Bypass -File .\scripts\android-build17-account-data-v10-ota.ps1 -Action Publish
```

脚本绑定 Android 项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`，API 为 `https://api.outdoorfit.hk/api`，校验源码和产物，临时切换配置后按字节恢复原配置。不重新打包旧版本。成功标志 `OTA_ANDROID_PREVIEW_PUBLISHED=YES`。未出现成功标志不能视为已发布。

先在原手机接收更新并联网打开，设置页等待“帳戶記錄已同步”。旧 AI 历史此前在设备本地，需要该设备执行一次上传。网页版刷新后登录同一账号，在 AI 历史记录查看导入的对话。新设备不会被强行切入另一设备当前会话。训练目标、SMART 目标、学习进度和使用统计也会合并恢复。已有收藏同步保持原逻辑。

上传网络错误会保留本地导出及原配置，可重试同一 Publish 命令。不要重装或清除旧手机 App 存储来解决上传故障，以免丢失尚未上云的历史。
