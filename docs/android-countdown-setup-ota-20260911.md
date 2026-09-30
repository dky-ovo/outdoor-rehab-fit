# Android 倒计时结束设置 OTA（2026-09-11）

## 发布结果

- 已按用户“帮我推送到手机”的授权发布 Android OTA；未发布 iOS，未创建新 Build，未部署服务器。
- 内容：倒计时结束后恢复初始时间设置，移除“再次开始”，支持重新选时长后手动开始，不弹运动记录。
- 发布时间：2026-09-11 15:17:09（香港时间）。
- 项目：`dky2004/outdoor-rehab-fit`，ID `bcee8c37-e833-4f4d-b660-aa457accd96d`。
- 平台：`android`；频道/分支：`preview`；运行时：`1.1.8`。
- 更新组 ID：`28b2f968-d634-4935-9323-09ef34258615`。
- Android 更新 ID：`01a08f53-ce0d-7d52-830a-728458b952d4`。
- [Expo 发布详情](https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/updates/28b2f968-d634-4935-9323-09ef34258615)。

## 兼容性与验证

- 发布前读取 Build `b5a2156c-e71c-491f-ba73-b8f7ea78ad95` 的云端记录，确认已完成、Android 1.1.8 / versionCode 12、preview 频道、正确项目及包名。
- 当前 JS 界面修改不依赖本地尚未 Build 的原生诊断或新原生方法；保留 Build 12 原生服务。
- 最近一轮相关回归：4 套、63 项通过。此前完整回归：78 套、870 项通过。
- 本次发布重新导出 2134 个模块，上传 1 个 bundle；已有资源未重复上传。EAS 命令退出码 0，显示 Published。
- 发布后以原生客户端的 Accept 格式和 `android`、`preview`、`1.1.8` 请求更新入口，HTTP 200，返回 Android 更新 ID `01a08f53-ce0d-7d52-830a-728458b952d4`，确认频道实际送达目标版本。首次探测未声明 multipart 格式而收到 406，补齐与客户端一致的请求头后通过；没有重复发布。
- 导出目录：`workspace-artifacts/ota-countdown-setup-20260911/android`。未覆盖之前的 `dist` 导出。
- HBC bundle SHA-256：`B423FAA8745D60DADA084A7383C658A9E0331788285C2601B8F393DB9DDE29F4`。
- `app.json` 已恢复，SHA-256 与发布前一致：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。没有遗留 Android 更新/Build 临时备份。

## 操作记录

发布脚本新增兼容旧调用的可选 `InputDir` 和 `NonInteractive` 参数，以隔离导出产物并避免无人值守交互。PowerShell 语法解析及实际发布均通过。

下面记录本次已执行命令；不要仅为手机尚未下载而再次发布：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
$env:CI = '1'
powershell -NoProfile -ExecutionPolicy Bypass -File '.\scripts\publish-android-preview-update.ps1' -Message '倒计时结束返回初始时间设置，移除再次开始' -InputDir 'workspace-artifacts/ota-countdown-setup-20260911/android' -NonInteractive
```

## 手机上应用更新

1. 先结束当前计时或保存正在编辑的日志，手机保持联网后打开 APP。
2. 如出现更新下载提示，保持 APP 打开等待完成，再点“重新启动应用程序”。
3. 若未出现提示，可完全关闭 APP 后重新打开，再等待下载及重启。
4. 设置 1 分钟倒计时验证：结束后显示预设、加减、输入框及“开始”，没有“再次开始”，没有自动创建记录。

本次只确认云端已发布且匹配客户端请求能够取到更新，未远程确认用户手机已下载、应用或完成真机测试。Build 编号仍为 12，不增加。用户已确认的一加后台权限设置保持原状；本次 OTA 不安装此前未 Build 的 Kotlin 防护/诊断代码。
