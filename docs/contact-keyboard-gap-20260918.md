# 安卓「联络我们」键盘上方留白修复

## 问题与范围

用户确认问题出现在安卓手机。联络表单原本在键盘显示时仍保留 `110 + insets.bottom` 的滚动底部空间；Android 底部导航栏又在布局中单独占位，形成多余预留。

本次仅修改 `app/(tabs)/setting/contact.js` 的安卓输入状态及对应回归测试：

- 联系页面聚焦时启用 Android `tabBarHideOnKeyboard`；离开时恢复，其他页面不受影响。
- Android 键盘显示时底部间距改为 24 像素；键盘隐藏后保持原有布局。
- 保留共享 `useKeyboardInset` 对实际剩余遮挡的处理，不重复添加整个键盘高度，不修改全局输入法或原生设置。
- iOS 布局、表单字段、输入内容、提交/重试、权限及后台接口不变。

## 验证与发布

- 相关表单、反馈 API 与返回链路共 67 项测试通过。
- 完整前端及既有脚本回归：100 套、1,581 项通过。
- 覆盖 Android 系统已缩小窗口、仍有键盘遮挡、连续多轮开关键盘、草稿保留、离开页面恢复及 iOS 布局不变。
- TypeScript 检查通过；Android 导出成功，目录 `workspace-artifacts/contact-keyboard-gap-20260918/android`。
- 本地未连接真实安卓手机；原生键盘动画和实际输入法效果需要更新后真机复核。
- 不涉及后端、数据库或原生依赖，无需重新上传服务器部署包。对兼容安装版本发布 Android preview OTA 即可；本轮未实际发布。

在电脑 Windows PowerShell 执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
$otaOutput = "workspace-artifacts/android-contact-keyboard-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "修复联络我们输入时键盘上方留白" -InputDir $otaOutput
```
