# AI 历史对话删除：Web 独立更新

发布标识：`ai-history-delete-20260923`。

仅更新 `/var/www/outdoor-fit` 下的 Web 页面与静态资源。包含 AI 历史对话删除的前端界面；手机仍须发布兼容的 OTA，安装此服务器包不会自行更新手机。

## 安全边界

- 不包含 API 源码，不停止或重启 API，不安装依赖，不修改数据库、账户、上传文件、密钥或 Nginx。
- 校验 ZIP 的全部路径、类型、大小和成员冲突后才解压；只接受列入清单的静态 Web 文件。
- 校验器、清单和本文的 SHA-256 嵌入安装脚本，Web 每个文件的 SHA-256 写入清单。不依赖额外 `.zip.sha256` 文件。
- 安装前备份将被替换的 Web 文件到 `/home/dukaiyu2004/outdoor-fit-backups`；先安装资源，最后替换 HTML。保留旧资源，避免已打开页面立即失效。
- 校验失败自动恢复本轮 Web 文件；如发现安装期间其他人修改目标文件，停止自动恢复并保留诊断，避免覆盖他人的修改。数据库和上传文件始终不在恢复范围内。

## 本地生成

源码和 Web 导出冻结后，在项目目录执行。不要将混合 Android/iOS 导出目录用作 Web 输入。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-ai-history-delete.ps1 -StageOnly
powershell -ExecutionPolicy Bypass -File .\scripts\package-ai-history-delete.ps1
```

默认读取 `workspace-artifacts/ai-history-delete-20260923-web`；输出 `deploy/2026-09-23/outdoor-fit-ai-history-delete-20260923-update.zip`，同时打印实际大小和 SHA-256。已存在的同名包不会覆盖。需要时可用 `-WebDirectory` 指定另一份经确认的纯 Web 导出。

## 服务器安装

先由操作者将 ZIP 上传到 `gs://outdoor-rehab-fit/`，再 SSH 执行下列命令。将占位符替换为打包输出的真实 SHA-256，不下载旁文件。尚未生成或上传的文件不能安装。

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-ai-history-delete-20260923-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' 'REPLACE_WITH_ACTUAL_ZIP_SHA256' 'outdoor-fit-ai-history-delete-20260923-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-ai-history-delete-20260923-update.zip install-ai-history-delete-20260923.sh > install-ai-history-delete-20260923.sh &&
sudo bash /home/dukaiyu2004/install-ai-history-delete-20260923.sh /home/dukaiyu2004/outdoor-fit-ai-history-delete-20260923-update.zip
```

安装成功后浏览器刷新（必要时 Ctrl+F5）。本包不改变服务器 API；无需为此重启 API 服务。

## Android OTA

适用于已安装 Build 17、Android runtime `1.2.3`、`preview` 渠道的手机；旧 runtime 须先安装兼容 APK。执行前先完成本轮前端测试，不要与 Build 并行执行。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "新增AI历史对话删除功能"
```

这份说明不代表已经执行上传、安装或 OTA 发布。
