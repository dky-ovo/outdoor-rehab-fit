# v26 运动影片分类交付

已完成本地构建、封存、封包和包清单核验。**尚未上传服务器、执行生产 MySQL DDL、部署或发布 OTA；未做 Android 真机视觉验收。**

本版增加运动影片分类与器材关联。软件安装不自动上传或分配视频：先在后台文件存储核对文件，缺少的上传后再选择分类、关联器材。

## 实际产物

服务器更新包：`deploy/exercise-video-categories-20261012-v26/outdoor-fit-exercise-video-categories-20261012-v26.tar.gz`

- 大小：**1,851,124 字节**。
- SHA-256：`9d7284c5c445692dff932a8ac0b772c250097961f321cb449ca13c3a4bd8f0f3`。
- 36 个归档成员：manifest、28 个服务器文件、4 个安装支持文件、3 个网页增量文件。
- 网页完整导出 243 个文件，逐项校验全部通过；没有密钥、数据库或用户导出文件混入。

Android Build 17 导出：`workspace-artifacts/android-build17-exercise-video-categories-20261012-v26/export`。

- 241 个文件，共 **167,899,117 字节**。
- Manifest SHA-256：`0ee410259bed7b9051fb131803e9f20d5aae218428e85c48afed598c8175262c`。
- 项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`，包名 `com.maxcch.c.outdoorrehabfit`，runtime `1.2.3`，channel `preview`。
- 原 `app.json` 已逐字恢复，双端封存再次通过，没有遗留临时配置备份。

## 第一步：Windows PowerShell 上传

只复制代码框内的命令。目标仍是旧 ECS `47.83.186.36:28832`。

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
Get-FileHash -Algorithm SHA256 -LiteralPath '.\deploy\exercise-video-categories-20261012-v26\outdoor-fit-exercise-video-categories-20261012-v26.tar.gz'
scp -P 28832 '.\deploy\exercise-video-categories-20261012-v26\outdoor-fit-exercise-video-categories-20261012-v26.tar.gz' root@47.83.186.36:/root/
```

## 第二步：服务器 Bash 安装

要求原 API 为封存 v23 且保持 `deepseek_only`；接受已知 v23、v24、v25 网页的 24 种完整前驱树。未知代码、挂载或配置变更会停止，不强行覆盖。

```bash
(
set -euo pipefail
umask 077
cd /root
printf '%s\n' '9d7284c5c445692dff932a8ac0b772c250097961f321cb449ca13c3a4bd8f0f3  outdoor-fit-exercise-video-categories-20261012-v26.tar.gz' | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-v26.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
env -u TAR_OPTIONS tar --extract --gzip \
  --file=/root/outdoor-fit-exercise-video-categories-20261012-v26.tar.gz \
  --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
cd "$update_dir/outdoor-fit-exercise-video-categories-20261012-v26"
python3 install.py --check-only
python3 install.py --prepare
python3 install.py --migrate
python3 install.py --apply
)
```

`--prepare` 构建候选并检查字段。`EXERCISE_VIDEO_SCHEMA=MISSING` 表示下一步需要迁移，尚未激活。

`--migrate` 只在缺少字段时提示输入 **outdoor_fit_migrator 的 RDS 密码**；仅在服务器终端输入，不把密码发到聊天。它通过标准输入传入一次性客户端，并验证数据库身份及 TLS 证书/主机名。应用账号不获得 DDL 权限。

迁移只为现有 `content_items` 增加两个兼容字段，不增加表、不重放旧迁移、不修改原记录；保持原生产所需 42 张表。仅执行即时增列，不在失败时降级为重建数据表。已完成则返回 `EXERCISE_VIDEO_MIGRATION=ALREADY_READY`，首次完成为 `EXERCISE_VIDEO_MIGRATION=PASS`。

最终安装成功应出现：

```text
EXERCISE_VIDEO_CATEGORIES_UPDATE=PASS
```

任何一步失败就停止后续操作。已知中断可在刚才的解包目录重试相应命令；保留 `UPDATE_DIR` 输出。安装器不更改模型、原密钥、数据库通道或资源限制，并在替换 API 前关闭入口、检查 AI 队列，避免两个 worker 同时运行。

## 第三步：Android OTA

服务器成功后，在电脑项目 PowerShell 核验并发布已有导出：

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& '.\scripts\android-build17-exercise-video-categories-v26-ota.ps1' -Action Verify
& '.\scripts\android-build17-exercise-video-categories-v26-ota.ps1' -Action Publish
```

发布成功标记：`OTA_ANDROID_PREVIEW_PUBLISHED=YES`。发布脚本使用封存的 Android 导出并恢复原配置，不需要再次 Export。手机接收更新后重新打开；未运行发布命令前不会自动送达。

## 安装后的影片设置

进入 **后台 → APP 维护 → 运动影片 → 添加影片（多选）**，从文件存储选择影片，核对标题产生的分类及器材建议后保存。四个影片是否已上传尚未确认，请先在文件存储查询，缺少的上传后再选取。

| 影片 | 关联器材／教学项目 |
| --- | --- |
| 站立式低背伸展 | 全身伸展運動器（背部肌肉伸展） |
| 坐式低背伸展 | 全身伸展運動器（背部肌肉伸展） |
| 手臂關節活動 | 太極揉推器／太極推手器 |
| 前後腳站立伸展運動 | 全身伸展運動器（下肢伸展）＋小腿伸展 |

已有的未分类影片仍显示在「全部」，补充分类后才会出现在相应分类中。安装软件不会自动替这些影片保存分类或关联。

## 回退

服务器如需恢复原 API、网页及运行配置：

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-exercise-video-categories-20261012-v26/package/install.py --rollback
```

回退保留新字段和已经保存的分类数据，不执行 DROP 或恢复旧数据库备份。旧 API 忽略这些字段。若仍有 AI 任务，安装器保留当前工作进程并要求等待后重试；原先停止的服务会恢复原停止状态。

## 验证记录

- 安装器全套 45 项本地状态机测试通过；独立审查发现的恢复目标校验缺口修复后，新增反例测试通过，共覆盖 46 项。
- Web、Android 封存工具 2 项回归通过。
- 独立审查已关闭恢复目录篡改问题，确认迁移 stdin、版本基线、兼容回退和原模型配置保留机制。
- 真实归档所有成员集合/哈希、28 个服务器文件、24 种网页前驱增量完整性和双端封存均通过。
- 主线程本地浏览器检查：四文件多选、分类建议、发布四条记录、全屏图库及器材详情关联影片通过；分类单选和器材复选的可访问选中状态已验证。该浏览器测试不代表生产数据已发布。
- 可访问性修复后的 Web/Android 已重新导出并核验，本文列出的均为最终包；先前产物保存为 `.pre-a11y` 备份，不用于本次上传。
- 审核记录：`workspace-artifacts/exercise-video-categories-20261012-v26/package-audit.json`。
- 本地浏览器验收：[ui-review.json](../workspace-artifacts/exercise-video-categories-v26-ui-qa/ui-review.json)；[分类与器材选中状态截图](../workspace-artifacts/exercise-video-categories-v26-ui-qa/admin-categories.png)。

以上是本地代码、模拟状态机和产物验证，不代表已在生产服务器或真实 MySQL 执行迁移，也不代表 Android 真机验收。后端/界面功能测试的详细记录由主线程另列。
