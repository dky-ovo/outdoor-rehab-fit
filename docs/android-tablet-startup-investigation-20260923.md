# 安卓平板启动闪退：只读检查（2026-09-23）

## 当前结论

用户报告最新安装包在安卓平板打开闪退、旧版正常。尚未收到设备型号、Android 版本、实际安装的 APK/版本、发生阶段或 Logcat。本轮没有复现同款平板的崩溃，不能确定根因，也没有修改业务代码、Build、推送 OTA 或操作服务器。

## 云端已核实

- 安卓项目：`dky2004/outdoor-rehab-fit`，`bcee8c37-e833-4f4d-b660-aa457accd96d`。
- 最新成功 APK：`412adb3b-0f53-4932-8a11-670e0563e8e1`，1.2.2 / Build 16，2026-09-21 创建，FINISHED。
- 之前的 Build 15 为 1.2.1，Build 14 为 1.2.0，Build 13 为 1.1.9。
- `preview` 频道仍指向 `preview` 分支，最新 OTA 为 2026-09-22 的 AI 历史对话更新，group `638fc99a-6619-48e5-9dbd-5e90e1928af4`，Android runtime 1.2.2。
- 该 OTA 原生指纹和 Build 16 均为 `d12b54da490f54534bc58509f59047a68062981f`。未发现频道或已发布原生指纹串线；这不等于排除了 JS 或特定设备问题。

## 实际 APK 对比

下载官方 Build 16 进行只读检查，保存为 `workspace-artifacts/tablet-audit-build16-20260923.apk`；ZIP CRC 及倒计时语音资源检查通过，结果见同目录 `tablet-audit-build16-20260923-integrity.json`。本次检查不是 APK 签名验证，也没有安装运行该 APK。

对比本地旧 Build 10、11、12：

- 均支持 `armeabi-v7a` / `arm64-v8a`，最低 Android API 24、target/compile API 36，`extractNativeLibs=true`。
- Build 16 与 Build 12 的 `.so` 原生库逐项 SHA-256 相同。
- 新包无 sherpa、onnx、sensevoice 模型及旧识别器标记；保留纯朗读模块。
- MainActivity 属性和启动 providers 与 Build 12 相同；权限变化为移除录音权限，未新增权限。

因此，不能把故障归因为“最新版本才丢失 32 位 ARM”“最新包残留语音识别大模型”或“新换了原生 .so 库”。DEX、JS、新旧本地状态和设备环境仍需要崩溃堆栈判断。

## 启动源码审查

- AI 原生朗读引擎按需创建，不在开屏时初始化；计时原生模块的启动回调不主动启动计时服务。
- 对比 2026-09-11 的 Android source map，更新窗口、语言初始化、音频模式及计时会话核心逻辑没有相关新增变化。
- 新增学习进度同步和登录会话恢复有异常捕获。
- 更新窗口中未保护的 `AppState.currentState.match(...)` 边界在旧版也存在，不能当成本次新增原因。
- 首页大图可能涉及低内存设备，但资源与旧版相同，暂无内存崩溃证据。
- 本次实际运行 4 套启动相关测试，74 项通过；测试使用原生 mock，不代表实体平板通过。此前成功导出或 EAS FINISHED 也不能证明设备启动无误。

## 下一步需要

1. 平板品牌/型号、Android 版本，实际 APK 链接或版本号，以及旧版正常的版本。
2. 点图标立即退出，还是看到启动画面、主页、更新完成、或某个功能后退出。
3. 如能 USB 连接电脑并启用调试，复现后只读导出崩溃记录：`adb logcat -b crash -d -v threadtime`。仅提供本 APP 同次崩溃段落，发送前删去可能包含的私人信息。官方说明：https://developer.android.com/tools/logcat。

不要为测试卸载、清除 APP 数据或随意回退 OTA，以免丢失本地聊天、未同步记录及诊断线索。

## 用户补充及 USB 诊断准备

用户补充“点击图标立即闪退”，并对可以 USB 连接电脑的询问回复“是的”。目前尚未收到平板型号或系统版本截图。

电脑未找到已有 ADB，已从 Google 官方 `https://dl.google.com/android/repository/platform-tools-latest-windows.zip` 下载独立 Platform-Tools 至 `workspace-artifacts/tablet-adb-tools-20260923/`；ADB 版本 1.0.41 / 37.0.1-15733141。未修改系统 PATH、安装 Android Studio 或改动 APP。

工具 ZIP SHA-256：`45F4D63113E895EBDE0C90F194099A4676B6AC653BD28D54314A9E022BBC1A99`。

首轮 `adb devices -l` 成功执行但设备列表为空。因此还未读取平板信息或崩溃日志，不能据此认定闪退原因。已请用户连接支持数据传输的 USB 线、开启 USB 调试，并在平板上允许这台电脑调试。
