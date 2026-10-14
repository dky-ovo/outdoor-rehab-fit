# v25：首屏图标字体与 AI 用户界面

本次已完成代码修改、独立审查、本地网页验证，以及真实 Web/Android OTA 产物。尚未上传 ECS、安装生产更新或发布 Android OTA。

## 原因与修复

1. Web/App 网页与后台共用的图标工厂每次挂载都先设为未加载，并把字体缺失显示成英文图标名、Emoji 或替代符号。现在在模块加载时提前请求实际使用的字体，首渲染复用已成功加载的状态；尚未就绪时保留固定位置，不渲染替代文字，成功后不改变图标框尺寸。
2. 字体失败不再永久缓存失败：慢请求在失败后安排有限重试，网络恢复/页面重新可见也可重试；卸载清理监听和计时器。
3. Android 启动预载已有的五套图标字体，SpaceMono 独立加载。最多等待 1.5 秒，失败继续启动；字体稍后完成不会重建导航。没有增加原生依赖，面向现有 Build17 的 OTA。
4. AI 用户界面的历史标题、逐条回复、历史消息、清空提示与错误提示移除应用添加的 DeepSeek/百炼标签。内部 provider 路由、账户同步、历史隔离和删除范围保持；清空提示准确说明当前列表中可删除的历史。管理员模型配置仍可辨识具体配置。
5. 82 个首屏翻译键均有中英文值；169 个源码文件未发现无效 UTF-8、U+FFFD 或常见乱码标记。后台文件存储的图标已有本地 SVG，检查确认正常。

持久无法下载且未缓存字体时，Web 会保留图标位置和按钮文案。此修复没有将正常的数据读取等待承诺为零，也不表示已解决未经复现的其他乱码来源。

## 验证

- 合并后客户端：9 套、124 项通过。
- 安装器：17 项通过；两端封存与 Metro 解析工具：4 项通过。
- 独立代码审查通过；慢请求失败后的重试缺口已修复并补回归。
- 本地浏览器延迟字体下载，对比旧版和修复版后台：旧版显示替代字符，修复版中文正文正常，字体到达前后图标框位置尺寸完全一致。
- 检查文件存储、本地模拟账号首页、聊天及历史页；历史页没有模型标签。界面用本地模拟数据，不是生产账号数据。
- Android Hermes 导出成功，但未做 Android 真机冷启动验收。首次 Windows 沙箱阻止 Hermes 写临时字节码，失败产物单独留存；重新构建成功并封存后才用于交付。
- 根 app.json 已恢复，SHA-256：d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe。

## 正式产物

Web 包：`deploy/frontend-loading-20261009-v25/outdoor-fit-frontend-loading-20261009-v25.tar.gz`

大小：1,439,011 字节；SHA-256：`d33e1c30923b14c3de476201b0989070d3a05752392b0cb59b24dd0263b2f168`。

本包仅更新网站静态内容，包含 3 个 Web 变更文件及安装工具；不包含 API 源码或数据库迁移。要求封存 v23 API，支持已知 v23/v24 网页前驱。校验发现其他版本会停止。激活只重建 Caddy，网页连接会短暂重连。

Android：`workspace-artifacts/android-build17-frontend-loading-20261009-v25`，241 文件、167,872,580 字节。

OTA manifest SHA-256：`34e9caa10e5aab9c7a01f6abb42204b0bddfbf7c177479869e51d0cb70ff793f`。

## Windows PowerShell 上传

只复制代码框内部内容，不复制开头/结尾的三反引号。

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
scp -P 28832 '.\deploy\frontend-loading-20261009-v25\outdoor-fit-frontend-loading-20261009-v25.tar.gz' root@47.83.186.36:/root/
if ($LASTEXITCODE -ne 0) { throw '上传失败，请勿继续安装' }
```

## 旧 ECS 的 SSH 窗口安装

目标：47.83.186.36，SSH 28832，不是新轻量服务器。

```bash
(
set -euo pipefail
umask 077
cd /root
printf '%s\n' 'd33e1c30923b14c3de476201b0989070d3a05752392b0cb59b24dd0263b2f168  outdoor-fit-frontend-loading-20261009-v25.tar.gz' | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-v25.XXXXXXXX)"
tar -xzf outdoor-fit-frontend-loading-20261009-v25.tar.gz -C "$update_dir" --no-same-owner --no-same-permissions --keep-old-files
cd "$update_dir/outdoor-fit-frontend-loading-20261009-v25"
python3 install.py --check-only
python3 install.py --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-frontend-loading-20261009-v25/package/install.py --apply
)
```

成功标记：`FRONTEND_LOADING_WEB_UPDATE=PASS`。完成后刷新网页。若有失败，保留输出，不跳过校验强制覆盖。

## Windows PowerShell 发布 Android

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& '.\scripts\android-build17-frontend-loading-v25-ota.ps1' -Action Verify
if ($LASTEXITCODE -ne 0) { throw 'OTA校验失败' }
& '.\scripts\android-build17-frontend-loading-v25-ota.ps1' -Action Publish
```

出现 `OTA_ANDROID_PREVIEW_PUBLISHED=YES` 后，手机接收更新并重开。只发布到 Android Build17、runtime 1.2.3、preview；保持原 iOS 项目配置。

## 网页回退

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-frontend-loading-20261009-v25/package/install.py --rollback
```

回退仅网页/Caddy。Android OTA 是独立发布渠道，需要单独匹配回退。

## 核查文件

- `workspace-artifacts/frontend-loading-v25-ui-qa/browser-check.json`
- `workspace-artifacts/frontend-loading-v25-ui-qa/after-admin-ready.png`
- `workspace-artifacts/frontend-loading-v25-ui-qa/history-header.png`
- `workspace-artifacts/frontend-loading-20261009-v25-review/native-font-review.json`
- `workspace-artifacts/frontend-loading-20261009-v25/package-result.json`
- `workspace-artifacts/frontend-loading-20261009-v25/package-audit.json`
