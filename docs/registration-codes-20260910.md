# 用户注册与一次性推荐码（2026-09-10）

## 实现范围

- 后台「用户管理」增加独立「用户注册」入口（`AdminRegistrationCodes`），每页 20 条，并支持姓名/手机号搜索、可用/已使用/已停用筛选与翻页。
- 有 `users.read` 权限可查看列表；有 `users.edit` 权限可生成和停用注册码。普通 APP 治疗师不因此获得后台权限。
- 后台登记姓名、手机号、用户类型。参与者存为既有 `participant`，治疗师存为既有 `staff`，沿用 APP 项目人员功能。登记姓名留作核对；APP 用户可填写自己的昵称。
- APP 注册表单为昵称、手机号、推荐码、密码、确认密码，没有角色自选或短信步骤。
- 新用户类型仅由服务端读取注册码记录确定，忽略客户端提交的角色或权限字段。
- 注册表单沿用现有样式并补充键盘遮挡留白，密码/确认密码/推荐码聚焦可滚动到键盘上方。

## 安全与异常处理

- 用 Node `crypto.randomInt` 生成 20 位不含容易混淆字符的随机码，分 4 组显示；约 99 位熵。
- 仅存 SHA-256 和末四位，不把完整注册码写入数据库、列表或操作日志。创建成功响应设置 `Cache-Control: no-store`，完整码仅在本次创建结果里展示。
- 注册码绑定规范化手机号和后台选定的类型；每个手机号最多一个未使用、未停用的码。
- 同一事务内重新验证注册码、插入用户、标记已使用；密码散列的异步间隙不会造成并发重复消费。
- 已有手机号、失效码、错误码、不匹配手机号、密码不一致均不消费有效码。密码范围 8–256 字符。
- 每个手机号最多 15 次注册请求 / 15 分钟；仅保存临时键控摘要，不直接保存 IP/手机号限流日志。错误码在密码散列前拒绝。此限流为当前进程内，重启清零；未来多实例部署应接共享限流。
- 停用后不可恢复，需重新生成；已使用的码不能停用，不删除既有账户。
- 生成响应丢失时，后台提示先刷新并停用旧码再重新生成。注册响应丢失时 APP 提示先尝试用刚填的手机号和密码登录。
- 防止快速重复提交、过时列表覆盖新筛选、账号切换后显示旧明文码、旧确认框用另一个管理员账号执行停用。

## 接口

| 接口 | 内容/权限 |
| --- | --- |
| `GET /api/admin/registration-codes` | `users.read`；`page/pageSize/search/status`；pageSize 最大 50 |
| `POST /api/admin/registration-codes` | `users.edit`；`name/phone/countryCode/profileRole` |
| `POST /api/admin/registration-codes/:id/revoke` | `users.edit`；停用未使用的码，重复停用幂等 |
| `POST /api/auth/register` | `name/phone/countryCode/registrationCode/password/confirmPassword`；成功返回既有用户/token 结构 |

数据库启动时只添加 `registration_codes` 表及索引，不修改既有用户记录和密码。保留旧 SMS 接口是为了不影响现有找回密码接口，不作为新注册的绕过方式。

## 本地验证

- `server/test/registrationCodes.test.js`：11 项通过，覆盖随机码、哈希保密、权限、角色绑定、错误/失效/跨手机号、停用/重新生成、重复手机号、并发单次消费、分页和限流。
- `server/test/app.test.js`：13 项通过，旧注册测试使用测试专用邀请种子；登录、访客资料、用户更新、权限与运动记录测试仍通过。
- `contexts/__tests__/AuthContext-test.js`、`components/__tests__/AdminRegistrationCodes-test.js`、`components/__tests__/RegistrationFlow-test.js`、`components/__tests__/LoginFlow-test.js`：共 47 项通过。
- `npx tsc --noEmit` 通过。
- 未在本轮子任务连接生产服务器、创建实际用户、发送注册码或执行部署。原生软键盘和手机实际注册仍需真机复核。

## 发布兼容性

服务器更新后，新注册必须具备推荐码及确认密码，因此旧 APP 的新注册入口需要更新 APP/OTA 后使用；已有账号登录和访客访问不变。请协调后台与客户端发布顺序，不提供任何生产绕过开关。后台姓名、手机号与随机注册码由工作人员安全交给本人；这不是运营商短信实名验证。
