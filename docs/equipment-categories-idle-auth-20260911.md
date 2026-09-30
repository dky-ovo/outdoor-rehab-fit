# 设施分类维护与闲置登录调整

本轮仅修改本地源码，没有部署服务器、发布 OTA 或启动 EAS Build。

## 分类维护

- 新增 `equipment_categories` 表（迁移 22）。保留内建分类编号及器材绑定，旧版自由填写的分类编号采用为历史分类，不删除原有数据。
- 设施教学后台提供可展开的「分类管理 / AI 推荐分类」，可新增及修改中文、英文名称，显示已绑定器材数量；列表每页 20 项，支持搜索和翻页。
- 器材编辑使用同一动态分类清单，多选每页 20 项、至少一个、最多 32 个。新增分类为 `category-UUID`，改名不改编号、素材 URL 或器材内容。
- 只有 `app_maintenance.equipment.manage` 权限可以读取后台分类管理和新增/改名；文件维护或设施位置权限不能修改分类。
- 双语名称必填，归一化后最多 80 字符。拒绝控制字符、尖括号、同名和未知分类引用。新增分类总数上限 200；不提供删除分类接口。
- 改名必须附带打开编辑时的两种原始名称 `expectedNames`。事务内校验基线，其他管理员已修改时返回 409，保留输入并阻止重复保存；刷新并重新打开最新分类后才能重试。此检查不依赖时间戳，避免同一毫秒内的修改互相覆盖。
- 分类管理刷新会另行重新获取完整分类目录同步到器材多选；当前页或搜索结果不会覆盖全量选项，迟到响应不会覆盖新改名或不同账号的数据。
- `alternative` 默认名称为「民間智慧 / Local Tips」，与设施说明中的中医学字段相互独立。原未开放分类锁定状态不变。

## 接口

- `GET /api/equipment-categories`：公开 APP 分类清单。
- `GET /api/equipment-catalog` 和 `GET /api/admin/equipment`：保留原 `items`，新增 `categories` 属性。
- `GET /api/admin/equipment-categories?page=1&pageSize=20&search=`：返回 `categories/total/page/pageSize/totalPages`。
- `POST /api/admin/equipment-categories`：请求 `{nameZh,nameEn}`，返回 `{category}`。
- `PATCH /api/admin/equipment-categories/:id`：请求 `{nameZh,nameEn,expectedNames:{nameZh,nameEn}}`，只允许修改名称，返回 `{category}`；缺基线 400，基线已变化 409 `equipmentCategoryChanged`。
- 分类字段：`id/nameZh/nameEn/isBuiltIn/showInGuide/isLocked/sortOrder`；后台分页另有 `equipmentCount`。

## AI 分类检索边界

后台中英文分类名称由服务器匹配为分类编号，再筛选 APP 内绑定器材；模型同时获得相关编号的双语名称作为参考数据，而不是指令。英文按词边界匹配，避免把 `imbalance` 误当 `Balance`。

新增分类不会自动获得临床适用性。涉及下肢、上肢或腰背的问题仍经过原有身体部位过滤，分类名称不能绕过疼痛澄清、紧急症状限制或器材上下架检查。未增加外部联网回答来源。

## 登录

移除 90 分钟闲置恢复限制与运行中自动退出计时器，保留使用活动记录。保留主动退出、改密码后的退出、账号撤销与服务端 token 安全校验；服务端凭证仍有原有有效期。FAQ 和登录相关说明同步更新。

## 验证

- 后端完整 100 项通过，含真实 116 个图片/GIF 与 57 个教育原件导入、56 个视频 HEAD/Range/完整 SHA、27 个设施 54 条双语绑定以及私有 Word 授权检查；没有跳过项。分类专项含并发保护共 10 项。
- 分类后台、分类合并、Auth 及原媒体集成 42 项前端测试通过；追加冲突处理、完整目录刷新与实际后台联动 3 项通过；两个旧后台集成测试的目录 mock 同步更新并通过。
- 新分类专项涵盖新增、重命名、已有绑定不变、重启不覆盖名称、未知历史分类采用、权限拒绝、规范化同名、分页及双语 AI 匹配。
- 闲置登录回归包括七天前本地会话恢复、运行闲置两小时不退出、无 token 会话仍拒绝、退出与异步保存竞态。
- `app/admin.js`、分类组件及 Auth 的 JSX 语法检查通过。

真机键盘、后台计时和系统通知不属于本子任务的修改与验证范围。
