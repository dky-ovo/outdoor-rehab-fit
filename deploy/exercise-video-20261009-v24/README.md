# v24：运动影片卡片与 AI 标题

本包只包含网页静态文件与安装脚本，不包含后端源码或 Docker 镜像。Android 使用独立 OTA 脚本。

**前提：先完成 v23 服务器安装。** 安装器核对封存 v23 的24个API文件、DeepSeek单模型环境及6种合法网页树。旧 v21/v22 不兼容本版批量影片幂等接口要求，检测到时停止，不自动升级后端。

## 安装

在旧 ECS `47.83.186.36`（SSH `28832`）的新解包目录中依次执行：

```bash
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-exercise-video-20261009-v24/package/install.py --apply
```

成功标记：`EXERCISE_VIDEO_WEB_UPDATE=PASS`。`--prepare`只合并并校验静态文件，不打镜像；`--apply`只替换Caddy的`/srv/admin`只读挂载。所有Compose操作都限定`caddy --no-deps`。API容器ID、镜像、启动时间、环境与挂载签名必须保持不变；不会停止/重启API，不改模型、密钥、数据库或上传媒体。

为替换挂载需要重建Caddy，网页连接可能短暂中断。后台已经接受的AI任务仍在原API运行；安装器不会取消任务或调用模型。

## 回退与重试

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-exercise-video-20261009-v24/package/install.py --rollback
```

只恢复安装前的Caddy配置和网页。已知准备/激活中断可以重复相同步骤；未知网页修改、API重启或其他发布会停止，防止覆盖后续工作。状态目录为`/opt/outdoor-fit/production/.update-state/exercise-video-20261009-v24/`，配置记录保持root私有，不要粘贴到聊天。

## Android

电脑端用`scripts/android-build17-exercise-video-v24-ota.ps1 -Action Verify`检查封存，按交付说明再运行`-Action Publish`。只适用于Android Build17、runtime 1.2.3、preview，脚本会恢复原项目配置。

本地封包和自动化检查不等于线上安装，也不等于Android真机已验收。实际SHA-256和操作命令以最终交付为准。本包不改v23封存产物。
