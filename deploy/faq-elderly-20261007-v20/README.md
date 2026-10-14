# v20 长者友善 AI 回答更新

本包只接受已封存的 v19 服务端源码及其两种对应网页目录。安装前逐文件核对；未识别的修改、缺少模块或不匹配的网页目录都会停止安装。

本轮将 FAQ 作为内部内容参考，回答直接说明用户该注意什么，减少内部检索话术；根据明确否认的疾病筛选内容，明确索取器材教学时直接查阅已维护的指南。需要模型选择内容的分支关闭 thinking。实际交付范围和验证结果以封包后的发布说明为准；这些修改不等于已验证线上响应速度提升。数据库结构、账号、JWT、媒体文件和现有网络配置沿用当前生产环境。

## 安装

在电脑校验本包的 SHA256SUMS 后上传。服务器使用新目录解压，不覆盖任何旧发布目录，然后进入解压后的目录执行：

```bash
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-elderly-20261007-v20/package/install.py --apply
```

`--check-only` 核对包与环境，不修改服务。`--prepare` 从正在运行的 v19 镜像离线构建候选镜像，现有服务继续运行。`--apply` 在队列空闲时关闭入口、再次核对，再替换唯一 API worker 并恢复入口。独立的 API／Caddy Compose 配置以及与本次更新无关的隧道保留。

成功标记：`FAQ_ELDERLY_UPDATE=PASS`。若出现 `UPDATE_AI_BUSY_TRY_LATER`，等已有任务结束后再执行同一步骤，不绕过检查。

## 回退

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-elderly-20261007-v20/package/install.py --rollback
```

回退校验原有配置、镜像与当前容器身份。恢复入口后的验证若失败，也会先关闭入口并检查队列；有未完成 AI 任务时保留 worker，不强行中断。回退不清空聊天数据。

## Android

网页和 Android 共用部分回答展示代码。电脑项目中的 `scripts/android-build17-faq-elderly-v20-ota.ps1` 仅针对已安装 Build 17／runtime 1.2.3 的 Android preview。发布前运行 `-Action Verify`；在服务器更新完成后再按交付命令运行 `-Action Publish`。脚本会恢复原项目配置。

本地构建、封包与验证均不代表已上传、部署或发布。生产账号复测和 Android 实机检查需要分别记录。
