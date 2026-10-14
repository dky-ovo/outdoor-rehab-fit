# 50 人并发稳定性更新 v13

交付目标：`outdoor-fit-api:20261002-v13`，归档名为 `outdoor-fit-load-capacity-20261002-v13-delta.tar.gz`。本地准备更新包不表示已上传、部署或完成生产复测。

安装器只接受正在运行的 `outdoor-fit-api:20261002-v12`，并核验全部 v12 API 源码和完整网页文件的 SHA-256。标签、源码、网页或现场 Compose 与容器不一致时停止，不能跳过检查或强制重装。此次只覆盖四个 API 源码文件，基于现场已验证的 v12 镜像构建；网页采用完整目标文件清单及差异文件。保留现场代理域名、密码、JWT、存储目录、RDS 和临时账户开关。

更新将连接池保持为 4，新增有限等待队列，默认 128（可通过 `--queue-limit 1到256之间的整数` 调整）。减少重复鉴权活动写入，识别队列超限并返回可退避的 503，网页合并和错开同步。128 只缓冲突发请求，不增加数据库持续吞吐能力。此安装不执行数据库迁移、不新增或删除字段、不改写业务数据，不发布手机 OTA。

现有日志的 237 次通用错误与连接池队列超限高度吻合，但旧日志没有保留精确原因；不能声称所有错误已经确认或解决。安装后的健康和网页检查只验证上线成功，仍需按 1、10、25、50 人逐级复测，确认无持续 500/503、资料最终同步一致以及视频实际持续播放。视频带宽和转码问题需单独测量和处理。

## 上传与安装

先将最终归档的 SHA-256 与交付说明一致核验。Windows PowerShell：

```powershell
$package = "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\load-capacity-20261002-v13\outdoor-fit-load-capacity-20261002-v13-delta.tar.gz"
Get-FileHash -LiteralPath $package -Algorithm SHA256
scp -P 28832 $package root@47.83.186.36:/root/
ssh -p 28832 root@47.83.186.36
```

服务器 Bash（哈希一致后继续；首次安装使用新目录）：

```bash
set -euo pipefail
umask 077
cd /root
sha256sum outdoor-fit-load-capacity-20261002-v13-delta.tar.gz
mkdir outdoor-fit-load-capacity-20261002-v13-upload
tar -xzf outdoor-fit-load-capacity-20261002-v13-delta.tar.gz -C outdoor-fit-load-capacity-20261002-v13-upload
cd outdoor-fit-load-capacity-20261002-v13-upload/outdoor-fit-load-capacity-20261002-v13
python3 install.py --check-only
python3 install.py
```

预检成功为 `LOAD_CAPACITY_PREFLIGHT=PASS`；安装成功为 `LOAD_CAPACITY_UPDATE=PASS`。镜像切换会短暂重建 API/Caddy。安装器不会打印完整环境、密码、原始 Docker 输出或 SQL。

## 回退与中断恢复

安装前保存原镜像 ID、原网页目录和已解析的 Compose；敏感配置只存于 root 私有的 `/opt/outdoor-fit/production/.update-state/load-capacity-20261002-v13/`。回退脚本在服务切换前创建。回退恢复原 v12 镜像、原网页和原环境，去掉此次新增的队列配置，不删除业务数据或旧发布：

```bash
bash /opt/outdoor-fit/production/.update-state/load-capacity-20261002-v13/rollback.sh
```

成功为 `LOAD_CAPACITY_ROLLBACK=PASS`。服务激活后失败会尝试回退已切换的服务。若检测到后续部署、环境/挂载漂移、恢复配置被修改、旧镜像或网页缺失，拒绝回退，避免覆盖其他更新。SSH 中断或出现 `UPDATE_*` 错误后应先检查私有状态和容器；保留日志及发布目录，不能删除状态强行重新安装。构建阶段失败尚未切换服务，但可能留下暂存目录，需要人工核对后再处理。
