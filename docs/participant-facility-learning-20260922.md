# 参与者设施教学使用情况：交付与验证

日期：2026-09-22。此轮修改不改变原生模块、APP 版本或 runtimeVersion；未上传、部署、发布 OTA 或启动 Build。

## 查看入口

- 其他 → 查看参与者使用数据 → 选择参与者 → 设施教学累计进度。
- 其他 → 查看参与者使用数据 → 选择参与者 → 选择日期 → 当日设施教学。
- 列表显示设施图片、名称、阅读／观看／收听百分比；点击设施查看三项进度。
- 与收藏规则一致，各项达到 75% 才高亮。只计算当前所选语言与内容版本；修改教学内容后不会沿用旧版的绿色标记。
- 详情通过稳定器材编号查询；返回保留参与者、日期、查看模式及页码。查看他人的详情不会写入查看者自身的设施学习进度。

## 数据与权限

- 参与者手机原本只有本地学习证据，因此必须更新 APP 并登录联网，才能开始上报。
- 日别按香港时间统计真实新增范围；累计对重叠区间求并集，不重复加算。
- 旧 version 2 范围证据只导入累计，日期为空；旧的点击布尔值不伪造成 75% 完成，也不补造学习日期。
- 本地使用独立账号的待同步队列；离线保留、前台定期补传。并发录入与上传确认按版本号协调，迟到确认不会删除新范围。
- 异常历史记录保留，轮转处理避免阻塞后续正常记录；上传队列出错不会阻断收藏本地进度保存。
- 访客记录留在本机，不上报。服务器仅接受 JWT 所属用户的写入；读取沿用本人或明确关联参与者的权限。数据不发送给 DeepSeek。
- 进度是基于 APP 上报范围计算的使用记录，不是防恶意客户端篡改的研究认证证据。

## 核心代码

- `utils/learning.js`：75% 判断、当前版本覆盖率、本地累计与按日待同步队列。
- `utils/learningSync.js`、`components/LearningProgressSync.js`：账号隔离、限量上传、重试、确认。
- `app/(tabs)/participant-usage/learning.js`、`learning-detail.js`：列表与只读详情。
- `components/ParticipantLearningProgress.js`、`hooks/useParticipantLearningPage.js`：状态展示与授权查询。
- `server/src/learningProgress.js`、`app.js`、`database.js`：追加式表初始化、验证、合并、权限及查询。

## 后端更新包

`deploy/2026-09-22/outdoor-fit-participant-facility-learning-20260922-update.zip`

- 56,113 bytes（54.80 KiB），只包含三份后端源码与安装/校验说明，不含 Web 或手机包。
- SHA-256：`299BA0D7ECF76651727126E9A27410D0E31944258484CF51B2A7B4E413DBBA14`。
- 基线：已部署 `admin-document-voice-20260921` 后端。未知或混合版本会在停服务前拒绝覆盖。
- 不改账号、密钥、文件存储、Nginx、依赖或已有数据；失败只回退源码。

先将此 ZIP 上传到 `gs://outdoor-rehab-fit/`，再在服务器执行：

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-participant-facility-learning-20260922-update.zip /home/dukaiyu2004/ &&
printf '%s\n' '299ba0d7ecf76651727126e9a27410d0e31944258484cf51b2a7b4e413dbba14  outdoor-fit-participant-facility-learning-20260922-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-participant-facility-learning-20260922-update.zip install-participant-facility-learning-20260922.sh > install-participant-facility-learning-20260922.sh &&
sudo bash install-participant-facility-learning-20260922.sh /home/dukaiyu2004/outdoor-fit-participant-facility-learning-20260922-update.zip
```

整个 ZIP 的校验值直接写在命令内，不依赖云端存在 `.sha256` 文件。

## 安卓 OTA

后端安装成功后，在电脑 PowerShell 执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -NonInteractive -Message "新增参与者设施教学使用进度"
```

适用于相同项目、preview 通道、runtime 1.2.2 的安装包；不改变 Android Build 编号。旧 runtime 的 APK 不能仅靠这次 OTA 跨版本升级。参与者端与查看者端均应更新并重新打开 APP。

## 已完成验证

- 前端：130 个套件、1,894 项测试及 1 个快照全部通过。
- 后端：260 项中 258 项通过，2 项既有外部媒体条件测试跳过，0 失败。含真实中英文六栏教学范围的上传、读取与幂等回归。
- 发布工具：12 项部署验证、7 项 ZIP 提取安全检查、隔离内存 SQLite＋5 次 HTTP 冒烟通过。
- `npx tsc --noEmit` 与 scoped `git diff --check` 通过。
- Android、iOS、Web 最终导出成功：`workspace-artifacts/participant-facility-learning-20260922-final-export`。
- 本地源码交叉审查已修复坏记录队头阻塞、坏同步队列影响收藏保存、排序变化影响器材详情定位三项边界问题。

## 真机复核

本轮进行了自动化组件交互与隔离 HTTP 测试、类型检查及三端导出；没有连接真实手机或生产数据库。

1. 参与者登录，阅读一项设施超过 75%，观看和收听另行测试；联网停留后退出该页。
2. 已关联的志愿者或项目人员进入该参与者累计页与当天页，确认对应设施的三个状态。
3. 查看任一器材详情后返回，检查日期/页码不变；切换账号确认不短暂显示上一个人的记录。
4. 离线学习后重新联网、前台打开 APP，确认补传；次日重复阅读后确认累计不翻倍、两日记录独立。
