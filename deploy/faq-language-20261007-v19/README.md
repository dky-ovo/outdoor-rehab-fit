# v19 AI 语言与问答修复

只接受已封存的 v18 服务端源码及两种对应网页目录。安装器逐文件核对来源，任何未识别的服务器修改都会停止安装。

本包更新 FAQ、繁体／粤语／英文症状识别、否定句和连续追问，以及明确器材查阅与受控生成失败反馈。数据库、账号、JWT、媒体文件和网络配置沿用现有生产配置。

网页与 Android 同步删除设置页用户资料上方的同步提示、运动影片标题下的说明文字。登录自动同步及影片内容保留。

## 安装

先在电脑核对外部 SHA256SUMS，然后上传压缩包。服务器使用新目录解压，不要覆盖旧发布目录。

```bash
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-language-20261007-v19/package/install.py --apply
```

`--check-only` 仅核对包及线上环境。`--prepare` 从当前 API 镜像本地构建候选镜像，不下载依赖，旧服务继续运行。`--apply` 确认 AI 队列空闲，关闭入口并再次核对后，替换唯一 API worker，再恢复入口。正在运行的 AI 任务不会被本安装器强行中断。

成功标记：`FAQ_LANGUAGE_UPDATE=PASS`。

若提示 `UPDATE_AI_BUSY_TRY_LATER`，请等已有任务结束后再执行原步骤，不要绕过检查。

## 回退

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-language-20261007-v19/package/install.py --rollback
```

自动及手动回退都会核对配置与镜像身份，并尊重运行中的 AI 任务。回退保留迁移前后的聊天数据；本更新不修改数据库结构。

## 手机更新

网页与手机共用部分 FAQ 展示代码，需同时发布 v19 Android OTA。使用电脑项目内的 `scripts/android-build17-faq-language-v19-ota.ps1`，先 `-Action Verify`，服务器成功后再 `-Action Publish`。该脚本只针对既有 Build 17 / runtime 1.2.3 的 Android preview，并恢复原来的项目配置。

本地测试与封包成功不等于已经部署。上线后的真实账户复测仍需单独记录。
