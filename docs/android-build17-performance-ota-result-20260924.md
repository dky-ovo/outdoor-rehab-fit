# Android Build 17 Performance v2 交付记录

日期：2026-09-24。已完成本地修改、验证、Android 导出和清单复核；尚未上传或发布 OTA，尚未在用户手机验证。

## 本轮内容

- 联络页回退和手势使用“关于此程序”的处理方式，撤除上一轮 Contact 特有的 `dismissTo`、键盘优先返回和禁用手势配置；保留页面失焦后的定时任务清理。
- 成功恢复登录后，跳过紧接着的一次重复账号校验。初次服务端校验、前台/定时复查及账号删除防护保留。
- 收藏卡片使用现有 `expo-image` 的内存/磁盘缓存、本地占位和按显示尺寸降采样；图片失败后下一次进入重试，条目或 URL 改变时重置图片状态。

本轮未修改后端、RDS 数据或媒体文件，未生成缩略图，未变更 RDS 自动启停设置。

## 验证

| 范围 | 结果 |
| --- | --- |
| 联络页、导航与既有设置页回归 | 4 套、72 项通过 |
| 账号启动校验、删除账号和会话竞态 | 3 套、50 项通过 |
| 收藏图片、收藏操作和场地流程 | 3 套、20 项通过 |
| 发布脚本语法、清单逻辑与独立审核 | 通过 |
| Android Hermes 导出及独立 Verify | 通过 |
| Build 17 原生兼容 | APK DEX 已包含 `Lexpo/modules/image/ExpoImageModule;`，无需因本轮组件新增原生依赖 |
| `app.json` 恢复 | 原始字节 SHA256 一致，临时备份已清理 |

总计 142 项相关测试通过。测试不能代替 Android 真机过渡动画和网络性能测量。

## 已导出产物

- 目录：`workspace-artifacts/android-build17-performance-20260924-v2/export`
- Android bundle：`_expo/static/js/android/entry-4c8e0495d0867411d74a3440f3cf001a.hbc`
- 导出文件：243 个，共 167,635,980 字节。这个数字包含完整导出素材，不是手机本次实际增量下载量。
- 清单：`workspace-artifacts/android-build17-performance-20260924-v2/release-manifest.json`
- 清单 SHA256：`93c4183af6133aee0e2d9d9025b6c3a78167f1f5f478b7a25e2123d44c3cd570`
- 原始配置 SHA256：`d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe`

目标为 Android 1.2.3 / Build 17、runtime `1.2.3`、`preview` 通道，项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`。产物包含阿里 API 地址 `https://api.outdoorfit.hk/api`。旧 v1 工具和产物保留，不用于发布本次修复。

## 发布命令

在本地 Windows PowerShell 执行，不能在 ECS 的 Bash 终端执行：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\android-build17-performance-ota.ps1" -Action Publish
```

命令先验证已导出的文件及对应源码，再上传这份 Android 产物，不重新打包，不发布 iOS。需要本机 EAS 登录状态；发布成功后以工具返回的结果为准，打开手机应用下载更新并按提示重新启动。

本地导出不等于发布成功；本记录没有 EAS 更新 ID。发布前不要修改清单绑定的客户端源码、配置、发布工具或流程说明，否则脚本会拒绝使用旧导出。

## 仍需处理

- 用户在 RDS 控制台关闭自动启停，并查看启停记录；已有数据库健康检查可能使实例始终活跃，不能只凭开关归因。
- 验证更新后的 Android 联络页进入和返回，尤其键盘打开时的情况。
- 比较首次及再次启动、收藏页第一次和缓存后的图片显示。本轮没有取得线上时延或真实手机帧率。
- 后续按 `docs/storage-performance-plan-20260924.md` 分阶段处理缩略图、接口读取与头像/聊天图片迁移。
