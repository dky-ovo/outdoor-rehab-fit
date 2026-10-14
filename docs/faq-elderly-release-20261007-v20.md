# v20：长者可理解的 AI 回复

本次已修改并导出、封包，尚未上传、部署或发布 OTA。Web 与 Android 必须分别更新。

之前的回复把内部内容约束写给了用户，出现“现有 FAQ 没有……”和“供核对的教学入口”。现在 FAQ 只作后台参考：先回答问题，再用短句说明必要注意事项；不把来源检索、证据核对等内部过程显示给长者。

## 修改范围

- 31 组中英 FAQ 采用简明答法；繁体、粤语口语和换表达方式继续使用同一规范。必要警示保留，每次最多三张器材卡。
- 去掉内部 FAQ 标签、重复跳转说明及未请求的整段中医附加内容。历史聊天仅调整显示，保存原始记录。
- 明确说“没有肩周炎／足底筋膜炎”时，不再选用专门针对该疾病的文字；连续对话仍保留尚未解除的急症提示。
- 明确的器材或专业栏目教学直接返回已维护的完整段落，保留末尾注意事项。新话题和被用户排除的器材不会误继承。
- 缺少有效匹配时减少不必要的模型等待；需要模型选择已核实内容的分支关闭 thinking。实际线上耗时改善须部署后测量。
- 设置用户资料上方的同步标语和运动影片下的说明文字已从此前版本移除，当前导出包含该状态。

拉绳教学有相互矛盾的手部操作说明，尚需内容负责人确认。本次没有臆造单手、双手动作或次数，改为直接提示请场地人员或治疗师示范；不能将这项文案修复说成动作内容已获确认。

## 已完成的验证

线上复测针对修改前的 v19，不能作为 v20 已部署的证明：

- 107 个实际登录后的 API 请求全部完成，包含 Word 原题、改写、繁体、粤语及连续追问。
- 内容分类：89 符合、15 合理范围处理、3 部分覆盖；这三项及额外代码审查发现已在 v20 修改。
- 本轮未检测到回复外链；重新登录后全部 107 条问答同步一致。
- 中位耗时 527 ms，P95 2501 ms，最长 31509 ms。仅代表这次采样。
- 浏览器另核对四个场景，属于上面题目的界面复核，不增加唯一题目数量。
- 全文及浏览器截图在：workspace-artifacts/ai-faq-account-retest-20261007-v19/AI-v19-线上复测报告.html。

v20 本地验证：

- 95 题 FAQ 路由回归通过，已保存全部本地答案，并审阅 31 组中英答法。
- 后端相关测试 209/209；最后展示和 API 更正后，受影响的 73 项再次通过。
- 前端 11 套、403/403 项通过；独立审查发现的四项问题均修复并复核。
- 29 项部署/回退与基线检查、2 项 Web/OTA 封存检查通过。
- Web 真实导出、Android Hermes 字节码导出和源码/文件哈希封存通过。
- 未用 Android 模拟机或实机验证此次显示，不声称键盘问题已在本轮实机验收。

## 实际产物

服务器包：

- 路径：deploy/faq-elderly-20261007-v20/outdoor-fit-faq-elderly-20261007-v20.tar.gz
- 大小：1,409,434 字节（约 1.34 MiB）。
- SHA-256：7db41956b1c05d15484f111690f299fdb14a86d19ede75b744f1b20f7dd735b4
- 17 个后端模块、4 个安装支持文件、3 个变化的网页文件。
- 仅接受已核对的 v19 服务与网页基线。数据库、账户和媒体不需要迁移。

Android：

- workspace-artifacts/android-build17-faq-elderly-20261007-v20
- 241 个文件，167,796,619 字节。
- 清单 SHA-256：d3b65776f246ec8efccd0153fdfb4022b55b3a01f1c28bbc7d7e6418a326cf87
- Build 17 / runtime 1.2.3 / preview。
- 导出时原项目配置和环境变量已恢复。首次沙箱内 Hermes 写临时文件被拒，保留失败目录后，以本地编译权限重试成功，没有上传动作。

## 1. Windows PowerShell 上传

只复制代码块里的命令，不复制三个反引号。

~~~powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
scp -P 28832 '.\deploy\faq-elderly-20261007-v20\outdoor-fit-faq-elderly-20261007-v20.tar.gz' root@47.83.186.36:/tmp/
if ($LASTEXITCODE -ne 0) { throw 'V20_UPLOAD_FAILED' }
~~~

## 2. 当前生产 ECS 的 SSH 窗口安装

~~~bash
(
set -euo pipefail
umask 077
archive=/tmp/outdoor-fit-faq-elderly-20261007-v20.tar.gz
printf '%s  %s\n' 7db41956b1c05d15484f111690f299fdb14a86d19ede75b744f1b20f7dd735b4 "$archive" | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-v20.XXXXXXXX)"
tar --extract --gzip --file="$archive" --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
cd "$update_dir/outdoor-fit-faq-elderly-20261007-v20"
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-elderly-20261007-v20/package/install.py --apply
)
~~~

成功标记 FAQ_ELDERLY_UPDATE=PASS。若出现 UPDATE_AI_BUSY_TRY_LATER，等已有任务结束后再运行提示中的同一步，不绕过队列检查。其他错误保留完整错误码反馈，不继续发布手机更新。

安装器从当前 v19 镜像离线构建，保留数据库、媒体、环境和独立 Compose 配置。切换时关闭入口并复核队列，不启动第二个生产 worker。手动回退：

~~~bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-elderly-20261007-v20/package/install.py --rollback
~~~

## 3. 服务器成功后，回到 Windows 发布 Android OTA

~~~powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& '.\scripts\android-build17-faq-elderly-v20-ota.ps1' -Action Verify
& '.\scripts\android-build17-faq-elderly-v20-ota.ps1' -Action Publish
~~~

看到 OTA_ANDROID_PREVIEW_PUBLISHED=YES 代表发布完成。手机仍需取得更新并重新打开，不能把发布成功当作已在设备生效。此次已经导出，勿重复执行 Export。

## 证据文件

- workspace-artifacts/faq-language-20261007-v20-review/local-regression.json：95 个本地问题、上下文和完整回复，明确标注未调用线上模型。
- workspace-artifacts/faq-elderly-20261007-v20-review/independent-parent-review.json：四项独立审查与修复证据。
- workspace-artifacts/faq-elderly-20261007-v20-review/final-dependency-audit.json：安装器与运行时依赖检查。
- workspace-artifacts/assistant-user-language-20261007-v20-review/frontend-review-summary.json：前端 403 项测试与源文件哈希。
- workspace-artifacts/faq-elderly-20261007-v20/package-result.json：实际封包信息。
