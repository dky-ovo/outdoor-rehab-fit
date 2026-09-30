# 语音问题修正与验证边界（2026-09-21，r2）

## 用户反馈与结论

一加 7T Pro、Android 12：答案朗读不是粤语，点击语音转文字闪退。

本轮修正已确认的代码缺口，但**尚未复现该手机的闪退，不能宣称闪退已解决**。需要当前安装包版本、发生阶段和退出诊断，区分麦克风启动、权限返回、模型载入及原生解码。

## 已核实的安装包

- EAS Android preview Build：`f76ac19b-d446-49d4-80c2-a87cf18fccf7`。
- 版本 1.2.0、Build 14、runtime 1.2.0；该 Build 成功不代表真机语音功能通过。
- 对现有 APK 的 ZIP 目录只读检查发现：239,233,841 字节的 ONNX 模型采用 DEFLATE 压缩（160,168,880 字节），模块级“不压缩”设置没有作用到最终 APK。
- 模型、tokens、arm64-v8a／armeabi-v7a 原生库均存在。
- 压缩模型可能增加载入时的内存压力；这**不是**“刚点麦克风就闪退”的确定原因，当前代码在录音结束后才初始化识别器。

## 本轮修改

1. Android 朗读只接受明确的粤语声音，排除普通话、网络声音及未安装声音。设置后核对引擎实际返回的 voice，不再仅凭“香港中文”地区标签认定为粤语。iOS 优先选择粤语，并核对朗读声音。
2. 朗读仍使用手机已安装的离线声音，**没有内置粤语语音合成模型**。若没有符合条件的声音，会提示不可用，保留文字；不以普通话替代粤语。第三方引擎的元数据不能代替实际试听。
3. 应用级 Expo 插件设置 `.onnx` 不压缩；Android assembleDebug／assembleRelease 后检查 APK 内模型存在、大小正确、采用 ZIP_STORED，否则 Build 失败。独立 APK 校验器另检查模型／tokens 的 SHA、arm64 库和 DEX 模块标记。
4. Android 录音、模型及事件发送增加内存不足处理；事件在主线程检查当前会话和页面状态，防止迟到权限／录音回调影响新会话。不可捕获的 native SIGABRT／SIGSEGV 仍需原生日志定位。
5. 聊天页增加可直接打开的“查看语音诊断”。只显示版本、引擎、阶段及本 APP 最近退出类别，不需要先启动麦克风，不采集录音、问题文字、用户资料或崩溃堆栈。阶段持久化为尽力写入，进程突然退出时可能来不及保存。
6. 原生版本／runtime 最低升级到 **1.2.1**。不能靠旧 1.2.0 的 OTA 或服务器更新生效。

## 本地验证

- Jest：127 套、1859 项测试和 1 个快照通过；其中原生源码契约测试只检查约定，不等于原生执行。
- 随后增加 4 项内存不足错误映射／清理测试，语音会话套件共 24 项通过。
- TypeScript 检查通过；Android、iOS、Web 的 JS／资源导出通过。
- 生产 Java 声音选择器：28 项实际 JVM 断言通过；诊断状态 helper：18 项实际 JVM 断言通过。
- Expo 实际 Android 模板的隔离插件集成测试：5 项通过，确认设置写入应用级 Gradle，未修改根目录原生工程；不等于 Gradle 编译。
- APK 验收脚本：13 项合成 ZIP 测试通过；不代表新 APK 已产生或验收通过。
- 51 个引擎／模型资源及 5 份许可证校验通过。
- 本机找到 PyCharm 自带 JDK；没有 Android SDK／ADB 或连接的测试手机，未执行完整 Android 原生编译、iOS 原生编译或真机录音／试听。
- 本轮没有上传服务器、发布 OTA、创建云端 Build 或提交 Apple。

## 下一步：新 APK

在 Windows PowerShell 执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
node .\modules\offline-assistant-voice\scripts\verify-artifacts.cjs --platform android
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -NonInteractive -Message "修正离线语音模型打包与粤语声音选择"
```

Build 成功后下载新 APK，并用本地 Python 校验（替换成实际下载路径）：

```powershell
python .\scripts\verify-offline-voice-apk.py "D:\下载\新安装包.apk"
```

该校验只是安装包结构／资源检查。覆盖安装后确认版本 1.2.1 和修订版 `offline-voice-20260921-r2`，再做真机测试：

1. 打开 AI 助手的语音诊断，截图版本及阶段；暂不反复触发闪退。
2. 录制 5 秒粤语后结束，确认文字正确；分别验证点开、取消、完成录音以及快速重开。
3. 若退出，重启 APP 后直接查看诊断的上次阶段、退出原因和时间，记录是在点麦克风时还是完成录音时发生。
4. 先用短回答测试粤语朗读，核对选中声音及语言；英文单独测试。元数据合格但实际音色错误仍需记录引擎与 voice ID。
5. 测试切后台、切页面、停止朗读、开始录音、原有计时播报及教学视频的音频互斥。

本轮包是当前项目基线上的**源码增量包，不是 APK，也不是服务器部署包**。保留原始模型许可，不含 API Key、数据库或用户资料；无需执行 SSH。
