# Android Build 17：后台 AI 与账号收藏 v8

适用已安装 Android 1.2.3 / Build 17，项目 bcee8c37-e833-4f4d-b660-aa457accd96d，preview 通道、runtimeVersion 1.2.3。不修改原生权限，不需要重新安装 APK。

必须先安装 `deploy/account-continuity-20260928` 的服务器及网页更新，再发布手机更新。旧服务器没有任务及收藏同步接口。

Windows PowerShell：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File .\scripts\android-build17-account-continuity-ota.ps1 -Action Verify
powershell -ExecutionPolicy Bypass -File .\scripts\android-build17-account-continuity-ota.ps1 -Action Publish
```

本次为独立 v8 产物，保留 v1–v7 已封存文件。Publish 上传已经导出并校验的 Android 文件，不重新打包当时的工作区；发布脚本会恢复原 app.json。固定 eas-cli 24.7.0、阿里 API 地址。

AI 查询由服务器接收为任务后继续运行，离开页面或关闭手机 App 不取消任务。重新进入前台后读取任务状态，并保存到原对话；切换账号不会显示其他账号的结果。服务器已完成任务保留七天，本地已保存对话继续保留。请求尚未送达服务器时退出，保留的待发送请求会在下次打开时继续提交。服务器进程异常中断会显示失败，避免自动重复付费请求。若本地对话存储损坏或已满，原有保存警告仍显示，临时聊天不承诺关闭 App 后恢复。

收藏继续优先显示本地缓存，登录和返回前台时后台同步，前台期间每 30 秒同步其他设备的变化。本地改动约 1 秒后发送，离线改动保留。初次升级迁移已有本地收藏，云端已取消收藏的记录不会被旧设备的导入重新添加。并发冲突采用服务器版本检查，保留云端较新结果。游客收藏保持本机独立。

这里只记录交付行为。准备或校验不表示已经发布；需用户执行 Publish，手机接收更新并重开。
