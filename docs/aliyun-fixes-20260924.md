# 阿里部署后的科研与收藏修复

用户反馈：后台科研数据无法载入；收藏页出现长时间等待；要求将原“关于我们”的程序介绍放到“关于此程序”，并在“关于我们”展示本次提供的 Word 团队资料。

## 已确认问题

- 用户在阿里 ECS 回传 `API_REQUEST_FAILED ER_CANT_AGGREGATE_2COLLATIONS`，与打开科研页的失败对应。
- 科研查询使用的 MySQL JSON_TYPE/JSON_UNQUOTE 返回文本与会话的 `utf8mb4_0900_bin` 存在排序规则冲突。修复在各 JSON 文本结果参与比较、NULLIF、COALESCE 之前显式选择同一排序规则；不改数据库结构、现有值或全局参数。
- 收藏页原来在每次进入时清空列表，并等待本地收藏、目录网络请求、学习记录全部完成。目录请求无超时会阻塞已存在的本地收藏。改为本地收藏先显示、目录和学习记录独立更新，保留重新进入时的已知列表，并限制网络等待。

## Word 与关于页面

已使用受管理文档运行时重新只读提取用户文件 `Our Team Document (24.09.2026)v2.docx`，SHA256为 `7748e292fb25556b73ef5425c171bd89533dba990f5119497e06f78334dfe4f0`。共18个正文块、8张表，中英文各4组16人，无图片、批注或修订。

已有本地两页实现和已部署阿里 v1 网页包均包含这份文档内容，逐成员职责/姓名/职称/机构与此次重新提取的 Word 一致；`/setting/about` 显示 `copy.intro` 程序介绍，`/setting/info` 显示 `teamInfo` 团队名单。无需重新抄写或改动现有名单。旧 Google 网页静态文件与已安装手机版本不随后端迁移自动更新；已向用户询问实际访问客户端，尚待回复。

## 发布边界

当前正式环境是阿里 Docker/RDS：用户已回传 v2 更新 `activated` / `PASS`，当前版本为 `outdoor-fit-api:20260924-v2`、`/opt/outdoor-fit/production/releases/outdoor-fit-production-20260924-v2`。v1 作为代码回退基线保留。Google 原 API 已停用，只保留旧入口代理。不得使用旧 `team-about` 发布说明中的 Google systemd 安装命令，不重跑数据迁移或替换已配置秘密。

新修复以阿里 v1 为基线制作增量包，原冻结归档和已部署数据保留。用户已将包上传 ECS 并执行配套安装器；本机没有 ECS SSH 密码或线上写入连接，上线结果依据用户回传的安装器日志。手机安装版还需要对应平台的客户端更新；在平台未确认前，不自动向任意 EAS 项目或频道发布。

网页版 `app.outdoorfit.hk` 的 DNS 与站点补充仍待用户确认；本次增量工具须保留实际线上 Caddy 配置，不盲目写入未确认的域名配置。

## 验证与结果

科研相关21项回归通过（新增MySQL HTTP/查询契约4项、原内容标签7项、分页10项）；收藏相关6个套件44项通过；现有关于页面套件21项通过，团队内容与此次Word重新提取结果逐项一致。新增前端回归覆盖远程目录/学习记录挂起时本地收藏可显示、缓存自定义目录、快速取消收藏与保存顺序、账号切换和迟到响应、网络超时及访客限制。

新网页已离线构建成功：`tmp/aliyun-fixes-web-20260924-v2`，246文件，167233730字节；入口JS为 `entry-48f836b527a40990d18ce6ef44c296ea.js`。构建时沙盒阻止Metro子进程，自动审批允许后以2个worker完成；没有部署或发布OTA。网页清单校验通过。新源码较冻结阿里v1仅变更2个运行时后端文件，网页增量3文件；关于页面保留既有正确实现。

增量安装工具已完成独立审阅、Python 3.10 语法及纯函数验证。发布前由新镜像通过现有 TLS 配置执行只读合成 JSON SELECT，核对真实 RDS 排序规则兼容性；通过后才切换版本。TLS检查使用实际加密套接字及主机名校验，不依赖此RDS先前为空的Ssl状态变量。候选 Caddy 容器实际读取挂载网页；切换后验证 HTTPS 健康、index 和主 JS 哈希。失败尝试恢复旧代码及配置，保留现有 RDS 数据。

已生成不可变增量包 `deploy/aliyun-fixes/outdoor-fit-fixes-20260924-v2.tar.gz`，大小 1,215,683 bytes，SHA256 `3879a96b581f47e576e24edb1db3dd9a9f6e5c3c8d3a954d60d91d9768d79c99`。11 个普通文件，逐成员哈希核对通过；仅含 2 个后端文件、3 个网页增量文件和公开部署工具/清单。安装入口为包内 `apply-update.py stage`，成功后执行 `apply-update.py activate`。

用户已回传正式执行结果：更新目录 `/root/outdoor-fit-update.XXNQaczv`，`RESEARCH_SQL_COMPATIBILITY=PASS`、`UPDATE_PHASE=staged`、`UPDATE_HTTPS_HEALTH_AND_WEB=PASS`、`UPDATE_PHASE=activated`、`UPDATE_RESULT=PASS`。正式报告 `/opt/outdoor-fit/production/.update-state/20260924-v2/report.json`。由此确认候选真实 RDS 只读兼容检查通过，阿里 v2 后端及网页切换完成；最终科研页面的业务数据显示与用户正在使用的 App 客户端仍待确认，不能将合成查询检查等同于用户界面验收。已询问网页版当前网址或手机平台，以继续发布对应前端。

用户随后确认正在使用昨天交付的 Android 1.2.3 / Build 17 安装版；当前目标为 Android 项目 `bcee8c37-e833-4f4d-b660-aa457accd96d`、`preview` 频道、runtime `1.2.3`。补充反馈“联络我们”进入/返回时闪白、跳动，设置其他页面正常。本轮继续准备兼容该 APK 的 Android OTA，将收藏/关于页与 Contact 局部修复一并交付，并在安卓导出进程指定 `https://api.outdoorfit.hk/api`。不修改 iOS 根项目、原生依赖或已冻结的阿里 v2 更新包；按交付偏好准备发布产物及 Windows 命令，不将本地导出说成已发布。
