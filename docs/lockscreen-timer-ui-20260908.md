# 锁屏计时卡片修改与验证（2026-09-08）

## 已修改

- Android：系统装饰通知的紧凑/展开卡片，红色点缀、大号计时、模式及暂停状态；深浅主题、中英文与长时间数字适配。
- Android 计时由系统 Chronometer 驱动，不新增每秒推送或常驻服务；暂停固定显示，不计算暂停时长。
- Android 同一通知渠道不变；恢复前台只读检查已显示/被移除/被禁用，不因缓存误报成功，不自动重发用户划走的同状态卡片。
- iOS 16.2+：新增 ActivityKit 锁屏实时活动及灵动岛组件，显示正数/倒数、暂停、打开计时器入口和倒数进度条。主 APP 最低版本仍为 iOS 15.1。
- iOS 普通通知权限与实时活动开关独立；关闭实时活动或系统不支持时使用允许范围内的静态通知，不在每次前后台切换重复撤回/重发。
- 不改变计时器、手动记录、总结保存和返回路由功能；点通知仍验证当前账号及计时器编号。
- 暂停/继续、放弃、结束、换账号及迟到异步结果均沿用/补强单活动清理保护；不显示用户资料、病况或位置。
- 新增 iOS Widget Extension 自动配置、EAS 签名元数据、UserDefaults 必要原因 CA92.1 隐私声明。

## 配置与交付范围

- 新增 `app.config.js` 注册本地插件，把现有版本 1.1.1 映射为 1.1.2，避免与旧 Build 4/15 共用原生 OTA runtime；后续更高版本不会被覆盖。
- 本轮开始时 `app.json` 已是 dky2004 Android 项目，并存在 `app.json.android-build-backup`。本轮保留二者，没有改写、恢复或删除这份外部构建备份；后续启动构建前要先确认原命令状态。
- 没有重新发起 EAS Build、OTA、TestFlight 提交或商店发布。
- 没有后端修改、服务器部署包或 SSH 操作；此功能需要新的原生安装包，不能靠上传服务器启用。
- 前一轮 Android Build 4 / iOS Build 15 的下载链接不包含本轮锁屏新 UI。

## 本地验证结果

- Jest：42 个测试集、375 项测试和 1 项快照通过。包括既有计时、记录保存、返回、权限等回归，以及新通知接线和原生源码/资源契约检查。
- iOS 构建插件：10 项 Node 测试通过。使用 Expo 模板真实 Xcode 工程，完整 mod 重放两次，结果幂等；验证扩展来源、framework、签名嵌入、主 target 与版本继承。
- TypeScript 检查通过。
- Android/iOS 自动链接可发现本地模块；Expo 解析配置包含实时活动开关和 `.timer-widget` 扩展声明。
- Android、iOS、Web 导出通过（移动端含 Hermes 字节码）。最终导出位于 `workspace-artifacts/exports/lockscreen-timer-20260908`。
- 原生 UserDefaults 隐私声明可解析；差异空白检查通过。

这些检查不等于 Swift/Kotlin 编译，更不等于真机锁屏 UI 测试。当前 Windows 无 Xcode、Android SDK/JDK，尚未验证本轮原生编译、签名或安装效果。

## 新 Build 后需要检查

1. 两端分别开始正数/倒数，锁屏等待后核对卡片时间与 APP 时间。
2. 暂停锁屏、继续锁屏，确认暂停不走时，恢复不计入暂停时长。
3. 倒数归零后点击卡片/提醒，确认进入当前计时或总结且可以保存。
4. 放弃、重新开始另一模式、快速暂停继续和切换账号，不残留前一条卡片。
5. 从锁屏点击返回 APP，验证需要解锁、进入正确计时器且返回路径正常。
6. Android 拒绝通知、关闭计时渠道、划走通知；iOS 关闭实时活动、关闭普通通知、主动移除活动，均不循环重发或影响计时。
7. 最小屏幕、放大字体、深浅色、横跨一小时的时间显示，以及 Always-On 模式。

## 系统边界

锁屏通知是否显示仍受系统与用户设置决定，应用不会绕过隐藏静默通知或锁屏隐私设置。[Android 通知布局文档](https://developer.android.com/develop/ui/views/notifications/custom-notification)

iOS 实时活动最长活跃 8 小时，系统可额外在锁屏保留最多 4 小时。倒数数字使用有界系统时间文本；结束文案的 stale 刷新和移除不能承诺精确零秒后台回调。Always-On 下也不保证每秒重绘。[Apple Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)

iOS 首次构建新增 `.timer-widget` 扩展时，需要 Apple 团队提供相应扩展签名/描述文件；插件已声明 EAS 元数据，但本轮没有创建任何新签名凭据。[Expo App Extensions](https://docs.expo.dev/build-reference/app-extensions/)
