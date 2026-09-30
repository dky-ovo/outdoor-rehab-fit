# 正式库迁移工具

目标固定 `outdoor_fit_prod`，账号固定 `outdoor_fit_migrator`，RDS 内网与已核验 CA 沿用现有配置。此包不包含业务数据、媒体、密码或应用服务，不启动应用、不冻结 Google，也不运行合成业务测试。旧 rehearsal 工具及归档保持原行为。

在 ECS 解压到一个新目录，进入 `aliyun-production-migration-20260924-v1/`。以下命令均通过 Docker Node 22 使用锁定 mysql2 3.24.4，密码在交互提示输入，不放在参数中。

## 1. 创建正式空结构（一次）

```bash
bash ./run-production-migration.sh schema
```

要求真实 `DATABASE()` 为 `outdoor_fit_prod`、MySQL 8.0、约束与严格模式启用、16 KiB InnoDB 页、库内无表/视图。创建 38 表与 33 外键后立即核对完整结构。成功输出 `PRODUCTION_SCHEMA PASS` 和 `REPORT_STATUS FINAL`。DDL 无法整体回滚，部分失败保留对象与报告，不自动 DROP 或继续；不要无视失败再重跑。

若只需读取已创建结构：

```bash
bash ./run-production-migration.sh verify
```

此命令不改业务表。生产 fingerprint 包含生产库的外键 schema 名称，可能不同于演练库 fingerprint。

## 2. 准备最终快照导出（保持 Google 写入冻结）

最终快照与媒体取得流程见 `FINAL-SNAPSHOT.md`。在 ECS 校对传输清单后，将实际路径填入；不要指向 rehearsal 快照。

```bash
final_dir='/opt/outdoor-fit/migration/填入本次final目录名'
cd "$final_dir"
sha256sum -c SHA256SUMS
umask 077
python3 /填入工具目录/aliyun-production-migration-20260924-v1/export-aliyun-sqlite.py \
  --database "$final_dir/outdoor-fit.sqlite" --output "$final_dir/export.jsonl"
```

导出器拒绝覆盖已有输出，并要求源是完整的独立 SQLite 快照。其 SHA 应与 Google 最终备份输出及传输清单一致。导出内容完整读取后还会核对原快照未变化。JSONL 必须位于工具构建目录之外；不要放进源码包、Git 或聊天。

## 3. 正式空库导入（一次）

回到工具目录，明确传入源端记录的 **SQLite SHA-256** 与本次 JSONL 绝对路径；不要传媒体 SHA 或 JSONL SHA。

```bash
bash ./run-production-migration.sh import \
  --source-sha256 '填入Google最终快照的64位小写SHA256' \
  --input '/opt/outdoor-fit/migration/本次final目录/export.jsonl'
```

脚本在构建目录之外新建私有 `production-migration-run.XXXXXXXX`，复制 JSONL 为容器可读的 0400 文件，只读挂载；不会改原数据文件权限。容器中的导入 CLI 要求同样的显式参数，核对源 SHA、结构与全流摘要，单个 SERIALIZABLE 事务内确认所有目标表为空，按外键顺序插入并逐字段回读后提交。BIGINT、DOUBLE、5 个摘要列、2 个条件生成列及 2 个代理主键的原有核验保留。

成功必须同时看到 `PRODUCTION_IMPORT PASS`、`TARGET_DATABASE outdoor_fit_prod`、`DATA_COMMIT_STATUS committed`、`DATA_ROLLBACK_STATUS not_needed`、`REPORT_STATUS FINAL`。每次报告位置由 `HOST_REPORT_FILE` 打印，文件权限 0600。保留源快照、媒体、JSONL和报告直到正式切换完成。

出现 `DATA_COMMIT_STATUS unknown`：停止并核对报告/库状态，不能自动重试、清表或再次导入。出现整体 FAIL 但 commit 为 committed：可能是锁释放、连接关闭或报告故障；数据仍可能已提交，同样不能重跑。`REPORT_STATUS INCOMPLETE` 保留上次完整运行中报告，结合控制台已知提交状态处理。

默认直接运行镜像仅打印 Node 版本；只有 wrapper 的显式 schema/import 子命令会写库。数据导入不会更新已有业务库、不会切换流量，也不证明完整后端已部署。
