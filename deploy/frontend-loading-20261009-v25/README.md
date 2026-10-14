# v25：首屏图标字体与用户 AI 文案

本包仅更新网页静态文件，配套 Android Build17 OTA 工具。它不包含后端源码、Dockerfile、镜像、数据库迁移或密钥。

## 兼容前提

服务器必须已安装 **v23 API**，保留 `ASSISTANT_PROVIDER_MODE=deepseek_only`。安装器逐文件验证封存 v23 的24个API模块，网页可为封存的 v23 或 v24，共12种精确的完整网页树。未知文件、旧 v21/v22 API 或其他发布会停止检查，不自动升级后端。

## 服务器安装

目标为旧 ECS `47.83.186.36:28832`。校验正式交付的 SHA-256，并在新目录解包后依次运行：

```bash
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-frontend-loading-20261009-v25/package/install.py --apply
```

成功标记：`FRONTEND_LOADING_WEB_UPDATE=PASS`。准备阶段只合并校验静态文件，不构建镜像。激活阶段只改 Caddy 的 `/srv/admin` 挂载，使用 `caddy --no-deps`，不会停止或重启 API；原模型配置、密钥、RDS、媒体和账号数据保持原样。

安装过程中会重建 Caddy，网页连接可能短暂中断；API 中已接受的 AI 任务继续运行。安装器校验 API 容器 ID、镜像、配置签名、启动时间和重启次数未变。

## 恢复

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-frontend-loading-20261009-v25/package/install.py --rollback
```

仅回退 Caddy 配置和网页。已知准备、激活或回退中断可重试相同步骤；若检测到其他部署或 API 重启会停止，避免覆盖后续改动。状态目录 `/opt/outdoor-fit/production/.update-state/frontend-loading-20261009-v25/` 含原 Compose 配置，保持 root 私有。

## Android

使用 `scripts/android-build17-frontend-loading-v25-ota.ps1`。先用 `-Action Verify` 检查正式产物，再按最终交付说明运行 `-Action Publish`。只面向 Android Build17、runtime 1.2.3、preview；脚本临时使用 Android 项目配置，并恢复原始配置。

脚手架和测试通过不代表已经生成产物、部署服务器或发布 OTA。本版不会覆盖 v23、v24 的封存文件；正式产物的大小、SHA-256 及验证范围由最终交付文档记录。
