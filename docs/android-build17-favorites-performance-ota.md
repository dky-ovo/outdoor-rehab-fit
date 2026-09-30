# Android Build 17 收藏显示与导航更新 v7

本次针对 v6 仍出现的收藏等待，修正跨隐藏分页进入详情的导航结构，复用已读取的本地收藏快照，并为实际使用的内置器材主图准备有上限的原生图片缓存。详情的文字和主图先显示，下方播放器等资源稍后初始化。共享教学详情业务逻辑，收藏不改存储位置，不改变数据库、短信配置或账号权限。

此文件与 v7 导出一起封存。检查结论和实测限制见 `android-favorites-deep-audit-20260925.md`。

在 Windows PowerShell 执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\android-build17-favorites-performance-ota.ps1" -Action Verify
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\android-build17-favorites-performance-ota.ps1" -Action Publish
```

目标固定为 dky2004 / Android 项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`、preview 通道、runtime 1.2.3，与已安装的 1.2.3 / Build 17 兼容。使用已导出的文件，不重新打包发布中的源码；调用固定 eas-cli 24.7.0。脚本临时切换 Android 配置，并在退出时恢复原 app.json 和进程环境。不是服务器 Bash 命令。

产物目录：`workspace-artifacts/android-build17-favorites-performance-20260925-v7/export`。Publish 前会核对源码、配置、脚本与全部导出文件；如校验不一致，应保留现有产物并重新制作新版本，不能覆盖封存清单。

本文和准备导出均不代表已经发布。需用户执行 Publish、手机联网接收并重新打开。首次联网取得替换照片、系统内存回收或尚未完成本地准备时仍可能短暂等待；自动检查不能代替用户手机上的帧率与缓存命中记录。
