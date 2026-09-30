# 中英文视频播放统计回归（2026-09-10）

## 修复内容

- 原生内嵌播放器和 Web 播放器在 `waiting`（缓冲）、`seeking`（拖动）、`emptied`（重新加载）时关闭当前实际观看区间；缓冲和拖动等待不再加入 `watchedMs`。
- `seeked` 只有在播放器未暂停、未结束且具备后续数据时恢复播放统计。
- 统一事件钩子只接受真实 `playing` 区间之后的 `ended`。仅加载、错误、切页、后台、错误后的迟到回调均不生成 `video.completed`。
- 失败重试、新视频、切换设备、语言或账号会隔离旧播放器会话，旧回调不能污染新的观看时长或完成状态。
- 详情首次等待后台目录时不挂载可能已被替换的旧 YouTube；取得目录后切语言立即使用缓存目录的对应语言。后台刷新较慢时也不短暂回落旧视频。缺少另一语言不播放错误语言或旧 YouTube。
- 首次目录请求失败时保留既有离线资料回退；已取得后台双语目录的页面不会因刷新失败重新回退旧视频。
- `ManagedContent` 换页面、语言、账号时清空旧页面内容及计时归属，防止慢响应或旧回调记录到新页面。
- 保留现有播放器界面及 `markWatched` 原有语义：开始播放即标记已观看，不改成整片验证。

## 统计含义

- `watchedMs`：每个真实播放区间的观看时间，暂停、缓冲、拖动等待关闭区间。后台可按既有 paused/completed 事件相加。
- `positionMs` / `durationMs`：播放器当前位置和媒体总时长。
- `progressPercent`：当前位置占媒体总时长的比例，**不是去重观看覆盖率**。拖动靠近结尾可能改变位置百分比，不代表观看了前面的内容。
- `video.completed`：此前正在播放且播放器真实触发 ended；既有业务语义不扩展为“逐秒全部观看认证”。
- 不新增定时研究数据上传。内部 `timeupdate` 只保留快照，仍只随既有 play/paused/completed 事件发送 API。

## 验证

`MediaContentIntegration-test.js`、`MediaVideo-test.js`、`contentVideo-test.js`：共 **45 项通过**。

覆盖：

- 中文和英文设施替换数据 → 对应 `MediaVideo` source → 实际生成的原生 HTML 地址 → play/ended → 带位置和时长的 research event。
- 真实生成 HTML 的视频事件监听脚本执行验证；Web 浏览器组件 playing/waiting/seeking/seeked/ended 顺序验证。
- 缓冲与拖动等待排除、错误/初次加载/切页不伪造完成、重试恢复、迟到旧回调隔离。
- 首次目录慢响应、语言切换缓存即时选择、另一语言空白不误播、不回旧 YouTube、迟到旧目录响应不覆盖新选择。
- 后台/导航失焦暂停去重、ManagedContent 页面切换归属。

`server/test/videoProgress.test.js`：**2 项通过**。使用本地 HTTP 服务和内存数据库，确认中英文视频的播放/暂停/完成元数据实际经过 `/api/research/events` 保存且不丢字段。

`npx tsc --noEmit` 通过。

以上是组件事件和本地接口链路验证，不等于所有提供的视频都已在真机完整播放。真实文件编号对应关系、编码可播放性、生产上传和手机解码需由整合流程单独验证；本子任务没有连接生产服务器。
