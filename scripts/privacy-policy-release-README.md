# 隐私声明：APP、完整 Web 与后台文字目录更新

发布标识：`privacy-policy-20260924`。

本包包含本轮完整纯 Web 导出，以及唯一后端文件 `src/appTextCatalog.json`。隐私声明在 APP 设置中打开，中文、英文均可离线阅读；对应文字加入现有后台文字维护目录。安装需短暂重启 `outdoor-fit-api` 以重新读取 JSON。手机端需另行发布 OTA。

## 安装条件与保留范围

- 安装前核对现有后端 `app.js`、`appTexts.js`、`adminPagination.js`、`index.js`、`package.json` 的受支持哈希和文字接口。未知实现会在停止服务或替换文件之前报错。本包不会安装这些源码或依赖。
- 现有文字目录必须是新目录中逐项不变的子集；不会删除条目或覆盖未审核的默认文字变化。已经保存的管理员文字存于数据库，本包不修改这些覆盖值。
- 不依赖任何旧 ZIP，不读取环境文件或进程环境，不访问数据库文件，不修改账户、上传文件、密钥、依赖或 Nginx。
- 安装锁与其他现有部署共用；先核对所有 ZIP 路径、类型、大小，再解包。唯一 JSON、辅助文件及每个 Web 文件均有包内 SHA-256 校验。
- 只备份文字目录和受影响 Web 文件；静态资源先安装、HTML 最后安装；保留旧资源。失败只恢复这两个范围，发现他人并发修改时停止自动恢复并保留诊断和备份。

## 本地打包（Windows PowerShell）

先完成目录生成、测试及本轮纯 Web 导出，再执行。`-WebDirectory` 可指定最终 Web 导出目录，默认是 `workspace-artifacts/privacy-policy-20260924-web`。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File .\scripts\package-privacy-policy.ps1 -WebDirectory .\workspace-artifacts\privacy-policy-20260924-web -StageOnly
powershell -ExecutionPolicy Bypass -File .\scripts\package-privacy-policy.ps1 -WebDirectory .\workspace-artifacts\privacy-policy-20260924-web
```

输出 `deploy/2026-09-24/outdoor-fit-privacy-policy-20260924-update.zip`，并打印实际大小和 SHA-256。已存在的同名包不会覆盖；本包不产生或依赖额外的 `.sha256` 文件。

## 上传（Windows PowerShell）

```powershell
gcloud storage cp ".\deploy\2026-09-24\outdoor-fit-privacy-policy-20260924-update.zip" "gs://outdoor-rehab-fit/"
```

## 安装（SSH / Bash）

把 `REPLACE_WITH_ACTUAL_ZIP_SHA256` 替换成正式交付包的实际 SHA-256；校验失败不会执行安装器。

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-privacy-policy-20260924-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' 'REPLACE_WITH_ACTUAL_ZIP_SHA256' 'outdoor-fit-privacy-policy-20260924-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-privacy-policy-20260924-update.zip install-privacy-policy-20260924.sh > install-privacy-policy-20260924.sh &&
sudo bash /home/dukaiyu2004/install-privacy-policy-20260924.sh /home/dukaiyu2004/outdoor-fit-privacy-policy-20260924-update.zip
```

## 手机 OTA（Windows PowerShell，顺序执行）

安卓沿用项目切换脚本，当前 Android 1.2.3 / preview；脚本结束后恢复独立 iOS 根配置。iOS 当前为 1.2.2 / production。不要同时执行两个发布命令，也不要把根 iOS 项目直接用于 Android 发布。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File .\scripts\publish-android-preview-update.ps1 -Message "设置新增中英文隐私声明" -NonInteractive
npx eas-cli@latest update --platform ios --channel production --message "设置新增中英文隐私声明" --non-interactive
```

本说明和本地打包不表示已经上传、部署、发布 OTA 或提交 Build。
