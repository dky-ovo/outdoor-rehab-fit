# 阿里云正式部署

本包包含 MySQL 后端与完整后台网页。production.js 只使用 createMysqlApp，强制正式库 outdoor_fit_prod、应用账号 outdoor_fit_app、TLS CA 与主机名验证。运行时不建表、不重放种子内容、不回退 SQLite。Google 的旧 SQLite 入口保持独立。

用户已选择先上线、关闭短信找回密码。当前正式入口只接受 SMS_MODE=disabled，发送/验证短信和短信重置密码接口返回 smsUnavailable；账号密码登录、注册码注册保留。测试验证码关闭。阿里云短信开通后另行接入。

## 当前验证范围

已完成源码语法检查、MySQL 模块加载、异步调用/SQL/事务静态审查及 Expo Web 导出。演练库的 38 张表、32,314 条旧快照记录已导入校验，但不代表生产库已有最新数据。按用户要求未安排额外业务测试。本机没有运行 Docker/RDS；服务器镜像构建、配置检查和启动健康检查仍须完成。

## 部署结构

- API：非 root UID/GID 1000，外部 RDS，3000 仅容器网络可见，连接池 4，1536 MiB/1.5 CPU。
- Caddy：非 root，宿主 80/443 映射容器 8080/8443，自动 HTTPS；只处理 api.outdoorfit.hk、admin.outdoorfit.hk，256 MiB/0.5 CPU。
- web/ 是完整 Expo 导出，后台首页跳转 /admin，/api 原样代理。主域名和 www 留给官网。
- /opt/outdoor-fit/production 下持久保存媒体、证书和私有配置，不能依赖容器临时目录。
- JWT 和数据库密码以只读文件挂载，不写入镜像或 Compose 环境变量；环境文件只含路径和非敏感配置。

停止时等请求和后台设施任务结束，最长 90 秒，Compose 停止宽限为 110 秒。

Caddy 官方 2.11.4 镜像在可执行文件上设置 `cap_net_bind_service=ep`，因此 Caddy 服务在 `cap_drop: [ALL]` 后保留 `cap_add: [NET_BIND_SERVICE]`，否则即使只执行 validate 或监听 8080/8443，也可能在 exec 时返回 operation not permitted（[官方项目问题记录](https://github.com/caddyserver/caddy-docker/issues/396)）。保留非 root、只读文件系统和 no-new-privileges；API 仍移除全部 capabilities。已经发布的 v1 归档不重写，ECS 上该版本的 compose.yaml 需单独补上 Caddy 的 cap_add 行；这不需要重建 API 镜像或重跑秘密配置。

## 1. 准备结构与代码，Google 保持运行

使用独立正式迁移包运行 run-production-migration.sh schema，只在空的 outdoor_fit_prod 建结构。迁移账号须有该库 DDL+DML，应用账号仅 DML。库非空时拒绝，不删除/覆盖已有表。

将应用包解压到 /opt/outdoor-fit/production/releases/，保留包自带顶层目录 outdoor-fit-production-20260924-v1。在顶层目录运行：

```bash
bash deploy/aliyun-production/prepare-host.sh
```

脚本仅准备目录和 CA，不启动服务、不复制旧快照。

## 2. 私下迁移 JWT 并配置密码

将 capture-google-jwt.py 放到 Google 服务器，运行 sudo python3 capture-google-jwt.py。它仅从正在运行的服务提取 JWT 到新建私有文件，终端只显示文件路径。用 SSH 28832 的 rsync 把该文件传入 ECS 私有目录；不要把内容发到聊天。保留原 JWT 才能延续已签发的登录状态；若脚本拒绝旧密钥，先处理提示，不能自动换密钥后声称登录无影响。

在 ECS 上运行（jwt-source 必须替换为实际路径）：

```bash
python3 deploy/aliyun-production/configure-host.py \
  --release /opt/outdoor-fit/production/releases/outdoor-fit-production-20260924-v1 \
  --jwt-source /实际私有目录/jwt-secret
```

在服务器本地输入 outdoor_fit_app 密码和证书联系邮箱。脚本拒绝覆盖现有文件；密码和 JWT 文件为 UID 1000、0400，父目录 root、0700。不要把完整配置或秘密文件发到聊天。

## 3. 停机前完成镜像构建

在发布包顶层运行：

```bash
docker compose --env-file /opt/outdoor-fit/production/secrets/production.env -f deploy/aliyun-production/compose.yaml config --quiet
docker compose --env-file /opt/outdoor-fit/production/secrets/production.env -f deploy/aliyun-production/compose.yaml build api
docker compose --env-file /opt/outdoor-fit/production/secrets/production.env -f deploy/aliyun-production/compose.yaml pull caddy
docker compose --env-file /opt/outdoor-fit/production/secrets/production.env -f deploy/aliyun-production/compose.yaml run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Caddy 明确选用 2.11.4-alpine（[发布说明](https://github.com/caddyserver/caddy/releases/tag/v2.11.4)）。构建 Node 22 镜像后记录镜像 ID/摘要，同次切换复用已构建镜像，避免停写后重新解析基础镜像。此阶段不启动 API、不给空生产库制造新数据。

## 4. 最终停写、快照、正式导入

确认镜像、RDS 权限、安全组 80/443、DNS、旧 Google 入口代理方案就绪，再按正式迁移包 FINAL-SNAPSHOT.md 停服务、制作全新 SQLite + 媒体快照。rehearsal 是较早数据，不能当作上线时最新数据。

传到 ECS 后检查 SHA256，以新 JSONL 和该次 SQLite SHA256 执行正式 import。导入要求空表、核对结构、保留外键/唯一性检查，逐表校验后才提交。须看到 PRODUCTION_IMPORT PASS 和 DATA_COMMIT_STATUS committed。不要向非空库重复导入或自行清表。

把同次最终媒体包恢复到新私有目录，通过核对后放入正式 state 挂载位置；仅为这些明确媒体目录设置 UID 1000 所有权。旧 rehearsal 目录保留，不覆盖或混入。

## 5. 启动并切换

正式数据和媒体就绪后，在同一发布目录运行：

```bash
docker compose --env-file /opt/outdoor-fit/production/secrets/production.env -f deploy/aliyun-production/compose.yaml up -d --no-build
docker compose --env-file /opt/outdoor-fit/production/secrets/production.env -f deploy/aliyun-production/compose.yaml ps
curl --fail --silent --show-error https://api.outdoorfit.hk/api/health
```

入口检查正式库表数、必要基础记录和媒体读写权限；健康接口执行数据库查询。再确认后台页面与 HTTPS 可达。这是正式启动核对，不另建业务测试库。

已安装手机 App 仍可能请求 https://outdoor-fit.35-241-75-217.sslip.io/api 。Google 该 HTTPS 入口须代理到新 API 并保留路径；自有域名 DNS 不会修改已安装 App。代理完成后保持旧 SQLite 服务停写，防止双端分叉。未来新手机版本使用 EXPO_PUBLIC_API_BASE_URL=https://api.outdoorfit.hk/api。

阿里开始接收新写入后，不能直接恢复旧 SQLite 写入作为回退。保留旧服务、备份和报告，先协调新增数据再决定回退。
