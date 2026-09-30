# AI 完整说明按钮修复（2026-09-17）

## 原因及修复

- 在上一版 Web 导出的 390 × 844 手机尺寸页面实际复现：点击后按钮变为“收起詳細說明”，正文也已展开，但倒序聊天列表将新增段落留在视口上方，用户看起来像没有展开。
- 展开/收起后，等待虚拟列表父级单元记录新高度，再用一帧回调无动画定位至本条回复顶部。不能只监听内部正文的高度，否则父级仍可能使用旧尺寸，收起时会偏移。
- 使用稳定的 `AssistantMessageCell` 单元组件，保留倒序样式、焦点处理和子节点；先调用列表原来的 `onLayout`，再通知定位逻辑，不因展开而重建整行。
- 仅显式点击触发一次定位，不增加自动滚动动画或循环重试。用当前消息 ID 查找最新索引，避免新消息到达时定位至另一条回复。
- 拖动/网页触摸滚轮、离开页面、切换账号/语言、发送消息、视口变化和卸载会取消待执行定位。目标已删除或未能测量时安静退出，不循环跳动。
- 推荐筛选、原始正文、中医说明、设施跳转、已保存历史和 API 上下文均不修改；没有后端或原生依赖变更。

本记录取代 `ai-compact-replies-20260917.md` 中“展开和收起不自动滚动”的描述：本次增加的是用户点击后的单次、无动画定位，普通浏览历史仍不强制回到底部。

## 验证

- 使用 computer-use 技能在本地隔离测试站点实际复现并验证，没有连接生产账号或数据。
- 最终三平台导出中的 Web 版本：390 × 844 视口，点击“查看完整說明”→全文顶部出现在安全提示下方；被折叠的专业说明恢复可见；点击收起、再次展开位置均正确。
- 自动化测试包含 Android/iOS/Web 模拟平台的展开/收起、历史消息、快速切换、新消息插入、删除、手势取消、页面与身份切换、父级测量先后顺序及不重建单元。
- 完整前端回归：92 套、1,328 项测试和 1 项快照通过。
- TypeScript 检查通过。
- Android、iOS、Web 本地导出通过：`workspace-artifacts/ai-expand-button-fix-20260917/export-final`。
  - Android：`entry-bdb76f07adbf324a451a4326ee359055.hbc`
  - iOS：`entry-c8e0bd43288785f9a7614f26027282ae.hbc`
  - Web：`entry-fdc21293dd869cd17a11de81b82bc955.js`
- 修改文件的 `git diff --check` 通过。
- 原生 Android/iOS 真机未实际点击验证，不能以浏览器或模拟平台组件测试替代真机检查。

回归命令（已有配置会排除部署包与临时工作副本）：

```powershell
& .\node_modules\.bin\jest.cmd --config scripts/jest-app-regression.config.cjs --runInBand --watchAll=false
```

直接运行不带配置的 Jest 会错误索引现有临时目录内的 package.json（重名包、BOM JSON），因此使用项目现有专用回归配置；没有删除或修改这些临时文件。

## 发布状态

仅本地完成修改与验证，没有上传服务器、发布 OTA 或重新 Build。兼容安装包可通过前端 OTA 获取本次修复，不需要后端更新包。

在电脑 Windows PowerShell 执行 Android preview OTA：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"

$otaOutput = "workspace-artifacts/android-ai-expand-fix-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "修复AI完整说明展开定位" -InputDir $otaOutput
```

该脚本临时切换 Android Expo 项目配置，结束时恢复原配置。不要替换成默认 iOS 项目上的裸 Android update 命令。
