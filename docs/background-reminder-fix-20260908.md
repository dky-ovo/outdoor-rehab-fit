# 后台倒计时与安卓锁屏通知修复（2026-09-08）

## 已确认的程序原因

1. 原后台预约的声音为 default，安装包未包含半程／结束语音文件；JS 的 expo-speech 不会因预约通知自动在后台执行。
2. 完成状态始终保留 countdownCompletionVoicePending，过半也没有限定有效时点，重新打开 APP 后会补播过期语音。
3. Android 计时状态渠道原为 LOW；部分系统会把这类静默通知从锁屏隐藏。通知在系统列表中存在，不等于锁屏可见。
4. Android 新装未声明／引导可选的精确提醒权限；本地 Expo Notifications 实现会在未授权时使用非精确闹钟。
5. 通知权限拒绝后进设置授权，旧调度结果可能仍被缓存；开始后立刻切后台也可能提前消费尚未执行的授权请求。

## 本轮修改

- 仅在持续前台且触发时点后 2 秒内播放前台语音；后台错过、恢复旧总结、音频准备过慢或暂停后，不补播旧提示。
- 保持绝对时间计时、真实截止时间及待填写总结，不因跳过语音丢失运动记录。
- 回到前台清理过期预约，未来预约保持；精确提醒授权变化时按原截止时间重新预约。
- Android 新装状态卡片使用 DEFAULT 无声渠道 v2。只有能确认旧渠道未被用户修改时迁移；保留用户关闭、静默及隐私偏好，增加提示和实际渠道设置入口。
- 新原生桥接在通知权限申请前准备渠道；旧模块安全回退。修复拒绝后重试、首次启动 AppState 未就绪、异步权限读取后立即锁屏等链路。
- 加入可选 SCHEDULE_EXACT_ALARM，只有用户点击提示才打开系统授权页面。未采用 USE_EXACT_ALARM、前台常驻服务、全屏闹钟或电池豁免。
- 英文后台语音已生成并配置：countdown_en_halfway.wav（2.990 秒）、countdown_en_complete.wav（2.520 秒），本机离线合成，PCM 24 kHz / 16 bit / mono。
- 英文语音仅安装包 runtime 1.1.3+ 使用，旧安装包安全回退普通提示音；Android 与 iOS 发布项目不变。
- 语音提醒渠道迁移同样保留旧渠道的关闭、静音、自选铃声、震动和锁屏隐私；已有语音渠道只读复用，不覆盖设置。Android 默认锁屏继承值 -1000 不误判为用户隐藏设置。

## 尚未完成：中文后台语音

本机没有粤语语音。原前台中文播报继续优先使用设备粤语，未擅自改成普通话。已询问用户是否接受后台暂用普通话或提供粤语录音，尚未收到选择。因此中文后台当前仍为系统提示音，不能宣称中文后台语音已完成。

## 验证

- 前端与原生源码／资源契约：43 套、446 项测试及 1 项快照通过。
- 后端使用其正确 Node 测试运行器：20 项通过，未改后端代码。
- iOS Widget 配置：10 项通过，真实 Expo Xcode 工程配置重复运行无重复目标。
- TypeScript 通过。
- Android、iOS（Hermes）及 Web 导出通过：workspace-artifacts/exports/background-reminder-fix-20260908。
- 英文音频格式、时长、非静音采样及哈希检查通过，详情见 assets/sounds/notifications/README.md。
- 初次测试扫描遇到无关 tmp/bsk-test/package.json BOM，之后限定正式测试根；后端测试不放入 Jest，使用 Node 运行。沙箱限制构建子进程时经批准执行本地导出，没有联网发布。

## 交付和真机边界

当前配置解析为 1.1.3。尚未重新 Build、上传服务器、发布 OTA 或提交新的 TestFlight。已发布的 Android Build 6 / iOS Build 16 不含本轮改动，完整修复需要新的原生安装包。

此 Windows 机器没有 Android SDK/JDK 或 Xcode；本轮未做 Kotlin 编译或真机锁屏验收。系统全局锁屏隐私、勿扰、静音、省电和厂商限制不能由程序绕过。Android 深度 Doze 下精确提醒仍有频次限制，不能保证所有机型都在毫秒级准时播放。

新包验收需检查：

1. 中英文、前台／后台／锁屏分别运行正计时与倒计时，半程和结束时间核对。
2. 到点后 1 秒、30 秒及数分钟再打开，不补播旧语音，运动总结可保存。
3. 暂停／继续、放弃／重开、切换模式和账号，不保留前一计时器的通知或语音。
4. 拒绝后授权通知、拒绝后授权准点提醒，回 APP 后核对未来预约。
5. 新装与覆盖安装分别检查旧通知渠道迁移；关闭锁屏通知后不得强行重开。
6. Android 深度 Doze、静默通知隐藏、iOS 静音／专注模式及大字体。

## 官方依据

- [Expo SDK 54 自定义通知音](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/#set-custom-notification-sounds)
- [Apple 通知声音格式与 30 秒限制](https://developer.apple.com/documentation/usernotifications/unnotificationsound)
- [Android 精确闹钟权限](https://developer.android.com/develop/background-work/services/alarms)
- [Android Doze 限制](https://developer.android.com/training/monitoring-device-state/doze-standby)
