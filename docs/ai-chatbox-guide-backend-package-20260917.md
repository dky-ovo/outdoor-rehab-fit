# Chatbox 发送恢复与只读检索：更新包交付（2026-09-17）

## 产物

- ZIP：`deploy/2026-09-17/outdoor-fit-ai-chatbox-guide-backend-20260917-update.zip`。
- 大小：106244 字节，103.75 KiB。
- SHA-256：`2DA2EA429534319C9D6C1A516C65291D09591274FC0F6540E0233EAA5E1A4C65`。
- 安装器：`install-ai-chatbox-guide-20260917.sh`。
- 校验器：`verify-ai-chatbox-guide-backend-patch.cjs`，清单版本 4。
- 操作说明：`deploy/2026-09-17/README-ai-chatbox-guide-backend-20260917.md`，含 Windows 上传、服务器安装、安卓及 iOS OTA 命令。

这是后端增量包，不是 APK／IPA，也不包含视频或后台 Web 导出。

## 更新范围与安全

固定 11 个平铺归档成员、10 项内部校验和、6 个后端源码目标。相对于上一中医正文版本，变更为 `app.js`、新增的 `assistantGuide.js` 和包含完整使用说明的 `equipmentGuideEvidence.json`；另外三个助手辅助源码按原样携带，支持从较早批准版本升级。

支持完整 Sep11（19 文件）、Sep14（21 文件）、Sep16 中医卡片版（22 文件）、Sep16 中医正文版（22 文件），以及本次完整安装状态（23 文件）。拒绝不明、混合、预先加入部分新文件或额外源码的状态。

保留既有数据库、账号、用户权限、API Key、配置、媒体、上传文件、Nginx 和依赖；只短暂停止 API 并更新六个源码路径。备份旧代码及权限，失败时只恢复源码，新加入且原先不存在的文件移入诊断目录保留。未覆盖任何旧版发布包。

## 实际验证

- 前端与发布校验完整回归：96 个套件、1520 项测试、1 个快照全部通过，其中新增发布包测试 81 项。
- 后端功能回归：186 项通过、2 项原有外部媒体种子测试跳过，0 失败。
- 四套真实旧基线分别完成旧版哈希识别、六文件升级、完整新态识别和隔离预检。每套 37 次 HTTP 请求，共 148 次；指南请求合计 88 次、模拟 AI 调用 116 次、外部 AI 调用 0 次，全部内存数据库。
- 四基线报告：`workspace-artifacts/ai-chatbox-guide-upgrades-18e8a9301b3a4c8abe3dd0396bec3350/upgrade-results.json`。
- 最终 ZIP 重新解压，验证 11 个成员、10 项校验、清单及当前测试源码一致；再通过 37 次隔离 HTTP 预检，外部 AI 调用 0 次。
- 最终解包验证目录：`workspace-artifacts/ai-chatbox-guide-final-zip-bd13d9f9c330424e900340c68dcd8d29`。
- PowerShell 解析、Bash `-n`、Node 检查通过；原任务类型检查及 Android、iOS、Web 导出通过。没有执行生产 systemd 安装流程。

## 发布状态

已生成本地更新包，尚未上传 GCS、SSH 部署、发布 OTA 或创建 Build。未调用真实 DeepSeek 做联调，仍需上线后真机复测。

手机发送问题恢复需要 OTA，新的服务器教学检索需要安装本次后端包；只做其中一项不会完成整个更新。安卓沿用项目切换脚本发布 preview，iOS 使用恢复后的原项目 production，两个发布命令不要同时执行。`app.config.js` 将当前 appVersion 转为 1.1.8，只有匹配 runtime 的客户端可接收相应 OTA。

本次打包没有改动 `app.json`，SHA-256 仍为 `1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。

用户要求以后直接交付更新文件和命令，已记入 `docs/release-delivery-preferences.md`；这不代表自动授权生产发布。
