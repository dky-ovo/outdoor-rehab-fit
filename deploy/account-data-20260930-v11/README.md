# 帐户资料同步 v11 后继交付

本目录提供 2026-09-30 代码审查后的新版本交付。归档生成后的文件名与 SHA-256 见同目录 `SHA256SUMS`；该文件缺失时表示尚未完成封存。**本地交付尚未上传或部署，新包待用户部署。** 不要以本目录源码替换已封存 v9/v10 或旧 Android OTA 的内容。

版本固定为 `20260930-v11`，候选 API 镜像为 `outdoor-fit-api:20260930-v11`。只接受已运行的 `outdoor-fit-api:20260928-v9` 或 `outdoor-fit-api:20260928-v10`。从 v9 增加 `account_documents`（40→41 张表）；从 v10 核对同一张表，无重复导入或删除数据。

安装器保存 Compose 时保护美元符字面值，并对完整配置重新展开核对。API 与 Caddy 回退分别尝试；其中一个失败不会阻止另一个恢复。v9 回退镜像兼容 40/41 张表；v10 使用安装前镜像 ID 回退。手动回退会检查两项服务的配置来源及镜像 ID，检测到后续部署时停止，避免覆盖新版配置。回退保留已经同步的账户资料，不删除新增表。

## 准备新归档

代码与测试稳定后，先导出本次纯 Web 目录，再在项目根目录运行：

```powershell
python scripts/package-account-data-v11.py --web-dir "workspace-artifacts/account-data-20260930-v11-web"
```

打包器核验原 v9/v10 归档的固定 SHA-256，只有两套基线均有相同哈希的 Web 文件才省略；安装时仍核验现场资源。新归档和 `SHA256SUMS` 中任一已存在即拒绝打包，不修改历史包。失败保留现场，不自动删除或覆盖产物。归档固定输出到本目录 `outdoor-fit-account-data-20260930-v11-delta.tar.gz`。发布前应提供实际大小、SHA-256、上传及安装命令，不能把框架检查视为真实 ECS/RDS 验证。

## 用户部署与回退

用户核验最终归档 SHA-256 后，在新的私有目录解压并以 root 运行 `python3 install.py`。仅在提示时输入 `outdoor_fit_migrator` 密码。安装器保留现场代理、域名和私有挂载，重建 API/Caddy 会短暂中断连接；期间不得并行运行其他部署工具。只有 `ACCOUNT_DATA_UPDATE=PASS` 表示本次服务器检查完成。

状态保存在 `/opt/outdoor-fit/production/.update-state/account-data-20260930-v11/`。安装失败或 SSH 中断时先核对状态，不要删除目录后重复安装；需要回退时使用：

```bash
bash /opt/outdoor-fit/production/.update-state/account-data-20260930-v11/rollback.sh
```

`UPDATE_LATER_DEPLOYMENT_PRESENT` 表示已检测到其他部署，需人工确认当前版本；不得绕过保护强行回退。`UPDATE_ROLLBACK_FAILED_SERVICES` 指出未恢复的服务；私有状态目录不得公开。

此安装器不会发布 Android OTA；手机前端有变更时必须另行准备新的 v11 导出与发布工具，服务器成功后再由用户发布，不能复用或改写旧 v10 OTA 清单。
