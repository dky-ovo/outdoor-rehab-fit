# 固定格式 Word 设施教学导入

## 功能范围

后台户外器材维护中的独立组件 `AdminEquipmentImport` 使用现有管理员会话和 `app_maintenance.equipment.manage` 权限。选择 DOCX 只创建预览，不改动设施。所有字段默认不选；管理员核对中英文新旧内容、选定具体设施和字段，再按“核对并导入所选字段”及“确认更新”才保存。

只可更新使用方法、运动学介绍、物理治疗、职业治疗、中医学角度及照顾者提示的中英文文字。图片、左右 GIF、视频、分类、上下架状态、中医栏目启用状态、未选中的文字均不改动。空白及 `/` 不清空旧值，未变化字段不可选择。预览五项一页；导入历史十项一页；历史旧内容五字段一页。

## 固定文档核对

读取但没有修改 `D:/下载/Exercise Machine Code and Content V24.docx`，SHA-256：`AEB4EB8A0942D9C485300B310529507303EC54B60ED63B1D9F867033C65FE340`。

文档有两个编号索引表，不当作教学正文。实际教学正文为九个表格、54 个双语文字字段；其余 20 项器材没有正文，保留后台原样。并非文档索引中的全部 29 项都需要重新导入。

| 文档编号 | APP ID | 映射备注 |
| --- | --- | --- |
| 1 | 0 | 太极揉推器 / 太极推手器为审核过的同义名称 |
| 5a | 4 | 全身伸展运动器（下肢伸展） |
| 5c | 6 | 全身伸展运动器（上背伸展） |
| 7 | 8 | 扭腰机 |
| 9 | 10 | 小腿伸展；不是编号减一 |
| 14 | 16 | 文档“下肢的伸展（膕繩肌伸展）”为既有设施别名 |
| 17 | 19 | 肩关节伸展 |
| 18a | 20 | 文档标题别名，规范编号为 18，上肢伸展器 |
| 21 | 22 | 背部按摩器 |

每项必须同时匹配显式编号与已核对中英名称；后台设施身份若被更名、删除或变成自建项则阻止导入。不存在编号减一推算。重复设施、重复栏目、未知正文、错误或缺失语言列、语言列互换均阻止整批确认。格式要求是编号/中英名称标题及“栏目、Chinese、English”三栏表格。文档修订采用当前可见文本（含插入、不含删除），显示修订警告。

正文是数据，任何正文指令不会执行；医学表述不自动改写、补全或翻译。段落空白规范化，保留中英文字与段落顺序。导入预览显示后台实际文字或 APP 随包回退文字，审计同时保存真实数据库旧值和当时有效展示值。

## 服务合同与完整性

- `createEquipmentDocumentImport({ database, now?, ttlMs? })` 返回 `preview/getPreview/confirm/history/audit`。
- `preview({buffer,fileName,actorId})` 返回 `previewId/confirmationKey/documentSha256/expiresAt/entries/issues/skipped/canConfirm`。预览默认有效 15 分钟，每管理员最多十个有效预览。
- `confirm({previewId,selections:[{id,fields}],idempotencyKey,actorId})` 必须使用该预览的选择；客户端使用预览返回的稳定 `confirmationKey`。实际确认幂等记录存数据库，不依赖进程内存。相同选择重试不重复写入，即使服务重启或预览随后到期也返回原结果；改变已确认选择会拒绝。
- 同一 SQLite immediate transaction 内先验证全部项目，再写全部字段与审计。`updated_at` 及每个字段原值共同检查并发改动；任何冲突或写入失败都回滚整批，不部分覆盖管理员后来修改。
- `history({page,pageSize})` 只接受严格正整数、每页最多 20 条；`audit({previewId})` 返回本次字段级前后值。路由均由 root 集成的器材维护权限保护。
- `EQUIPMENT_DOCUMENT_IMPORT_SCHEMA` 新建独立预览、确认记录表；不更改旧内容迁移版本。
- 成功保存后后台列表刷新失败，会明确提示“已保存，但列表刷新失败”，不提示重新导入。

## 安全与 AI 分界

只允许标准 DOCX，上传最大 12 MiB，总解压最大 40 MiB，正文 XML 最大 4 MiB、300 ZIP 条目、压缩率最多 250。拒绝路径穿越、重复 ZIP 项、软链接、加密 ZIP、宏、嵌入程序、外部实体、动态公式、嵌套教学表格及内容控件。仅在内存中读取两个必要 XML；不解包到磁盘、不访问文档外链、不执行 Word 域。规范内书签超链接可作为普通文本读取。

Word 导入本身无外部 AI 请求。若 root 提供并授权 `onAssistantDocument`，只将当前单项器材中管理员已勾选的非空变更文字传给 AI 草稿组件；不传全篇 V24，不传数据库旧值、审计、用户资料、token。AI 草稿仍是单独的预览/授权流程，不能直接发布器材内容。

客户端请求界限：预览 30 秒；确认及历史读取 20 秒；网络实现忽略 abort 时也能超时退出。确认超时/离线会提醒可能已保存，保留原幂等确认以安全重试。响应先校验结构，错误不回显服务器原始日志。

## 验证

2026-09-21 本地通过：

- 后端 15 项，包含真实 V24、编号映射、UTF-8 BOM、语言列互换、空值保护、ZIP/XXE/动态域、预览只读、字段白名单、幂等重放、跨管理员访问、过期、并发冲突、事务失败回滚、历史分页验证。
- 前端组件及 API 12 项，包含默认全不选、显式两次确认、AI 单器材/选中字段边界、错误预览阻断、超时与离线、同键重试、异步刷新失败、预览分页及切换管理员丢弃旧请求结果。
- TypeScript `--noEmit` 通过。

测试命令：

```powershell
node --test --test-isolation=none server/test/equipmentDocumentImport.test.js
.\node_modules\.bin\jest.cmd --config scripts/jest-app-regression.config.cjs --runInBand components/__tests__/AdminEquipmentImport-test.js utils/__tests__/adminEquipmentImportApi-test.js
.\node_modules\.bin\tsc.cmd --noEmit
```

浏览器文件选择、整页视觉 QA 及权限路由集成由 root 做最终联调；本模块测试不等于已上传生产或已发布 OTA。
