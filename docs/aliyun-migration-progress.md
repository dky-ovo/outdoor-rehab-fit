# 阿里云迁移进度

本文件用于后续逐步迁移时接续工作。仅记录环境、决策和核验结果，不保存密码、密钥或控制台账号链接。以下状态根据本次会话中的核验结果记录。

## 目标与域名安排

- 应用已部署在阿里云 ECS，使用 Docker Compose 管理后端与 Caddy，连接独立的阿里云 RDS MySQL。
- `outdoorfit.hk` 和 `www.outdoorfit.hk` 保留给官网。
- `api.outdoorfit.hk` 用于手机端 API，`admin.outdoorfit.hk` 用于管理后台；DNS、部署和 HTTPS 已完成，API 健康返回正常、后台 `/admin` 返回200。
- 结构化业务数据已迁入 `outdoor_fit_prod`；117 个图片、视频等媒体文件已恢复到 ECS 持久目录，数据库保留相应记录和引用。

## 已确认环境

| 项目 | 当前结果 |
| --- | --- |
| ECS 公网 IP | `47.83.186.36` |
| ECS 私网 IP | `172.28.239.99` |
| ECS SSH | `root@47.83.186.36`，密码登录，实际端口 `28832`（用户在 Xterminal 配置中确认） |
| VPC | ECS 与 RDS 同属 `vpc-j6cds9oskblc8e04gkapk` |
| ECS 系统 | Ubuntu `22.04.5` |
| ECS 资源 | 2026-09-24 用户回传：`x86_64`，`nproc=2`，内存总量 `3.5 GiB`、当前 available `2.7 GiB`，Swap `0 B`；根盘与 `/opt/outdoor-fit` 同属 `/dev/vda3`，总量 `99G`、已用 `11G`、可用 `84G`、使用率 `11%` |
| Docker / Compose | Docker `29.8.1`；Compose `5.5.1` |
| RDS | 香港，MySQL 8.0；实测 `VERSION()` 为 `8.0.36` |
| RDS 内网地址 | `rm-3nsog7t39ggxq6qkv.rwlb.cnhk.rds.aliyuncs.com:3306` |
| 网络连通性 | ECS 至 RDS TCP 连接成功 |
| 迁移账号 | `outdoor_fit_migrator`，普通账号，已激活 |
| 测试库权限 | `outdoor_fit_test`：已授权读写，DDL + DML |
| 登录核验 | 登录成功，`CURRENT_USER()` 为 `outdoor_fit_migrator@%` |
| 测试库字符集 / 排序规则 | `utf8mb4` / `utf8mb4_0900_ai_ci` |
| MySQL 客户端 | `8.0.46-0ubuntu0.22.04.4`，Linux x86_64 |
| 当前连接 TLS | 用户已按保留 `VERIFY_IDENTITY` 和 CA 文件的同连接核对命令回传 `SSL: Cipher in use is ECDHE-RSA-AES128-GCM-SHA256`，CLI 到该 RDS 地址的加密与身份校验已确认。服务端 Ssl_* 先前为空的根因未独立确认，不据此降低 TLS 设置 |
| RDS 测试库现有对象 | 38 表、324 源列（另 9 内部列）、33 外键；快照 32,314 行已导入、逐字段核验并提交 |
| RDS 正式应用连接 | `outdoor_fit_app@%` → `outdoor_fit_prod`，现有 API 镜像内连接成功，TLSv1.2 与证书身份校验通过，可见 38 张表，已具备 SELECT/INSERT/UPDATE/DELETE |
| ECS 公网安全组 | 用户已确认入方向 TCP 80、443 放行；API/后台 HTTPS 已通过，Google 到阿里 API 的 HTTPS 也已通过 |
| RDS 参数 | `max_allowed_packet=1073741824`（1 GiB），`lower_case_table_names=1`；SQL 模式为 `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` |
| 候选业务排序规则 | 已查询确认 `utf8mb4_0900_bin` 存在，`PAD_ATTRIBUTE=NO PAD`；当前库默认值仍为 `utf8mb4_0900_ai_ci`，尚未修改 |
| 子域名解析 | 2026-09-24 用户在 ECS 执行 `getent ahostsv4`，`api.outdoorfit.hk` 和 `admin.outdoorfit.hk` 均返回 `47.83.186.36` |

测试库默认排序规则仍为 `utf8mb4_0900_ai_ci`；已生成的业务表方案逐表明确指定 `utf8mb4_0900_bin`，并为原 SQLite 条件唯一索引及过长唯一字段提供专门映射。

## 当前停靠点

**迁移完成后的用户反馈：打开 API 健康地址仅看到 JSON，期望看到 App 页面。** 当前线上新域名仅有 api 数据接口与 admin 管理后台，尚未部署独立网页版 App 域名；此前完成范围为后端、数据、媒体和旧入口代理，不代表新用户端网页域名也已配置。Google 原站点根路径仍保留旧网页版，API 已代理阿里。用户端网页源代码和现有完整 Expo 导出均在发布包内；`utils/api.js` 的网页请求固定同源 `/api`，可复用现有 `/srv/admin` 静态目录，无需重新导入数据或构建后端。

正在补充 `app.outdoorfit.hk` 入口：本地 Caddyfile 已准备独立站点（根路径显示 App、`/api` 代理同一 API、SPA fallback），不含 admin 站点的根路径跳转；api/admin 现有规则不改。冻结 v1 归档不重写，ECS Caddyfile 尚未应用此变更。先指导用户确认/添加 app 的 A 记录指向47.83.186.36，主域名/www继续保留官网；待解析可用后交付线上候选校验和仅Caddy重建，API容器与数据库保持运行。Caddy当前admin off，不能直接使用需要管理API的 caddy reload。新域名上线结果尚未确认。

**2026-09-24 最新实际状态：正式迁移、部署和入口切换完成。** 阿里正式库已导入，最终媒体已安装，API/Caddy 已启动，新 API 和后台 HTTPS 已通过；Google 旧入口已通过 HTTPS 转发阿里。最后结果为 `GOOGLE_PROXY_ACTIVATION=COMPLETE`、源服务 `inactive`/PID0/自启DISABLED。以下按时间顺序保留的早期“仍运行/尚未执行”记录已被本条取代。Google 必须保持原 API 停写，同时保留服务器和 Nginx 为旧 App 转发请求；阿里 API 已运行，不能直接恢复旧 SQLite。

- Google 最终目录：`/home/dukaiyu2004/outdoor-fit-final-e_hjixlt`；38 张表、117 个媒体文件，媒体未压缩字节总量 `653151118`。
- 最终 `outdoor-fit.sqlite` SHA256：`ed6608c19e5d4521f2ca9c22995e3b5375773e3a0d5bc251e2acd042a3ffcf27`。
- 最终 `media.tar.gz` SHA256：`a5eb1cb8f8684a9441379234dcc62650536d8877eba734933c77bddec0304dd6`。
- 已安排只传 `SHA256SUMS`、`outdoor-fit.sqlite`、`media.tar.gz` 三文件到 ECS `/opt/outdoor-fit/migration/outdoor-fit-final-e_hjixlt/`，不传 `.source-copy`；使用 SSH 28832。用户随后回传目标侧 `outdoor-fit.sqlite: OK`、`media.tar.gz: OK`，最终文件传输校验通过。
- 目标校验后用已部署 `aliyun-production-migration-20260924-v1` 导出最终 SQLite 并向 `outdoor_fit_prod` 导入，显式绑定上述最终源 SHA；不再建表，不使用演练快照。随后安装最终媒体、启动已构建 API/Caddy，再激活 Google 旧 HTTPS 入口代理。

