# 审查修复交付 v11（2026-09-30）

已完成本地修复、测试和交付校验。**未上传到 ECS、未安装线上、未发布 Android OTA。** GitHub 推送只更新仓库代码。

修复说明见 [代码审查报告](code-review-20260930.md)。包括 AI 队列容量及断连恢复、账号同步丢回包后的后续编辑、旧登录状态 ID 补全、学习记录上传／下载隔离，以及部署配置保存和回退。

## 后端与网页

交付文件：[outdoor-fit-account-data-20260930-v11-delta.tar.gz](../deploy/account-data-20260930-v11/outdoor-fit-account-data-20260930-v11-delta.tar.gz)

- 大小：**1,503,789 字节**（约 1.43 MiB）。
- SHA-256：`80e069a9ffb23f68b3f0f6bd1024d6529e426e9e4e4130654cfb955e64e851b9`
- 包含 API 源码、网页差异资源及 v11 安装器。
- 只接受已运行的 API `20260928-v9` 或 `20260928-v10`，核验现场资源后安装。其他版本会停止，不能绕过校验。
- 从 v9 增加账号资料表；从 v10 核对已有表。不重新导入旧 SQLite、不清空生产数据。
- 旧 v9/v10 包和手机导出保留原样；本次修复不在旧包内。

Windows PowerShell，电脑端执行上传：

```powershell
Set-Location 'D:\polyu work\outdoor-rehab-fit-anesthesia'
Get-FileHash -Algorithm SHA256 '.\deploy\account-data-20260930-v11\outdoor-fit-account-data-20260930-v11-delta.tar.gz'
scp -P 28832 '.\deploy\account-data-20260930-v11\outdoor-fit-account-data-20260930-v11-delta.tar.gz' root@47.83.186.36:/root/
```

确认上述哈希一致后，在阿里 ECS 的 Bash 执行安装。会短暂重建 API 和 Caddy；请不要并行运行其他部署。提示时仅在终端输入 `outdoor_fit_migrator` 的密码。

```bash
(
set -euo pipefail
umask 077
cd /root
printf '%s\n' '80e069a9ffb23f68b3f0f6bd1024d6529e426e9e4e4130654cfb955e64e851b9  outdoor-fit-account-data-20260930-v11-delta.tar.gz' | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-account-data-v11.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
env -u TAR_OPTIONS tar --extract --gzip \
  --file=/root/outdoor-fit-account-data-20260930-v11-delta.tar.gz \
  --directory="$update_dir" --no-same-owner --keep-old-files
python3 "$update_dir/outdoor-fit-account-data-20260930-v11/install.py"
)
```

只有 `ACCOUNT_DATA_UPDATE=PASS` 表示安装器的服务器、网页和接口检查通过。若失败，保留输出与状态目录，不删除状态后强行重装。

需要回退时，服务器 Bash 命令为：

```bash
bash /opt/outdoor-fit/production/.update-state/account-data-20260930-v11/rollback.sh
```

回退分别尝试 API 和 Caddy，并保留新增资料表。检测到后续部署会拒绝覆盖；这时应核对当前版本，不能绕过保护。

## Android 1.2.3 / Build 17

后端安装成功后，在电脑 Windows PowerShell 发布已经封存的 v11：

```powershell
Set-Location 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& .\scripts\android-build17-account-data-v11-ota.ps1 -Action Verify
& .\scripts\android-build17-account-data-v11-ota.ps1 -Action Publish
```

发布到原 Android 项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`、`preview` 通道、runtime `1.2.3`。脚本恢复原始根配置，不使用默认 iOS 项目发布 Android。看到 `OTA_ANDROID_PREVIEW_PUBLISHED=YES` 后才代表发布成功；手机还需联网接收并重开。

- Android 导出：241 个文件，167,546,888 字节。
- 导出目录：`workspace-artifacts/android-build17-account-data-20260930-v11/export`。
- 清单 SHA-256：`5bf0b024e6e7720df23a3a0f2877c400b58332b985e48da9a2837058704af726`。
- 新导出绑定修复后的源码；旧 v10 的发布命令不能作为本次修复发布使用。

## 本地验证

- 前端：8 套、127 项相关回归通过。
- 后端：74 项相关测试通过。
- 部署和封存保护：15 项测试通过。
- 网页导出、Android Hermes 导出、包内文件 SHA-256 及 OTA 清单检查通过；原 `app.json` 恢复为 SHA-256 `d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe`。
- 本地未运行真实 Docker/RDS 安装、手机真机或生产网络验证；安装器现场检查不能用上述单元测试代替。

安装包、OTA 导出和部署压缩包保留在本地交付目录，不进入 Git 源码历史。源码、测试、安装／打包／发布脚本、校验和及本说明纳入仓库。
