# MySQL 移植执行计划

依据：2026-09-24 的 `server/src` 和 `server/test`；源库结构见 `aliyun-source-schema-audit.json`，聚合列画像见 `aliyun-source-column-profile.json`。本文只安排应用移植，不修改 RDS、源库或运行配置。列宽、索引和排序规则由独立建表方案定义。

## 实施结论

可以渐进适配并保留 SQLite 测试和旧部署，但不能只把驱动替换成 mysql2。当前 17 个源文件直接使用同步数据库接口；异步要传播到 HTTP 中间件、业务服务、AI 数据回调、启动任务和管理 CLI。每个进程只选一个后端，保留 SQLite 默认值；MySQL 请求链未完成时不启用该部署模式，不双写、不在 MySQL 失败后回落 SQLite。

保留 `database.js:createDatabase()` 作为 SQLite 建库与旧迁移入口。新建异步 bootstrap，根据后端选择连接和 repository，等待必要初始化完成后再 `listen()`。不要用同步 worker 桥模拟网络数据库的 `prepare().get()`。

## 模块边界

| 层 | 建议职责 | 保持方式 |
| --- | --- | --- |
| MySQL 配置与连接模块 | 配置校验、CA 读取、池、参数绑定、事务连接生命周期、关闭 | 第一批独立新增；暂不接入旧 app，不触发建表或种子 |
| 显式建表/迁移入口 | MySQL DDL、迁移版本、导入前后核验 | 不执行 SQLite 的 23 次迁移 SQL；生产启动不自动重建或重播导入 |
| 业务 repository | identity/registration、catalog、activity/feedback、chat、media/import、research/facilities | SQL 和完整事务位于后端实现；共享校验、序列化及纯合并函数 |
| 路由与服务 | await repository、权限校验、调用外部服务、生成响应 | 同一路由支持两后端，不复制整份 Express app |
| bootstrap/任务/CLI | 初始化、启动、停止、定时任务、授予管理员 | 显式等待完成，统一选择后端 |

调用方统一 `await repository.operation()`。SQLite 方法可返回普通值，并在内部继续同步 `database.transaction(fn).immediate()`；MySQL 方法返回 Promise，并在一个专用连接上完成同一业务操作。不要把 async 回调交给 better-sqlite3 事务，也不要在共享 SQLite 连接手工 BEGIN 后跨 await 执行无关工作。

## 第一批：独立连接模块可先交付

在不改变现有 `createApp({ database })` 和 SQLite 配置的情况下实现并验证下列契约：

- MySQL 模式才要求主机、库名、用户名、密码和 CA；CA 读成内容，不把文件路径当证书。密码、连接 URL、SQL 参数不输出日志。
- 初始池建议 `connectionLimit=4`、`queueLimit=32`、`waitForConnections=true`、`connectTimeout=10000`、`multipleStatements=false`；适合先在 2 核 4 GB ECS 上演练，再以实测调节。
- 锁定 mysql2 版本并核对 TLS 实现，使用真实 RDS DNS 作为 `host`；显式启用 `ssl.ca`、`rejectUnauthorized:true`、`verifyIdentity:true`、`minVersion:'TLSv1.2'`。不要依赖默认的 hostname 校验，也不要只传驱动可能忽略的 `ssl.servername`。该驱动由 `host` 生成 SNI/servername。
- 普通查询使用参数绑定；事务回调仅接收绑定到专用连接的 executor。动态表/列/排序标识必须白名单，IN 列表展开占位符。
- `withTransaction`：获取连接 → begin → await 操作 → commit；失败 rollback，最终 release。回滚失败或连接失效则销毁连接，并保留原始业务错误。事务内不得偷偷使用 pool 查询。
- 明确返回契约：行数组、单行不存在、写入计数、重复键错误、时间/JSON/BIGINT 解码。不要把 MySQL `affectedRows` 直接命名为 SQLite `changes`。
- `close()` 等待池关闭；无自动重试整段业务操作。邮件、文件、AI 等副作用不能随死锁重试再次执行。

