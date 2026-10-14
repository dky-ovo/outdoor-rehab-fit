# App Suggestions v12 交付准备

本目录是独立的 `20261002-v12` 安装方案，目标镜像为 `outdoor-fit-api:20261002-v12`。接受运行中的 v9（20260928）、v10（20260928）或 v11（20260930），保留原交付及手机导出。`SHA256SUMS` 缺失表示尚未封存；本地准备不表示已经上传、安装或发布 OTA。

包含更新后的 API 源码、设施扩展迁移、网页差异资源。FAQ 的唯一公开知识文件在 `server/src/assistantFaqKnowledge.js`，随 API 源码打包，手机导出也绑定该文件。既有账户资料表迁移兼容 v9 升级；设施的追加影片及教学栏目为新增可空 JSON 字段。安装前核对字段状态，两字段均缺失才执行新增，两者均为可空 JSON 时验证后继续；部分存在或类型异常时停止。

代码及测试稳定、网页导出完成后，在项目根目录准备归档：

```powershell
python scripts/package-app-suggestions-v12.py --web-dir "workspace-artifacts/app-suggestions-20261002-v12-web"
```

打包器核验原 v9/v10/v11 归档固定 SHA-256。只有三套基线全部具有相同内容的网页文件才省略，安装时还会核对现场字节。输出为本目录 `outdoor-fit-app-suggestions-20261002-v12-delta.tar.gz` 和 `SHA256SUMS`；任一存在即拒绝覆盖。

安装需在用户核对最终归档哈希后，于服务器新的私有目录解压并以 root 运行 `python3 install.py`。安装器保持现场 Compose 的代理、域名、密码及挂载，提示时只在终端输入迁移账户密码。迁移检查成功后才启动新 API，随后检查健康、公开设施目录和网页内容。成功标志是 `APP_SUGGESTIONS_UPDATE=PASS`。

安装/回退状态保存在 `/opt/outdoor-fit/production/.update-state/app-suggestions-20261002-v12/`。回退脚本为该目录的 `rollback.sh`，检测到后续部署会拒绝覆盖。失败或 SSH 中断后应检查状态，不能删除状态强制重装。回退保留新增数据和字段。

Android 使用独立的 `scripts/android-build17-app-suggestions-v12-ota.ps1`，后端/网页安装完成后才发布手机更新。安装器本身不发布 OTA。

## 临时测试账户

临时测试账户功能默认关闭。确需启用时使用 `python3 install.py --enable-test-users` 安装，安装器显式设置 `TEMP_TEST_USERS_ENABLED=true`。普通安装显式设置为 `false`。批次审计表 `test_user_batches` 只存账户 ID、用户名与凭据摘要，不存明文密码。

安装包含独立的审计表迁移，迁移后共 42 张表。安装器在变更数据库前准备兼容新增表的回退镜像，v9/v10/v11 均可回退，不删除账户数据或新增字段。

在服务器一键停用临时模块（会短暂重建 API，账户及审计保留）：

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-app-suggestions-20261002-v12/install.py --disable-test-users
```

此动作只接受仍在运行的 v12，并受后续部署保护；成功标志为 `TEMP_TEST_USERS_DISABLED=PASS`。需要停用已经创建的测试账户时，先在管理后台按批次停用，再关闭整个临时模块。
