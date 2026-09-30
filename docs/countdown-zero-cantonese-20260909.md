# 倒计时归零停止及前后台粤语／英语播报（2026-09-09，运行时 1.1.6）

## 本轮改动

1. Android Build 9 的服务通知使用 SystemUI 的倒计时 Chronometer。该控件过零后会继续显示负数，原先只有结束音播放准备阶段才替换卡片，无法给显示设置零边界。
2. 新服务倒计时按原生单调截止时间每秒更新同一个通知数字，显示值限制为非负，保留原字号、位置、卡片样式。正数计时仍使用系统 Chronometer，不增加正计时 CPU 唤醒锁。
3. 到期先取消倒计时刷新并显示“已结束 / 0:00”，再处理结束播报；播报完成、静音、加载失败、焦点失败或超时均会清理服务通知。正在播放的结束语句不被“到期”状态截断，计时本身已经结束。
4. 暂停、放弃、换账号和重新开始均撤销旧刷新与播放代次。旧通知、旧播放器或旧定时回调不能修改新计时器。刷新恰好跨零时也不误清除结束播放服务。
5. 中文改为内置粤语合成语音，英文沿用既有英语录音。Android 服务和 APP 前台播放器使用完全相同的四段 WAV，不依赖手机系统默认 TTS，不使用普通话或提示音替代粤语。新版本不再注册历史 chime 为计时提醒资源。
6. 前台加载完成且提示仍有效时才开始播放，取消及迟到回调不能在重新打开后补播；已经开始的句子可完整播完，不被原有两秒“开始时效”截断。播放器、监听器和短时轮询会释放，最长十五秒兜底。
7. 同一计时切换语言不重置计时或已领取的阶段。如果旧语言还在 prepare，准备回调会比对当前音源并丢弃旧句；已开播的句子允许读完，后续阶段使用新语言。
8. 已安装运行时 1.1.3–1.1.5 的系统通知仍只引用它们真正包含的英语资源；1.1.6 起才引用新的粤语资源。原有通知频道静音和系统音量／勿扰选择不被绕过。

## 播报内容与来源

| 界面语言 | 半程 | 结束 |
| --- | --- | --- |
| 中文（粤语发音） | 倒數計時已過一半。 | 倒數計時已結束。 |
| English | The countdown is halfway complete. | The countdown has finished. |

粤语由 `zh-HK-HiuMaanNeural` 合成，语速 `-20%`，两段长度分别为 3.432 秒、3.024 秒。中断前的生成进程已实际保存两份 MP3，恢复时确认能完整解码，再本地转换为 24 kHz、16-bit、单声道 PCM WAV，没有再次发送在线合成请求。手机播放不联网，不读取用户资料。

英语保留原先 Windows Zira 录音，未重新生成。所有文件的文本、语言、来源、时长、大小及 SHA-256 记录在 `assets/sounds/notifications/speech-manifest.json`，详情见该目录 README。格式／解码验证不能等同人工试听，发布前仍建议试听两段粤语及真机验证。

## 验证

- 全量前端与原生源码契约：55 组、618 项 Jest 测试及 1 项快照通过。
- 音频格式、非静音内容、准确时长、哈希及 Expo Android 插件原生资源复制：11 项 Node 测试通过。
- `npx tsc --noEmit` 通过。
- Android、iOS、Web 的 JS/Hermes 导出通过：`workspace-artifacts/exports/countdown-zero-cantonese-20260909`。
- 导出检查首次因受限环境禁止子进程出现 `spawn EPERM`；经许可在限制外重新执行成功，没有因此更改业务逻辑。
- 原始 `app.json` 保持不变，SHA-256：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。配置只在 `app.config.js` 将旧运行时映射为 1.1.6，保留 Android／iOS 各自的发布项目。

以上原生测试属于源码／布局资源契约测试，不是手机执行测试。后续 Android Build 10 已在 EAS 完成原生编译，云端日志包含 `:session-timer-notification:compileReleaseKotlin`，最终状态为 `FINISHED`。本机没有 JDK／Android SDK／adb，尚未完成真机锁屏及扬声器验证。

## 发布状态

