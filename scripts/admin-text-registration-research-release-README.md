# 后台文字、短邀请码与科研内容名称更新

版本：`admin-text-registration-research-20260923`。这是 API + Web 更新包，不是纯网页包，也不是手机 APK 或 OTA。

## 更新范围

- 后台维护 APP 中英文文字：分页、搜索、独立维护权限、恢复默认、版本冲突检查；保留占位符，链接只接受 HTTPS。
- 新生成的邀请码为 8 位无易混淆大写字母/数字，显示为 `ABCD-EFGH`，使用密码学随机数及数据库唯一约束重试；原有长邀请码仍可使用。手机号、身份类型、一次性使用和原有权限规则不变。
- 科研使用记录附加设施/内容名称，保留原始 ID 与历史计数。
- 同步本轮后台网页界面；手机页面变化需另行发布兼容 OTA。

## 安装前检查

仅接受已核对的 `ai-recommendation-context-20260922` 后台完整源码与依赖清单，以及本版本的重复安装。已经安装 `ai-chat-history-20260922` 的对应 API 文件与此基线相同。更早、手工改动或混合版本会停止，不能绕过校验强行覆盖。

只替换 6 个 API 文件：`src/app.js`、`src/database.js`、`src/registrationCodes.js`、`src/appTexts.js`、`src/appTextCatalog.json`、`src/researchContentLabels.js`，以及清单内 Web 文件。使用现有 Node 与依赖，不运行 npm、不改 Nginx、不覆盖数据库、账户、环境变量、API key、上传文件或旧网页资源。新数据库结构仅增加文字覆盖表。

安装脚本内嵌所有根文件的 SHA-256，Web 文件由内嵌校验的清单逐个验证。无需另外下载 `.sha256` 文件。这用于检测传输/文件损坏，并非发布者数字签名；只使用可信渠道取得的包。

## 服务器 SSH

先将此 ZIP 上传到既有存储桶 `gs://outdoor-rehab-fit/`，再在服务器执行：

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-admin-text-registration-research-20260923-update.zip /home/dukaiyu2004/outdoor-fit-admin-text-registration-research-20260923-update.zip &&
unzip -p /home/dukaiyu2004/outdoor-fit-admin-text-registration-research-20260923-update.zip install-admin-text-registration-research-20260923.sh > /home/dukaiyu2004/install-admin-text-registration-research-20260923.sh &&
sudo bash /home/dukaiyu2004/install-admin-text-registration-research-20260923.sh /home/dukaiyu2004/outdoor-fit-admin-text-registration-research-20260923-update.zip
```

脚本检查 ZIP 路径/成员、磁盘空间、当前版本、权限及 Web 冲突。先用内存 SQLite 和虚构数据进行本地 HTTP 冒烟，不调用外部 AI，也不读取真实用户资料用于测试。随后短暂停止 API，备份程序和 Web，并调用 SQLite backup API 创建一致快照、检查完整性，再替换文件并启动/健康检查。后台地址不变；完成后浏览器强制刷新。

## 备份与失败恢复

备份位于 `/home/dukaiyu2004/outdoor-fit-backups/admin-text-registration-research-20260923-时间.随机值/`。其中 `database/database.sqlite` 为一致 SQLite 快照，`database-snapshot.json` 保存大小/校验值。备份目录仅管理员可访问，含用户数据，请妥善保护。

失败时只自动恢复已知程序/Web 文件；若检测到其他操作员并发修改，会停止自动恢复，保留现场。**绝不自动恢复/回滚用户数据库**，避免覆盖安装后的注册、反馈、学习记录或文字更新。数据库快照仅供明确评估后的人工恢复，不要直接复制覆盖运行中的数据库。暂存和备份不会自动删除。

## 验收

1. 原后台账号仍可登录；无文字维护权限者不能访问该接口。
2. 修改一项中英文文字后客户端能拉取，恢复默认有效；两个编辑者不会静默覆盖彼此。
3. 新建邀请码显示 4-4 短码，原长码仍接受。
4. 科研记录显示对应内容名称；原统计和 ID 不变。
5. 手机页面如仍旧版，需要发布本轮兼容 OTA；此脚本不自动 Build 或发布 OTA。
