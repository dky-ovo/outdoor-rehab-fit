# 后台文档、AI 草稿与语音入口更新（2026-09-21）

## 完成范围

- 主页语音悬浮球可拖动、左右吸附、限制在安全区内，避让运行中的计时浮层；拖动不误触启动语音。
- 语音错误区分缺原生模块、系统识别服务不可用、语言不支持。诊断显示实际安装的版本与 Build、系统、模块、默认识别服务和请求语言；不会记录语音或用户身份。返回设置后刷新可用性，不自动录音。
- 用户确认已经安装 APK，手机是一加 7T Pro、Android 12，但尚未提供所安装 Build 链接或运行时诊断。当前不能确定具体原因，也不能宣称真机问题已经修复。请更新后在语音失败提示中打开「查看語音診斷」并提供截图。
- 按文档技能核对 `體能活動量建議 (1).docx`：增加中文 WHO 引用，替换英文 WHO 引用及链接；保留原医学内容，不生成新建议。源文件 SHA-256：`BE143492CB8A25A50ED08B1BE6F195ED01E4454E4C4AA3764D9828107818E07B`。
- V24 的正文、媒体与上一版提取内容相同，没有再次强制覆盖已有后台维护内容。
- 后台「设施教学」新增 Word 导入：固定编号及中英文名称匹配、三列表头校验、分项新旧差异、选中字段后二次确认、空值不清空、并发冲突整批拒绝、幂等重试、分页历史和旧内容查看。
- 真实 V24 共识别 9 项正文/54 个文字字段，其他 20 项保持原样；文档自带修订标记会提示核对。未知或有歧义的编号/名字阻止导入，不自动新建设施。
- 「AI 文档助手」是独立侧栏入口与 `admin_assistant.use` 权限。复用已有 DeepSeek model/API key，只读取已发布设施教学及主动选入并确认的公开教学文字。未授予用户表、密码、反馈、运动记录、文件系统、任意网络或写库工具。
- 导入页面可把单一器材的所选新文字送到 AI 面板核对，仍需预览并确认发送。AI 只生成草稿，不能自动保存或发布。检测到常见个人资料、凭证或受限查询会阻断；任意自由文字不能保证完美识别所有个人信息，管理员仍需审阅文档。

## 本地验证

- 前端：117 套件、1739 项通过，1 个快照通过。
- 后端：250 项，248 项通过，2 项真实媒体种子检查按现有条件跳过。
- TypeScript 检查通过；29 项设施的中英教学证据与 APP 一致。
- Android、iOS、Web 最终导出成功，输出在 `workspace-artifacts/admin-document-20260921/native-final` 和 `web-final`。
- 真实 Word 已通过本地 HTTP 上传、预览、确认、重复提交、审计读取测试；只写内存数据库。AI 测试使用模拟服务，没有调用生产 DeepSeek。
- 发布安全检查：31 项，29 项通过，2 项因 Windows 的 POSIX 权限和符号链接限制跳过；Bash 安装脚本语法检查通过。独立后台 AI／导入隔离检查通过，真实外部 AI 请求为 0。
- 正式 ZIP 已使用安装器的 ZIP 路径、大小、类型和内部校验流程重新解压，包清单与源文件复核通过；包含 8 个后端文件、246 个 Web 文件。安装时仍需在服务器实际 Node 环境验证原生依赖与 Linux 权限。
- 这些不是远程 EAS Build、真机语音识别验证或生产部署验证。仍需一加 Android 12 与 iPhone 真机验收。

## 已生成交付文件

- 更新包：`deploy/2026-09-21/outdoor-fit-admin-document-voice-20260921-update.zip`。
- 校验文件：同路径 `.zip.sha256`，已核对内容与 ZIP 实际哈希一致。
- 大小：157,789,618 字节（150.48 MiB）。
- SHA-256：`5CD0720B99595A8813FC50BC24CA55AC7C93D7705796EF7E2BAF2C3448F1192F`。

## 电脑上传（Windows PowerShell）

ZIP 和校验文件必须一起上传，不要遗漏 `.sha256`。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
gcloud storage cp ".\deploy\2026-09-21\outdoor-fit-admin-document-voice-20260921-update.zip" ".\deploy\2026-09-21\outdoor-fit-admin-document-voice-20260921-update.zip.sha256" "gs://outdoor-rehab-fit/"
```

## 服务器安装（SSH / Bash）

支持完整 V24 或上一轮 learning-voice-input 后端，或重复安装本轮。未知/混合版本会停止，不强行覆盖。请完整复制以下代码；重定向符号 `>` 与 `unzip` 必须在同一行。

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-admin-document-voice-20260921-update.zip gs://outdoor-rehab-fit/outdoor-fit-admin-document-voice-20260921-update.zip.sha256 /home/dukaiyu2004/ &&
sha256sum -c outdoor-fit-admin-document-voice-20260921-update.zip.sha256 &&
unzip -p outdoor-fit-admin-document-voice-20260921-update.zip install-admin-document-voice-20260921.sh > install-admin-document-voice-20260921.sh &&
sudo bash install-admin-document-voice-20260921.sh /home/dukaiyu2004/outdoor-fit-admin-document-voice-20260921-update.zip
```

安装器先隔离安装锁定依赖并检查，再停止服务、备份代码/Web/数据库与 WAL/SHM、切换依赖。旧依赖保留，失败保留新依赖并恢复旧代码/依赖；不回滚用户数据库，不修改 Nginx 或上传文件。不应为了重试删除数据库、备份或原依赖。

## 手机更新（Windows PowerShell）

如果 APK 确实包含原生语音模块并匹配 runtime 1.1.9，可通过 OTA 更新本轮浮球、文献和诊断界面：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "语音诊断、可拖动悬浮球与体能活动文献更新" -NonInteractive
```

如果诊断显示「缺少原生组件」，OTA 和更新服务器都不能补上原生语音模块，需要新的 APK：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -Message "原生语音输入、语音诊断与可拖动悬浮球" -NonInteractive
```

生成后安装该次 Build 的 APK（不要重新安装更旧链接）。系统识别服务缺失或不支持粤语仍需配置可用服务，Build 本身不能保证解决系统能力问题。保留键盘输入退路。

iOS 如未安装包含语音模块的版本，需 Build；没有改变当前 iOS 项目配置，不要与安卓项目切换脚本同时运行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
npx eas-cli@latest build --platform ios --profile production --message "原生语音输入与可拖动悬浮球"
```

本轮未上传、未部署服务器、未发布 OTA、未提交任何远程 Build 或 Apple 发布。