用户明确要求构建并提供安装链接后，已完成 **Android 1.1.6 / Build 10**。构建 ID 为 `01b6ffa5-1ebc-4ffa-9860-013679aaacdb`，项目 `dky2004 / outdoor-rehab-fit`，配置及频道均为 `preview`，沿用现有签名。云端于 **2026-09-10 00:41:48（香港时间）**完成，2026-09-10 恢复工作后再次只读核对为 `FINISHED`，没有重复提交构建。没有提交 iOS、发布 OTA 或更新服务器。

[Build 10 云端详情](https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/01b6ffa5-1ebc-4ffa-9860-013679aaacdb)。已交付的 Build 9（1.1.5）仍为旧安装包，不包含本次修复，不得用旧链接代替本次产物。

[下载 Build 10 APK](https://expo.dev/artifacts/eas/Il4qUhhmz_jrAaCU0Ze0d4i0FE0XTtRmXKlmNS3A6yY.apk)。

- 本地备份：`deploy/2026-09-10/outdoor-fit-android-1.1.6-build10.apk`。
- 文件大小：205,452,744 字节（195.94 MiB）。
- SHA-256：`561C52697B0F9EDA8CED4B7DF8C4122D43BABB151C3CC361DB722F463949DC4C`。
- 同目录 `.apk.sha256` 保存整包校验值。

### Build 10 实包检查（2026-09-10）

- APK 二进制 Manifest：`com.maxcch.c.outdoorrehabfit`、版本 `1.1.6`、versionCode `10`，minSdk 24、targetSdk 36。
- `TimerAudioService` 已注册，`exported=false`、`stopWithTask=true`、前台服务类型 `specialUse|mediaPlayback`；对应前台服务、通知、唤醒锁及精确提醒权限存在。
- `classes4.dex` 的类定义确认包含 `TimerAudioService`、`TimerAudioAlarmReceiver`、`SessionTimerNotificationModule`，不只是残留字符串。
- `resources.arsc` 的四个 raw 映射：`countdown_en_complete → res/g3.wav`、`countdown_en_halfway → res/Xa.wav`、`countdown_yue_complete → res/Fy.wav`、`countdown_yue_halfway → res/yG.wav`。
- 四段包内 WAV 均与本地对应源文件逐字节及 SHA-256 一致；未发现 `countdown_chime_*` raw 资源。
- 原始 `app.json` 哈希恢复后再次核对不变，未留下 Android 临时配置备份。
- 以上为云端编译及静态实包检查，不能替代设备安装、锁屏播放或人工试听。

本次修改含 Kotlin 与新增原生 WAV，必须重新构建并覆盖安装新 Android APK；不能只向 Build 9 发布 OTA。无需新的后台 ZIP 或 SSH 部署。请不要卸载旧 APP，以免丢失仅存本地的运动记录。

以下仅为构建命令留档，Build 10 已完成，安装本次更新无需再次执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android-preview.ps1" -NonInteractive -Message "修复倒计时通知负数并统一粤语和英语播报"
```

## 真机复核清单与边界

- 中文与英文分别做 1 分钟倒计时：APP 前台、普通后台、锁屏各测试半程和结束，确认每阶段只播一次且语言一致；到零不出现负数，整句结束后通知清除。
- 暂停／继续、放弃后立即进入正计时、连续重开、结束后填写并保存记录，确认不会复活旧通知或截断已到期结束句。
- 语音加载期间切换语言：旧准备回调不得稍后开始播出旧语言；已经开播的句子允许读完。
- 静音、勿扰、通知权限关闭、频道静音、来电抢焦点：不得强行出声、卡死或重复弹旧提示。
- **深度省电可暂停原生回调**：静态通知可能暂留最后一个非负数字，恢复执行后按真实截止时间结束；不会负数累加，但不承诺所有品牌锁屏状态瞬间归零或移除。已有前台服务和唤醒锁仍不是 Doze 豁免，十秒过期提示仍会丢弃。
- 通过系统停止 APP、清除任务或进程被杀后，不偷偷重启声音服务。需用户返回 APP 主动继续，未来提示才可恢复。
