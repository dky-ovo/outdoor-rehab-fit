# AI 原文依据后端补丁交付

日期：2026-09-14。状态：本地部署包已生成并验证，未上传存储桶、未执行服务器安装、未发布手机 OTA。

- 文件：`deploy/2026-09-14/outdoor-fit-ai-backend-evidence-20260914-update.zip`
- 大小：77,170 字节（75.36 KiB）。不包含视频，体积小属正常。
- SHA-256：`23BF32F928B6ECDB217E1193036D05C6E26423569C7FCDF67E09A6D0248DA59B`
- 适用基线：2026-09-11 `pdf-app-timer-20260911` 后端，或本补丁已安装状态。全部 19 个原始源文件和依赖清单均核对；其他版本拒绝安装。
- 修改范围：只替换 `src/app.js`、`src/assistant.js`，添加 `src/assistantSymptomEvidence.js`、`src/equipmentGuideEvidence.json`。
- 保留运行数据库、账号权限、上传、媒体种子、Web、Nginx 和已有依赖。安装会短暂停止并重启 API。

## 验证

- PowerShell 打包脚本解析通过；Bash 安装脚本 `bash -n` 通过。
- 打包安全测试 24 项通过。
- 实际 20260911 源文件核对为 baseline；用包内四文件构造新源树后核对为 installed。
- 构造的新源树通过 6 项真实本地 HTTP 隔离测试，使用内存数据库，外部 AI 调用为零。
- 最终 ZIP 9 个条目逐个 SHA-256 与暂存文件一致，四个载荷与当前后端源文件一致。
- 独立审查覆盖失败恢复、完整基线、备份一致性、同一部署锁和重复安装后进程重启。未在生产 Linux 上执行安装。

## 上传：Windows PowerShell

```powershell
gcloud storage cp "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\2026-09-14\outdoor-fit-ai-backend-evidence-20260914-update.zip" "gs://outdoor-rehab-fit/outdoor-fit-ai-backend-evidence-20260914-update.zip"
```

## 安装：服务器 SSH

以下四步使用 `&&` 连接，任一步失败都不继续后续安装。

```bash
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-ai-backend-evidence-20260914-update.zip /home/dukaiyu2004/outdoor-fit-ai-backend-evidence-20260914-update.zip &&
echo '23BF32F928B6ECDB217E1193036D05C6E26423569C7FCDF67E09A6D0248DA59B  /home/dukaiyu2004/outdoor-fit-ai-backend-evidence-20260914-update.zip' | sha256sum -c - &&
unzip -p /home/dukaiyu2004/outdoor-fit-ai-backend-evidence-20260914-update.zip install-ai-symptom-evidence-20260914.sh > /home/dukaiyu2004/install-ai-symptom-evidence-20260914.sh &&
sudo bash /home/dukaiyu2004/install-ai-symptom-evidence-20260914.sh /home/dukaiyu2004/outdoor-fit-ai-backend-evidence-20260914-update.zip
```

成功会输出 `AI backend patch completed` 和备份目录。如果提示基线不兼容或校验失败，保留完整输出反馈，不要跳过校验或用旧全量包强行覆盖。

手机仍需单独发布兼容 OTA，后端包不会消除旧手机端本地补推荐逻辑，也不会改后台网页样式或地址。
