# 关于我们及关于此程序：APP、完整 Web 与后台文字目录更新

发布标识：`team-about-20260924`。

本轮将原「关于我们」介绍移到「关于此程序」，并将「关于我们」更新为新团队文档内容。本包包含本轮完整纯 Web 导出，以及唯一后端文件 `src/appTextCatalog.json`。新团队中英文文字接入后台文字维护；完整目录也包含上轮隐私声明文字。手机端需要另行发布 OTA，没有新增原生依赖。

## 安装条件与保留范围

- 安装前核对现有后端 `app.js`、`appTexts.js`、`adminPagination.js`、`index.js`、`package.json` 的受支持哈希和文字接口。未知实现会在停止服务或替换文件之前报错，本包不安装这些源码或依赖。
- `package.json` 精确兼容经审核的两份版本（仅相差是否声明本地 `mysql2 3.24.4` 依赖）；不安装、移除或修改服务器依赖。其余四份后端源码必须一致，备份后包括 `package.json` 在内的所有支持文件均不得变化。
- 现有目录中的每个文字键、字段类型及中英文默认值必须保持不变，不能删除；后台分组、说明标签及来源标签允许调整。旧版 APP 使用的团队文字键保留，不覆盖已经保存的管理员文字。
- 兼容已安装或未安装上轮隐私声明目录的受支持后台，不需要先安装旧 ZIP。若服务器有更新且本包不认识的文字键或不同默认值，安装会安全停止。
- 不读取环境文件、进程环境或数据库文件；不修改账户、上传文件、密钥、依赖或 Nginx。只短暂重启 `outdoor-fit-api` 以读取新目录。
- 安装锁与现有部署共用；先校验所有 ZIP 路径、文件类型、大小。目录、辅助文件及每个 Web 文件都有包内 SHA-256 校验，不依赖外部 `.sha256` 文件。
- 仅备份文字目录和受影响 Web 文件，保留旧静态资源。失败仅恢复这两个范围；发现并发修改时停止自动恢复并保留诊断和备份。

## 本地打包（Windows PowerShell）

先完成文字目录生成、测试及本轮纯 Web 导出。默认导出目录为 `workspace-artifacts/team-about-20260924-web`；可以使用 `-WebDirectory` 指定最终导出目录。`-StageOnly` 只生成并核验暂存包，不生成 ZIP。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File .\scripts\package-team-about.ps1 -WebDirectory .\workspace-artifacts\team-about-20260924-web -StageOnly
powershell -ExecutionPolicy Bypass -File .\scripts\package-team-about.ps1 -WebDirectory .\workspace-artifacts\team-about-20260924-web
```

正式输出：`deploy/2026-09-24/outdoor-fit-team-about-20260924-update.zip`。脚本打印实际大小和 SHA-256；已存在的同名 ZIP 不会被覆盖。

## 上传（Windows PowerShell）

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
gcloud storage cp ".\deploy\2026-09-24\outdoor-fit-team-about-20260924-update.zip" "gs://outdoor-rehab-fit/"
```

## 安装（现有 outdoor-fit-prod 服务器 SSH / Bash）

将 `REPLACE_WITH_ACTUAL_ZIP_SHA256` 换成正式包实际 SHA-256。校验失败不会执行安装器。解出安装器的命令与 `>` 必须位于同一行。

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-team-about-20260924-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' 'REPLACE_WITH_ACTUAL_ZIP_SHA256' 'outdoor-fit-team-about-20260924-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-team-about-20260924-update.zip install-team-about-20260924.sh > install-team-about-20260924.sh &&
sudo bash /home/dukaiyu2004/install-team-about-20260924.sh /home/dukaiyu2004/outdoor-fit-team-about-20260924-update.zip
```

## 手机 OTA（Windows PowerShell，顺序执行）

安卓使用项目专用 preview 发布脚本，脚本退出后恢复 iOS 根配置。不要同时执行两个平台的命令。

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File .\scripts\publish-android-preview-update.ps1 -Message "更新关于我们团队及关于此程序介绍" -NonInteractive
npx eas-cli@latest update --platform ios --channel production --message "更新关于我们团队及关于此程序介绍" --non-interactive
```

打包和本说明不代表已经上传、部署、发布 OTA 或提交 Build。
