# Android 缩放与器材旧图清理交付（2026-09-24）

2026-09-25 后端续更：本说明的后端 v3 已在 ECS 只读检查阶段因 RDS 默认 `READ-COMMITTED` 而停止，未激活。请改用 [后端隔离级别修正版 v4](backend-session-isolation-fix-20260925.md) 的包和命令；下面的旧后端命令仅作历史记录，不再重跑。Android OTA v4 仍有效，无需重新生成。

已准备 Android OTA v4 与阿里 API v3 更新包，尚未上传、发布或部署。

## 本次行为

- Android 设置子页面使用 150ms 原生驱动轻微缩放，配合原生淡入淡出，无左右位移；标题栏归属保持稳定。未在 Android 真机测量帧率。
- 健騎機（器材 ID `9`）不再引用旧内置照片；两份旧照片已从源码和本次导出素材删除。列表、收藏、详情及 AI 推荐的加载与失败状态使用通用占位，不退回旧器材照片。
- 公共器材目录按 API 地址保存最近一次结果，并在后台刷新。设备尚未同步新目录、尤其离线时，可能仍显示上次缓存的新旧版本；服务器无法远程擦除离线设备的缓存。旧 APK 中固有的资源字节需安装新 APK 才能移除，当前 OTA 会停止引用它们。
- 后台以后成功更换器材主图时，确认旧图属于本服务、没有其他活动或可恢复内容引用、不是教学种子素材，才标记永久清理。事务提交后异步删除精确文件；失败和重启后会重试。保存回滚不删除旧图。
- 文件校验、引用扫描或权限不满足时保留旧文件。不是历史孤儿图片全盘清扫；现用的健騎機新图不会被本次上线删除。图片/视频仍在 ECS 文件目录，RDS 保留引用与元数据。
- 永久清理项不进入可恢复的回收站。状态可由有素材权限的后台账号通过 `GET /api/admin/media-retirements` 查询。代码回滚不能恢复已经删除的文件。

## 1. 电脑 PowerShell：发布 Android OTA

固定现有 Android 1.2.3 / Build 17、runtime `1.2.3`、`preview` 通道。不要重新导出，也不要并行执行其他构建或发布脚本。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\android-build17-setting-image-ota.ps1" -Action Publish
```

脚本核验冻结产物后发布 Android，不发布 iOS。发布需要本机 EAS 账号有该项目权限；保留终端返回的更新记录。现有 APK 无需重装，收到更新后重启应用观察生效情况。

本次导出目录：`workspace-artifacts/android-build17-setting-image-20260924-v4/export`。

- 241 个文件，167,382,738 字节（包含复用素材；这不是手机实际增量下载量）。
- 清单 SHA256：`ae315add1de2bb011a4527e84c5f3a71cbcb83d893b30eba199a48873025ee10`。
- `app.json` 原字节已恢复，无遗留临时配置备份。

## 2. 电脑 PowerShell：上传后端更新包

包：`deploy/aliyun-equipment-image-cleanup/outdoor-fit-equipment-image-cleanup-20260924-v3.tar.gz`。

大小：87,211 字节（约 85.2 KiB）。SHA256：

```text
d62707279b639ad9a8a60ffe606adf06ea6cac455479dddcedba6a82a20d6e30
```

```powershell
scp -P 28832 "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\aliyun-equipment-image-cleanup\outdoor-fit-equipment-image-cleanup-20260924-v3.tar.gz" root@47.83.186.36:/root/
```

密码只在 SSH 提示中输入，不发送到聊天。

## 3. 阿里 ECS 的 Xterminal：安装后端更新

以下完整代码在阿里 ECS 的 root Bash 终端执行，不在 Google 服务器或电脑 PowerShell 执行。

```bash
(
set -euo pipefail
umask 077
cd /root

printf '%s\n' 'd62707279b639ad9a8a60ffe606adf06ea6cac455479dddcedba6a82a20d6e30  outdoor-fit-equipment-image-cleanup-20260924-v3.tar.gz' | sha256sum -c -

update_dir="$(mktemp -d /root/outdoor-fit-image-cleanup.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
env -u TAR_OPTIONS tar --extract --gzip \
  --file=/root/outdoor-fit-equipment-image-cleanup-20260924-v3.tar.gz \
  --directory="$update_dir" \
  --no-same-owner --no-same-permissions --keep-old-files

cd "$update_dir/outdoor-fit-equipment-image-cleanup-20260924-v3"
python3 apply-update.py stage
python3 apply-update.py activate
)
```

`stage` 核对已部署 v2 基线，构建候选 API 镜像，并只读核对 RDS TLS、生产账号及事务隔离级别；此阶段不启动清理器。成功后才重启 API，Caddy 和现有 Web 文件保持原样。只修改 4 个后端文件，不改数据库结构、不重新导入数据。

成功应包含：

```text
CLEANUP_READ_ONLY_CHECK=PASS
API_RELEASE_TAG=20260924-v3
CADDY_AND_WEB_PRESERVED=YES
UPDATE_PHASE=activated
UPDATE_RESULT=PASS
```

阶段失败会停止，不继续激活；保留输出，不删状态目录后重跑。报告：`/opt/outdoor-fit/production/.update-state/20260924-v3/report.json`。若只读检查提示 `IMAGE_RETIREMENT_ISOLATION_REQUIRED`，当前隔离级别不满足清理器要求，旧 API 继续运行，需要先核对配置，不能跳过检查。

需要回滚 API 代码时，在上面打印的 `UPDATE_DIR` 下同一包目录运行 `python3 apply-update.py rollback`。这会恢复 v2 API 和环境文件，不能恢复已经物理删除的旧图。不得重启 Google 上的旧 SQLite API。

## 已完成的验证

- 设置导航与新动效：3 个 Jest 套件，48 项通过；旧健騎機素材引用：2 项通过。
- 客户端图片、缓存、收藏、详情与相关入口回归通过；两次检查覆盖有重叠，不累计为互不重复的数量。
- 后端清理：25 项定向检查通过，覆盖提交/回滚、提交结果不明、共享与种子引用、编码 URL、永久删除恢复阻止、重启重试、文件一致性和扫描上限。
- 后端测试使用注入的 MySQL 形状执行器及独立 SQLite 行数据，不代表已验证线上 InnoDB 并发锁；ECS `stage` 执行实际只读连接检查。
- 更新工具：Python 3.10 语法、基线与环境字节保护、API-only 启动参数，以及 6 个只读探针合成场景通过；v1/v2 封存包保持原样。
- Android 导出及清单校验通过，导出中不含两份旧照片的 SHA256。后端包逐成员校验通过，无数据库、私钥、密码文件或新 Web 内容。

完成发布和安装后，仍需在当前 Android 手机上观察实际进入/返回效果；目前没有声称更新已送达或真机动画已验证。
