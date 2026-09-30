# 體能活動建議与删除账号强制下线更新

版本：`activity-advice-account-deletion-20260923`。此包同时更新 API 与 Web；手机端必须另行发布本轮兼容 OTA，才能显示新页面和已删除通知。

## 更新范围

- 更新體能活動建議页面与相应可维护文字。
- 后台删除用户后，有效、未过期的旧登录凭证收到 HTTP 401 / `accountDeleted`，供 APP 清理当前登录并提示。无效/过期凭证仍返回一般未授权；登录失败保持统一提示，不透露账号是否被删除。
- 账号删除、推送凭证清理和审计记录在同一数据库事务内完成；已有运动和研究历史保留。同一手机号重新注册会生成新用户 ID，旧登录不会恢复。
- 保护密码验证、资料修改、管理员权限在异步操作期间发生变化的情况。

服务端在请求到达时检查；手机离线、系统停止后台运行或旧版 APP 未更新时，无法即时弹出通知。APP 将在联网请求、启动/回到前台及定期校验时处理，不能承诺断网状态下实时远程下线。

## 支持的服务器基线与保护

仅支持已经成功安装 `admin-text-registration-research-20260923` 的完整 API 版本，及本版本重装。更早或手工改动版本会安全停止，不要绕过验证。本包严格只替换 `src/app.js`、`src/appTextCatalog.json` 和清单内 Web 文件，不安装依赖、不改 Nginx、不新增数据库结构、不覆盖用户数据、配置、API key 或上传文件。旧 Web 资源保留。

所有根文件校验值内嵌在安装脚本中，Web 文件由内嵌校验的清单逐个验证；**无需下载单独的 `.sha256` 文件**。校验可发现传输损坏，不是发布者数字签名，请只使用可信提供的包。

## 服务器 SSH

先上传此 ZIP 至既有 `gs://outdoor-rehab-fit/` 存储桶，再执行：

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-activity-advice-account-deletion-20260923-update.zip /home/dukaiyu2004/outdoor-fit-activity-advice-account-deletion-20260923-update.zip &&
unzip -p /home/dukaiyu2004/outdoor-fit-activity-advice-account-deletion-20260923-update.zip install-activity-advice-account-deletion-20260923.sh > /home/dukaiyu2004/install-activity-advice-account-deletion-20260923.sh &&
sudo bash /home/dukaiyu2004/install-activity-advice-account-deletion-20260923.sh /home/dukaiyu2004/outdoor-fit-activity-advice-account-deletion-20260923-update.zip
```

脚本先核对 ZIP、安全路径、基线、磁盘空间和 Web 冲突，执行仅使用虚构数据的内存 SQLite / HTTP 检查；随后短暂停止 API，备份程序/Web，并通过 SQLite backup API 创建包含已提交 WAL 的一致快照，再安装并健康检查。后台地址不变，网页完成后强制刷新。

## 备份和失败处理

备份在 `/home/dukaiyu2004/outdoor-fit-backups/activity-advice-account-deletion-20260923-时间.随机值/`，快照是 `database/database.sqlite`，哈希/大小在 `database-snapshot.json`。备份仅管理员可读，包含用户数据，须妥善保管。

失败仅自动恢复已知程序/Web 文件，**不自动回滚用户数据库**。若发现操作员并发修改文件，自动恢复也会停止并保留现场。数据库快照仅供人工评估后恢复，不能直接覆盖运行中的数据库；新注册、反馈和学习记录不能被旧快照覆盖。暂存与备份不会自动清理。

## 验收

1. 用专门测试账号登录 APP；后台删除该账号，联网后出现已删除提示并退出。
2. 普通断网、服务器异常、密码错误不显示账号已删除。
3. 其他账号、现有反馈、运动与研究记录不受影响。
4. 更新 APP OTA 后检查體能活動建議页面；仅更新服务器不会更新旧手机页面。
