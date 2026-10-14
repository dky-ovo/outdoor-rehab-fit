# v18 FAQ、自动同步与 Android 输入法修复

状态：本地修改、审查和交付准备。未上传 ECS，未部署生产服务，未发布 Expo OTA。

## 修改内容

- FAQ：修复餐后运动、陪同家人练上肢、膝痛问题带器材名称时的错误匹配，以及天气、个人目标、颈部受伤的换问法。完整器材名称不再被当作另一处疼痛，但真正多部位症状、否认症状和急症仍独立处理。
- 补齐报告中的九项主回复遗漏。腰痛和手腕痛问题中，需要谨慎或避免的器材显示具体注意事项，不再只展示一般锻炼益处。保持 App 内容来源限制和条件性健康说明，不加入外部链接或个体治疗承诺。
- FAQ 15 上肢伸展器教学原文同时包含“不要两手同时拉绳”和“不可单手拉绳”。AI 摘要检测到这类冲突时提示先向场地人员或治疗师确认使用方式，保留器材入口；原始教学内容仍待内容负责人核对。
- 设置：移除手动同步按钮，保留只读同步状态。每次成功登录和同账号重登都按新登录会话自动同步；保留离线操作的原 operationId，逐项合并，后台同步不延长 90 分钟闲置时间。
- Android AI 聊天：使用现有 APK 内的 Reanimated 原生 IME 高度和动画。打开后改变候选栏或表情键盘高度也能更新；聊天页移除旧 Android 测量 padding，避免重复补偿。页面失焦时解除对原生窗口的接管。已处理首次挂载时键盘已开、返回时旧高度、关闭时旧事件及动画结束事件迟到。
- 网页仍采用 visualViewport；iOS 仍采用现有 KeyboardAvoidingView。未新增原生依赖或修改 Android manifest。

## 原因与参考

RN 0.81.5 的 Android 11+ 实现只在键盘可见性变化时发送 show/hide。旧代码监听的 keyboardDidChangeFrame 不能用于 Android 键盘打开后的动态高度变化。

