# 交付：AI 后台任务与账号收藏

最终交付服务器 `outdoor-fit-account-continuity-20260928-v9-delta.tar.gz`，1,494,048 字节；SHA-256：

```text
f5b0b4ea109ab13817122774df17143a4f4af17fe5535a89b2ab2f3fa0fed6be
```

包内校验完整的 244 个网页文件，仅传输其中改变的 3 个；其余 241 个从现场 Caddy 网站目录按哈希复用。后端新增任务与收藏接口、两张表。安装保留域名路由配置，不重新导入生产数据；API 与 Caddy 切换时有短暂连接中断。

Windows PowerShell 上传：

```powershell
scp -P 28832 "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\account-continuity-20260928\outdoor-fit-account-continuity-20260928-v9-delta.tar.gz" root@47.83.186.36:/root/
```

阿里 ECS Bash 安装：

```bash
(
set -euo pipefail
umask 077
cd /root
printf '%s\n' 'f5b0b4ea109ab13817122774df17143a4f4af17fe5535a89b2ab2f3fa0fed6be  outdoor-fit-account-continuity-20260928-v9-delta.tar.gz' | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-account-update.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
tar --extract --gzip --file=outdoor-fit-account-continuity-20260928-v9-delta.tar.gz --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
python3 "$update_dir/outdoor-fit-account-continuity-20260928-v9/install.py"
)
```

只在终端提示时输入 outdoor_fit_migrator 的 RDS 密码。出现 `ACCOUNT_CONTINUITY_UPDATE=PASS` 后再发布手机更新。失败应保留输出和状态目录，勿盲目重跑。

Windows PowerShell 发布 Android 1.2.3 / Build 17 更新：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File .\scripts\android-build17-account-continuity-v9-ota.ps1 -Action Publish
```

安卓 v9 清单 SHA-256：`e185af733d4f50d2eddddc4e4341f7c17ec72922939c549f3d582a8bb1b428ee`；241 个文件，167,503,659 字节。原 app.json 的 SHA-256 已恢复为 `d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe`。

先在原手机安装更新并登录一次，已有本地收藏才会上云；另一台设备使用同一账号后可取回收藏。收藏显示优先走本地缓存，网络恢复后同步。服务器确认接收的 AI 任务会继续处理，页面关闭或 App 退出不取消它；回到前台取回原对话的结果。明确登出再登录时，原对话仍在历史记录中。

验证：12 个前端测试套件 283 项通过；54 项后端测试通过，包括任务幂等、账号隔离、收藏删除与过期重试、MySQL 事务、科研查询和图片清理回归。完成网页与 Android 导出、脚本语法、资源引用、归档逐文件哈希及 OTA 清单校验。没有本机 Docker 守护进程或服务器凭证，未执行真实 RDS 迁移、ECS 部署或 Expo Publish；现场启动与 HTTPS 检查由安装程序执行。

本轮未交付的 v8 草稿及 v9 全量包保留用于追溯，当前只使用上述 v9 delta 包和 v9 OTA 命令。
