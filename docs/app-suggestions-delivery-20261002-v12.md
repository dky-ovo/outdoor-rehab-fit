# 2026-10-02 App Suggestions v12 交付与上线

代码、网页和 Android Build 17 OTA 已准备；本次没有连接 ECS 安装，也没有发布 OTA。正式后台已创建 50 个测试参与者账号，并核对列表数量及第 1、50 个账号登录。

## 本次修改

- 时段总结时长留空显示 `--`；先显示曾使用的设施，再显示运动类型；感受标题改为「記錄感受/遇上的問題」。
- 设施选择优先显示账户收藏，收藏之间按已保存运动记录的使用量排序。
- 英文分类改为 `Specific Populations`；陪伴者教学标题改为 `Tips for Exercise Companions`。
- AI 输入框支持多行自适应高度，按键盘实际遮挡补偿位置，避免 Android 已调整窗口时再次整体抬升。
- 器材图片独占第一行，左、右 GIF 并列第二行；支持追加双语影片和自定义教学栏目。
- 业务页面从文件存储选择图片、GIF、影片和 Word；文件存储页面保留上传入口。
- 参与者数据按香港时间星期一至星期日分周，保留按日查看明细。
- 首页增加「運動影片」，后台 APP 维护支持管理该内容。
- 将 FAQ 整理成 26 类双语受控知识检索，沿用现有模型处理未覆盖问题；不是模型微调。医疗表述审阅及来源见 `assistant-faq-review-20261002.md`。
- 用户管理新增「测试用户（临时）」：最高管理员一键创建 50 人，导出用户名和密码 CSV，按批次停用。

## 临时测试用户的使用方式

安装时启用开关后，在后台「用户管理」的「新增用户」旁打开「测试用户（临时）」。每批创建 50 个普通参与者，不授予后台管理权限，不发送短信或邮件。

创建成功后立即导出 CSV。密码只保留在当前页面内存，不保存到浏览器持久存储或服务端明文库。刷新、离开页面、切换管理员或开始下一批后，不能再恢复上一批密码。请求结果不明确时重试同一批次，避免重复创建。

不用时先按批次停用账户。停用后不能登录，已有登录凭据失效，历史记录保留。再用下方命令关闭整个临时功能：入口隐藏，相关 API 关闭。关闭功能本身不删除已创建账户。

这次已在正式后台创建的 50 个测试参与者账号是通过原有用户管理创建的，未归入新功能的批次表；后续停用这 50 人需在原用户列表操作。Word 中的密码对应这批正式账号，不能与本地 QA 的临时 CSV 混用。

## 文件及校验

| 产物 | 结果 |
| --- | --- |
| ECS 网页/API 更新包 | `deploy/app-suggestions-20261002-v12/outdoor-fit-app-suggestions-20261002-v12-delta.tar.gz` |
| 更新包大小 | 1,551,210 bytes |
| 更新包 SHA256 | `57b8272d6431be65816094484020658b1ac0bcd332e08e76ce2c5026d94e254a` |
| Android 产物目录 | `workspace-artifacts/android-build17-app-suggestions-20261002-v12` |
| Android 产物 | 241 个文件，167,631,582 bytes |
| Android release-manifest SHA256 | `3fab288e31c3093e564994009fb8c745c68d4f28c8f5168307bd48ba74025414` |
| 最终 FAQ 源码 SHA256 | `69bad6ae38c496c07fca1b9f90ad98ec5010bc8aa1b7869d4d02a9f7deffcc9e` |

未交付的第一次导出因缺少最后补充的英文紧急症状词，已完整保留到忽略目录 `workspace-artifacts/app-suggestions-20261002/superseded/`，不用于安装或发布。表中均为重新导出后的最终产物。

账号 Word 位于项目目录：

`workspace-artifacts/app-suggestions-20261002/private/OUTDOOR-FIT-50-Test-Accounts-20261002.docx`

账号文档及凭据 JSON 只存本地忽略目录，不在源码或部署包内。已核对 50 个账号与 Word 表格内容一致；当前环境没有可用的内置 Word 渲染器，因此没有完成分页视觉检查。

## 1. Windows 上传更新包

