# AI 历史对话删除（2026-09-23）

## 功能范围

- AI 助手的历史列表每条记录增加独立「删除」按钮；列表顶部增加「清空历史对话」。打开与删除不是嵌套按钮，不会误触进入详情。
- 同一个历史弹窗内显示确认页，支持取消；中繁/英文说明删除范围是本机当前账号、当前语言的历史，操作不可在界面撤销。
- 不删除当前正在进行的对话，不清空输入草稿，不改变推荐、朗读或新对话的上下文规则。删除不调用 DeepSeek，也不新增云端聊天同步。
- 删除期间禁止重复提交，可以关闭窗口；失败时保留记录、显示错误并允许重试。
- 历史及当前对话仍按账号、语言隔离。退出重登继续创建新对话，历史不会进入新请求的上下文。

## 存储与并发

删除与保存共用按账号/语言串行队列，读取最新档案后修改。界面版本号保护阻止删除前的异步结果把旧列表重新填回。删除期间抵达的 AI 回答会在完成后保存；切换账号后旧删除结果不会影响新账号界面。

容量按 100 段有消息的对话计算，另允许一个空白当前会话，总字符上限继续保持。删除释放空间后自动重试当前保存。如果首次载入失败而进入临时聊天，恢复持久化不会清草稿或中断请求；隐藏的原当前对话先归档，不会被临时聊天覆盖，也不会混入其 AI 上下文。

旧版 v1 迁移源数据按既有兼容设计保留；删除会持久更新 v2 档案和迁移状态，当前版本不会重新导入已删历史。这不是设备取证意义上的安全擦除，也不会删除系统备份或其他设备上的副本。

## 文件

- `components/AssistantConversationHistory.js`：删除/清空/确认界面。
- `utils/assistantConversations.js`：持久删除、当前对话保护及容量处理。
- `app/(tabs)/chat/index.js`：删除、保存、异步请求与身份切换的衔接。
- `scripts/package-ai-history-delete.ps1` 等：独立纯 Web 打包与安装工具。

## 验证与交付

最终验证：

- 删除功能定向测试 94 项通过；完整前端回归 136 套、2083 项全部通过，1 个 snapshot 通过。
- TypeScript 检查、最终 Android Hermes 导出及 Web 导出通过。
- 纯 Web 安装/备份/回滚测试 20 项通过；1 项 POSIX 文件权限测试在 Windows 条件跳过。ZIP 安全测试 8 项通过。
- 最终 ZIP 使用安装器同款安全解压逻辑重新提取，246 个 Web 文件全部通过清单/内嵌哈希校验，生成安装器的 Bash 语法检查通过。
- 首轮测试误用默认 Jest 配置索引了历史暂存文件，改用项目既有回归配置排除暂存文件后重跑；普通沙箱的隔离 HTTP 子进程测试遭 EPERM，允许子进程后完整重跑通过。不把环境失败列为通过。

测试使用本地模拟账号和存储，没有请求生产 DeepSeek、删除真实用户历史或修改服务器。未进行实体手机操作验证。

本轮没有原生组件变更。刚交付的 Android 1.2.3 / Build 17 用当前 Android preview OTA 脚本更新即可；该 runtime 的 OTA 不会下发给旧 1.2.2 安装包。没有重新构建 APK，没有发布 OTA。

服务器包仅用于同步 Web：固定更新 `/var/www/outdoor-fit`，内嵌校验、安装前备份、出错恢复，不更改 API、数据库、上传文件、服务配置或 Nginx。安装不依赖额外 `.sha256` 文件。没有自动上传云端或执行生产部署。

正式文件：`deploy/2026-09-23/outdoor-fit-ai-history-delete-20260923-update.zip`。

- 大小：157,706,774 字节（150.40 MiB）。
- SHA-256：`E6F4D51E6143FC6C6A362EA9D01F5071327D171E4DAAE33FCBF2328C9F667991`。
- Web 来源：`workspace-artifacts/ai-history-delete-20260923-web-r2`；不要使用未包含最终恢复修正的初次 Web 导出。
- 最终校验解压：`workspace-artifacts/ai-history-delete-final-y3zqq_u5`。

手机更新（Windows PowerShell，仅发布 Android preview）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "AI历史对话支持单条删除和清空，保留当前聊天"
```

如需同步 Web，电脑上传：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
gcloud storage cp ".\deploy\2026-09-23\outdoor-fit-ai-history-delete-20260923-update.zip" "gs://outdoor-rehab-fit/"
```

上传后在服务器 SSH 执行（内联校验值，无旁文件）：

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-ai-history-delete-20260923-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' 'E6F4D51E6143FC6C6A362EA9D01F5071327D171E4DAAE33FCBF2328C9F667991' 'outdoor-fit-ai-history-delete-20260923-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-ai-history-delete-20260923-update.zip install-ai-history-delete-20260923.sh > install-ai-history-delete-20260923.sh &&
sudo bash /home/dukaiyu2004/install-ai-history-delete-20260923.sh /home/dukaiyu2004/outdoor-fit-ai-history-delete-20260923-update.zip
```
