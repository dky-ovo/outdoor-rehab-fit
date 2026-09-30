# Android 设定页过渡修复 v3

日期：2026-09-24。针对进入设定子页面时整页放大、跳动和卡顿的反馈。

## 找到的原因

1. 当前 `react-native-screens` 的 Android 默认动画，在 base 资源中会把退出页从 1 放大到 1.15、新页从 0.85 缩放到 1。API 33 及以上有不同默认资源，因此这能说明部分系统的缩放来源，不代表已经在用户手机复现。
2. 设定首页原来使用父 Tabs 标题栏；联络、关于程序、关于团队及隐私页面在获得焦点后隐藏它，退出时恢复。标题栏高度在过渡中变化，会同时改变整个子栈可用空间。个人资料和免责声明又没有相同的隐藏处理。
3. Android 硬件返回使用既有的 `replace` 路径，原生栈默认把 replacement 按前进动画播放，方向可能与标题栏返回不一致。

源码依据：`node_modules/react-native-screens/android/src/main/res/base/anim/rns_default_enter_out.xml`、`rns_default_enter_in.xml`、`android/src/main/java/com/swmansion/rnscreens/utils/FragmentTransactionKt.kt`，以及原有设定页面焦点副作用。

## 修改

- 设定栈在 Android 明确使用现有原生 `slide_from_right`。进入和返回对应的四个动画资源都只有平移，不包含缩放。
- 仅设定栈在 Android 使用 `animationTypeForReplace: "pop"`，让确定性返回的 replacement 使用返回方向。
- 父 Tabs 的设定标题栏固定关闭，设定首页和全部子页面统一由子栈显示标题栏。首页仍提供回首页按钮，各子页保留原返回目标。
- 移除联络、关于程序、关于团队、隐私页对父标题栏的焦点切换。联络页保留失焦后取消输入框滚动计时器的处理。
- Android 设定页的键盘隐藏底栏策略放到父导航静态配置；不再进入页面时临时设置、退出时恢复。保留输入框避让、表单提交和防重复逻辑。
- iOS 保留其原生动画；其他功能栈的动画与返回行为不改。本轮没有新增原生依赖，没有后端或数据库变更。

动画选项依据：[React Navigation 原生栈](https://reactnavigation.org/docs/native-stack-navigator/#animation)。这些选项使用现有原生能力，符合当前 Build 17 的 runtime；没有把新的原生功能仅通过 JavaScript 下发。[Expo runtime 规则](https://docs.expo.dev/eas-update/runtime-versions/)

## 验证与交付状态

发布工具语法、清单合成验证及独立代码审核通过。7 个回归套件、121 项测试通过：ContactUs、AboutTeam、PrivacyPolicy、ContactNavigation、TabAuthGuard、IosReturnStackNavigation、ProfileCamera。覆盖全部设定子页重复进入和返回、无历史回退、固定父布局、键盘与失焦清理、账号保护以及其他栈和 iOS 原有行为。

Android Hermes 导出及再次独立 Verify 均通过。原 `app.json` 字节校验一致，临时配置备份已清理。真机动画和实际帧率未验证；本机没有可用的 Android 调试设备连接。

导出目录：`workspace-artifacts/android-build17-setting-motion-20260924-v3/export`。

- 文件数：243。
- 总大小：167,635,033 字节，包含完整素材，不等于手机实际增量下载量。
- 启动包：`_expo/static/js/android/entry-ad3f9e293cb9943764009a2a4a59968e.hbc`。
- `release-manifest.json` SHA256：`eca3172012beef93541e90e99eed1763bedca1d161a999035d8a85fd2caf01eb`。
- 原始配置 SHA256：`d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe`。

发布入口：`scripts/android-build17-setting-motion-ota.ps1`。对应 Android 1.2.3 / Build 17、runtime `1.2.3`、`preview` 通道。

本地导出、上传发布和手机安装是不同步骤。未收到 EAS 发布成功输出前，不能认定手机已获得此版本。

本次未上传或发布。请在本地 Windows PowerShell 执行，不能在 ECS Bash 里执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\android-build17-setting-motion-ota.ps1" -Action Publish
```

发布使用已校验的导出文件，不重新打包，固定 Android 项目与 `preview` 通道。不要修改绑定的源码、工具或流程说明后再发布旧导出。v1/v2 文件和产物保留，本轮使用新的 v3 入口。

## 发布后观察

手机完成在线更新并重新启动后，从设定页依次打开联络、关于程序、关于团队、隐私、个人资料和免责声明，再分别用顶部返回和 Android 系统返回退出。重点确认：不再整页缩放、标题栏不会突然消失导致内容跳动、返回方向一致。联络页还需确认打开键盘后返回和再次进入时没有残留滚动。

页面内容加载或设备本身造成的掉帧仍需真机观察，不能以代码测试替代帧率测量。