正式导出与导入已完成：在最终目录内新建私有 `production-export.XXXXXXXX`，由已部署 exporter 输出 `export.jsonl`，然后调用同一部署工具的 `run-production-migration.sh import --source-sha256 ed6608c19e5d4521f2ca9c22995e3b5375773e3a0d5bc251e2acd042a3ffcf27 --input <新 JSONL 绝对路径>`。用户回传 `PRODUCTION_IMPORT PASS`、`TARGET_DATABASE outdoor_fit_prod`、`DATA_COMMIT_STATUS committed`、`DATA_ROLLBACK_STATUS not_needed`、`ROW_COUNT 32686`、`REPORT_STATUS FINAL`；结构指纹仍为 `09ff78ba27cd885301649cab5ce9c075e9c1aa607ef8cf386cba4809802e32ee`，源 SHA 与最终快照一致，导出 SHA `f95b278375ee8f8157361c43bf68a79b71cf4b17a2a94f98cc40b1cac5f0d31e`。此次 HOST_REPORT_FILE 路径尚未回传，不为获取路径延迟启动。不得重复导入或清表。

用户已回传同次最终媒体安装成功：`FINAL_MEDIA_RESTORE=PASS`、`FILE_COUNT=117`。所执行命令校验固定 SHA、117 文件/653151118 字节，恢复至 state 下三处挂载目录并设 UID/GID1000、目录0750/文件0640。复用现有镜像启动成功：`outdoor-fit-production-api-1` 使用 `outdoor-fit-api:20260924-v1`、状态 healthy；`outdoor-fit-production-caddy-1` 使用 `caddy:2.11.4-alpine`、状态 Up，公开80→8080、443→8443，API3000未公开。Compose汇总写Caddy Healthy，但其无独立healthcheck，不能将其等同应用健康探针。首次curl出现3次TLS alert后重试成功，最终API为 `{"ok":true,"service":"outdoor-fit-api"}`、`ADMIN_HTTP=200`、`ALIYUN_STARTUP=COMPLETE`。符合初次ACME签发时暂时不可用表现，未经日志确认具体原因；最终正常校验证书的HTTPS已成功，无需关闭TLS校验或重建服务。

Google 最终代理已执行成功：独立 `deploy/aliyun-production/activate-google-proxy.py` 为9358字节，SHA256 `08e9aca1c98acfaa40f2ba6fd317771723f5b9a523ffe4553fa6e764704c0d1b`，用户上传校验OK后以sudo运行，参数固定 `/home/dukaiyu2004/outdoor-fit-cutover-rjxnay1p`。用户回传 `ALIYUN_HTTPS_HEALTH=PASS`、`ACTIVATION_MODE=INSTALLED`、`OLD_HTTPS_HEALTH=PASS`、`TLS_VERIFICATION=ENABLED`、`SOURCE_ACTIVE_STATE=inactive`、`SOURCE_MAIN_PID=0`、`SOURCE_AUTOSTART=DISABLED`、`GOOGLE_PROXY_ACTIVATION=COMPLETE`；实际站点配置 SHA256 `7570db1fba880e0c18e0bd4ca727721975d3e64740ac78471ce68125ff3a9c01`。健康请求使用公共CA与主机名验证；旧域名检查经本机Nginx再转发阿里，两条API路由配置此前均已核验。没有重新启用旧写入或恢复旧配置。

完成范围：最终38表/32686行导入并提交、117媒体文件安装、应用与HTTPS启动、旧域名API代理、源服务禁用。按用户要求没有追加完整业务验收，不将部署健康检查表述为所有业务功能测试通过。保留迁移快照、报告和旧SQLite；未删除备份或关闭Google服务器。阿里短信接入和官网建设是后续工作，当前短信找回密码关闭、主域名/www保留官网；未来发布使用新API域名的移动客户端并确认旧流量迁出后，才考虑退役Google代理。未配置或声称已配置新的备份自动化、监控或短信服务。

**最新用户决定：跳过额外业务验收，直接推进正式部署。** 不再要求上传或运行 `aliyun-mysql-business-v1.tar.gz`，也不把用户跳过验收记为通过。用户已确认 ECS `docker ps` 无运行容器，`ss` 查询 80、443、3000 均无监听；可准备标准 80/443 HTTPS 入口。当前没有启动生产容器、停止 Google 服务或切换线上写入。

最新用户确认：生产库 `outdoor_fit_prod` 与运行账号 `outdoor_fit_app` 已创建；阿里云短信尚未开通，**先上线并暂时关闭短信找回密码**。正式入口强制 `SMS_MODE=disabled` 和禁用测试码；保留账号密码登录、注册码注册。短信接口返回 `smsUnavailable`，前端已有中英文提示。账号密码和密钥不发聊天。

用户已在真实 RDS 完成正式库建表：`PRODUCTION_SCHEMA PASS`，目标 `outdoor_fit_prod`，38 表、71 条语句，`SCHEMA_PARTIAL NO`、锁正常释放、报告 FINAL。生产结构 fingerprint 为 `09ff78ba27cd885301649cab5ce9c075e9c1aa607ef8cf386cba4809802e32ee`；报告 `/opt/outdoor-fit/migration/20260924-production/production-migration-run.9frL5sSv/reports/report.json`。生产指纹包含实际库名，与 test 指纹不同是预期。不要重跑空库建表。正式库业务数据尚未导入。

用户已执行发布包校验/解压、`prepare-host.sh` 和 Docker 构建，并回传 `API_IMAGE_BUILD=COMPLETE`。API 镜像标签 `outdoor-fit-api:20260924-v1` 已在 ECS 构建完成；该 Dockerfile 也在 Node 22 镜像中检查 production.js 语法并加载 appMysql.js，不连接数据库。发布目录 `/opt/outdoor-fit/production/releases/outdoor-fit-production-20260924-v1`，准备脚本已建立正式目录与 CA 副本。后续复用此镜像，不必重新上传/重建。

用户已回传 `JWT_TRANSFER=COMPLETE`，原 Google JWT 已直接传入 ECS：`/opt/outdoor-fit/migration/20260924-production/outdoor-fit-jwt-6nh673_9/jwt-secret`。只获知文件路径，未读取或接收实际密钥。Google 服务保持运行。

用户已回传 `CONFIGURE_HOST=COMPLETE`、`ENV_FILE=/opt/outdoor-fit/production/secrets/production.env`、`FILES_OWNER=1000:1000 FILES_MODE=0400`。JWT、数据库密码和环境配置已写入；未读取实际秘密，不重跑拒绝覆盖文件的 configure-host.py。Caddy 2.11.4-alpine 已拉取，Compose 网络已创建；临时 validate 容器在 exec 阶段报 `/usr/bin/caddy: operation not permitted`，尚未完成配置核验或启动 API。

Caddy 故障定位：官方 2.11.4 Alpine Dockerfile 对 `/usr/bin/caddy` 设置 `cap_net_bind_service=+ep`；官方项目 issue 396 记录 cap_drop ALL 导致完全相同的 exec EPERM，即使使用高端口也会发生。本地 compose.yaml 已仅对 Caddy 补上 `cap_add: [NET_BIND_SERVICE]`，保留 UID 1000、只读根文件系统及 no-new-privileges，API 仍 cap_drop ALL。冻结的 v1 tar.gz 与 SHA256 不改写，ECS 已解压的 compose.yaml 需备份后应用此单行修复；无需重新上传完整包或重建 API。依据：https://github.com/caddyserver/caddy-docker/issues/396 和 https://raw.githubusercontent.com/caddyserver/caddy-docker/master/2.11/alpine/Dockerfile 。

用户已在 ECS 应用 Caddy 单行补丁，回传 `CADDY_PERMISSION=FIXED`、`Valid configuration` 和 `PRODUCTION_CONFIG=COMPLETE`。原配置保存在同目录 `compose.yaml.before-caddy-fix`。这确认 Caddy 可执行文件和站点配置通过；validate 的自动 HTTPS 日志不代表证书已签发或公网已上线。API 尚未启动，正式库尚未导入业务数据。

