# Android Build 17 客户端修复交付记录

用户确认正在使用 Android 1.2.3 / Build 17，并补充“联络我们”进入或返回时闪白、跳动，设置其他页面正常。阿里服务器 v2 此前已经由用户执行安装器成功切换；本轮仅准备安卓客户端更新。

## 修改与证据

- 保留并交付前一轮收藏优化：本地收藏先显示，目录与学习记录独立补充，目录请求超时与缓存、账号隔离、取消收藏写入顺序保护。
- “关于此程序”显示程序介绍，“关于我们”包含用户 Word 文档的中英文四组团队资料；前一轮已逐项核对。
- Contact 页标题返回、成功回执返回、Android 硬件返回统一弹回已有设置页，避免 replace 重复生成设置路由。硬件返回在键盘可见时先收起键盘；离开时清除延迟输入滚动，失焦后拒绝滚动回调。
- 保留其他设置页、父标题栏显隐、原有键盘留白及 tabBarHideOnKeyboard 配置，没有为推测原因改动全局动画或原生依赖。
- Android 本次导出进程指定 `EXPO_PUBLIC_API_BASE_URL=https://api.outdoorfit.hk/api`；编译后 Hermes 启动包中已检查该完整地址。默认 iOS 项目及源代码中的兼容回退地址未变；旧 Google 代理仍供未更新客户端使用。

定向回归 `ContactUs-test.js`、`ContactNavigation-test.js`、`IosReturnStackNavigation-test.js`、`PrivacyPolicy-test.js` 共 4 套 / 69 项通过；包括使用当前 StackRouter 验证连续四轮进退不重复设置页、深链返回及失焦滚动保护。前一轮收藏 44 项、关于页面 21 项已通过。本轮未进行 Android 真机视觉验证，不能将测试通过等同于已复现并消除所有进入闪白；用户更新后仍需核对进入、标题返回、系统返回及键盘开关。

## 已生成产物

- 路径：`workspace-artifacts/android-build17-aliyun-fixes-20260924-v1/export`
- 243 文件，167,615,315 bytes；这是包含资源的完整离线导出大小，不等于手机实际增量下载量。
- Hermes 入口：`_expo/static/js/android/entry-215a4a93c33d2509e253b54032d70a5c.hbc`
- 清单：`workspace-artifacts/android-build17-aliyun-fixes-20260924-v1/release-manifest.json`
- 清单 SHA256：`e9b81bbe40480cb0df0e5e8c421b55f49ef1e3e26ca594a88007dd6d02974f04`
- 本地 Export 与独立 Verify 均为 `OTA_MANIFEST=PASS`；客户端源码、发布脚本、配置及全部导出文件已绑定哈希。
- 原 `app.json` SHA256 在导出前后相同：`D2AC8FCA2075FCE08A9F79AB3E7163A5EB2B84BB8BE521638DBB1197C5D4B1FE`；临时备份已正常清理。离线构建为启动 Metro/Hermes 子进程经自动审批允许，未执行网络发布。

## 发布边界

固定 Android 项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`、包名 `com.maxcch.c.outdoorrehabfit`、preview 频道、runtime `1.2.3`。沿用已安装 Build 17，不需要本次重新构建 APK。发布入口为 `scripts/android-build17-ota.ps1 -Action Publish`；固定 `eas-cli@24.7.0`，使用完整校验后的 `--input-dir` 与 `--skip-bundler`，不重新导出、不发布 iOS。

按项目交付偏好，已准备实际导出及可执行发布命令；截至本记录尚未上传、发布 OTA 或启动 EAS Build。不可把阿里服务器 v2 的上线成功当成安卓手机已收到本次更新。冻结的 `docs/android-build17-aliyun-ota.md` 和两个发布脚本为清单绑定文件，不要修改后直接发布；本记录作为未绑定的结果补充。
