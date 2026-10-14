# v23 聊天与键盘更新

本版同时更新 Android 聊天键盘适配及后台运动影片多选/文件名标题。目标为 DeepSeek 单模型界面，保留 v22 的版本化接口、账号数据与旧任务快照。安装器不改数据库、不删除百炼历史/密钥、不调用真实 AI。

支持封存 v21 / v22 API 与已知 v21 / v22 Web 的精确组合，包括回滚中断后的混合或已停止容器。未知代码、挂载、后续部署会拒绝。

服务器依次执行（在此解包目录）：

    sudo python3 install.py --check-only
    sudo python3 install.py --prepare
    sudo python3 install.py --apply

成功标记 `CHAT_KEYBOARD_UPDATE=PASS`。`--prepare` 可重试已知构建失败；`--apply` 可重试已知激活/回退中断，已运行目标 API 不会无故重启。恢复原先状态用 `sudo python3 install.py --rollback`。原先停止的服务回退仍保持停止，不能把它称作恢复在线。

保留原独立 Compose、SSH 数据库通道、资源限制和全部原密钥挂载。候选仅加入 `ASSISTANT_PROVIDER_MODE=deepseek_only`。切换前确认 AI 队列为空；HTTPS 校验后回退也再次排空入口并检查队列，有任务则保留工作进程，等待完成后重试。

报错输出固定阶段、工具类别、退出码，不输出命令参数、密码或原始 stderr。状态记录位于 `/opt/outdoor-fit/production/.update-state/chat-keyboard-20261008-v23/`，其中 Compose/plan 含原环境信息，保持 root 私有，不要粘贴。

验证范围为本地状态机、封存文件和源码检查；不等于已在生产服务器安装，也不等于安卓真机键盘验收。最终校验和及上传命令见版本交付文档。

Docker 命令核对参考：[Compose run](https://docs.docker.com/reference/cli/docker/compose/run/) 与 [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)。只读 SQL 探测覆写入口为 Node，`run --no-deps --pull never` 不启动应用 worker；恢复原停止容器用 `up --no-start`。
