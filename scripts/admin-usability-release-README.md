# 后台易用性与布局：Web 独立更新

发布标识：`admin-usability-20260923`。

仅将本轮经验证的完整 Web 导出更新至 `/var/www/outdoor-fit`，用于后台易用性与布局优化。不包含原生安装包，本轮后台页面更新无需手机 OTA。

## 安全边界

- 不包含 API 源码，不停止或重启 API，不安装依赖，不修改数据库、账户、上传文件、密钥或 Nginx。
- 校验 ZIP 的全部路径、类型、大小和成员冲突后才解压；只接受列入清单的静态 Web 文件。
- 校验器、清单和本文的 SHA-256 嵌入安装脚本，Web 每个文件的 SHA-256 写入清单。不依赖额外 `.zip.sha256` 文件。
- 安装前备份将被替换的 Web 文件到 `/home/dukaiyu2004/outdoor-fit-backups`；先安装资源，最后替换 HTML。保留旧资源，避免已打开页面立即失效。
- 校验失败自动恢复本轮 Web 文件；如发现安装期间其他人修改目标文件，停止自动恢复并保留诊断，避免覆盖他人的修改。数据库和上传文件始终不在恢复范围内。

## 本地生成

等待源码、测试和纯 Web 导出冻结后，在项目目录执行。不要使用混合 Android/iOS 导出或旧版本 Web 导出。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-admin-usability.ps1 -StageOnly
powershell -ExecutionPolicy Bypass -File .\scripts\package-admin-usability.ps1
```

默认读取 `workspace-artifacts/admin-usability-20260923-web`；输出 `deploy/2026-09-23/outdoor-fit-admin-usability-20260923-update.zip`，同时打印实际大小和 SHA-256。已存在的同名包不会覆盖。可用 `-WebDirectory "完整路径"` 指定本轮确认的纯 Web 导出。

## 服务器安装

先由操作者将 ZIP 上传到 `gs://outdoor-rehab-fit/`，再 SSH 执行下列命令。将占位符替换为打包输出的真实 SHA-256，不下载旁文件。尚未生成或上传的文件不能安装。

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-admin-usability-20260923-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' 'REPLACE_WITH_ACTUAL_ZIP_SHA256' 'outdoor-fit-admin-usability-20260923-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-admin-usability-20260923-update.zip install-admin-usability-20260923.sh > install-admin-usability-20260923.sh &&
sudo bash /home/dukaiyu2004/install-admin-usability-20260923.sh /home/dukaiyu2004/outdoor-fit-admin-usability-20260923-update.zip
```

安装成功后重新打开后台并刷新（必要时 Ctrl+F5）。本包不改变服务器 API；无需重启 API 服务。安装校验确认文件完整性，具体页面操作应同时参照本轮功能测试报告。

这份说明不代表已经执行上传、安装、Build 或 OTA 发布。