在项目根目录的 PowerShell 执行。输入 ECS 的 SSH 密码，不要把密码发到聊天。

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
scp -P 28832 '.\deploy\app-suggestions-20261002-v12\outdoor-fit-app-suggestions-20261002-v12-delta.tar.gz' root@47.83.186.36:/root/
```

## 2. 阿里 ECS 安装

安装接受目前的 v9、v10 或 v11。会核对现场镜像、配置和网页资产；未知版本会停止。保留原域名、密钥、媒体目录及 RDS 数据，新增字段和测试批次表。安装会短暂重建 API 和代理容器。

在阿里 ECS 的 root 终端完整执行下面这一块：

```bash
(
set -euo pipefail
umask 077
cd /root

printf '%s\n' '57b8272d6431be65816094484020658b1ac0bcd332e08e76ce2c5026d94e254a  outdoor-fit-app-suggestions-20261002-v12-delta.tar.gz' | sha256sum -c -

update_dir="$(mktemp -d /root/outdoor-fit-v12.XXXXXXXX)"
printf 'UPDATE_DIR=%s\n' "$update_dir"
env -u TAR_OPTIONS tar --extract --gzip \
  --file=/root/outdoor-fit-app-suggestions-20261002-v12-delta.tar.gz \
  --directory="$update_dir" \
  --no-same-owner --no-same-permissions --keep-old-files

python3 "$update_dir/outdoor-fit-app-suggestions-20261002-v12/install.py" --enable-test-users
)
```

看到 `APP_SUGGESTIONS_UPDATE=PASS` 才表示网页及服务端更新成功。提示时仅在 ECS 终端输入 `outdoor_fit_migrator` 的 RDS 密码。

若失败或 SSH 中断，保留错误输出及状态目录，不要删除状态强制重装：

`/opt/outdoor-fit/production/.update-state/app-suggestions-20261002-v12/`

需要回退本次 API/网页时运行：

```bash
bash /opt/outdoor-fit/production/.update-state/app-suggestions-20261002-v12/rollback.sh
```

回退保留新增数据及字段；检测到后续部署会拒绝覆盖。此命令不回退已发布的手机 OTA，所以应先完成服务端安装，再发布手机更新。

## 3. 发布 Android 更新

只在服务端安装成功后，在本机项目目录执行：

```powershell
& .\scripts\android-build17-app-suggestions-v12-ota.ps1 -Action Verify
& .\scripts\android-build17-app-suggestions-v12-ota.ps1 -Action Publish
```

目标是 Android 1.2.3 / Build 17 的 `preview` 通道。发布使用已封存内容，不会重新打包。只有 `OTA_ANDROID_PREVIEW_PUBLISHED=YES` 才表示发布成功；之后手机接收更新并重新打开。

## 4. 不再需要临时账号功能时

先在后台停用新功能创建的测试批次，再在 ECS 执行：

```bash
python3 /opt/outdoor-fit/production/releases/outdoor-fit-app-suggestions-20261002-v12/install.py --disable-test-users
```

`TEMP_TEST_USERS_DISABLED=PASS` 表示入口和 API 已关闭。账户、审计及历史记录保留；功能代码可以在后续版本移除。

## 审查与验证范围

本次做了并行代码审查，覆盖收藏排序、香港周边界、媒体引用/删除保护、存储 Word 导入、FAQ/键盘、批量账号权限与幂等、迁移及安装回退。未发现确认的 P1/P2 问题。

- 聚焦页面与数据逻辑回归：12 个套件、135 项通过。
- AI 后端回归：134 项通过；相关前端回归 198 项通过。不同测试组有重叠，不合并计算总数。
- 服务端文件/媒体/账号检查：67 项通过、2 项因可选种子资产缺失跳过；后续账号专门测试 5 项通过。
- 测试账号及 MySQL 媒体模拟执行器：32 项通过；账号页面和 CSV 7 项通过。
- 安装及回退测试 17 项通过，迁移/OTA 检查 4 项通过。
- 本地浏览器实际操作已验证一键创建 50 人、CSV 50 行、确认后整批停用、媒体布局、追加影片和新增教学栏目。
- 网页构建及 Android 导出/来源校验完成；原 `app.json` 已按字节恢复。

限制：没有在生产 RDS 执行新迁移，没有在 Android 真机验证中文/英文/表情输入法和导航模式。既有 `AssistantHistory` 套件有 10 个失败，在原始 HEAD 也复现，不能宣称整个项目测试全绿。正式部署后的输入法体验仍需真机确认。
