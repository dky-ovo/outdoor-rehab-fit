# 离线语音输入与答案朗读（2026-09-21）

> 本文记录初版。后续发现实际 APK 模型压缩及声音选择缺口；最新修正、1.2.1 构建要求和真机验证边界见 `offline-assistant-voice-r2-20260921.md`。

## 已接入

- Android/iOS 使用本地 Expo 原生模块 `OfflineAssistantVoice`，内置 sherpa-onnx 1.13.8 和 SenseVoiceSmall INT8 识别模型；不再依赖系统 SpeechRecognition 服务。
- 中文界面识别粤语，英文界面识别英语。点击麦克风开始，点击完成后转成文字，用户检查／编辑后才发送给现有 DeepSeek。
- 录音限 60 秒、16 kHz 单声道，仅在手机内存处理；模块不保存录音文件，不上传录音，不在运行时下载模型。
- 新成功回答默认自动朗读当前可见的简短内容；可以关闭自动朗读，也可以手动朗读／停止。历史、欢迎语、错误及已废弃的照片回答不会自动读出。
- 进入后台、退出聊天、切换账号／语言、新提问及开始录音都会停止朗读。长文分段，有旧会话隔离、超时和音频互斥。
- 主页现有可拖动悬浮球沿用现有入口，语音会调用同一个离线识别模块。

## 重要限制

- **不是完全离线聊天**：语音转文字在手机运行，但 DeepSeek 生成答案仍需要网络。
- **朗读使用手机已有的离线声音**，没有内置第三方粤语合成模型。Android 只接受非网络、已安装的粤语／英文声音，iOS 从已有声音列表选择；不会暗中换成普通话或把朗读文本上传。
- 如果手机没有离线粤语／英文声音，会明确提示，并保留文字答案。系统“语音识别服务不可用”与系统“朗读声音是否存在”是两个不同检查。
- 本机没有 JDK、Android SDK、Xcode，因此代码／资源检查不等于 APK、IPA 编译或真机识别通过。OnePlus 7T Pro／Android 12 的速度、准确率、麦克风权限和实际声音仍需新安装包验证。
- 离线模型本体 239,233,841 字节，约 228 MiB；会增加安装体积及运行内存。实际 APK／IPA 大小以 Build 产物为准。

## 资源与许可

- 4 个官方发布产物的固定 URL、大小、SHA-256：`modules/offline-assistant-voice/native-artifacts.json`。
- 解包后 51 个文件逐一校验：`native-file-inventory.json`；5 份完整许可逐一校验：`licenses/sources.json`。
- 模型保留原名、作者、原始 LICENSE／README，完整 FunASR 模型协议和引擎许可随原生资源打包。模型许可不等于桥接代码 MIT 许可。
- 未执行下载内容中的脚本，未引入授权不明的粤语 TTS 模型。固定 SHA、许可核对和代码检查不能替代完整安全审计。
- 资源已准备好，构建验证命令：

```powershell
node .\modules\offline-assistant-voice\scripts\verify-artifacts.cjs
```

如果未来从代码仓库新检出、没有大体积资源，可运行模块内 `scripts/prepare-artifacts.py`，它只接受固定校验值，并拒绝覆盖不匹配的现有文件。

## 本地验证结果

- 应用完整回归：124 套、1847 项测试全部通过，1 个快照通过。
- TypeScript `tsc --noEmit` 通过。
- Android、iOS、Web 三端 JS／资源导出成功。导出不代表原生编译通过。
- Expo Android／Apple 自动链接检查通过，均识别到新模块。
- 51 个引擎／模型文件及 5 份完整许可的 SHA-256 校验通过；EAS 忽略规则检查确认模型、引擎、校验脚本会包含在新 Build 上传内容中。
- 尚未执行原生 Build／真机录音、离线粤语朗读验收。

## 发布方式

**原生版本／运行时升级到 1.2.0，必须新 Build 并安装；不要对旧版 1.1.x 直接发布本轮 OTA。** 本轮无服务器／数据库变更，不需要 SSH 安装后端包，也不改变 DeepSeek API Key。

Android（沿用已有 dky2004 preview 项目）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
node .\modules\offline-assistant-voice\scripts\verify-artifacts.cjs --platform android
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -NonInteractive -Message "内置离线粤语英文语音输入和答案朗读"
```

iOS（沿用项目现有 production 配置，只构建不自动提交 Apple）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
node .\modules\offline-assistant-voice\scripts\verify-artifacts.cjs --platform ios
npx eas-cli@latest build --platform ios --profile production --message "内置离线粤语英文语音输入和答案朗读"
```

本轮没有运行云端 Build、发布 OTA、提交 Apple 或生成可安装 APK／IPA。源码增量包不是服务器部署包；仅针对当前项目基线，应用前先备份，不包含密钥、数据库或 node_modules。

## 真机验收清单

1. 安装新包后切飞行模式：粤语／英文各录制短句，检查能转文字；取消录音不应追加文字。
2. 恢复网络发送问题：新回答自动朗读；停止后不能因迟到回调又播放。
3. 连续快速点击录音／取消／重开，切换页面、后台、语言、账号，确认没有卡死、串音或旧问题混入。
4. 缺粤语声音时应显示提示，不改用普通话；有离线声音时，旧回答可在断网后手动朗读。
5. 一加 7T Pro／Android 12 测试 5 秒、15 秒、60 秒录音；iOS 真机单独验证权限、声道转换和声音。
6. 检查现有倒计时播报、设施教学音频／视频与助手切换，确保离开助手后声音能正常恢复。
