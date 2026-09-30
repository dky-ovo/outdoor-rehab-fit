# 联络我们与后台反馈收集（2026-09-18）

## 功能范围

- APP「设置」新增「联络我们 / Contact us」。中文 APP 文案使用繁体中文，英文界面使用英文。
- 姓名、电子邮箱、内容必填；标题选填。已登录用户预填现有姓名/邮箱，也可以修改；访客可直接提交。
- 确认收到后显示留言编号。网络失败、超时及服务错误不清空内容；相同提交重试使用同一幂等标识，避免重复收件。
- 后台新增独立「用户反馈」入口，支持搜索、状态筛选、每页 20 条分页、完整详情、处理状态及内部备注。
- 默认管理员和最高管理员有权查看与处理；操作员需要授权「查看用户反馈」「处理用户反馈」。只授予处理但没有查看权限时不能读取或修改。
- 这是后台收件功能，不是自动发邮件系统。备注不发送给用户，不调用 DeepSeek，也不进入聊天或科研事件表。

## 数据与安全

- 新增 SQLite `feedback` 表及迁移 23，不更换数据库，不删除原有账号、用户数据、文件或视频。
- 登录身份只从已验证的会话确定；客户端伪造 userId 无效，过期 token 不自动降级成访客。
- 字段长度与正文大小限制、邮箱校验、提交限流、SQL 参数绑定、纯文本显示；审计记录不含邮箱或留言正文。
- 后台更新使用 `expectedUpdatedAt` 防止多人编辑覆盖；冲突时保留草稿，允许读取最新记录再确认保存。

## 验证

- 应用与脚本既有回归：100 套、1,580 项通过；后端 200 项通过，2 项真实视频素材导入测试因不加载大型种子而跳过。
- `tsc --noEmit` 通过；最终 Android、iOS、Web 导出成功（`workspace-artifacts/contact-feedback-20260918/all-final`）。
- 纯 Web 部署导出：`workspace-artifacts/contact-feedback-20260918/web-final`。
- 本地浏览器使用隔离内存数据库实际验证：空表单提示、访客提交回执、返回设置、再次进入、360×740 窄屏滚动到发送按钮；后台读取同一留言、打开详情、保存已处理状态和内部备注成功。
- 组件测试覆盖账号/语言/焦点切换后的旧响应、重复点击、断网重试、过期会话、分页及并发冲突；服务测试覆盖访问控制、持久化重开与隐私隔离。
- 未在真实 Android/iOS 手机上测试原生键盘、字体缩放或无障碍读屏；浏览器测试不能代替真机复核。

## 最终交付包

- 路径：`deploy/2026-09-18/outdoor-fit-contact-feedback-20260918-update.zip`
- 大小：157,776,878 字节（150.47 MiB）。
- SHA-256：`351B1AE40BBAA06BE02925EF91B890ABD48E61E2AD75ACEB5189F8A05DC3FB7E`。
- 同目录提供 `.zip.sha256` 校验文件；ZIP 包含 8 个指定后端文件、246 个 Web 文件和安装/校验支持文件，共 260 个条目。
- 最终 ZIP 已重新解压检查，清单与每个文件哈希通过，且和当前后端源码一致。
- 五个真实历史源码基线（09-11、09-14、09-16 摘要、09-16 正文、09-17 检索）逐一升级后反馈接口及 AI 隔离冒烟验证通过。报告：`workspace-artifacts/contact-feedback-upgrades-0f7201ca1d3440aa8d494a26368a67c9/results.json`。
- 发布专项测试 12 项通过；1 项 POSIX 权限测试在 Windows 跳过。部署脚本 `bash -n` 语法检查通过，未在生产 Linux 执行安装。
- 修复 Windows PowerShell 5.1 的 JSON 数组枚举与 ZIP 路径分隔符兼容问题。首个不合格 ZIP 留档于 `workspace-artifacts/contact-feedback-20260918/rejected-windows-zip/`，不应上传；最终交付包使用 Linux 兼容的正斜杠条目。

## 发布配置留档

发现上一次 Android OTA 遗留 `app.json.android-update-backup`，会阻止现有发布脚本运行。已只读确认没有 EAS/Android 发布进程或 Build 备份，且现有配置与备份仅 owner、projectId、updates.url 三字段不同。

- 原 Android 临时配置 SHA-256：`6D284985E36138102F1806F57E1C333A1AB3B5A9DDBC9F1E36B0C77803EF7648`。
- 已核对原 iOS 备份 SHA-256：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`，与 9 月 16 日发布记录一致。
- 已先留存两份副本，恢复根配置的三个项目字段，再将原临时备份移入 `workspace-artifacts/contact-feedback-20260918/ota-config-archive/`；未删除任何备份。
- Expo 实际 app/runtime 版本仍为 1.1.8，无原生依赖变化。Android 继续使用项目切换脚本，iOS 使用 production 渠道。

未上传云端、未在服务器安装、未发布 OTA、未创建新 Build。应先部署后端与 Web，再发布手机 OTA。
