# v21：次数、负重口语及相关上下文修复

已完成本地修改、真实 Web／Android 导出和封包；尚未上传、部署或发布 OTA。网页与 Android 需要分别更新。

## 本轮范围

在明确重新加载 v20 网页后，“拉繩機要拉幾多下先夠？我係長者。”返回了未获 Word／已发布教学支持的次数和组数。本次补充拉绳器粤语别名及次数、负重问法，并修复相关急症上下文与历史答复展示；英文 how heavy、rep target 等同类问法也纳入本地回归。

这不代表所有自然语言表达都已穷尽验证，也不代表 Word 对照发现的全部遗漏已修复。重新提问的 28 道 Word 原题在 v20 的严格结果仍为：8 题核心语义一致、12 题关键遗漏、7 题偏离、1 题动态占位无法仅凭 Word 判断。该报告保持真实原样，不能用本次 v21 包替代线上复测，更不能说 28 题已经全部一致。

此前未刷新标签页使用旧客户端的观察已从 v20 UI 结论排除；上面的缺陷来自确认 v20 页面版本后的独立复测。

## 实际产物

服务器包：

- 路径：`deploy/faq-repetitions-20261007-v21/outdoor-fit-faq-repetitions-20261007-v21.tar.gz`
- 大小：1,411,452 字节，约 1.35 MiB。
- SHA-256：`dfe6ba6f7b488b48b6d69ed7f8c282d9b2aef031c8f60d2a01aec8d7adda06e0`
- 17 个后端模块、4 个安装支持文件、2 个变化的网页文件；最终网页清单共 243 项。
- 仅接受实际封存 v20 的服务及两种对应网页基线，没有新增运行时模块。

Android：

- 目录：`workspace-artifacts/android-build17-faq-repetitions-20261007-v21`
- 241 个文件，167,816,055 字节。
- 清单 SHA-256：`91823e1bb31c3f5aef2a4aeaed68322cff7275662af574f89beeea56e8cbcd0e`
- 目标：Android Build 17／runtime 1.2.3／preview；这不是新 APK。
- 原 `app.json` 与环境变量已恢复；原配置 SHA 核对通过。

最终 Web 入口：`entry-3c5a6c7cc2fbc40a877422b4cf53992b.js`。

## 验证范围

- 10 项新增 HTTP 数量问法检查通过，87 项相关后端回归通过；使用本地回环 HTTP 与 MySQL 形状测试，不是生产 RDS 实测。
- 最终修改后 18 项客户端数量／历史专项再次通过。
- 扩展客户端回归为 11 套、378 项，其中 375 通过、3 项失败。独立对照已证明这 3 项旧断言／急症夹具差异也存在于封存 v20，不是本次新增；不能把该扩展回归说成全部通过。
- 20 项安装／回退、9 项基线／文件清单、2 项 Web／Android 封存守卫测试通过。
- 最终 Web 真实导出、Android Hermes 字节码导出、源文件与产物哈希校验均通过。
- 未运行 Android 实机／模拟器检查；未对 v21 进行生产账号复测，不声称实际速度或全部回答问题已在线解决。

首次导出后发现额外数量问法遗漏，已暂停并把草稿保存在带 `superseded-before-quantity-edge-fix` 后缀的目录。本次交付为最终源码冻结后重新生成的产物，未覆盖或发布旧草稿。

## 1. Windows PowerShell 上传

只复制代码块中的命令，不复制代码围栏。

~~~powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
scp -P 28832 '.\deploy\faq-repetitions-20261007-v21\outdoor-fit-faq-repetitions-20261007-v21.tar.gz' root@47.83.186.36:/tmp/
if ($LASTEXITCODE -ne 0) { throw 'V21_UPLOAD_FAILED' }
~~~

## 2. 当前生产 ECS 的 SSH 窗口安装

~~~bash
(
set -euo pipefail
umask 077
archive=/tmp/outdoor-fit-faq-repetitions-20261007-v21.tar.gz
printf '%s  %s\n' dfe6ba6f7b488b48b6d69ed7f8c282d9b2aef031c8f60d2a01aec8d7adda06e0 "$archive" | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-v21.XXXXXXXX)"
tar --extract --gzip --file="$archive" --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
cd "$update_dir/outdoor-fit-faq-repetitions-20261007-v21"
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-repetitions-20261007-v21/package/install.py --apply
)
~~~

成功标记：`FAQ_REPETITIONS_UPDATE=PASS`。若出现 `UPDATE_AI_BUSY_TRY_LATER`，等待现有任务结束后重试同一步；不要跳过队列检查。其他错误请保留错误码，先不要发布手机更新。

安装器以当前 v20 镜像离线构建，保留数据库、账户、JWT、媒体、环境、独立 Compose 和无关隧道。切换时先关闭入口、复核队列，替换唯一 API worker。数据库不需要迁移。

手动回退：

~~~bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-repetitions-20261007-v21/package/install.py --rollback
~~~

## 3. 服务器成功后回到 Windows，发布 Android OTA

~~~powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& '.\scripts\android-build17-faq-repetitions-v21-ota.ps1' -Action Verify
& '.\scripts\android-build17-faq-repetitions-v21-ota.ps1' -Action Publish
~~~

`OTA_ANDROID_PREVIEW_PUBLISHED=YES` 表示发布完成；手机仍需取得更新并重新打开，发布成功不代表设备已经生效。此次已完成真实导出，不要重复执行 `Export`。

## 证据

- `workspace-artifacts/ai-word-alignment-20261007-v20/Word原题与AI回答-逐题对照报告.html`：本轮 28 道 Word 原题严格对照主报告。
- `workspace-artifacts/ai-faq-account-retest-20261007-v20/AI-v20-线上复测报告.html`：107 道广泛回归与 5 项新版 UI 观察；其“符合”不能解释成 Word 全文一致。
- `workspace-artifacts/faq-quantity-20261007-v21-review/independent-parent-quantity-review.json`：数量判断的独立审查与修复。
- `workspace-artifacts/assistant-quantity-20261007-v21-review/`：客户端专项、扩展测试及 v20 既有差异证据。
- `workspace-artifacts/faq-repetitions-20261007-v21-review/`：安装守卫、封存检查及最终导出日志。
- `workspace-artifacts/faq-repetitions-20261007-v21/package-result.json`：实际封包结果。
