# v22：DeepSeek／阿里百炼独立切换

本包接受封存的 v20 或 v21 服务端源码及各自对应的网页树，共四种精确基线。逐文件核对 24 个后端模块，其中 6 个新增模块必须在旧镜像中不存在。`accountDocuments.js` 的旧版本来自封存 v12，之后各发布包没有替换该文件。未知线上修改会停止安装，不自动覆盖。

DeepSeek 保留现有模型、密钥、应用提示词和 FAQ。百炼独立使用 `qwen3-14b-1f1a8952705b`、国际站兼容接口；本轮不加入应用系统提示词，不启用 FAQ，不把调用失败转交 DeepSeek。百炼返回若为训练选择器 JSON，应用会如实显示，不假装是完整答案。

## 服务器配置与安装

核对最终交付 SHA-256 后上传，在新目录解压，不覆盖旧发布目录。进入解压目录，在真实 SSH 终端依次执行：

```bash
python3 configure-bailian.py
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-ai-providers-20261008-v22/package/install.py --apply
```

`configure-bailian.py` 隐藏输入并确认两次密钥，只写入服务器 `/opt/outdoor-fit/production/secrets/dashscope-api-key`，权限 `0400`、所有者 `1000:1000`。密钥不进入命令历史、Compose 值、更新报告或发布包；已有合规密钥时保持原样，不覆盖。需更换密钥时单独处理，不重复运行安装来轮换。

安装器从当前运行的 Compose 捕获配置，添加密钥文件的只读挂载以及 `DASHSCOPE_API_KEY_FILE`、固定模型、固定国际站 base URL 和 `BAILIAN_FAQ_ENABLED=false`。不会修改数据库中的活跃提供商，不自动切换百炼。安装后在后台 AI 配置中检查并选择提供商；DeepSeek 的模型和密钥仍保留。

`--check-only` 只读检查包、密钥元信息和环境；`--prepare` 离线构建候选镜像，旧服务继续运行；`--apply` 在 AI 队列空闲时关闭入口、再次核对，再替换唯一 API worker 并恢复入口。RDS、SSH 隧道、资源限额及其他配置保持原样。

成功标记：`AI_PROVIDERS_UPDATE=PASS`。出现 `UPDATE_AI_BUSY_TRY_LATER` 时等待任务结束后重试同一步，不绕过检查。安装器不会发送收费的模型测试请求。

## 回退

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-ai-providers-20261008-v22/package/install.py --rollback
```

回退恢复捕获的原镜像及原 Compose，移除本次新增挂载与环境设置；保留密钥文件和聊天记录。回退前关闭入口并检查队列，有 AI 任务时保留 worker、不强行中断。若安装后在后台选择了百炼，回退前应先切回 DeepSeek；旧客户端／旧服务器不支持百炼独立会话。

新手机使用独立 v2 聊天接口。服务器回退 v20／v21 后，新手机不会退到旧聊天接口：未送出的请求保留在本地并提示需要更新／恢复服务，恢复 v22 后再重试。这会暂时影响新手机的 AI 可用性，但不会把百炼请求交给 DeepSeek。回退不能视为新手机仍可完整使用 AI。

## Android

电脑脚本 `scripts/android-build17-ai-providers-v22-ota.ps1` 仅用于 Android Build 17／runtime 1.2.3／preview。实际导出封存后先运行 `-Action Verify`；服务器安装成功后再运行 `-Action Publish`。脚本会恢复原项目配置，不用 iOS 默认项目发布。

网页版部署后需刷新页面；安卓需接收更新并重启应用，才能使用提供商切换与独立聊天历史。封包与离线验证不表示已上传、部署、调用百炼或发布 OTA。
