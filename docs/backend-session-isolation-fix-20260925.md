# 后端旧图清理隔离级别修正（2026-09-25）

用户回传 ECS v3 在 `validating_cleanup_read_only` 阶段报 `IMAGE_RETIREMENT_ISOLATION_REQUIRED`。进一步只读诊断确认 RDS 的 SESSION 与 GLOBAL 均为字符串 `READ-COMMITTED`。该阶段不启动新 API 或清理器，旧 v2 没有被本次安装切换。

新版 `20260925-v4` 直接以已部署 v2 为基线，独立保留 v3 失败目录、状态及镜像。此次交付已打包并本地验证，尚未上传或在 ECS 执行。原 Android OTA v4 保持有效；若已经发布，不用重复发布。

## 修复方式

只对器材更新和旧图清理事务，在同一借出的连接上读取原隔离级别，临时设置 `REPEATABLE READ` 并验证，再开启事务。确认提交或回滚结束后，恢复原隔离级别并验证，才归还连接。普通请求保持现有设置；不修改 RDS GLOBAL 参数，也不要求重启数据库。

设置失败、提交结果不明或回滚失败会销毁连接。业务提交已确认但恢复设置失败时，也销毁连接，并保留已确认的提交结果，避免向上层误报回滚而触发错误文件补偿。

这是 MySQL 支持的会话级事务设置；会话设置在下一事务开始时生效，因此必须先设置再 BEGIN，不能在清理事务中途改级别。[MySQL 8.0 SET TRANSACTION 官方说明](https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html)

原有共享引用、种子素材、文件 SHA256、大小和路径检查继续保留。新包不会批量扫描删除历史文件，永久文件删除仍只针对成功换图产生的明确记录。

## 更新包

本地文件：`deploy/aliyun-equipment-image-cleanup-v4/outdoor-fit-equipment-image-cleanup-20260925-v4.tar.gz`。

- 大小：92,379 字节，约 90.2 KiB。
- SHA256：`be6053c60fd1988ecfe3adc6e3eef6b9179c89bf0f00c7a1b2ca15478c8b8a71`。
- 对 v2 的后端变化共 6 个文件，Web 变化 0，不打包数据库、依赖或凭据。

## 电脑 Windows PowerShell：上传

```powershell
scp -P 28832 "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\aliyun-equipment-image-cleanup-v4\outdoor-fit-equipment-image-cleanup-20260925-v4.tar.gz" root@47.83.186.36:/root/
```

只在 SSH 提示中输入 ECS 密码。

## 阿里 ECS 的 Xterminal：安装

完整执行下面代码。无需删除旧 v3 目录，也不要再次执行旧包的 stage 或 activate。

```bash
(
set -euo pipefail
umask 077
cd /root

printf '%s\n' 'be6053c60fd1988ecfe3adc6e3eef6b9179c89bf0f00c7a1b2ca15478c8b8a71  outdoor-fit-equipment-image-cleanup-20260925-v4.tar.gz' | sha256sum -c -

update_dir="$(mktemp -d /root/outdoor-fit-image-cleanup-v4.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
env -u TAR_OPTIONS tar --extract --gzip \
  --file=/root/outdoor-fit-equipment-image-cleanup-20260925-v4.tar.gz \
  --directory="$update_dir" \
  --no-same-owner --no-same-permissions --keep-old-files

cd "$update_dir/outdoor-fit-equipment-image-cleanup-20260925-v4"
python3 apply-update.py stage
python3 apply-update.py activate
)
```

`stage` 用真实 MySQL 适配器、生产账号及 TLS 身份校验，在仅一个连接的池内读取默认隔离级别，开启临时 RR 的只读事务，运行清理状态计数，再验证同一连接恢复原隔离级别、GLOBAL 值不变。该阶段不调用 app 工厂或启动清理器，不扫描和删除文件，不读取业务正文。不能以关闭检查或改报告文件来绕过失败。

成功应包含：

```text
CLEANUP_DEFAULT_ISOLATION=READ-COMMITTED
CLEANUP_TRANSACTION_ISOLATION=REPEATABLE-READ
CLEANUP_SESSION_RESTORED=PASS
CLEANUP_GLOBAL_UNCHANGED=PASS
CLEANUP_READ_ONLY_CHECK=PASS
API_RELEASE_TAG=20260925-v4
CADDY_AND_WEB_PRESERVED=YES
UPDATE_PHASE=activated
UPDATE_RESULT=PASS
```

`activate` 才切换 API，会有短暂重启；Caddy、现有网页和媒体目录保持原样。新报告在 `/opt/outdoor-fit/production/.update-state/20260925-v4/report.json`。任一步失败保留输出和目录，不删状态后重跑。

## 验证及回滚

已完成 47 项适配器与旧图清理定向测试、13 项新探针检查，共 60 项通过。覆盖 RC→RR→RC、原 RR/SERIALIZABLE、提交与回滚异常、连接重用、恢复失败、TLS 和账号拒绝、全局值变化及只读 SQL 限制。测试使用合成驱动/行数据，未冒充线上 RDS 锁验证。

Python 3.10 语法及安装工具合成检查通过，打包器已核对 v1/v2 基线和所有包成员哈希。旧 v3 归档仍为 `d62707279b639ad9a8a60ffe606adf06ea6cac455479dddcedba6a82a20d6e30`。手机 OTA 清单仍通过，哈希不变。

如需要恢复 API v2，在新包目录执行 `python3 apply-update.py rollback`。代码回滚不能恢复已经物理删除的图片；不要恢复 Google 的旧 SQLite 写入服务。
