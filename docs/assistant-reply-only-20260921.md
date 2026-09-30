# 移除语音输入，保留答案朗读（2026-09-21）

## 范围

- 移除聊天页麦克风按钮、录音／识别状态、转写候选文字及识别诊断入口。
- 移除主页语音悬浮球和其专用留白；普通 AI 助手入口与文字输入保留。
- 旧 `voiceRequest` 路由参数不再自动开启录音。
- 保留新答案自动朗读开关、手动朗读、停止朗读、切页面／后台停止播放及中文粤语／英文声音选择。
- 保留原有倒计时播报、设施教学音频／视频与头像拍照功能；这些功能没有改为录音。

## 新安装包

原生模块沿用 `OfflineAssistantVoice` 名称，只保留三个朗读接口和 `onReplySpeech` 事件，移除录音和识别实现。新包不再编译或打包 sherpa-onnx、SenseVoice 模型或识别依赖。

Android 禁止合并麦克风录音与前台麦克风服务权限；iOS 移除麦克风／语音识别权限说明。`expo-audio` 保留播放功能、关闭录音配置，`expo-image-picker` 保留头像照片权限但不申请麦克风。

已下载的模型和引擎二进制**保留在电脑上**，没有删除；`.easignore` 排除这些文件。原有后端、DeepSeek、用户资料、数据库及上传文件不变。

原生版本／runtime 为 **1.2.2**，防止旧语音输入界面加载到已经删除录音 API 的新包中。旧 APK 中的模型和权限不能通过 OTA 物理移除；完整移除需要重新 Build、覆盖安装。

朗读仍使用手机已安装的离线粤语／英文声音；没有合适声音时提示不可用，文字答案继续保留。不是新增内置粤语合成模型。

## 构建

本轮不需要服务器部署包或 SSH。源码增量包不是可安装 APK。

Windows PowerShell：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -NonInteractive -Message "移除语音输入，保留答案语音播报"
```

本轮没有创建云端 Build、发布 OTA 或提交 Apple。新包需真机验证：仅显示文字输入及发送按钮；主页无语音悬浮球；发送问题后自动朗读；手动朗读、停止、关闭自动朗读和退出页面均正常；倒计时播报保持正常。

## 验证

可执行 `node .\scripts\verify-reply-only-config.cjs` 进行只读 Expo 插件检查；安卓构建脚本已自动执行此预检，失败时不提交云端 Build。

实际 Expo 插件解析确认 Android 录音权限有明确移除规则，iOS 没有麦克风／识别说明，头像照片、计时音频和 Live Activity 均保留。该检查还覆盖新 EAS 上传中的模型排除规则和朗读模块完整性。

本地结果：

- 完整回归 126 套、1843 项测试及 1 个快照通过。
- 文字发送／历史／滚动／朗读及入口关联的 8 套、178 项测试通过（已包含在完整回归中）。
- 生产 Java 粤语声音选择器实际编译执行，28 项断言通过。
- TypeScript 检查、Android／iOS／Web 的 JS 与资源导出通过。
- 构建脚本 PowerShell 语法检查、实际 Expo 插件只读预检通过。

原生源码契约测试和 Expo 资源导出不能替代 Android／iOS 原生编译及真机试听。本轮未执行原生 Build 或手机测试。
