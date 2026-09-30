# AI 中医原文补充后端包交付（2026-09-16）

## 产物

- ZIP：`deploy/2026-09-16/outdoor-fit-ai-tcm-backend-20260916-update.zip`
- 大小：81,706 字节（79.79 KiB）
- SHA-256：`65A4567772D270EC3AEAADC84EB4C9B492EE1DB41AE6FBEB0790F7AF8BA892F9`
- 安装器：`install-ai-tcm-excerpts-20260916.sh`
- 校验器：`verify-ai-tcm-backend-patch.cjs`
- 不覆盖 9 月 14 日旧 ZIP；旧包 SHA-256 仍为 `23BF32F928B6ECDB217E1193036D05C6E26423569C7FCDF67E09A6D0248DA59B`。

## 范围

只有 5 个后端源码目标：app.js、assistant.js、assistantSymptomEvidence.js、assistantTcm.js、equipmentGuideEvidence.json，均位于 API 的 src 目录。ZIP 另含安装器、校验器、版本清单、校验和及 README，共 10 个平铺文件。

相对 9 月 11 日基线：修改 app.js/assistant.js，新增症状模块、中医模块和专业资料快照。相对 9 月 14 日基线：修改 app.js/症状模块，新增中医模块；其余两个文件保持相同。其他后端源码、依赖、package.json、package-lock.json 均与已审核基线一致。

不包含或覆盖数据库、.env、真实密钥、账号、权限数据、视频、上传文件、媒体种子、node_modules、Web 导出、APK、IPA。未上传存储桶、未连接服务器、未发布 OTA、未创建 EAS Build。

## 本次验证

- 重新运行后端测试：147 通过，2 项既有完整媒体种子测试跳过，0 失败。
- 新校验器 35 项测试、旧校验器 24 项回归，共 59 项通过。包括完整双基线和已安装状态、混合/未知/预暂存拒绝、篡改、缺失/多余文件、路径越界、符号链接、文件超限及清单结构检查。
- 真实 Sep11 源码重建：旧态识别成功，只覆盖 ZIP 对应 5 文件后新态识别成功，14 个 HTTP 请求通过。
- 真实 Sep14 基线由 Sep11 源码加 Sep14 ZIP 四文件重建：旧态识别成功，只覆盖本包 5 文件后新态识别成功，14 个 HTTP 请求通过。
- 共 28 次隔离接口请求，使用内存数据库、本机随机端口、独立 scratch；外部 AI 调用 0 次，没有生产账号或数据库修改。
- 覆盖中英文膝痛、肩周炎/五十肩识别路径、frozen shoulder、直接中医问答、缺少英文、关闭开关、伪造客户端以及连续追问。膝痛不会补入石春路。
- 原文快照核对：29 个设施、2 种语言匹配。前后端中医模块及症状模块分别逐字一致。
- PowerShell AST 解析、Bash `-n`、Node 语法检查通过。Git Bash 在普通沙箱无法创建信号管道，随后经本地语法检查授权成功；未执行安装器。
- 最终 ZIP 重新解压后验证固定 10 成员、内部 9 项校验和、manifest 与现有后端完整新态均通过。最终包不是只对打包前源目录检查。
- 安装器与校验器经独立只读审查，无阻塞项。未实际运行 Linux/systemd 安装流程；本地验证不等于生产部署成功。

## 安装保护

安装到固定 API 路径 `/home/dukaiyu2004/outdoor-fit-api`，使用现有 `outdoor-fit-api` 服务及共同部署锁。只接受完整 Sep11、完整 Sep14 或完整本包源代码状态。停服前进行包、路径、基线、服务运行配置和内存接口预检；停服后再次验证基线、备份与停止 PID，再原子替换源文件并启动服务。

备份目录为 `/home/dukaiyu2004/outdoor-fit-backups/ai-tcm-excerpts-20260916-*`，诊断目录为 `/home/dukaiyu2004/.outdoor-fit-deploy/ai-tcm-excerpts-20260916.*`。出错时只恢复源文件，不回滚/删除数据库和业务文件。恢复不能确认完成时不重启半恢复代码，提示人工检查。不执行 npm、系统升级、Nginx 配置变更或清理命令。

后台地址不变。手机需另行发布兼容本次前端的 OTA，才能显示新增的中医卡片栏目；单独部署后端不会自动更新手机。
