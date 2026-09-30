# 文件存储与正式教学视频本地验证（2026-09-10）

## 验证范围与结果

全部操作使用独立系统临时目录、`:memory:` SQLite 数据库和 `127.0.0.1` HTTP 服务。未修改原始 Word 或视频，未连接生产数据库，未上传或部署到公网。

- 输入清单：`workspace-artifacts/education-video-seed-20260910/manifest.json`。
- 清单 SHA-256：`8340866AE6E02AD1E6F1EE81A46966D84A9311AA5D8562A63FCCA078F0A7EF39`。
- 57 个原始文件，共 325,170,612 字节。
- 54 个正式教学视频，2 个 `old` 视频归档，1 个 Word 私有附件。
- 全部 57 个文件的源清单 SHA-256、入库元数据、存储字节 SHA-256 和原目录路径逐项一致。
- 全部 56 个视频的 HTTP HEAD 返回 200，文件长度正确；Range 返回 206，前 1,024 字节一致；HTTP 完整下载的 SHA-256 与清单一致。
- Word 公网地址返回 404；匿名后台下载返回 401；仅设施维护权限返回 403；文件维护管理员下载返回 200、附件 Content-Disposition、application/octet-stream，下载哈希一致。
- `createApp` 实际调用 `applyEducationVideoSeed` 后，`app.locals.educationVideoImport` 为 applied，27 个设施/54 个双语视频；数据库中 27 个设施的中文与英文视频字段均非空，video_localized 为 1。
- 清单中缺少的编号 13 和 27 保持原设置。
- 再次初始化同一数据库后返回 already_applied，文件仍 57 个、双语设施仍 27 个，不重复导入或重新覆盖绑定。

本次文件库测试：20 项通过，1 项旧版图片种子环境测试因未设置其独立环境变量而跳过。前端文件库、媒体工具与批量导入专属测试：52 项通过。类型检查通过。

## 已复核的异常链路

- 在上传完成字节传输、等待异步磁盘 rename 期间删除父目录：上传返回 409，不创建数据库记录，并清理本次文件；此前无关上传的文件和字节保持不变。
- 上传最后一次目录检查与媒体记录写入处于 BEGIN IMMEDIATE 事务内；目录删除的后代收集、引用检查与删除也位于同一即时事务，避免多进程读写空隙。
- 批量删除遇到中文或英文视频引用时全部阻止，不能只删除一部分。
- 删除进入回收站、可以恢复，不物理释放磁盘空间；先前独立删除的子文件不会随其他目录恢复而自动恢复。
- 上传取消、过大、格式签名不匹配时不产生可选媒体，不遗留未完成文件。
- 任意 JSON 文件用二进制传输保存；误用 application/json 被全局解析的请求明确拒绝，避免悄悄保存空文件。
- 前端关闭媒体选择器或切换账号后取消上传；旧请求不能回填新账号界面或完成过期选择。
- 前端目录导入先验证整批路径和大小；中途取消会报告已完成数量，保留已完成文件，停止其余上传。

## 实际发现并修复

真实清单的归档标记使用 `archiveOnly`，原导入协议使用 `archived`。导入器现兼容两者，确保两个旧版视频确实归档，不能误选为正式教学视频。此修复未更改原始清单。

## 可复现命令

在项目目录的 PowerShell 中执行：

```powershell
$env:OUTDOOR_EDUCATION_SEED_TEST_DIR = 'D:\polyu work\outdoor-rehab-fit-anesthesia\workspace-artifacts\education-video-seed-20260910'
node --test --experimental-test-isolation=none server/test/mediaLibrary.test.js
```

仅运行真实视频种子集成测试：

```powershell
node --test --experimental-test-isolation=none --test-name-pattern='real education seed' server/test/mediaLibrary.test.js
```

前端专属测试：

```powershell
npx jest --runInBand --watchAll=false --silent --modulePathIgnorePatterns='workspace-artifacts|[\\/]tmp[\\/]|[\\/]deploy[\\/]' --runTestsByPath utils/__tests__/adminMedia-test.js utils/__tests__/adminMediaApi-test.js utils/__tests__/adminMediaBatch-test.js utils/__tests__/pickAdminMedia-test.js components/__tests__/AdminMediaLibrary-test.js
```

## 限制

本报告证明本地存储、权限、传输、目录和设施双语绑定链路，不等同于已上传生产云端，也不取代真机完整播放和观看进度界面测试。现有云端存储为配置的云服务器持久磁盘目录，不是另建的 GCS 桶。
