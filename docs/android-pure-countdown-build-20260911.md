# Android 纯倒计时修复构建（2026-09-11）

用户要求「帮我 Build」。沿用 Android preview APK 工作流；本轮不构建 iOS、不发布 OTA、不提交商店或部署服务器。

## 构建输入

- APP/runtime：`1.1.8`，发布项目 `dky2004/outdoor-rehab-fit`（`bcee8c37-e833-4f4d-b660-aa457accd96d`）。
- 通过现有 `scripts/build-android-preview.ps1` 提交一次，参数 `-NoWait -NonInteractive`，冻结既有签名凭据，不安装模拟器。
- 构建信息：倒计时独立运行不弹记录，修复后台结束通知停留。
- 本次包括独立 completed 状态、结束不创建运动记录、再次开始、旧草稿保留、通知同秒刷新去重、固定零秒完成卡替换及旧通知防重建。
- 源码验证记录：[纯倒计时及后台结束通知检查](pure-countdown-expiry-20260911.md)。上一轮最终 77 套、861 项测试及 1 个快照通过，类型检查与 Android/iOS JS 导出通过。
- 提交前 `app.json` SHA-256：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。

## 云端构建与产物

- 构建 ID：`b5a2156c-e71c-491f-ba73-b8f7ea78ad95`。
- [构建详情](https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/b5a2156c-e71c-491f-ba73-b8f7ea78ad95)。
- versionCode 从 `11` 增加到 `12`；使用既有 `gdWYb5HJat` 安卓签名。
- 归档约 334 MB，上传用时 1 分 5 秒，项目指纹计算通过；仅提交一次。
- 上传后脚本已恢复 iOS 的原 `app.json`，SHA-256 与提交前相同，没有遗留构建／更新备份文件。
- 7 个关键源码／语音文件均存在且未被 `.easignore` 排除；后台、部署产物及本地测试目录不进入移动端源码归档。
- 云端结果：`FINISHED`，没有构建错误；完成于 2026-09-11 05:56:26.905 UTC（香港 13:56:26）。
- [Build 12 APK 下载](https://expo.dev/artifacts/eas/SShtwAIcTLCt3VozQxvJ_qWiM1iSr0jBhzvnay2Q0C8.apk)。
- 已保存 `deploy/2026-09-11/outdoor-fit-android-1.1.8-build12.apk`：205,515,620 字节（195.99 MiB）。
- SHA-256：`90AF613BE3669C9B3E1D6B1734453A5184519CDBFC77DF648DEBB84FBFCB8362`；同目录提供 `.apk.sha256`。
- `verify-android-preview-apk.py` 通过：1,895 个 ZIP 条目 CRC 正常；四段粤语／英文半程和结束语音的原生资源字节均与源码一致；计时模块 DEX 描述符及通知布局名称存在。
- 上述静态检查不独立解析二进制 Manifest、不验证 APK 签名或资源 ID 映射；版本／签名选择依据 EAS 构建结果，不能将资源存在视为真机声音验收。
- 云端确认 `ANDROID / 1.1.8 / versionCode 12`，2026-09-11 05:43:51 UTC 创建；05:45:00 UTC 进入 Gradle 编译。

## 验证边界

云端编译及 APK 静态检查不能替代手机锁屏实测。新包需要覆盖安装后复核最后 5 秒至零秒、结束语音只播放一次、运行通知移除、不弹记录，以及暂停／继续／放弃／重开。不能保证每个 Android 厂商和省电设置下都准点显示。旧 Build 11 及已有部署 ZIP 保持原样，不包含本次原生修复。
