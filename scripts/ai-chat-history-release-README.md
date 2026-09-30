# AI 对话历史更新（2026-09-22）

此包更新本轮 Web 界面，并携带上一轮已经验证的五个后端源文件。新增历史对话只供查看，不会用于新对话上下文。五个 API 源文件与 `ai-recommendation-context-20260922` 已发布包逐字节一致；原有症状推荐及参与者设施教学进度功能不变。

支持已审核的 `admin-document-voice-20260921`、`participant-facility-learning-20260922`、`ai-recommendation-context-20260922` 后端基线；发现未知代码或依赖修改时停止，不擅自覆盖。

固定路径：API `/home/dukaiyu2004/outdoor-fit-api`，Web `/var/www/outdoor-fit`。沿用原更新流程，仅重启 `outdoor-fit-api`；已安装上一轮 AI 包时 API 文件内容保持相同，不更换服务配置、端口或依赖。

安装前校验 ZIP 路径、内嵌 SHA-256、完整源文件清单及 Web 清单；隔离内存数据库验证学习接口及三轮症状问答（只用模拟模型，零外部 AI 调用）。停止服务后备份将替换的源文件和 Web 文件，资源先写、HTML 最后写，保留旧 Web 资源。健康与哈希检查失败时只恢复已知源文件和 Web 文件；安装后出现未知人工修改则停止自动恢复，保留诊断。

不安装 npm 依赖、不修改 Nginx、不读取 API key、不上传云端，不删除、备份或回滚生产数据库、用户资料及 uploads。旧基线初次获得学习进度功能时仅应用既有新增表迁移。

ZIP 内含完整校验资料，不依赖另外的 `.zip.sha256`。请用交付的完整 ZIP SHA-256 校验压缩包，再提取 `install-ai-chat-history-20260922.sh` 并执行。此包不发布手机 OTA，不更新手机原生安装包。