先用注入连接的测试验证 begin/commit/rollback/release/失败分支及配置拒绝条件。真正 TLS 成功、错误 CA/错误主机名被拒绝、连接会话属性及并发事务仍需独立 MySQL 实例验证；mock 不能证明 TLS 正确。mysql2 参考：[连接实现](https://github.com/sidorares/node-mysql2/blob/master/lib/base/connection.js)、[连接类型](https://github.com/sidorares/node-mysql2/blob/master/typings/mysql/lib/Connection.d.ts)。实施时以锁定版本为准。

## 必须贯通的 async 调用链

| 入口/证据 | 实施要求 |
| --- | --- |
| `app.js:197` authenticatedUser；`:585` 用户状态中间件；`:1646` 管理员中间件 | 先适配鉴权、last_seen_at、权限读取与日志；确认 Promise 不被当成用户对象，所有响应前写入均已完成 |
| `app.js:372` writeSystemLog；各模块注入的 writeSystemLog | 审计若属于原子业务操作，使用同一个事务上下文；必须 await，不能变成未等待的后台写入 |
| `app.js:1669–1672` 路由注册时初始化媒体、分类、文案及教学视频 | 拆出 awaited 初始化；路由组装保持无数据库种子副作用。导入库和全新库分别定义初始化策略 |
| `assistantGuide.js:33–52,96`；`adminAssistant.js:53–83`；`app.js:769,826,874,1708` | catalog/config/categories 回调也依赖数据库。异步预取后交给纯解析器，或全链 await；保留 AI 等待期间内容变化检查，不能只冻结一次快照使 isCurrent 永远为真 |
| `researchContentLabels.js:13` | 每次请求先 await 两组数据再构造纯 resolver，保留改名立即生效；不在每行 map 中查询 |
| `index.js:7,25–45` | bootstrap、设施同步前后读取、任务错误处理和 shutdown 都 await；停止定时器并等待在途工作后关闭池 |
| `grant-super-admin.js:12–40` | CLI 也选择后端；管理员变更与审计为同一事务；finally 等待关闭 |

直接数据库调用范围：`app.js`、`appTexts.js`、`database.js`、`educationVideoImport.js`、`equipmentCategories.js`、`equipmentDocumentImport.js`、`facilities.js`、`feedback.js`、`grant-super-admin.js`、`index.js`、`learningProgress.js`、`mediaFileOperations.js`、`mediaLibrary.js`、`mediaStorageSeed.js`、`registrationCodes.js`、`researchContentLabels.js`、`tcmContentUpdate.js`。迁移结束用这一清单核查入口，不以 HTTP 冒烟通过代表全部完成。

## 方言与事务的具体落点

- `database.js:402–548` 混合 DDL、ALTER、版本记录和种子。保留 SQLite 路径，将 MySQL DDL/迁移独立实现。迁移版本应表达实际执行的后端变更，不能仅填充到 SQLite 版本号。
- `ON CONFLICT` 要逐条确认目标唯一键；MySQL `ON DUPLICATE KEY` 可能由另一唯一键触发。`INSERT OR IGNORE` 不全局替换为 `INSERT IGNORE`，避免把截断、非空等错误吞掉。`@named` 参数显式转有序占位符或使用经过验证的驱动绑定。
- `app.js:1330,1579,1808` 的 SQLite datetime 表达式改为绑定统一 UTC 截止值；JSON 提取、数值转换、NULL/缺键及 `json_group_array(DISTINCT json_object(...))` 分别改写。去重可先子查询再聚合，或用明确排序的 JS 聚合；不能仅替换函数名。
- `.changes` 的成功判断见 `registrationCodes.js:89`、`feedback.js:129`、`app.js:1191,1255,2346`、`tcmContentUpdate.js:91`。定义“匹配/实际修改/插入或重放”的业务含义，并覆盖未改变值、upsert、并发冲突。`registrationCodes.js:161` 的 SQLite 唯一错误改成限定具体约束的后端错误映射。
- 注册码领取 `registrationCodes.js:78–117`：原子条件消费、创建用户及相关记录在一个事务；两连接同时领取只能一人成功。学习进度 `learningProgress.js:125`：读-合并-写必须串行化同一用户/设备/日期；缺失行时 `FOR UPDATE` 不是完整方案，可锁定用户锚点或用有证明的原子更新，批量键按稳定顺序加锁。
- 反馈版本更新 `feedback.js:121–168`、文档确认 `equipmentDocumentImport.js:185–209`、训练修订 `app.js:970`、账号删除 `app.js:1933`：完整事务保留冲突、幂等和审计语义。MySQL 默认隔离级别不等价于 SQLite `.immediate()`；显式设计锁定规则并用并发测试验证。
- 媒体 `mediaFileOperations.js:79,91,166`、`mediaLibrary.js:298,341,386` 和 `mediaStorageSeed.js:84` 同时涉及文件和数据库：文件先暂存、事务短持锁、失败补偿保持；不能假设 rollback 会还原文件。设施网络抓取在事务外完成，`facilities.js:128` 入库阶段才持锁。
- 分类、文案、教学视频、TCM 内容更新的原有原子写入也保留；不能在逐行 await 后部分成功即返回。大批次更新和 media 唯一规则按独立 schema 策略实现。

## 最小依赖顺序与交付标准

| 批次 | 工作 | 依赖与完成标准 |
| --- | --- | --- |
| 1 | 独立 MySQL 配置/池/事务模块 | 无 app 接入；SQLite 原测试仍可运行；配置与资源释放分支通过 |
| 2 | 建表策略、显式迁移入口、隔离测试库 fixture | 依赖 1 和 source audit；新建空库结构可核验；与源数据导入分开执行 |
| 3 | repository 契约、bootstrap、鉴权/权限/日志、只读 catalog | 依赖 1；先在 SQLite 上改调用方为 await，保持旧部署；MySQL 启用仍受完整性门槛限制 |
| 4 | 用户/注册、训练/学习/反馈、聊天、管理 CRUD | 依赖 2–3；每组同时补 MySQL 实现和后端共同 HTTP/业务契约；按实际业务操作封装事务 |
| 5 | 媒体/文档导入、种子/TCM、研究聚合、AI 回调、设施任务与 CLI | 依赖已有基础模块；补异步隐性入口及文件补偿；原功能与错误码保持 |
| 6 | 完整演练导入、双后端回归、MySQL 并发及故障验证 | 所有入口适配完成后再启用 MySQL 部署；验证计数/关系/登录/写入/文件；确认通过才安排最终冻结与切换 |

批次可以小步提交，未接入的 MySQL 模块可提前合并，但不能把部分适配的 MySQL 服务作为线上完成品。SQLite 路径可持续回归并运行旧服务；最终切换遵守进度文档中的单写与回滚规则。

## 测试保留与新增

- 保留 `server/test/database.test.js:47–54` 的 SQLite 38 表、PRAGMA、迁移版本与种子回归，它不适合作为 MySQL DDL 测试；纯校验/合并/序列化测试无需复制。
- HTTP 测试的 `withServer`（如 `app.test.js:16`）升级为后端 fixture，集中处理 await 初始化/清理和种子数据；SQLite 仍为默认快速测试。MySQL 只对专门隔离库执行，显式命令启用，未运行应报告未验证。
- 直接同步服务测试需随契约调整：`equipmentDocumentImport.test.js:81` 的 confirm/history、`learningProgress.test.js:214` 的关闭前保存、`researchContentLabels.test.js:109` 的 resolver；异步错误使用 `assert.rejects`。保留仍然纯同步函数的 `assert.throws`。
- MySQL 至少用两条独立连接验证：同注册码竞争、学习进度合并不丢失、反馈版本冲突、重复文档确认仅一次、媒体活跃重名竞争，以及事务中途失败无部分业务/审计提交。
- 校验驱动解码与 API 形状（JSON 字符串/对象、时间字符串、BIGINT、布尔值）、大小写/尾空格查询和唯一行为，以及空串根节点/日期约定；只输出聚合核验结果，不把生产行和凭据写入测试日志。

## 实施记录（2026-09-24）

- MySQL 连接、结构复核及快照导入已在真实 ECS/RDS 通过：38 表、32,314 行逐字段验证并提交，详见迁移进度文档。完整应用尚未连接 MySQL。
- 第一批身份访问已实施：`identityRepository.js` 提供用户、活跃用户、规范化标识查找、删除状态、管理员账户及最后活跃时间六个操作。SQLite 保持同步，MySQL 使用现有异步执行器；显式列投影保持原用户形状，管理员 `is_active` 严格解码，禁止把字符串 `"0"` 当作启用。
- `app.js` 的用户状态中间件、31 处异步用户鉴权调用（含反馈注入回调）、三处标识查找、登录密码验证后的重读及管理员权限查询已等待结果；`feedback.submit` 同样等待身份。最后活跃时间写入后重新读取当前用户，核对等待期间的删除或角色变化。
- 账号删除继续保留同步 SQLite 事务内重新鉴权。管理员创建在异步查找目标后，把操作者当前权限、目标活跃状态、账户创建及审计放在一个 SQLite immediate 事务中；相关异步竞争测试已覆盖。
- 50 项身份仓储、HTTP、原应用、账号删除及反馈回归通过。仓储 MySQL 测试使用注入执行器，未声称这些应用查询已在 RDS 运行。其余业务 SQL、事务、初始化、任务及 CLI 尚待适配；`createApp` 明确拒绝未完成的 MySQL 应用启动，防止误部署。源代码修改尚未上传云端。

## 第二批业务适配（媒体恢复后）

- 抽出原有权限策略至 `adminPermissions.js`；`adminAuthorization.js:revalidateAdmin` 必须位于有效事务内。MySQL 按 users → admin_accounts 顺序锁定当前行，重新检查删除、启用状态和所需权限，并刷新审计使用的操作者信息。SQLite 同步事务保持原行为。MySQL adapter 新增基于 AsyncLocalStorage 的只读 `inTransaction` 状态，在结束或事务受损后为 false。
- `systemLog.js` 保持原调用签名，SQLite 同步插入、MySQL 返回 Promise；MySQL 日志警告或非单行写入作为失败抛出，业务仓储等待日志，故可随业务事务回滚。未移植模块的异步日志调用仍是后续工作，MySQL 应用启动门槛保持关闭。
- `registrationRepository.js` 包含注册预检、消费、列表、发行、撤销。消费先锁邀请码再插入用户并条件标记使用；MySQL 唯一约束保护手机号/邮箱，错误由固定码和冲突后的当前读分类。前置不存在检查不加间隙锁；发行/撤销先复核管理员权限，数据与审计同事务。搜索保留 SQLite 的 ASCII 大小写语义及字面百分号、下划线和反斜杠。
- `learningProgress.js` 的 MySQL 保存锁定有效用户父行，按器材/日期稳定顺序当前读、合并与显式插入/更新，保存幂等且整批失败回滚。MySQL 查询用同事务的父行共享锁稳定分页，并拒绝在等待期间已被删除的目标账户；返回数字和原 JSON 形状。SQLite 公开函数继续同步，app 的两个调用点已 await。
- `appTextsRepository.js` 使用首次 INSERT 的主键冲突及现有行的 revision 条件 UPDATE 防覆盖；权限、数据、审计和写后读取同一事务。拒绝不安全的 BIGINT revision、警告、异常写入计数；不会把日志失败、死锁或未知 COMMIT 转成普通版本冲突。`appTexts.js` HTTP 调用已 await。
- 当前相关本地业务回归合计 140 项通过：原 109 项组合、后台文案 30 项、新增目标删除期间学习查询拒绝 1 项。另有验收 CLI 9 项测试通过，包括精确清理、未知提交不重试、错误去密及报告原子替换故障。MySQL 行锁和并发的本地测试使用真实 adapter 加注入执行器，尚未声称真实 RDS 业务验收通过。
- 已生成仅面向 `outdoor_fit_test` 的 `deploy/aliyun-mysql-business/aliyun-mysql-business-v1.tar.gz`：真实连接并发执行三个业务仓储，独立合成记录、私有持久报告、完成后精确清理。17 文件清单、源码字节一致、入口、Bash 语法及独立审查通过；上传与执行信息记录在迁移进度文档。等待用户 ECS 输出后处理实际数据库差异，再继续剩余业务移植。
