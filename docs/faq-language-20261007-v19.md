# v19 繁体中文、粤语问答修复

状态：本地修复与交付准备；未上传 ECS、未部署生产、未发布 Android OTA。

## 已处理的问题

- 统一服务端和手机端的症状解析。识别“心口痛、抖唔到气”等粤语表达；普通双腿较弱与突然严重症状分开处理。
- “条腰冇事、没有腰痛、I do not have back pain”只排除被否认的部位。新的更正优先于旧对话；过去已经缓解的症状和引用文字不会自动当作当前症状。
- 未解除的急症上下文优先于普通 FAQ、器材与地点查询。历史记录重新显示时也应用该规则，避免旧回复的模型标记跳过提示。
- 修复陪家人练上肢、餐后运动、手腕承重、颈部受伤、膝痛与扭腰机、连续追问的匹配。膝痛、手腕痛的回答不再自动拼接不相关的肩部或腰部教学益处。
- 明确的器材教学可直接读取完整已发布内容，包括末尾注意事项。无效模型输出给出明确的澄清反馈；网络失败、权限失败、取消及资料变更保留错误处理，不伪装成成功回答。
- 不新增外部网站链接或外部知识回答。FAQ 版本标记为 `2026-10-07-v19`。
- 删除设置页用户资料上方整块同步提示，自动同步继续运行；删除运动影片页面标题下的说明文字，保留影片内容及入口。
- 区分 HTTP 请求体读取完毕和回复真正断线。兼容较新 Node 的请求信号，防止正常 AI 请求被误取消；后台 AI 任务继续沿用自身截止时间。

## 仍需核对的原始内容

上肢伸展器的原始教学同时有“不要两手同时拉绳”和“不可单手拉绳”，这属于内容冲突。本次 AI 会提示先核对，并保留教学入口，不自行选择其中一种动作或编造次数。原始教学应由内容负责人确认后再修改。

## 验证范围

两轮线上测试留下的 95 道原题已用于本地重放，保存完整问题、历史上下文和回复。路径及专项语义断言通过，不表示所有医疗内容已获专业认证。

本地证据目录：`workspace-artifacts/faq-language-20261007-v19-review/`。

- `local-regression.json`：95 道题的完整本地回复及来源 SHA256；多轮问题使用前一轮本地实际回复。
- `api-regressions.log`：SQLite 与 MySQL 形状适配器的服务端 HTTP 测试，使用独立测试账号和模拟模型；不是生产 RDS 或真实模型调用。
- `frontend-regression.log`：FAQ 显示、摘要、教学入口及历史恢复回归。
- 部署与导出检查：来源文件和网页目录逐项校验；缺失新模块、源码变更、错误 Android 项目或导出内容变更均拒绝发布。

最终测试：Node 24.19 的全部助手测试 193/193 通过，前端 AI 显示与历史相关测试 217/217 通过；两处 UI 删除相关现有组件测试 40/40 通过；部署／导出校验测试 10/10 通过。完整最终后端日志为 `api-regressions-node24.19-final.log`，独立审查为 `cross-module-independent-review.json`。审查中发现的五项边界问题已修复，无遗留阻断发现。

本次修改没有新增原生依赖，适用于既有 Android Build 17 / runtime 1.2.3。未在用户的 Google 模拟器验收；输入法改动沿用 v18，本次不声称重新解决了键盘问题。

代码经过独立交叉审查；审查中发现的急症路由顺序及否定／历史边界已纳入专项回归。更新后的真实账号和模型复测需要在部署后再进行。

## 部署范围

目标仍是旧 ECS `47.83.186.36`，SSH `28832`。本包只接受封存的 v18 服务端与对应网页目录，遇到未知修改会停止。

从现有镜像本地构建候选版本，不重新下载依赖，不迁移数据库。准备阶段旧服务继续运行；切换阶段确认 AI 队列空闲，短暂关闭入口，再替换唯一 API worker 并检查 app/admin/API HTTPS。保留数据库、账号、JWT、媒体及网络配置。

若出现 `UPDATE_AI_BUSY_TRY_LATER`，等待已有任务结束后重试原步骤。不要跳过来源校验或强行停止 AI 任务。

安装成功标记：`FAQ_LANGUAGE_UPDATE=PASS`。

回退命令：

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-language-20261007-v19/package/install.py --rollback
```

回退会检查当前配置和镜像身份，并等待正在运行的 AI 任务安全结束。

## 交付文件与执行命令

服务器包：`deploy/faq-language-20261007-v19/outdoor-fit-faq-language-20261007-v19.tar.gz`。

大小：1,393,949 字节；SHA-256：`dc3e27aa39f73a3777f8bd2778b198381c01439a7ab8fa7d3dbd054c0beb55ee`。

包内有 15 个服务端模块、4 个安装支持文件、2 个变化的网页文件；完整网页导出有 243 个文件。入口为 `entry-9c044782f683af9802fff7260a63b567.js`。

Android 导出：`workspace-artifacts/android-build17-faq-language-20261007-v19`，241 个文件、167,739,191 字节；manifest SHA-256：`257186f710f1bb5f3a8f5c948ab47c1908f2473be334ab393b21017d5a67512c`。导出后网页及 Android 的 Verify 均再次通过，原项目配置和环境已还原。

电脑 PowerShell（只复制代码框内命令）：

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
scp -P 28832 '.\deploy\faq-language-20261007-v19\outdoor-fit-faq-language-20261007-v19.tar.gz' root@47.83.186.36:/tmp/
if ($LASTEXITCODE -ne 0) { throw '上传失败，请勿执行安装' }
```

旧 ECS 的 root SSH / Bash：

```bash
(
set -euo pipefail
umask 077
archive=/tmp/outdoor-fit-faq-language-20261007-v19.tar.gz
printf '%s  %s\n' dc3e27aa39f73a3777f8bd2778b198381c01439a7ab8fa7d3dbd054c0beb55ee "$archive" | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-v19.XXXXXXXX)"
tar --extract --gzip --file="$archive" --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
installer="$update_dir/outdoor-fit-faq-language-20261007-v19/install.py"
python3 "$installer" --check-only
python3 "$installer" --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-language-20261007-v19/package/install.py --apply
)
```

看到 `FAQ_LANGUAGE_UPDATE=PASS` 后，再在电脑 PowerShell 发布 Android OTA：

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& '.\scripts\android-build17-faq-language-v19-ota.ps1' -Action Verify
if ($LASTEXITCODE -ne 0) { throw '校验失败，请勿发布' }
& '.\scripts\android-build17-faq-language-v19-ota.ps1' -Action Publish
```

以 `OTA_ANDROID_PREVIEW_PUBLISHED=YES` 判断发布成功；本地导出和 Verify 不代表已经发布。手机接收更新后关闭并重新打开，再检查新的回复与两处文字删除。
