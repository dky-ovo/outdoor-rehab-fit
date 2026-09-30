# 75% 学习高亮、总时长提示与 AI 语音输入（2026-09-21）

## 本轮范围

1. 收藏中的阅读、观看、收听图标分别达到 75% 才高亮。详细计算口径见 `learning-coverage-20260921.md`。旧版仅有布尔值的完成标记没有比例证据，因此更新后可能恢复灰色；原有使用数据不删除。
2. 时段总结仅移除总时长输入框里的 `30` 占位提示，保留已填写的真实数值、分钟单位及保存逻辑。
3. AI 助手移除拍照、相册、图片预览、图片发送和图片识别；后端旧客户端图片请求返回明确错误，不调用 DeepSeek，不消耗文字问答额度。用户头像和后台文件库不受影响。
4. 麦克风使用手机系统语音服务转换文字：中文默认粤语，英文默认英语。先填入输入框，用户确认后再发送。没有新增语音服务器、语音 API Key 或后台录音功能。
5. 主页新增语音快捷浮球，保留访客访问限制；快捷请求必须由主页点击产生，在同一进程内单次使用，30 秒过期并绑定账号/语言。外部链接不能直接开启录音。

## 隐私、异常与兼容

- 只在用户点击语音入口后请求权限；挂后台、离开聊天、退出账号、切换语言或点击取消会停止当前识别，忽略过期回调。
- 不保存音频文件，不向本项目后端上传音频。系统语音服务可能使用网络，不承诺完全离线。
- 手动编辑与识别同时发生时，不覆盖新草稿；识别文字保留为可加入/取消的候选。600 字限制明确提示，不静默覆盖已有输入。
- 识别最长 60 秒，等待最终结果最长 6 秒，权限等待也有超时。识别失败时继续提供键盘输入。
- iOS 完成后恢复原有播放音频模式；不新增后台麦克风用途。
- 语音面板可收缩和滚动，输入框、发送按钮保持在面板外。主页浮球与左右吸附的计时浮层分开。

## 原生发布要求

新增 `expo-speech-recognition` 3.1.3（Expo SDK 54 兼容版本）。动态配置将当前应用版本/原生运行时提升至 `1.1.9`，保留 Android 和 iOS 原有 EAS 项目。

**本轮需要新的 Android/iOS Build，不能仅向旧安装包发 OTA 来增加语音功能。** 原生依赖缺失时界面保留键盘并显示更新提示，不应崩溃。

Android（Windows PowerShell）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -Message "75%学习进度及AI语音输入" -NonInteractive
```

iOS（Windows PowerShell）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
npx eas-cli@latest build --platform ios --profile production --message "75%学习进度及AI语音输入"
```

两个构建请依次执行，Android 脚本运行时会暂时切换配置，结束后自动恢复 iOS 项目。构建成功不等于提交 Apple；本轮未自动构建或提交。

## 后端/Web 发布

部署包：`deploy/2026-09-21/outdoor-fit-learning-voice-input-20260921-update.zip`，并附同名 `.sha256` 文件。

本包只支持完整的 `v24-activity-content-20260918` 后端或本轮完整已安装状态。不确定服务器是否安装过 V24 时，先查看安装器只读检查结果；不可绕过基线校验。只替换两项 API 源文件和公开 Web 导出，不包含数据库、视频文件、密钥或手机安装包。安装器先备份，失败恢复代码/Web，不自动恢复或清空运行数据库。

电脑上传（Windows PowerShell）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
gcloud storage cp ".\deploy\2026-09-21\outdoor-fit-learning-voice-input-20260921-update.zip" ".\deploy\2026-09-21\outdoor-fit-learning-voice-input-20260921-update.zip.sha256" "gs://outdoor-rehab-fit/"
```

服务器 SSH 执行：

```bash
cd /home/dukaiyu2004
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-learning-voice-input-20260921-update.zip gs://outdoor-rehab-fit/outdoor-fit-learning-voice-input-20260921-update.zip.sha256 /home/dukaiyu2004/ &&
sha256sum -c outdoor-fit-learning-voice-input-20260921-update.zip.sha256 &&
unzip -p outdoor-fit-learning-voice-input-20260921-update.zip install-learning-voice-input-20260921.sh > install-learning-voice-input-20260921.sh &&
sudo bash install-learning-voice-input-20260921.sh /home/dukaiyu2004/outdoor-fit-learning-voice-input-20260921-update.zip
```

## 验证边界与真机清单

最终本地验证结果：

- 前端 111 套、1,691 项测试全部通过，1 项快照通过。
- 后端 214 项：212 项通过、2 项既有真实媒体种子测试跳过。
- 发布工具 19 项：18 项通过、1 项 POSIX 文件模式测试因 Windows 平台跳过。
- TypeScript 检查通过；29 项器材中英内容证据目录一致性检查通过。
- Android、iOS 和 Web 独立导出成功；这不等于云端原生 Build 或真机测试。
- Expo 原生配置验证包含麦克风、iOS 语音识别用途及 Android RecognitionService 查询；Android/iOS autolinking 均检测到 3.1.3 原生模块。
- 实际交付 ZIP 已使用安装器的同一解包检查重新解包，并通过完整文件校验。

部署包大小：157,737,645 字节（150.43 MiB）。SHA-256：

```text
8D2140C5B02658B56D449E0FA38921003105D19B2B02A4DE7A226EF2BD35D776
```

本地验证包括组件交互、阅读/播放区间、TTS/录音/视频回调、拒绝权限、取消重开、旧回调、用户切换、外部链接、文字保留、后端文本问答及图片拒绝、发布校验/备份/回滚。浏览器控制工具本次连接失败，未完成新的浏览器实际点击检查；没有伪称手机实测。

新安装包仍需在 Android（尤其一加 7T Pro / Android 12）和 iPhone 检查：

- 首次允许/拒绝麦克风与语音识别；设备语音服务是否支持粤语。
- 中文/英文听写、手动编辑再听写、取消后重开、手机通话中断、退出聊天及锁屏后停止收音。
- 语音输入与倒计时语音/TTS 的音频中断恢复。
- 字体放大、键盘弹出时仍能操作候选文字、取消和发送。
- 阅读、视频、预录音、TTS 分别到 75% 前后，返回收藏核对灰/绿色；快划和跳播不应点亮。

未上传服务器、未发布 OTA、未触发 EAS Build 或 Apple 提交。
