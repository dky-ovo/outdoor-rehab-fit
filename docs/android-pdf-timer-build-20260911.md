# Android PDF 与计时修复构建（2026-09-11）

用户要求：「帮我 build 并给我安装包」。沿用现有 Android preview APK 工作流；本轮不构建 iOS、不提交应用商店、不发布 OTA、不部署后台。

## 构建目标

- 项目：`dky2004 / outdoor-rehab-fit`（`bcee8c37-e833-4f4d-b660-aa457accd96d`）。
- 包名：`com.maxcch.c.outdoorrehabfit`。
- 版本/runtime：`1.1.7`；远端 versionCode 已从 10 增加到 11。
- 配置/频道：`preview`，内部 APK，沿用现有 `gdWYb5HJat` 签名配置。
- 通过 `scripts/build-android-preview.ps1` 单次提交，使用 `-NoWait -NonInteractive`，冻结既有凭据，不尝试安装到模拟器。
- 上传归档约 334 MB；`.easignore` 排除服务器、数据库、部署包和本地临时资料，保留原生计时模块、裁剪插件及四个粤语/英文 WAV。
- 构建前 `app.json` SHA-256：`1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。

## 云端构建

- ID：`a5e8d210-feec-443f-97f7-34d10d61a229`。
- [构建详情](https://expo.dev/accounts/dky2004/projects/outdoor-rehab-fit/builds/a5e8d210-feec-443f-97f7-34d10d61a229)。
- 源码已上传，指纹计算成功；仅提交一次构建，没有重复提交。
- 2026-09-11 02:38:43（香港时间）云端开始执行，此前排队约 63 分钟。
- 02:39:12：Expo Doctor 18/18 通过；云端读取配置确认为 1.1.7 / dky2004 / preview，包含四段粤语及英文 WAV、头像裁剪插件与原生计时模块，随后进入 PREBUILD。
- 上传后现有脚本已恢复原 `maxcch.c` iOS 项目配置；哈希与构建前一致，没有遗留 Android build/update 备份文件。

## 最终云端结果：FINISHED

- 完成时间：2026-09-10 18:51:03.831 UTC（香港 2026-09-11 02:51:03）。
- Gradle 于 18:50:54 UTC 报告 `BUILD SUCCESSFUL in 11m 6s`。
- `:session-timer-notification:compileReleaseKotlin`、`:app:compileReleaseKotlin`、签名检查及 `:app:packageRelease` 均完成；18:51:03 APK 上传及构建结束流程完成。
- [APK 下载](https://expo.dev/artifacts/eas/vIKSOWDrMfDlbrRDCRSvdoI7PUrBaQJkADjzz9fRzrk.apk)。这是 Build 11 新产物，不是 Build 10 链接。
- 本地安装包：`deploy/2026-09-11/outdoor-fit-android-1.1.7-build11.apk`，205,513,184 字节（195.99 MiB）。
- SHA-256：`C89321BFBC18234547801A91F14511BE41E3F8724FB28E1A43342B3377516696`；同目录保存 `.apk.sha256` 校验文件。
- 使用 `scripts/verify-android-preview-apk.py` 对最终 APK 核验通过：1,895 个 ZIP 条目 CRC 正常；四段粤语/英文半程及结束语音的原生资源字节与源码逐一一致；存在计时原生模块 DEX 描述符及通知布局资源名称。
- 静态校验不解析二进制 Manifest、资源 ID 映射或 APK 签名，也不代表已通过真机执行测试；版本及既有签名配置依据 EAS 构建结果。校验后 `app.json` 哈希仍与构建前相同。

## 包含内容与验证边界

包含本轮 PDF 修改、只保留倒计时新入口、移除每次启动权限提示、修正媒体语音被通知/铃声条件错误拦截、AI 照片发送确认、头像裁剪对比度和双语分类同步。完整源码验证记录见 [PDF 修改与计时可靠性检查](pdf-app-timer-20260911.md)。

构建前回归：828 项前端、100 项后端、66 项资源/部署/插件测试，以及类型检查和三端导出通过。

云端原生编译与 APK 静态核验不能替代真机声音测试。安装后应分别在中文和英文、前台/后台/锁屏状态验证半程及结束；媒体音量零、勿扰、通话和厂商省电限制仍可能影响播放。请优先覆盖安装，不要卸载旧 APP，以免丢失仅存本地的运动数据。

后台/Web 部署包仍为 `deploy/2026-09-11/outdoor-fit-pdf-app-timer-20260911-update.zip`；本轮不会自动安装到服务器。