- [React Native 0.81.5 ReactRootView.java](https://github.com/react/react-native/blob/v0.81.5/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/ReactRootView.java#L891-L942)
- [Android 15 KeyboardAvoidingView 问题 #49759](https://github.com/react/react-native/issues/49759)：历史案例，不能当作本机复现证据。
- [Expo 输入法适配说明](https://docs.expo.dev/guides/keyboard-handling/)
- [Reanimated useAnimatedKeyboard](https://docs.swmansion.com/react-native-reanimated/docs/device/useAnimatedKeyboard/)：接管 Android root insets，最后一个观察器卸载后恢复系统行为。当前文档因 iOS 26 问题建议迁移；此次仅使用已装入 Build 17 的 Android 4.1.7 实现。
- [keyboard-controller 安装说明](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/installation)：新增该原生库需要重新编译 APK，不能仅靠 OTA 注入。本次没有引入它。

## 核验边界

已对昨日真实账户测试的 43 道题在中文和英文两种界面语境进行本地回归，共 86 次意图匹配。完整本地回复保存在 `workspace-artifacts/faq-sync-keyboard-20261007-v18-review/local-faq-regression.json`；它不是更新后的线上实测。

专项测试覆盖 FAQ/API、共享展示、登录自动同步、离线重试、闲置退出和键盘原生帧时序。发布检查拒绝源码或导出内容改动、错误 Android 项目、错误平台和复用输出目录。安装器检查两个经过封存的 v17 来源版本及全部十三个模块，拒绝未知网页文件和直接公开的 API 端口。

Build 17 APK 已实读核验 targetSdk 36、adjustResize、Reanimated 4.1.7 以及原生键盘类；因此这次可给现有 Build 17 发布 OTA。环境中未找到可访问的 adb 或运行中的模拟器，尚无 Android 设备上的位置/动画验收证据。发布后需在用户的 Google 模拟器检查普通输入、候选栏高度变化、表情键盘切换、收起再打开、离页返回及多行输入。

额外运行的 AiCamera 旧照片持久化用例有一个既有失败：读取时清洗旧附件字段但未立即落盘。已用校验过的 v17 网页产物确认相同行为，不能将测试中的空过滤结果解释为三条历史丢失；本次未改照片历史逻辑。证据：`workspace-artifacts/v18-ai-camera-baseline-review.json`。

## 部署行为

后端更新基于当前 ECS 的 v17 镜像构建，不重新下载依赖、不迁移数据库。保留当前数据库、JWT、媒体文件、SSH 隧道和域名配置。先准备镜像，再短暂关闭入口并确认 AI 队列空闲，替换唯一 API worker；检查 app/admin/API HTTPS。失败时通过原有配置回退，若新接受的 AI 任务仍在运行则保留 worker，等待安全回退。

安装入口：`deploy/faq-sync-keyboard-20261007-v18/install.py`。

Android 发布入口：`scripts/android-build17-faq-sync-keyboard-v18-ota.ps1`。必须先 Verify，再 Publish；脚本只针对 dky2004 的 Android preview、runtime 1.2.3，并在结束后还原默认 iOS 项目配置。

## 已生成文件与执行命令

服务器包：`deploy/faq-sync-keyboard-20261007-v18/outdoor-fit-faq-sync-keyboard-20261007-v18.tar.gz`，1,377,103 字节。

SHA-256：`6d855c08f70cda3a11870404a8cdaf203680d1c669608e1de261080c9e6422c7`。

网页导出包含 243 个文件，增量包包含 3 个变化的网页文件。入口：`entry-61dfe95012c50c3267614b80c3354363.js`。

Android 导出：`workspace-artifacts/android-build17-faq-sync-keyboard-20261007-v18`，241 文件，167,715,815 字节；manifest SHA-256 为 `99e413870a696c2fcdee84bdf7565e79f7c9066ba6f2092e6fcd9a8b79422818`。导出后已确认默认项目配置还原。

电脑 PowerShell 上传到当前 ECS（47.83.186.36、SSH 28832）：

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
scp -P 28832 '.\deploy\faq-sync-keyboard-20261007-v18\outdoor-fit-faq-sync-keyboard-20261007-v18.tar.gz' root@47.83.186.36:/tmp/
if ($LASTEXITCODE -ne 0) { throw '上传失败，请勿执行安装' }
```

该 ECS 的 root SSH 终端：

```bash
(
set -euo pipefail
umask 077
archive=/tmp/outdoor-fit-faq-sync-keyboard-20261007-v18.tar.gz
printf '%s  %s\n' 6d855c08f70cda3a11870404a8cdaf203680d1c669608e1de261080c9e6422c7 "$archive" | sha256sum -c -
update_dir="$(mktemp -d /root/outdoor-fit-v18.XXXXXXXX)"
tar --extract --gzip --file="$archive" --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
installer="$update_dir/outdoor-fit-faq-sync-keyboard-20261007-v18/install.py"
python3 "$installer" --check-only
python3 "$installer" --prepare
python3 /opt/outdoor-fit/production/releases/outdoor-fit-faq-sync-keyboard-20261007-v18/package/install.py --apply
)
```

出现 `FAQ_SYNC_KEYBOARD_UPDATE=PASS` 后回电脑 PowerShell 发布 Android：

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
& '.\scripts\android-build17-faq-sync-keyboard-v18-ota.ps1' -Action Verify
if ($LASTEXITCODE -ne 0) { throw '校验失败，请勿发布' }
& '.\scripts\android-build17-faq-sync-keyboard-v18-ota.ps1' -Action Publish
```

以 `OTA_ANDROID_PREVIEW_PUBLISHED=YES` 为发布成功依据。安装包校验和本地导出成功不是发布成功。
