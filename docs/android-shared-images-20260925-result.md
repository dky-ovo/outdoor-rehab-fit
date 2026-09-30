# 收藏与设施教学共用图片显示：Android v6

用户确认已发布 v5 并重开 App，但收藏列表及详情仍有加载过程。本轮进一步统一图片显示，而不是重复把收藏记录搬到手机：收藏记录原本就按账号保存在本地。

代码核对发现，收藏与教学器材列表已经共用持久文件缓存，但教学详情使用 React Native Image，列表使用 Expo Image，两者解码缓存不同。Android React Native 对 `file://` 图片也默认淡入约 300 毫秒；设施教学分类首页的 `require()` 图标则是内置资源，不能将两者的显示速度直接等同。本轮没有真机性能记录，因此这些代码差异不能证明用户看到的全部延迟都来自同一个原因。

已修改：

- 收藏、教学列表、详情主图、示范 GIF、放大图和推荐图片统一使用 `EquipmentImage`，关闭淡入，保留各页面原本的裁切/适应方式。
- 在后台从已经验证的手机本地文件预处理主图，收藏卡片和详情复用同一个原生图片引用，减少点入时重新读文件和解码。不会为此重复向服务器下载图片。
- 优先处理当前显示的主图，其次收藏主图。预处理缓存最多保留 12 张、按像素估算 32 MiB，解码尺寸不超过 1024 × 1024。该预算不是整个 App 的内存上限，也不包含仍被界面持有的引用与原生解码临时内存。仅在 Android 启用该预处理预算，不批量预解码 GIF 或视频。
- 持久图片下载部分失败后，在前台最多追加两次重试，分别等待 5 秒和 20 秒；后台、登出或卸载组件会取消旧重试。
- 图片 URL 或文件变更时不会套用旧图片引用；显示中的原生引用不会被缓存淘汰逻辑提前释放。父页面重绘也不会让同一个失败 URL 无限制重新请求。

预处理使用 [Expo SDK 54 的 ImageRef / loadAsync 接口](https://docs.expo.dev/versions/v54.0.0/sdk/image/#loadasyncsource-options)。已核对 Build 17 APK 中 ExpoImage 模块的实际注册和 `loadAsync` 能力，不需要为此安装新的 APK。

## 发布命令

在电脑的 **Windows PowerShell** 执行，不是在 ECS：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\android-build17-shared-images-ota.ps1" -Action Publish
```

固定发布 Android 1.2.3 / Build 17、runtime `1.2.3`、`preview` 通道，使用已导出的 v6 产物，服务器地址保持阿里 API。不会发布 iOS 或修改数据库；本次未替用户执行 Publish。

更新仍需手机联网接收并重新打开。首次图片下载、刚更换的图片、冷启动尚未完成准备、空间不足或系统回收内存时仍可能有准备时间；不能承诺所有情形都零延迟。本次没有连接用户手机做真机测速。

## 验证

相关页面、收藏与详情共用原生图片引用、过期回调、图片替换、文件缓存、内存预算、下载重试和账号切换的自动检查已通过。新共享图片组件有单独回归，既有聊天/教学测试按新的图片组件更新了原生模拟和选择器。相关 24 个套件共 385 项检查已通过（失败的旧组件模拟/选择器已更新，并单独复跑通过）；其中原生内存缓存 17 项、后台同步 25 项。这里不将模拟测试等同于 Android 真机测速。

Android v6 已实际导出，独立 Verify 通过；共 241 个文件、167,466,185 字节，目录为 `workspace-artifacts/android-build17-shared-images-20260925-v6/export/`。其中包含既有可复用资源，不等同于每台手机实际更新下载量。

`release-manifest.json` SHA256：`d4f83dbcf739e4b0062f3dae11c7864d938b3e9327fae41a577891a7fa0d5123`。清单绑定 Android 项目、阿里 API、源码、工具与导出文件；Publish 会再次核验。原 `app.json` 已按字节恢复，临时备份不存在。此次未执行上传或发布。
