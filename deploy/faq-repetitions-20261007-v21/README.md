# v21：拉绳器别名与次数问法

本包只接受实际封存的 v20 服务端源码及其两种对应网页目录。安装前逐文件核对 17 个后端模块；本轮没有新增运行时模块。未知修改、缺少模块或网页树不匹配会停止安装。

本轮针对已复现的粤语器材别名、次数及负重问法补充匹配，避免拉绳教学仍有内容冲突时生成没有依据的数量；同时修复相关急症上下文及历史答复展示。实际修改与验证以最终发布说明为准；本地通过不等于线上效果已验证，也不证明所有未测试问法都被覆盖。

本包没有修复 Word 严格对照中所有遗漏或差异，不应把升级成功当作 28 道原题已全部与原文一致。

## 安装

核对本包 SHA-256 后上传，在新目录解压，不覆盖旧发布目录。进入解压目录执行：

```bash
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-repetitions-20261007-v21/package/install.py --apply
```

`--check-only` 只检查包与环境；`--prepare` 从当前 v20 镜像离线构建候选镜像，旧服务继续运行；`--apply` 在队列空闲时关闭入口、再次核对，再替换唯一 API worker 并恢复入口。独立 API／Caddy Compose 配置和无关隧道保持原样。

成功标记：`FAQ_REPETITIONS_UPDATE=PASS`。若出现 `UPDATE_AI_BUSY_TRY_LATER`，等待已有任务结束后重试同一步，不绕过检查。

## 回退

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-repetitions-20261007-v21/package/install.py --rollback
```

回退先关闭入口并检查队列；仍有 AI 任务时保留 worker，不强行中断。回退不清空聊天数据。

## Android

电脑脚本 `scripts/android-build17-faq-repetitions-v21-ota.ps1` 仅针对 Android Build 17／runtime 1.2.3／preview。最终真实导出完成后，先执行 `-Action Verify`；服务器安装成功后再执行 `-Action Publish`。脚本恢复原项目配置，不使用 iOS 默认项目发布。

数据库结构、账号、JWT、媒体和网络配置沿用生产环境。构建、封包及验证不代表已上传、部署或发布；线上复测和 Android 实机检查需另行记录。
