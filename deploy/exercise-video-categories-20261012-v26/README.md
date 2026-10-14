# v26 运动影片分类更新

更新 API、网页和 Android 客户端的运动影片分类及器材关联。服务器包接受封存 v23 API 与已知 v23、v24、v25 网页前驱；未知源码、配置或后续部署会停止安装。此包不上传视频，不根据文件名自动分配已有视频。

本次仅为现有 `content_items` 增加 `video_category`、`equipment_ids_json` 两个兼容字段。原记录保持原值，不创建新表，生产启动要求的 42 张表不变。迁移核对现有字段类型、字符集、排序规则及默认值；兼容字段可重复执行，冲突字段不会被改写。不重放旧数据库迁移。

先校验实际交付的 tar SHA-256，解包至新目录，再依次执行：

```bash
sudo python3 install.py --check-only
sudo python3 install.py --prepare
sudo python3 install.py --migrate
sudo python3 install.py --apply
```

`--check-only` 核对包、现有版本和服务配置。`--prepare` 构建候选镜像并用应用账号只读检查新字段，保持运行中的服务不变。看到 `EXERCISE_VIDEO_SCHEMA=MISSING` 表示还需要下一步迁移，不表示已激活。

`--migrate` 先检查实际字段。缺少字段时才在服务器终端询问 `outdoor_fit_migrator` 的密码，通过标准输入传给一次性数据库客户端；密码不写入参数、环境文件或报告。数据库连接必须通过 TLS 证书与主机名验证，目标必须是 `outdoor_fit_prod`。只使用即时添加列，不回退到重建数据表。迁移后再以应用账号检查可读性；成功为 `EXERCISE_VIDEO_MIGRATION=PASS`，已完成则为 `EXERCISE_VIDEO_MIGRATION=ALREADY_READY`。

`--apply` 再检查字段已就绪，排空入口并检查 AI 队列后替换单个 API 和 Caddy。最终成功标记为 `EXERCISE_VIDEO_CATEGORIES_UPDATE=PASS`。网页和 API 成功后再发布对应 Android OTA；不要把新客户端提前发布到旧接口。

保留原独立 Compose、SSH 数据库通道、全部密钥挂载、资源限制和 `deepseek_only` 设置，不更改模型或密钥。本安装器不调用真实 AI，也不自动部署或发布 OTA。

已知构建、激活中断可重试同一步。回退命令：

```bash
sudo python3 install.py --rollback
```

回退只恢复原 API 镜像、网页及配置，**保留新增字段和已经保存的分类数据**，不执行 DROP/数据回滚。旧 API 忽略这两个兼容字段。回退前再次关闭入口并检查 AI 队列；若仍有任务，保留当前工作进程，等待后重试。原服务已经停止时，回退恢复其原停止状态。

错误只输出阶段、工具类别、退出码及经过筛选的数据库错误码。状态目录 `/opt/outdoor-fit/production/.update-state/exercise-video-categories-20261012-v26/` 内 Compose/plan 含原环境，必须保持 root 私有，不要粘贴到聊天。

视频是否已经上传需要在后台文件存储中核对。缺少的文件先上传到文件存储，再在运动影片管理中选择、分类并关联器材。软件安装成功不代表指定视频已配置完成。
