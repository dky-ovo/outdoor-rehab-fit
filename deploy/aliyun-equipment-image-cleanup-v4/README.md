# 阿里云旧器材图片清理后端更新 v4

正式 RDS 的默认事务隔离级别为 `READ-COMMITTED`，因此 v3 在只读检查阶段安全拒绝，未激活。这是独立修正版 `20260925-v4`，直接以当前运行的 `20260924-v2` 为基线。保留失败 v3 的目录、镜像和状态，不修改或重跑旧包。手机 OTA v4 是另一份独立交付。

本版只更新 API 后端：清理相关事务显式使用 `REPEATABLE READ`，验证同连接实际隔离级别，并在连接归还前恢复原级别；不修改 RDS 全局配置。保留正式 Caddyfile、Compose 和 Web 原样，`ADMIN_WEB_DIR` 仍指向 v2 的 `web`；正式环境文件只替换 `RELEASE_TAG`，不修改密码、JWT、数据库结构或已有媒体挂载。必须保留 v2 目录和镜像。

上线后，正常 API 生命周期才启动已审核的旧图清理：只处理器材替换操作明确退役的图片，保留引用检查和重试状态。这不是历史孤儿文件全盘清扫。回滚只恢复代码，**不能恢复此前已经物理删除的图片或撤销数据库退役标记**。

## 本地准备

等待六个后端源文件与只读检查脚本冻结并审核后运行：

```powershell
python scripts/package-aliyun-equipment-image-cleanup-v4.py --check
python scripts/package-aliyun-equipment-image-cleanup-v4.py --build
```

打包器验证封存 v1 全量包和 v2 补丁的 SHA256，从两者重建 v2 的 323 个文件基线；只允许 `appMysql.js`、`mysqlMediaLibrary.js`、`production.js`、`mysqlEquipmentImageRetirement.js`、`mysqlDatabase.js` 和 `mysqlRouteTransaction.js` 六个文件变化。没有新 Web、依赖、数据库或密钥。输出到本目录的 `outdoor-fit-equipment-image-cleanup-20260925-v4.tar.gz` 及 `SHA256SUMS`，已有目标拒绝覆盖。

## ECS 分阶段执行

上传并按交付 SHA256 核对后，解压到全新私有目录。以下命令在新包顶层执行，需 root：

```sh
python3 apply-update.py stage
python3 apply-update.py activate
```

`stage` 校验实际运行的 v2 镜像与本地 v2 tag 一致，核对文件基线，并创建全新的 v4 目录和状态。镜像只基于本地 v2 构建，不拉取镜像、不安装依赖。随后验证 Compose，以候选镜像及真实适配器执行只读事务检查：核对生产账号和 TLS 身份，验证事务内 `REPEATABLE READ`、同一连接的会话隔离恢复和全局隔离未变，汇总待清理和已完成数量。只读检查不读取业务正文、不扫描或删除文件、不加载生产入口或启动清理任务。

只有 `stage` 成功才能 `activate`。切换前再次核对文件、环境和镜像，原子备份/替换环境文件，仅对 API 执行 `compose up --no-deps --no-build --pull never`。核对运行镜像 ID/tag、API HTTPS 健康响应、现有管理网页 HTML 和主 JS 哈希，并确认 Caddy 容器及只读挂载未改变。API 切换会有短暂重启，不重建 Caddy。

成功输出 `UPDATE_PHASE=activated`、`API_RELEASE_TAG=20260925-v4`、`CADDY_AND_WEB_PRESERVED=YES`、`UPDATE_RESULT=PASS`。只读检查输出 `CLEANUP_READ_ONLY_CHECK=PASS`、数量、`CLEANUP_DEFAULT_ISOLATION`、`CLEANUP_TRANSACTION_ISOLATION=REPEATABLE-READ`、`CLEANUP_SESSION_RESTORED=PASS` 和 `CLEANUP_GLOBAL_UNCHANGED=PASS`。新私有报告位于 `/opt/outdoor-fit/production/.update-state/20260925-v4/report.json`；不输出原始 SQL、密码或业务值。

激活失败会尝试恢复 v2 环境和 API。需要明确代码回滚时，在同一新包目录执行：

```sh
python3 apply-update.py rollback
```

回滚同样只重建 API 并检查镜像和 HTTPS。若阶段失败或出现 `restore_failed`，保留所有目录、镜像和报告，先核对实际状态；不要删除状态后盲目重跑。v3 的 `.update-state/20260924-v3` 与 v3 release/image 不参与本工具操作。本地语法与合成检查不能替代 ECS 上的真实 `stage` 和上线健康检查。
