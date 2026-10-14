# Android Build 17：App Suggestions v12

本次修改包括时段记录、设施收藏排序、每周数据、AI 输入框与 FAQ、追加影片及教学栏目。服务端功能需要配套 v12 API。此文档为导出/发布操作说明，未封存或未执行发布时不代表交付完成。

固定目标：Expo owner `dky2004`，project `bcee8c37-e833-4f4d-b660-aa457accd96d`，Android package `com.maxcch.c.outdoorrehabfit`，runtime `1.2.3`，已安装 Build 17，`preview` 通道，API `https://api.outdoorfit.hk/api`。

代码与测试稳定后，在 Windows PowerShell 项目根目录首次导出：

```powershell
& .\scripts\android-build17-app-suggestions-v12-ota.ps1 -Action Export
```

导出写入独立目录 `workspace-artifacts/android-build17-app-suggestions-20261002-v12/export`。脚本拒绝复用已有目录；临时切换 Android 的 Expo 配置，完成或失败后恢复原始 `app.json` 字节和环境。此过程会临时修改配置，不能与网页导出或其他配置任务并行。

封存后可校验：

```powershell
& .\scripts\android-build17-app-suggestions-v12-ota.ps1 -Action Verify
```

只有在 v12 后端及网页已安装，且操作者已授权实际发布时执行：

```powershell
& .\scripts\android-build17-app-suggestions-v12-ota.ps1 -Action Publish
```

发布前核对源码、工具、公开 FAQ 知识、原配置及全部导出字节；发布使用已封存输入并跳过重新打包，仅面向 Android。`OTA_ANDROID_PREVIEW_PUBLISHED=YES` 才表示发布成功。历史 v9/v10/v11 交付不修改、不覆盖。