正式运行账号的连接与授权核对已完成：用户通过 Compose 的现有 API 镜像 stdin 执行 `check-app-connection.mjs` 同内容代码，回传 `APP_DATABASE=outdoor_fit_prod`、`APP_ACCOUNT=outdoor_fit_app@%`、`APP_TLS=TLSv1.2`、`APP_IDENTITY_VERIFIED=PASS`、`APP_TABLE_COUNT=38`、`APP_DB_CONNECTION=PASS`。这同时确认容器内运行 UID 能读取已挂载密码和 CA，真实驱动使用证书身份验证成功；未启动 production.js 或写业务数据。已查询授权含正式库 SELECT、INSERT、UPDATE、DELETE，满足运行时 CRUD 所需；还包含 CREATE TEMPORARY TABLES、LOCK TABLES、EXECUTE、SHOW VIEW、EVENT、TRIGGER，及全局 PROCESS/REPLICATION SLAVE/REPLICATION CLIENT/XA_RECOVER_ADMIN 和部分 mysql 系统表只读。不能将此账号描述为“仅四项 DML 权限”，本轮不改动已授权账号权限。

用户现已明确回传“已确认放行 80、443”，已完成目标 ECS 关联安全组公网 TCP 入方向规则确认；SSH 28832 保留。尚未核实公网连通性，正式启动后仍需 HTTPS 入口访问。下一项操作是 Google Nginx 旧入口的只读路由采集，历史站点路径 `/etc/nginx/sites-enabled/outdoor-fit`；需注意可能存在优先级更高的 `/api/admin/media/upload` location，不能只改通用 /api/。Google 仍运行，未停写；先准备并核对切换配置，再获取最终数据库和媒体快照。

Google 只读路由采集已成功，`NGINX_ROUTING_READ=COMPLETE`、`REVIEW_COUNT=3`。活动文件为 `/etc/nginx/nginx.conf`、`/etc/nginx/mime.types`、`/etc/nginx/sites-enabled/outdoor-fit` 和 `/etc/letsencrypt/options-ssl-nginx.conf`；站点真实路径 `/etc/nginx/sites-available/outdoor-fit`。HTTPS 站点 root `/var/www/outdoor-fit`、默认 25m，通用 `/api/` 和精确 `/api/admin/media/upload` 均代理 `http://127.0.0.1:3000`。上传路由为 260m、请求缓冲 off、读写超时 300s；两路均有 Host `$host`、X-Real-IP `$remote_addr`、X-Forwarded-For `$proxy_add_x_forwarded_for`、X-Forwarded-Proto `$scheme`。根路由 try_files 原 SPA。HTTPS 443 和 IPv6、HTTP 80/default_server 和 IPv6 均存在。第 44/45/53 行位于 HTTP server 的特殊语法未显示；不推断具体内容，保留整个 HTTP 区段原字节，无需追加取数才能准备不涉及它的 API 修改。

