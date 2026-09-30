# 阿里云旧器材图片清理后端更新 v3

本工具只更新 API 后端，从正式 v2 升至 `20260924-v3`。手机 OTA v4 单独交付。保留正式 Caddyfile、Compose 和网页文件原样，`ADMIN_WEB_DIR` 仍指向 v2 的 `web`；正式环境文件只替换 `RELEASE_TAG`，不修改密码、JWT、数据库结构或已有媒体挂载。必须保留 v2 目录和镜像。

上线后，正常 API 生命周期才启动已审核的旧图清理：只处理器材替换操作明确退役的图片，保留引用检查和重试状态。这不是历史孤儿文件全盘清扫。回滚只恢复代码，**不能恢复此前已经物理删除的图片或撤销数据库退役标记**。

## 本地准备

等待四个后端源文件冻结并审核工具后运行：

```powershell
python scripts/package-aliyun-equipment-image-cleanup.py --check
python scripts/package-aliyun-equipment-image-cleanup.py --build
```

打包器验证封存 v1 全量包和 v2 补丁的 SHA256，从两者重建 v2 的 323 个文件基线；只允许 `appMysql.js`、`mysqlMediaLibrary.js`、`production.js` 和新增 `mysqlEquipmentImageRetirement.js` 四个文件变化，不打包新 Web、依赖、数据库或密钥。生成独立压缩包及 `SHA256SUMS`；已有目标拒绝覆盖。

## ECS 分阶段执行

上传并按交付的 SHA256 核对后，解压到全新私有目录。以下命令在包顶层执行，需 root：

```sh
python3 apply-update.py stage
python3 apply-update.py activate
```

`stage` 校验当前运行的 v2 镜像与本地 v2 tag 一致，核对文件基线，并复制新 v3 目录。镜像只基于本地 v2 构建，不拉取镜像、不安装依赖。随后验证 Compose，使用候选镜像执行独立只读检查：核对生产账号及 TLS 身份、要求 `REPEATABLE-READ` 或 `SERIALIZABLE`，汇总待清理和已完成数量。只读事务不读取业务正文、不扫描或删除文件；不加载生产入口，不创建或启动清理任务。阶段失败保留诊断状态，不能直接重复覆盖。

只有 `stage` 成功才能 `activate`。切换前再核对文件、环境和镜像，原子备份/替换环境文件，仅对 API 执行 `compose up --no-deps --no-build --pull never`。核对运行镜像 ID/tag、API 的 HTTPS 健康响应、现有管理网页 HTML 与主 JS 哈希，并确认 Caddy 容器及只读挂载未改变。API 切换会有短暂重启；不重建 Caddy。

成功输出 `UPDATE_PHASE=activated`、`API_RELEASE_TAG=20260924-v3`、`CADDY_AND_WEB_PRESERVED=YES`、`UPDATE_RESULT=PASS`。只读检查输出 `CLEANUP_READ_ONLY_CHECK=PASS` 及数量。私有阶段报告在 `/opt/outdoor-fit/production/.update-state/20260924-v3/report.json`；不输出原始 SQL、密码或业务值。

激活失败会尝试恢复旧环境和 v2 API。需要明确代码回滚时，在同一包目录执行：

```sh
python3 apply-update.py rollback
```

回滚同样只重建 API，检查镜像及 HTTPS。若出现 `restore_failed`，保留所有目录、镜像和报告，先核对实际状态；不要删除状态后盲目重跑。此工具的本地语法与合成检查不能替代 ECS 上的实际 `stage` 和上线健康检查。
