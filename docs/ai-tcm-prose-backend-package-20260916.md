# 中医解释移入正文：后端包交付（2026-09-16）

## 产物

- 路径：`deploy/2026-09-16/outdoor-fit-ai-tcm-prose-backend-20260916-update.zip`
- 大小：84,306字节，82.33KiB。
- SHA-256：`47FEC604B5EA1421EFB8957537EF27F6F02FDD66369C8AA0EB80578B018BC938`。
- 安装器：`install-ai-tcm-prose-20260916.sh`。
- 校验器：`verify-ai-tcm-prose-backend-patch.cjs`，清单版本3。
- 用法：`deploy/2026-09-16/README-ai-tcm-prose-backend-20260916.md`。

旧版中医卡片ZIP未覆盖，哈希仍为 `65A4567772D270EC3AEAADC84EB4C9B492EE1DB41AE6FBEB0790F7AF8BA892F9`。

## 内容及保护

固定10个平铺归档成员、9项内部校验和、5个后端源码目标。相对于上一中医卡片版本，仅app.js、assistantSymptomEvidence.js、assistantTcm.js发生变化；assistant.js和equipmentGuideEvidence.json为兼容旧基线随包携带、未改动。其余源码、package.json、package-lock.json均一致。

支持完整Sep11（19文件）、Sep14（21文件）、旧Sep16卡片版（22文件），以及本次已安装状态。拒绝未知、混合、预暂存或额外源码状态；不会绕过安装前基线核对。

安装器只短暂停止API并更新5个源文件。备份保留旧源码及权限，安装文件为0644且沿用app.js拥有者；失败仅恢复源码。不覆盖数据库、账号、人员权限、配置、密钥、媒体、上传、Web、Nginx或依赖。沿用共同部署锁和内存预检。

## 验证

- 后端：151通过，2项既有完整媒体种子测试跳过，0失败。
- 新校验器52项与旧中医校验器35项，共87项通过。
- 使用真实Sep11源文件及Sep14、旧Sep16归档重建三个旧版，分别先验证旧态再只覆盖包中5文件，全部识别为新态。
- 三套升级后的隔离API共45次HTTP请求通过；覆盖中英症状检索、原名及PT/TCM原文位于正文、英文缺失、关闭中医、伪造客户端和连续追问。内存数据库、独立scratch、本机临时端口；外部AI调用0次。
- PowerShell AST、Bash -n、Node --check通过。Bash普通沙箱无法建立信号管道，经授权仅运行本地语法检查通过；没有实际运行安装脚本。
- 最终ZIP重新解压验证10成员、9校验和、清单、完整新态及当前测试源码哈希一致。
- 最终解包验证目录：`workspace-artifacts/ai-tcm-prose-final-zip-a5e1fa88a4014661944f6ad2884a30ae`。
- 三基线验证目录：`workspace-artifacts/ai-tcm-prose-upgrade-29b5fefab8734e678869ddaef72b8ce9`。
- 独立只读审查未发现安装器、打包器阻塞问题。本地测试不代表生产安装完成。

## 发布状态

仅生成本地部署包和指令；未上传GCS、未SSH部署、未发布OTA、未创建EAS Build。后台地址不变。

Android OTA仍使用 `scripts/publish-android-preview-update.ps1`，目标dky2004项目、preview通道、runtime1.1.8。通过新时间戳InputDir重新导出，不传skip-bundler，不上传旧导出。当前app.json未改动，哈希仍为 `1408078AF6E7EE9BBC8CF3036E0C99520401731A08D27FDFFB39BE3CAB53157C`。

必须同时部署后端与发布兼容手机OTA，手机才会在正文展示中医解释且不再在旧卡片中重复。