下一项交付 `deploy/aliyun-production/prepare-google-cutover.py`，需通过 Google 浏览器 SSH 的 Upload file 上传到用户 home 后按 SHA 校验运行。脚本只创建 root0700 随机 `/home/dukaiyu2004/outdoor-fit-cutover-*` 目录，保存原配置/manifest、两处 API return503 的维护候选、两处 HTTPS 新上游与 Host 的最终候选。保留其余路由、HTTP、证书、ACL、上传配置和其他头；启用上游 SNI/证书验证与系统公共 CA，关闭上游重试。复制主 nginx.conf 并将 sites-enabled/* include 指向私有候选，分别 nginx -t，不改动线上配置、不 reload、不 stop。已完成本地 Python 语法与独立静态审查，尚未远端执行；若主配置存在相对 include，影子检查可能需要处理其解析路径，不能跳过检查。失败日志只存入私有目录，默认不打印可能含配置值的 stderr。

交付准备脚本为 4,695 字节，SHA256 `195f789fad25adf7c11ef091b5c11eaee2a3e16dfc8a0aa34767b89ab6acc34a`。Google 上传后的预期路径 `/home/dukaiyu2004/prepare-google-cutover.py`，校验后 sudo python3 执行；等待 `CUTOVER_DIR`、`MAINTENANCE_CONFIG=PASS`、`ALIYUN_PROXY_CONFIG=PASS`、`LIVE_CONFIG=UNCHANGED` 和 `CUTOVER_PREPARE=COMPLETE`。只有候选配置准备好后才安排维护、停止 Google 服务和最终快照。

最新回传：在 Google home 校验脚本时 `No such file or directory`，因 set -e 校验失败，准备脚本尚未执行，没有 CUTOVER_DIR、配置变更或停服。本机同路径文件仍存在且 SHA 与交付值一致。当前下一步是通过 Google 浏览器 SSH 上传本机该文件到 `/home/dukaiyu2004/`，待上传成功后续跑同一校验和准备命令；若确已上传但路径不同，先定位上传结果，不能假定准备已完成。

随后用户已上传并执行成功：`prepare-google-cutover.py: OK`，`CUTOVER_DIR=/home/dukaiyu2004/outdoor-fit-cutover-rjxnay1p`、`API_PROXY_COUNT=2`、`MAINTENANCE_CONFIG=PASS`、`ALIYUN_PROXY_CONFIG=PASS`、`LIVE_CONFIG=UNCHANGED`、`CUTOVER_PREPARE=COMPLETE`。该目录是后续维护安装与最终代理切换的唯一已确认候选目录；Google 仍运行。

最终停写和快照脚本已准备，但尚未上传或执行：`freeze-google-source.py` 校验候选/主配置哈希、原子安装维护版、nginx -t/reload、检查两路本机 HTTPS 503 并等待旧 worker 完成请求，再 stop/disable 源 API、确认 inactive/PID0 及源文件无持有者；没有自动恢复 API 写入。`capture-final-snapshot.py` 以普通 dukaiyu2004 身份创建新私有 final 目录，用源 DB/WAL 只读副本进行 Backup API、integrity/FK/38 表检查，并以低压缩级别归档三棵媒体树、逐文件哈希与前后源清单核对；保留 partial，不修改旧备份。两个脚本完成 Python3.8 静态语法和独立审查，未做远端或业务运行测试。

用户对“是否有独立于 outdoor-fit-api 的定时任务或其他写入程序”回答“不确定”。因此下一项为上传并执行只读 `inspect-google-writers.py`：只显示源文件持有 PID 是否属于主服务进程树，以及 cron/自定义 systemd 文件名、有效行数、是否直接引用应用路径和定时器/运行服务名；不显示任务命令、环境或秘密。文件 3,186 字节，SHA256 `7d2a8b887cdd37890f3ea4a540a6d07b7be82195763d7b36c14d9710031dc22d`。等待结果排查独立写入者，Google 保持运行，暂不交付执行停写命令。

写入者只读检查已由用户回传完成：`SOURCE_WRITER_INVENTORY=COMPLETE`，主 PID 793417 是唯一源文件持有者，`APP_SERVICE=YES OPEN_FILES=3`、权限跳过 0。列出的 cron 为 certbot/e2scrub/apt/dpkg/exim4/logrotate/man-db 和系统 crontab，均无应用引用；自定义 systemd 文件只有 outdoor-fit-api.service 直接引用应用，没有列出用户/root crontab 或用户自设 systemd 任务。定时器和其余运行服务为所列系统/Google 管理服务。此次检查未发现独立写入者；这不代表对所有潜在间接调用的形式化证明，但足以依据已确认服务进入维护，快照仍会核对源文件前后不变。

当前下一项：用户通过 Google 浏览器 SSH 同时上传 `freeze-google-source.py`、`capture-final-snapshot.py` 到 `/home/dukaiyu2004/`，先同时核对下列两个 SHA，再在 subshell set -e 下 sudo 执行 freeze（参数固定 `/home/dukaiyu2004/outdoor-fit-cutover-rjxnay1p`），成功后以普通用户执行 snapshot。此步骤开始实际维护：旧 API 返回 503、请求排空、源服务停止并关闭自启，完成后保持停写直到阿里接管。尚未收到 SOURCE_FREEZE 或 FINAL_SNAPSHOT 输出，不得记录为已停服或已生成最终数据。

尚未执行的停写脚本 SHA256 `5e96778fe91a7e46fb0cc650a6e38e58f7db715218813178391217b6e59d5f22`；最终快照脚本 SHA256 `1ccbc9c58ebfd6bade7d7fe699b5317c4ab9a98f11e670e767c252e10603f5d4`，14,173 字节。后者必须普通 dukaiyu2004 运行，前者须 sudo；最终脚本捕获媒体文件数是动态值，不沿用演练 117 的固定判断。

不要发密钥/密码到聊天，不重新生成替代 JWT。应用账号连接与 ECS 安全组已确认，正式切换前还需准备旧手机版 Google HTTPS 入口代理方案，然后才停写制作最终快照。主域名保留官网。

JWT 操作安排：在 Google 的 `dukaiyu2004@outdoor-fit-prod` 浏览器 SSH 执行，从 ECS 的已校验发布目录用 scp 28832 拉取 `capture-google-jwt.py`，脚本 SHA256 `99575dfd10ae81caf3ea3a25697b18455193c127ee0381c675dcd55369eca2ff`。脚本用 sudo 只从当前服务 `/proc/PID/environ` 提取 JWT，保留原始字节，拒绝默认/短密钥；不读取整份环境文件到聊天。源端新建随机私有目录，目标 ECS 在 `/opt/outdoor-fit/migration/20260924-production/` 下同随机目录名；rsync 远端启动命令先独占 mkdir 0700，存在即失败，文件设 0600。仅要求用户回传 `JWT_TRANSFER=COMPLETE` 与 `JWT_SOURCE_ON_ECS` 路径。配置脚本复制到 production/secrets 时要求目标尚不存在，因此传输不能直接写生产 secrets/jwt-secret。

正式 MySQL 运行入口已接入独立 `appMysql.js`，保留旧 `app.js` SQLite 入口。核心路由、媒体、文档导入、设施同步、AI 内容读取等已异步适配；写入与审计同事务，根写路由等 COMMIT 后返回，媒体回滚补偿对 COMMIT 未知结果保留文件，推送延至提交后。启动不扫描媒体或重放 seed，要求正式导入基础记录和媒体权限。密码/JWT 通过只读秘密文件挂载。完整 Web 已导出到 `tmp/aliyun-production-web-v1`，246 文件、167,230,896 字节。已完成 57 个服务源码 Node 语法检查、MySQL 模块加载、SQL/异步/事务独立静态审查；按用户要求未新增/运行业务测试，之前 149 项属于此前版本，不代表新运行时验证。

正式迁移包 `deploy/aliyun-production-migration/aliyun-production-migration-v1.tar.gz` 已生成，18 文件、62,277 字节，SHA256 `2063954e72cd409f5775047a26a86cf2428fafa2be5c51918de9b6b3c1687a0f`，顶层 `aliyun-production-migration-20260924-v1`。新 CLI 固定 prod；旧演练 CLI 仍固定 test。导入需要显式最终 SQLite SHA、全量新 JSONL，拒绝非空目标；保留结构核验、逐字段比较、外键和唯一检查、事务提交与未知结果保护。包中 FINAL-SNAPSHOT.md 给出停写后备份及 28832 传输步骤，尚未执行。生产应用包由 `scripts/package-aliyun-production.py --build` 生成；部署说明在 `deploy/aliyun-production/README.md`。

本机未运行 Docker 或连接 RDS 业务运行时；正式库建表、ECS API 镜像构建、JWT 迁移、秘密配置、Caddy 权限修复及配置核验、应用账号真实连接/授权核对和安全组确认已由用户完成，**旧入口代理准备、正式数据导入、媒体最终恢复、HTTPS 启动及旧入口代理切换仍未完成**。Google 继续是唯一线上写入源。

已生成可传输正式应用包 `deploy/aliyun-production/outdoor-fit-production-v1.tar.gz`：318 文件、158,069,468 字节，SHA256 `3200ba265dc6a2f14838fa397cf73fdcf5dad7f0d3e08224affa9240a836a9a8`，顶层 `outdoor-fit-production-20260924-v1`。已逐字节校验源码与归档，并独立核对 246 个 Web 文件全部在包内（包含 Expo 导出的 assets/node_modules 字体资源，该路径不是依赖安装目录）。正式包同目录 `SHA256SUMS` 已写入。首次漏字体的中间归档仅保留在 `tmp/aliyun-production-incomplete`，不得分发；正式链接只用 deploy 下最新 hash。约 62 KB 的正式迁移工具包已完成远端建表；现在上传应用包并逐步配置。暂不停止 Google。

**已完成的数据迁移演练：** 用户已回传真实 RDS `DATA_IMPORT PASS`、`DATA_COMMIT_STATUS committed`、`DATA_ROLLBACK_STATUS not_needed`：38 表、32,314 行逐字段核验后提交。导入报告为 `/opt/outdoor-fit/migration/20260924-rehearsal/import-run.PQKK3n3f/reports/import-report.json`，源 SHA `9e01e2f4d5b0e05cb0dac415ccffa4179e42105a76efc42df7e3788c9e46933d`，ECS 导出 SHA `6a7f3d3d30e9bdb9084650079b546ce26fd2f721934e575008843a9a699ee002`。测试库现在有数据，不要重跑空库导入或建表脚本。Google 仍是线上写入源；这是已备份快照的迁移演练，尚未切换业务。

此前只读复核 v2 `SCHEMA_VERIFY PASS`：38 表、324 源字段、33 外键，解码表达式 74、Buffer 0，锁正常释放；结构 fingerprint `8b67ce16f43f3f82f9d03a9d4be1eec219d942951a44cf19249c71d68a561cb6`。报告为 `/opt/outdoor-fit/migration/20260924-rehearsal/aliyun-mysql-verify-20260924-v2/schema-report.EjWNN4Cb/schema-report.json`。核验器的表达式外层转义处理已在 RDS 验证。

已交付并成功运行导入包 `deploy/aliyun-mysql-import/aliyun-mysql-import-v1.tar.gz`，55,456 字节，SHA-256 `9722568982e0f6cbfa2e3f5bec667694c0095340de60f838ebe6dcbb53cac565`，仅含 14 个固定允许的源码/结构清单文件。入口 `aliyun-mysql-import-20260924-v1/run-import-data.sh` 读取 ECS 已有快照，在 Docker 构建目录之外新建私有 `import-run.XXXXXXXX` 目录，生成只读导出文件及 `reports/import-report.json`，控制台打印 `HOST_REPORT_FILE`。真实 RDS 运行结果见上。

- 导出与读取：固定源 SHA，严格核对导出清单、逐表行数/摘要及全流摘要；BIGINT 使用十进制字符串，DOUBLE 保留有限 IEEE-754 值，文本检查 UTF-8 和字段容量。已在私有临时目录对真实同哈希快照完成 Python 导出和 Node 读取：38 表、32,314 行、导出 18,224,822 字节，源 SHA 未变；临时业务导出已清除。不同 Python/SQLite 版本可能改变导出头部，故不固定导出文件 SHA。
- 导入：仅允许 `outdoor_fit_test`，同连接独立迁移锁并再次核验结构，保持外键/唯一检查和严格模式；在单个 SERIALIZABLE 事务内确认所有目标表为空，按父表在前顺序以显式原列和预备语句批量导入。提交前按原主键逐字段比较全部行，额外核对 5 个摘要列、2 个条件生成列和 2 个代理主键。DOUBLE 回读使用二进制协议以避免驱动文本十进制解析的额外舍入，并以 `Object.is` 比较。普通失败回滚；COMMIT 结果未知时销毁连接并停止，不自动重试。
- 本地验证：Python 导出器 6 项测试通过；Node 导出读取 11 项、导入器 14 项、CLI 3 项，共 28 项组合测试通过；Bash 语法及归档清单、入口、LF 检查通过。用户随后在 ECS 完成真实 RDS 写入、回读核验及提交；这证明快照数据导入成功，尚不代表应用业务兼容或正式切换完成。

2026-09-24 用户已在阿里 ECS 完成数据库审计：38 张表、32,314 行，`FK_VIOLATIONS 0`，报告位于 `/opt/outdoor-fit/migration/20260924-rehearsal/source-audit.json`。媒体审计也已完成，错误 0、警告 2，详情如下。此前目标目录中的 `outdoor-fit.sqlite` 和 `media.tar.gz` 已通过 `sha256sum -c SHA256SUMS`。独立 MySQL 连接模块及快照数据导入已验证，完整业务接口适配尚未完成。

审计工具验证：合成数据库覆盖带引号表名、生成列、隐式唯一索引、部分索引、NOCASE/降序索引、外键违规聚合；拒绝覆盖源库、硬链接、sidecar及已有输出，缺少源库不创建空库，前后源 SHA 不变。另用当前本地代码构建专用临时数据库进行集成验证，报告含 38 张表、完整字段/索引/外键、FK 违规 0，源 SHA 不变。此结果仅代表本地新建测试库；不能替代生产快照报告或证明两者结构完全一致。报告包含 DDL 与默认值定义，不导出业务行；工具不重复已完成的完整性检查。

脚本上传问题已解决：用户从本地 Windows PowerShell 用 `scp -P 28832` 上传 `scripts/audit-aliyun-sqlite.py` 后，在 ECS 成功运行。此前将目录当作命令和脚本缺失的错误均未影响源备份。

用户另外提供了本地 `D:\下载\outdoor-fit.sqlite` 与 `D:\下载\SHA256SUMS`。本地数据库 SHA-256 与云端已验证快照完全相同，因此无需再次下载 `source-audit.json`：已在本地复现审计，保存 `docs/aliyun-source-schema-audit.json`。通过当前后端代码创建专用临时 SQLite 库并对比，38 张表的字段定义、索引和外键均一致；`app_equipment_items` 仅列顺序和 CREATE TABLE 文本排列不同，后续导入必须显式指定列名。比较结果保存于 `docs/aliyun-source-schema-comparison.json`，不代表已经具备 MySQL 兼容性。

列级聚合分析保存于 `docs/aliyun-source-column-profile.json`，覆盖 324 列，仅记录结构与聚合，不导出业务行或配置值。已确认 4 个字段实际内容超过 65,535 字节、预览时间整数超过 INT32、注销手机号占位达到 44 字符等类型约束，详见兼容性待办。上述读取前后本地源文件 SHA-256 不变。

媒体归档仅在 ECS 和 Google 备份目录中可用，本地 `D:\下载\media.tar.gz` 不存在。用户已在 ECS 用 `scripts/audit-aliyun-media.py` 完成真实快照与归档审计，随后已解压到私有演练目录，尚未启动应用。报告位于 `/opt/outdoor-fit/migration/20260924-rehearsal/media-audit.json`；控制台结果为：

- `MEDIA_ROWS 62`、`RUNTIME_PATHS_CHECKED 59`、`ARCHIVE_FILE_PATHS 117`、`SEED_ITEMS_CHECKED 57`。
- `ERROR_COUNT 0`、`WARNING_COUNT 2`，唯一问题代码为 `runtime_sha256_metadata_unavailable`（2 条）。这表示对应记录没有可用的原有 SHA-256 元数据，不能据此对这两个文件进行逐文件历史哈希比较；文件存在和大小检查未报错。
- 本地同哈希快照的只读聚合确认：这 2 行均为 `source=legacy`、`kind=image`、`sha256=NULL`，引用 `/api/equipment-images/` 下的旧图片；大小元数据存在，未归档、未软删除。没有导出文件名或业务行。无需因这两条元数据警告重复传输归档。
- 审计覆盖范围内未发现缺文件、大小不符、已知哈希不符或无效本地引用。整个归档的异地传输 SHA-256 校验此前通过；此结果仍不证明先后获取的数据库与媒体备份处于同一时点，也不代替应用启动后的媒体访问验证。

媒体审计脚本已完成合成验证，覆盖正常归档、缺文件、大小及哈希不符、本地 external 引用、软删除文件保留、合法硬链接及链、循环/越界/重复/软链接拒绝、种子清单、报告防覆盖、数据库 sidecar 与变更检测。Python 3.12 执行通过，并通过 Python 3.10 语法检查；本地 Python 3.9 能正常运行 `--help`。控制台仅输出汇总与问题代码/计数，详细技术相对路径写入新报告；真实归档运行结果见上。

传输记录：初次 rsync 使用默认 22 端口超时；按用户确认改为 `28832` 后可密码认证。补传数据库与清单时 `xfr#0` 表示内容已一致，随后目标侧校验通过。Google 原始备份仍保留。在线媒体归档与先前数据库快照不保证处于同一时点，最终切换前仍需冻结写入并重新同步。

数据库备份命令使用 Python 标准库 Backup API，以只读 URI 连接源库，写入 `/home/dukaiyu2004/outdoor-fit-migration-*` 唯一私有目录内的 `.partial` 文件，仅在备份目标上切换 DELETE 日志模式并检查完整性，成功后生成 `outdoor-fit.sqlite` 和 `SHA256SUMS`。2026-09-24 用户回传成功输出：

- `BACKUP_OK`、`INTEGRITY_CHECK=ok`。
- 目录：`/home/dukaiyu2004/outdoor-fit-migration-bou2kze6`。
- 数据库文件：该目录内 `outdoor-fit.sqlite`，38 张业务表，15,716,352 字节（约 15 MiB）。
- SHA-256：`9e01e2f4d5b0e05cb0dac415ccffa4179e42105a76efc42df7e3788c9e46933d`。
- 已确认 Google 原始备份与阿里 ECS 校验通过的副本；源快照的逐表行数与外键检查、目标库结构及导入数据核验已完成，应用业务验证仍待进行。
- 同目录 `media.tar.gz` 已成功创建，内容限于 `data/equipment-images`、`data/media-library`、`media-seed`；用户回传 `MEDIA_BACKUP_OK`，gzip 与归档结构检查通过，`sha256sum -c SHA256SUMS` 对数据库和媒体包均返回 `OK`。
- 媒体包大小：`du -h` 显示约 `620M`；SHA-256：`d30ab0e5297c2b64b50048cc606dafbacb1ea8e50aec3f761b8d5a57c2ba45dd`。
- `SHA256SUMS` 包含 `outdoor-fit.sqlite` 和 `media.tar.gz` 两条校验记录。三文件已通过 SSH 28832 直接传到 ECS，目标侧两项均校验通过。

2026-09-24 本地临时 WAL 数据库验证通过：备份包含 WAL 中已提交记录、不包含未提交记录，快照可独立读取且完整性检查通过，源数据保持不变；源文件不存在时只读 URI 会失败且不创建空数据库。测试使用模拟数据，不代表生产备份已完成。

RDS 状态：用户在收到证书路径修复和 `VERIFY_IDENTITY` 登录命令后，回传了成功登录的新连接截图（连接 ID `536872177`）。截图确认传输加密；若按提供的命令执行，则 CA 与主机名校验也已通过。截图未展示登录命令，后续应用配置仍须明确启用证书及主机名校验。

证书问题记录：`/etc/outdoor-fit/certs/rds-ca.pem` 曾被上传为目录，导致 OpenSSL 读取失败及 MySQL `ERROR 2026`。已提供脚本，在目录中找到唯一 PEM 且 OpenSSL 解析成功后，安装到 `/etc/outdoor-fit/certs/rds-ca-chain.pem`，并使用此文件执行 `--ssl-mode=VERIFY_IDENTITY` 登录。此前 SQL `Ssl_cipher`、`Ssl_version` 为空的原因未确定，不据此否认客户端的加密证据。

DNS 结果：用户按指导配置后，回传 ECS 查询截图，两个子域名均解析为 `47.83.186.36`，STREAM/DGRAM/RAW 多行是同一解析结果。原指导为默认线路、TTL 600 秒，但控制台记录截图尚未提供，未独立核实 TTL 或权威 NS。保留主域名与 `www` 给官网。工具所在本机返回的 `198.19.x.x` 地址不作为实际公网记录证据。

尚未完成：完整后端 MySQL 移植、最终数据同步与切换、应用部署、HTTPS 配置。ECS 的 CPU、内存及磁盘容量已确认，可继续迁移演练；生产承载能力尚未经负载测试。真实 RDS 连接、TLS 身份校验、38 表结构复核及快照数据导入均已通过。

2026-09-24 数据导入完成后的后端第一批改造：新增身份仓储，同步 SQLite/异步 MySQL 各自执行固定参数化查询；登录、当前用户、删除状态、管理员鉴权和反馈身份访问已适配等待结果。管理员创建在目标查找后重新核验权限并原子写入审计，原账号删除事务保持同步；身份在最后活跃时间写入后重新读取，防止异步等待期间删除/降级失效。50 项本地相关测试通过，详见移植计划实施记录。完整 MySQL 应用启动仍被明确禁止；这些代码尚未部署，不影响 Google 运行实例。

2026-09-24 用户回传媒体恢复成功：归档 SHA 校验 OK，`RESTORE_DIR=/opt/outdoor-fit/rehearsal-media.g2Z2Kv2c`、`RESTORED_FILE_PATHS=117`、`du=624M`、`RESTORE_STATUS=OK`。保留 `data/equipment-images`、`data/media-library`、`media-seed` 三树，原始归档仍在演练目录；尚未设置容器所有权、挂载或启动应用。

媒体恢复后的第二批业务适配已在本地完成：邀请码消费/管理、学习进度合并/查询、后台文案 revision 更新均支持独立 MySQL 仓储或分支；共享管理员复核与审计写入具有事务边界。原 SQLite 同步事务不跨 await，原应用默认部署路径保留。相关业务回归 140 项、验收 CLI 9 项，共 149 项本地测试通过；真实 RDS 并发业务验收包已生成，尚未在 ECS 执行。完整应用的其余业务 SQL、媒体服务、后台任务、初始化和 CLI 仍需移植，不能据此启动 MySQL 生产应用。

- 此前准备的独立验收包（用户现已决定跳过）：`deploy/aliyun-mysql-business/aliyun-mysql-business-v1.tar.gz`，56,442 字节、17 个固定允许的源文件，SHA-256 `094f2e035c4c64c5b3cb213256bd87411a0430d66129224c2e8e9d730f2dbea8`。顶层目录为 `aliyun-mysql-business-20260924-v1`。保留归档供日后需要，不作为下一条远端操作。
- 验收固定连接 `outdoor_fit_test`，先复核结构与实际数据库；创建带独立 UUID 的少量合成记录，经两条实际连接并发验证学习证据合并、文案 revision 冲突及审计、同一注册码只能创建一个用户。所有并发操作结束后按本次精确标识清理并检查残留。源数据、媒体及密钥不在归档中；完整后端应用不在此包中。
- 每次运行在工具目录新建私有 `business-report.XXXXXXXX/business-report.json`，写库前记录本次 fixture IDs，报告通过临时文件 fsync 后原子替换。COMMIT 结果不明时不重试、不自动清理，保留核对信息；最终报告保存失败会输出 `REPORT_STATUS INCOMPLETE` 和整体 FAIL。两类磁盘故障回归及独立复核已通过。
- 成功预期：`BUSINESS_CHECK PASS`、`BUSINESS_LEARNING PASS`、`BUSINESS_APPTEXT PASS`、`BUSINESS_REGISTRATION PASS`、`BUSINESS_CLEANUP cleaned`、`BUSINESS_RESIDUAL_COUNT 0`、`BUSINESS_COMMIT_OUTCOME KNOWN`、`REPORT_STATUS FINAL`。用户尚未回传实际运行结果，不能把本地注入执行器测试视为真实 RDS 并发通过。

## MySQL 适配实施进度

- 已新增 `server/src/mysqlConfig.js`，要求真实 DNS 主机、账号、密码、数据库与可解析 CA；明确开启证书链与主机名验证，禁用多语句，默认 4 个连接、队列上限 32，保留时间和 JSON 字符串及安全范围之外的 BIGINT。
- `server/package.json` 和锁文件已新增锁定 `mysql2@3.24.4`，安装时禁用依赖脚本；核对安装版本的 `startTLS` 实现，`verifyIdentity=true` 调用 Node 主机名校验，并由配置 host 生成 SNI。
- 已新增 `server/src/mysqlDatabase.js`，提供异步 `all/get/run/transaction/close`，参数绑定、每次取连接重设 UTC 会话、事务使用专用连接并隔离并发上下文。MySQL affectedRows 不伪装成 SQLite changes；驱动错误不输出 SQL/参数；COMMIT 响应不确定时不自动重试。
- 审查发现死锁后继续写可能进入自动提交，已修复：标记事务失败，拒绝后续 SQL 和成功提交，事务请求在适配器内串行排队后检查状态。新增吞掉死锁/超时以及并行排队的回归覆盖。
- 本地配置 7 项、事务/连接 11 项及原 SQLite 建库 1 项测试通过；连接与事务使用模拟池，尚不构成真实 MySQL/TLS/并发验收。旧 app、启动入口和 SQLite 配置未切换。
- `docs/aliyun-mysql-port-plan.md` 记录 17 个数据库调用文件、异步传播与按业务事务拆分的实施顺序；`docs/aliyun-mysql-schema-plan.md` 记录 38 表的类型/索引/约束方案。二者为实施计划，不是已应用的 DDL。
- 已新增 `server/scripts/check-aliyun-mysql.js`：用实际驱动检查 TLS 套接字、证书主机名、页大小、连接排序规则、模式和测试库表数，再以只读 SELECT 检查事务连接一致、毫秒整数、中文/emoji 和 JSON 字符串。只打印固定状态与结构元数据，异常仅输出允许的错误码；不加载应用或业务数据。
- v1 的 24 项本地测试通过后，用户已在 ECS 成功构建 Docker 检查镜像（16.8 秒），但驱动连接阶段返回 `PROBE_CONNECT_FAILED`，未输出 CLIENT_TLS，尚未完成真实 RDS 驱动验证。此时没有执行建表或导入。
- 已发现并离线复现确定缺陷：mysql2 3.24.4 将配置 `utf8mb4_0900_bin` 转为 ID 309，SSLRequest/HandshakeResponse 用单字节 `writeUInt8` 写入而抛 `ERR_OUT_OF_RANGE`；v1 把该错误码归入连接失败兜底。握手现改为同属 utf8mb4 的 `utf8mb4_bin`（ID 46），握手成功后由共享 `initializeMysqlSession` 执行 `SET NAMES utf8mb4 COLLATE utf8mb4_0900_bin` 和 UTC 设置。直接检查连接及连接池每次 checkout 都调用该初始化；证书验证保持强制开启。
- v2 新增实际驱动握手数据包回归（非模拟池）和 probe 错误阶段分类；配置/协议 8 + 连接/事务 11 + probe 7 + 原 SQLite schema 1，共 27 项通过。命令为 `node --test --test-isolation=none server/test/mysqlConfig.test.js server/test/mysqlDatabase.test.js server/test/mysqlProbe.test.js server/test/database.test.js`。
- 2026-09-24 用户回传真实 ECS v2 `PROBE PASS`：CLIENT_TLS/IDENTITY_VERIFIED 均 PASS，TLSv1.2、ECDHE-RSA-AES128-GCM-SHA256；MySQL8.0.36、库 outdoor_fit_test、INNODB_PAGE_SIZE16384、COLLATION_CONNECTION utf8mb4_0900_bin、严格模式、TABLE_COUNT0。TRANSACTION_CONNECTION、MILLISECONDS_BINDING、UTF8MB4_BINDING、JSON_STRINGS_BINDING 全 PASS。此为连接及只读绑定验证，不代表写入事务、并发、DDL 或应用业务验收。
- 已实现 `server/src/mysqlSchema.js` 的受审结构映射，绑定源结构摘要 `eb0a3714329b76a1cb66ed3acc8dfa0a80d0ce98fbe732eab6910ba035a96feb`。生成 38 表、324 原列、9 内部列、96 索引、33 外键、29 CHECK，共 71 条 DDL；保留原字段并显式映射长文本、毫秒整数、条件唯一键及长字符串摘要唯一键。当前快照字段长度与 NULL 约束聚合核对冲突为 0。DDL 和结构清单位于 `deploy/aliyun-mysql-schema/schema.sql`、`schema-manifest.json`。
- `server/src/mysqlSchemaApply.js` 与 `server/scripts/create-aliyun-mysql-schema.js` 仅允许空的 `outdoor_fit_test`，同连接加锁并核验版本/严格模式/约束开关/页大小，然后建表、添加外键、从 information_schema 核验字段、默认值、索引、生成表达式及 CHECK。失败保留现场及进度报告，不自动删表或重试。结构生成 14 + 应用执行 14 + CLI 4，共 32 项本地测试通过；Bash 语法检查通过。执行器测试使用模拟连接，尚未在 RDS 执行任何建表。
- 建表工具包：`deploy/aliyun-mysql-schema/aliyun-mysql-schema-v1.tar.gz`，41,466 字节，10 个固定允许的源文件，SHA-256 `640d20c6de012f762a0a2308643011bef4068058810fedaab75f23bc2d90cc33`。顶层目录 `aliyun-mysql-schema-20260924-v1`；在 ECS 演练目录解压后运行 `bash aliyun-mysql-schema-20260924-v1/run-create-schema.sh`。报告保存到工具目录中每次新建的 `schema-report.XXXXXXXX/schema-report.json`，控制台打印 HOST_REPORT_DIR/HOST_REPORT_FILE。工具包不包含 SQLite、媒体或凭据；用户尚未回传此包的运行结果。
- 为后续导入准备了 `scripts/export-aliyun-sqlite.py` 与 `scripts/test-export-aliyun-sqlite.py`：只读独立快照，按显式原字段导出带类型标签的 JSONL，记录源/清单/每表/全流摘要，拒绝覆盖、旁路日志文件及源文件变更。6 项合成测试通过；尚未导出真实业务数据，也尚未实现和运行 MySQL 数据导入。
- 后续真实建表 v1 输出：`SCHEMA_CREATED_TABLES 38`、`SCHEMA_COMPLETED_STATEMENTS 71`、`SCHEMA_OPERATION verify_columns 71`、`SCHEMA_ERROR SCHEMA_EXPRESSION_UNSUPPORTED`、`SCHEMA_LOCK_RELEASED YES`。说明 DDL 已执行完成，失败发生在元数据表达式解析；`SCHEMA_PARTIAL YES` 表示变更已发生但整体核验未完成，不是只创建了部分表。不要重跑空库建表脚本或为此删表。
- 已向用户请求只读查询 `information_schema.COLUMNS` 中 `EXTRA LIKE '%GENERATED%' OR GENERATION_EXPRESSION <> ''` 的 TABLE_NAME/COLUMN_NAME/EXTRA/COLUMN_DEFAULT/GENERATION_EXPRESSION，使用原 VERIFY_IDENTITY + CA 连接；实际输出尚未收到。MySQL8.0.36 官方源码中 `convert_and_print` 经 `String::print` 可能把表达式外层单引号显示为反斜杠转义，是当前有依据但未由 RDS 实际输出确认的候选，不能据此盲目全局反转义或跳过约束比较。
- 已准备只读复核入口 `verifyMysqlSchema`、`server/scripts/verify-aliyun-mysql-schema.js` 及 `deploy/aliyun-mysql-verify/` 启动模板、`scripts/package-aliyun-mysql-verify.py`。CLI 三项测试及 Bash 语法已通过；等待真实表达式以完成针对性兼容修复后再打包交付。原 v1 建表归档与 SHA 保留。
- 用户已回传字段定义：默认表达式为 `_utf8mb4'[]'`、`_utf8mb4''` 等；5 个摘要生成列为 `unhex(sha2(cast(... as char charset binary),256))`，2 个条件唯一生成列为带外括号的 CASE/IS NULL。对这些 15 种去重后的实际文本格式调用原 parser 全部成功，并确认本地 parser 与 v1 归档中的实现一致。因此没有以猜测为由放宽语法或增加全局反转义。mysql2 3.24.4 的实际 text parser 对 charset 63 字段返回 Buffer，此类型输入可复现错误；新复核工具将兼容这类元数据文本并记录计数，最终原因需结合真实运行结果。
- 已完成兼容修复：仅在 schema 模块已知的元数据/状态 SELECT 别名上将 Buffer 按严格 UTF-8 解码，保留 NULL、空串、BOM，拒绝非法字节；业务连接配置与 BLOB 处理未变。控制台新增 `SCHEMA_METADATA_BUFFER_VALUES`，未知表达式还提供无内容的类型/长度/反斜杠引号计数及表/列上下文。独立 `mysqlMetadataProtocol.test.js` 使用已安装 mysql2 3.24.4 的 ColumnDefinition/TextRow/getTextParser 证明同样字节在 charset63 返回 Buffer、45/46 返回 string，空 Buffer 与 NULL 明确区分。Schema 14 + apply/verify 26 + create CLI 4 + verify CLI 3 + driver protocol 4，共 51 项测试通过；已有只读启动脚本 Bash 语法检查通过。
- 只读复核包已生成：`deploy/aliyun-mysql-verify/aliyun-mysql-verify-v1.tar.gz`，42,488 字节、10 个源文件；SHA-256 `12956bf182cd5cbf7fa752c8823def411fff6023227efc469e8874f845efdd78`。顶层目录 `aliyun-mysql-verify-20260924-v1`，运行 `bash aliyun-mysql-verify-20260924-v1/run-verify-schema.sh`，只执行连接会话初始化和元数据 SELECT，不运行 CREATE/ALTER/DROP 或数据导入。归档中的 Docker 入口、脚本 LF、受测源码与路径核对通过。成功标志 `SCHEMA_VERIFY PASS`，报告仍为新建的 `schema-report.XXXXXXXX/schema-report.json`。等待用户上传运行结果；不要重跑原空库建表脚本。
- 用户随后回传只读复核 v1 失败：`SCHEMA_METADATA_BUFFER_VALUES 0`、`SCHEMA_METADATA_KIND column_default`、`SCHEMA_TABLE admin_accounts`、`SCHEMA_COLUMN permissions_json`、`SCHEMA_EXPRESSION_TYPE string`、`SCHEMA_EXPRESSION_LENGTH 14`、`SCHEMA_EXPRESSION_BACKSLASH_QUOTE_COUNT 2`，锁释放成功。失败报告 `/opt/outdoor-fit/migration/20260924-rehearsal/aliyun-mysql-verify-20260924-v1/schema-report.qithsKeM/schema-report.json`。此次确认是 `_utf8mb4\'[]\'` 的实际外层转义，不是 Buffer；之前 CLI 贴文展示不足以确定实际字节。
- v2 修复依据：MySQL8.0.36 [String::print](https://github.com/mysql/mysql-server/blob/mysql-8.0.36/sql-common/sql_string.cc#L868-L897) 对反斜杠、单引号、NUL、LF、CR、Ctrl-Z 编码；[默认/生成表达式字典写入](https://github.com/mysql/mysql-server/blob/mysql-8.0.36/sql/dd/dd_table.cc#L269-L278) 及 [CHECK 字典写入](https://github.com/mysql/mysql-server/blob/mysql-8.0.36/sql/dd/dd_table.cc#L1675-L1684) 经 convert_and_print 使用此格式。修复仅对 I_S 的生成默认值、生成表达式、CHECK 表达式严格解码一次，再由既有 SQL parser 比较；普通默认值和编译契约不解码，不反复尝试，不跳过结构检查。
- 已完成 v2 修复：真实 14 字节默认表达式通过回归；38 表完整表达式按 MySQL 格式编码后，核验 fingerprint 与原契约一致；保留字面量撇号、反斜杠及控制字符，拒绝未知/尾部/混杂转义，双层编码只解一次后拒绝。新增 `SCHEMA_METADATA_DECODED_EXPRESSIONS` 计数。Schema14 + apply/verify31 + createCLI4 + verifyCLI3 + driverProtocol4，共 56 项本地测试通过；只读启动脚本 Bash 语法通过。
- 交付只读复核 v2：`deploy/aliyun-mysql-verify/aliyun-mysql-verify-v2.tar.gz`，42,854 字节，10 个固定允许的源文件，SHA-256 `20f647443c9915a9d9b1974f0b7db79d81b887b2203d3d542370004fc72e3318`。顶层目录及 Docker 镜像版本均为 `20260924-v2`；在 ECS 演练目录解压后运行 `bash aliyun-mysql-verify-20260924-v2/run-verify-schema.sh`。归档入口/版本/受测源码/LF 核验通过。未执行远端工具，等待用户 `SCHEMA_VERIFY PASS`，不重建、不导入。
- `scripts/package-aliyun-mysql-check.py` 从固定 7 文件白名单生成最新 `deploy/aliyun-mysql-check/aliyun-mysql-check-v2.tar.gz`（21,392 字节），SHA256 为 `1d32addba01b1fe9284add2870175b264d1878e0f29c935e1a60841e5643c949`。不包含 .env、数据库、媒体、密码或 CA。解压到新目录 `aliyun-mysql-check-20260924-v2`，不覆盖 v1。
- 工具 Dockerfile 使用 Node 22，按照 server 锁文件安装依赖并禁用安装脚本；它仅用于只读检查，不是生产应用镜像。`run-check.sh` 构建镜像后隐藏提示输入迁移账号密码，密码只传给临时容器，使用公共 CA 的临时只读副本，退出后清理。v2 镜像名 `outdoor-fit-mysql-check:20260924-v2`，不映射端口或挂载业务数据。

## 旧服务器核验

- 用户按浏览器 SSH 指导回传了 Google 服务器命令结果，远程访问已可用；Xterminal 的 Google 连接未另行验证。
- 用户名 `dukaiyu2004`，主机名 `outdoor-fit-prod`。
- 源码中出现的候选公网 IP：`35.241.75.217`。
- 已确认 systemd 服务：`outdoor-fit-api`，`LoadState=loaded`、`ActiveState=active`，当时 `MainPID=793417`。
- 已确认服务工作目录：`/home/dukaiyu2004/outdoor-fit-api`。
- 已确认进程可执行文件 `/usr/bin/node`，进程 cwd 与上述服务目录一致。
- 源进程环境：`DATABASE_PATH=./data/outdoor-fit.sqlite`、`EQUIPMENT_UPLOAD_DIR=./data/equipment-images`；未输出 `MEDIA_UPLOAD_DIR` 或 `MEDIA_SEED_DIR`。
- 实际打开的数据库文件为 `/home/dukaiyu2004/outdoor-fit-api/data/outdoor-fit.sqlite`，同时打开同路径 `-wal`、`-shm` 文件。
- systemd 环境文件：`/home/dukaiyu2004/outdoor-fit-api/.env`（`ignore_errors=no`）；未读取或记录其中密钥。
- 根文件系统 `/dev/sda1`：197 GB 总量、41 GB 已用、149 GB 可用、使用率 22%。
- 生产 `config.js` 已核对：数据库路径基于 `DATABASE_PATH`；器材目录默认在数据库同级 `equipment-images`；媒体目录默认在数据库同级 `media-library`；素材默认位于应用 `media-seed`。与本地源码一致。
- 用户 `du -sh` 核验：`/home/dukaiyu2004/outdoor-fit-api/data/equipment-images` 约 2.7 MB；`/home/dukaiyu2004/outdoor-fit-api/data/media-library` 约 311 MB；`/home/dukaiyu2004/outdoor-fit-api/media-seed` 约 311 MB。三者已打包并转至 ECS，并恢复到 `/opt/outdoor-fit/rehearsal-media.g2Z2Kv2c`。
- 公网 IP、项目 ID、zone 尚未远程确认；源快照逐表行数已经核实。首次数据库备份、媒体归档和备份异地传输均已成功（详见当前停靠点）。
- 核实数据库优先使用实际 Node 进程打开的文件描述符；MainPID 若是包装程序，继续检查其子进程。仅打印允许的路径变量，不输出整个环境或完整命令行。不能仅凭 `/proc/PID/environ` 缺少某项就断定使用默认值，生产可能通过 `--env-file` 或其他加载方式注入配置。

## 应用兼容性待办

- SQLite 源码与实际源快照均为 38 张表，字段、索引、外键已对照一致；快照包含 23 条迁移记录，后续仍须明确 MySQL 版本账本与种子数据策略。
- 当前后端使用同步 `better-sqlite3`，需要移植数据库访问、连接池与异步事务，不能仅修改数据库连接地址。
- 需要改写 SQLite SQL 方言，包括 `PRAGMA`、`INSERT OR IGNORE`、`ON CONFLICT`、部分索引、排序和 JSON/日期函数等。
- 明确每类字段的 MySQL 类型及排序规则；保留用户及业务 ID、密码盐和密码哈希、唯一约束、外键和删除行为。
- 明确 UTC 时间表示、毫秒精度、空日期哨兵值及 JSON 返回类型；保持接口行为一致。
- 重新验证注册码消费、进度合并、反馈版本检查等事务在 MySQL 并发连接下的语义，防止重复消费或更新丢失。
- 明确导入顺序、重复执行策略、种子数据和迁移版本处理方式，不以跳过错误代替完整校验。
- 实际数据中 `system_logs.metadata_json` 最大 508,268 字节、`users.avatar_data` 最大 508,019 字节、`equipment_document_previews.payload_json` 最大 95,627 字节、`messages.metadata_json` 最大 88,611 字节，不能映射成普通 MySQL TEXT；至少使用 MEDIUMTEXT 或经过接口返回类型适配的 JSON。
- 预览表毫秒时间戳需要 BIGINT；提交表虽为空，但源码同样使用 `Date.now()`。`users.phone` 必须保留长达 44 字符的匿名占位，建议 VARCHAR(64)。运动记录 ID 接口允许 100 字符，自定义器材 ID 长 43 字符，不能只根据快照最大值确定字段宽度。
- 媒体 URL 接口允许 2,048 字符，需明确完整唯一性实现；不能用 utf8mb4 长 URL 的前缀唯一索引替代原有完整 URL 唯一约束。
- 116 个现有索引键项均为 SQLite BINARY；候选 MySQL 默认规则为 `utf8mb4_0900_bin`，须另外适配 SQLite NOCASE/LIKE 的 ASCII 大小写语义。保留 NULL、空串根目录哨兵、末尾空格与业务 JSON 字符串行为。

## 后续执行顺序

1. 验证 RDS TLS；核实 ECS 资源、旧服务器运行环境与实际数据位置。
2. 完成后端 MySQL 适配、建表方案与迁移脚本，在测试库演练；不要连接旧生产库执行破坏性操作。
3. 使用一致性 SQLite 快照及配套文件备份演练导入，记录逐表行数、关键数据抽查、外键检查，以及文件数量、大小和哈希校验结果。
4. 验证登录、管理员权限、内容和媒体访问、研究记录、学习/运动进度、反馈、AI 配置与业务事务；演练部署、备份和恢复。
5. 切换前冻结旧环境的所有写入入口与后台任务，包括用户端、后台管理、同步任务和其他写入进程；获取最终一致性快照，完成最终文件同步并再次校验。
6. 切换域名、HTTPS、客户端入口及必要的旧入口转发；保持业务单写，只允许新后端写入 MySQL，避免新旧环境各自产生数据。
7. 验证线上读写、日志与备份；保留只读旧备份和必要的过渡入口，确认验收后再退役旧环境。

## 回滚约束

- 新环境尚未接收业务写入时，可按已验证的回滚方案恢复旧入口。
- **新环境已接收写入后，不能直接恢复旧 SQLite。** 必须先冻结新写入，核对并处理新增及修改数据，完成兼容恢复或经验证的数据回迁，避免丢失切换后的数据。
- 容器镜像回退与数据库回退是两件事；每次发布须确认旧镜像能否使用当前数据库结构。

## 接续记录规则

每一步完成后记录日期、执行环境、实际核验结果和下一步。未执行的步骤保持待办；不要将计划写成已完成，也不要在本文件保存连接密码或其他秘密。
