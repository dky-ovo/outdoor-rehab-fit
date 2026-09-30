# 帐户资料同步 v10 交付

原因：v9 已把 AI 生成任务放到服务器，但对话历史仍在各设备的本地存储。收藏已有独立同步，此次继续保留。新增 AI 历史、训练目标、SMART 目标、语言选择和使用统计同步，补齐学习进度下载，并在后台同步既有运动记录/日记、刷新姓名头像。设置页显示同步状态并可重试。

所有个人资料按服务端账号 ID 隔离；本地缓存即时展示，联网后合并。AI 历史在各语言的历史记录中查看，不会覆盖另一设备的输入框。已删除历史不会被旧设备复活；目标按单项版本处理并发，使用计数按设备分量合并，学习覆盖证据去重且不生成虚假的科研事件。图片视频缓存、凭据和正在计时的状态属于设备本地。

**先后端和网页，再手机 OTA。** 本次仅完成本地修改、验证、导出和打包，未上传、部署或发布。首次更新后必须让原手机联网打开一次，之前本地的 AI 历史才能上传；另一设备登录同一账号后从历史记录查看。不要为更新而清除原手机存储或重装。

服务器包：`deploy/account-data-20260928/outdoor-fit-account-data-20260928-v10-delta.tar.gz`，**1,502,175 字节**。

SHA-256：`8365ac7d0518e3abb57382fd7811bfffcd00b8b015c313902b698bfd8a97a9bd`。

Windows PowerShell 上传：

```powershell
scp -P 28832 "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\account-data-20260928\outdoor-fit-account-data-20260928-v10-delta.tar.gz" root@47.83.186.36:/root/
```

阿里 ECS Bash 安装：

```bash
(
set -euo pipefail
umask 077
cd /root
printf '%s\n' '8365ac7d0518e3abb57382fd7811bfffcd00b8b015c313902b698bfd8a97a9bd  outdoor-fit-account-data-20260928-v10-delta.tar.gz' | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-account-data.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
tar --extract --gzip --file=outdoor-fit-account-data-20260928-v10-delta.tar.gz --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
python3 "$update_dir/outdoor-fit-account-data-20260928-v10/install.py"
)
```

仅在提示时输入 `outdoor_fit_migrator` 的 RDS 密码。安装新增一张表（40→41），保留现有资料和域名配置；需要线上 API 为已部署的 v9。切换容器会短暂中断连接。成功标志 `ACCOUNT_DATA_UPDATE=PASS`，之后发布手机更新。若失败，保留输出及状态目录，不要删除后盲目重跑。

Windows PowerShell 发布 Android 1.2.3 / Build17：

```powershell
Set-Location 'D:\polyu work\outdoor-rehab-fit-anesthesia'
powershell -ExecutionPolicy Bypass -File .\scripts\android-build17-account-data-v10-ota.ps1 -Action Publish
```

成功标志 `OTA_ANDROID_PREVIEW_PUBLISHED=YES`。原手机接收更新并重新打开，设置页等待“帳戶記錄已同步”。网页版刷新并登录同一账号，在 AI 页历史记录中查看。完整手机说明在 `docs/android-build17-account-data-v10-ota.md`。

验证：20 个前端套件共 290 项通过；29 项后端测试通过，覆盖账号隔离、离线重试、并发修改、删除墓碑、AI 关闭页面后结果持久化、跨设备历史、目标/统计/语言、学习证据合并、登录退出及现有收藏。修复一处同步刷新影响临时对话恢复的回归后，相应 20 项对话集成用例重新通过。完成网页和 Android/Hermes 导出、脚本语法、归档逐文件校验及 OTA 清单校验。未在真实 RDS、ECS Docker 或实体手机运行本次版本；安装程序包含现场启动和 HTTPS 检查。

Android 清单：241 个文件、167,544,105 字节，SHA-256 `08d1330c4562144a894c81ced5ed7b006971c821c675531b6e7d7ad0514494b9`。原 app.json 已按字节恢复（SHA-256 `d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe`）。

服务器失败可使用 `/opt/outdoor-fit/production/.update-state/account-data-20260928-v10/rollback.sh` 恢复兼容旧服务，保留新增表及已同步资料。不要直接用未经兼容处理的 v9 镜像重启，它只允许 40 张表。此包未改变原有单 API 实例的后台 AI 队列部署模式。
