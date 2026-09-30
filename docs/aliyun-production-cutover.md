# 阿里云正式切换操作方案

审计时间：2026-09-24。本文只新增方案，不连接远端、不修改应用或迁移实现、不新增测试。用户已要求进入正式部署，不再增加合成业务演练；以下数据一致性、账号配置和流量切换操作是上线本身的组成部分。

## 当前状态与切换依赖

1. 已新增独立 `server/src/appMysql.js` 与 MySQL 媒体/导入/设施等模块，`production.js` 已接入；旧 `app.js`/`index.js` 保留 SQLite 行为。源码语法、模块加载、静态审查及完整 Web 导出已完成，未做额外业务测试。远端镜像构建和正式启动尚未执行。最新操作顺序以 `deploy/aliyun-production/README.md` 为准；用户已明确暂时关闭短信找回密码。
2. 原演练建表/核验/导入 CLI 和 wrapper 仍固定 `outdoor_fit_test`。正式库 `outdoor_fit_prod`、运行账号 `outdoor_fit_app` 与迁移授权现已由用户创建；正式工具已单独实现，见 `deploy/aliyun-production-migration/README.md`。现有测试库 38 表、32,314 行是旧快照，不应改名充当最新生产数据，也不能重跑空库导入覆盖它。
3. 导入 CLI 的 `REHEARSAL_SOURCE_SHA256` 与 wrapper 固定旧快照 `9e01e2f4d5b0e05cb0dac415ccffa4179e42105a76efc42df7e3788c9e46933d`。Google 仍在写入；必须在最终冻结后取得新快照。Python 导出器本身通用，`sqliteExportReader` 接受显式 `expectedSourceSha256`，无需放宽其哈希核对。
4. 手机上的默认地址是 `https://outdoor-fit.35-241-75-217.sslip.io/api`（`utils/api.js`）。只修改 `api.outdoorfit.hk` 的 DNS 不会迁走已安装的客户端。

## 正式迁移工具的最小改造边界

建议新增明确命名的生产入口/包，固定目标 `outdoor_fit_prod`，保留现有演练命令的默认值和行为。仅复制 shell 并更换 `MYSQL_DATABASE` 不足以执行：底层仍会拒绝生产库。

| 位置 | 正式入口必须做到 |
| --- | --- |
| schema apply/verify 内核 | 目标库使用统一显式上下文；允许列表仅 `outdoor_fit_test`、`outdoor_fit_prod`，原入口默认且固定 test。所有 `SELECT DATABASE()` 检查、information_schema 参数、外键 referencedSchema、报告及迁移锁名使用同一目标；生产入口拒绝 test |
| data import 内核 | 同样固定生产目标，并将此目标传给结构核验；保留 SERIALIZABLE 内再次空表检查、约束启用、完整字段回读、提交未知不重试 |
| 生产 CLI/wrapper | 输入本次冻结快照的明确 SHA、源结构审计和独立数据文件；SHA 必须与源端清单、ECS 文件、导出头/尾一致。不能从任意文件自算一个 SHA 后将其当成已确认的源端值 |
| 包内容 | 仅白名单源码、DDL/结构清单；数据库、媒体、JSONL、`.env`、CA 和密码留在构建目录外，以只读挂载或运行时秘密配置提供 |
| 生产报告 | 写明目标库、新源 SHA、导出 SHA、行数、提交/回滚状态；保留私有报告，提交未知时停止，不能自动再导入或清空库 |

现已采用共享内核的每次调用目标上下文：`applyMysqlSchema`、`verifyMysqlSchema` 和 `importMysqlData` 的 `expectedDatabase` 默认仍为 test，仅允许 test/prod；旧 CLI 不接受生产目标。新的生产 CLI 固定 prod，明确要求最终源 SHA 与 JSONL 路径。实际命令及失败处理见 `deploy/aliyun-production-migration/README.md`，最终冻结采集及 rsync 命令见同目录 `FINAL-SNAPSHOT.md`。工具已生成源码包，尚未在远端执行。

新快照可复用相同的 38 表类型方案，但要先比较结构。`mysqlSchema.js` 固定审核过的源结构指纹；如果线上 schema 已变化，必须处理实际结构差异，不能只改哈希常量来跳过拒绝。生产库名参与外键元数据指纹，不能要求生产 fingerprint 等于 test 库原值。

## 按此顺序完成切换

1. **先准备可启动的正式程序。** 完成当前代码缺口后，Node 22 容器使用明确 MySQL bootstrap，容器内部监听 `0.0.0.0`，API 只对容器网络或宿主回环开放，由前置代理对外提供服务。启动等待连接、必要初始化和媒体挂载准备完成；导入库不重播 SQLite DDL、不自动覆盖已导入配置或种子。此时 Google 继续服务。
2. **创建生产库和两个角色账号。** 在 RDS 控制台新建空 `outdoor_fit_prod`（utf8mb4；表仍明确 `utf8mb4_0900_bin`）。迁移账号仅对生产库临时授予所需 DDL+DML；应用使用独立 `outdoor_fit_app`，仅授予生产库 `SELECT, INSERT, UPDATE, DELETE`，不授予 CREATE/ALTER/DROP/GRANT。初始化 DDL 与应用运行分开，迁移完成后撤销不再需要的生产 DDL 权限。[阿里云账号权限说明](https://www.alibabacloud.com/help/zh/rds/apsaradb-rds-for-mysql/account-permissions)
3. **提前完成入口与持久目录。** `api.outdoorfit.hk`、`admin.outdoorfit.hk` 指向 `47.83.186.36`，分别具备有效 HTTPS。主域名及 `www` 留给官网。API 全路径含媒体均进入后端；admin 域名的 `/api` 与 `/api/*` 同域反代，其他路径使用完整 Expo 静态导出，`/admin` 由 SPA fallback 到 `index.html`。API 错误不能返回静态 HTML。
4. **预传大文件，缩短冻结时间。** 保留已校验的演练包，另建本次正式迁移目录。可以先同步媒体到该新目录，切换窗口再做最终同步；原来分别在线获取的 SQLite/媒体包不能证明同一时点。生产媒体树保留 `data/equipment-images`、`data/media-library`、`media-seed` 相对结构。
5. **进入一次维护窗口，冻结所有源写入。** 旧入口先进入维护响应，等待进行中的上传和写请求结束，停止 `outdoor-fit-api` 及已确认的其他写入者/定时任务。不要让管理员在冻结后继续改数据，也不要同时启动新旧写入服务。主服务包含设施同步定时器，停主服务会一并停止该进程内任务；独立服务/cron 是否存在仍需采集确认。
6. **在冻结期间获取最终数据库和媒体。** 对已确认的 SQLite 路径使用现有 Python Backup API 流程生成独立私有快照；即使已停服务，也不要只复制可能遗留 WAL 的主文件。目标快照执行完整性检查、记录结构及行数摘要。随后归档或最终同步三棵媒体树，记录文件清单与 SHA；数据库与媒体取得完成前保持源写入停止。不要覆盖 `outdoor-fit-migration-bou2kze6` 或已验收的演练文件。
7. **Google 直接传到 ECS。** 使用已确认的 SSH `root@47.83.186.36:28832`、rsync 断点续传，密码仅在交互提示输入。只传本次快照、媒体和 SHA 清单；在 ECS 比较源端清单。数据转换 JSONL 留在新私有目录并排除 Docker build context。最终归档/数据库路径由该次输出确定，不复用 rehearsal 固定路径。
8. **一次性正式建表与导入。** 新生产入口创建空结构，以新快照导出并导入空 `outdoor_fit_prod`。导入器已有的逐字段回读、摘要/生成列核对和 commit 报告必须保留；这是确认搬运没有丢数据，不是增加一轮合成业务测试。遇到 `commitStatus=unknown` 保持维护状态，先核对现状，不能重跑清库导入。
9. **挂载最终媒体和秘密配置，启动阿里服务。** 媒体目录属实际容器 UID；上传树可写，种子/CA只读；RDS `host` 仍用内网 DNS，CA 为 `/etc/outdoor-fit/certs/rds-ca-chain.pem` 的有效文件内容，容器内映射路径与 `MYSQL_SSL_CA` 一致，保持 `rejectUnauthorized`/`verifyIdentity`。运行账号使用正式库，避免误接有数据的 test 库。
10. **确认实际入口后切换旧站反代。** 确认服务已启动并连上生产库、正确加载最终媒体；检查新域名的健康响应及既有媒体路径，再将 Google 的旧 API 路由转发至阿里。此时才开放写入；记录首次生产写入时间和最终源 SHA。旧 Google 应用保持停止，只留下 HTTPS 反代和证书续期。

步骤 5 之前可随时撤回部署准备；步骤 5–9 若新库尚未接收业务写入，可以恢复 Google 原服务并撤销维护页。阿里开始接收写入后，不能简单恢复旧 SQLite 接流量，否则新记录会丢失；此时先冻结阿里写入，导出并协调新增数据后再决定回切。保留源机、源快照及报告，不自动删除。

## 运行配置必须保留的内容

- 保留当前生产 JWT 签名密钥的原值才能让旧手机令牌继续有效；通过私有文件/安全传输迁移，权限 0600，不在终端回显、不打包、不粘贴到聊天。若主动轮换，需要接受全部旧令牌失效，不应把它误判为数据库迁移失败。
- 同样私有迁移实际使用的短信/AI/推送配置；导入库可能已含部分应用配置，不用空默认值覆盖。生产显式设置 `NODE_ENV=production`、`TEST_SMS_CODE_ENABLED=false`，短信模式使用已确认的线上方式，不能因缺配置默认启用 mock。
- RDS 连接只需 ECS 私网访问；当前同 VPC，保留 ECS 来源白名单。无需为 Google 旧反代开放 RDS 公网或 3306。
- Google 到阿里 API 的 HTTPS 使用公共网站 CA 信任库；它与 MySQL 的 RDS CA 文件用途不同，不能互相替代。

## 旧 sslip.io 入口继续工作

旧地址把 `35.241.75.217` 编在主机名中；客户端仍会访问该 IP，域名提供方按名称中的 IP 解析。要保持这些客户端可用，保留 Google 公网 IP、该站 HTTPS 证书和 Nginx，不提前关机。后续新 App/适用 runtime 的更新改用 `https://api.outdoorfit.hk/api`，待旧版本使用情况确认后再退役旧入口。[sslip.io 服务说明](https://sslip.io/)

在旧站已核对的 API location 内替换上游，保留原访问限制、媒体上传大小/超时及 TLS 配置。下列是代理指令模板，不是完整可覆盖的站点配置；所有原来更具体的 `/api/...` location（尤其上传）也要指向相同新上游，否则会有请求继续进入已停止的 Google 应用。

```nginx
proxy_pass https://api.outdoorfit.hk;
proxy_http_version 1.1;
proxy_set_header Host api.outdoorfit.hk;
proxy_set_header Authorization $http_authorization;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_ssl_server_name on;
proxy_ssl_name api.outdoorfit.hk;
proxy_ssl_verify on;
proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
proxy_ssl_verify_depth 5;
proxy_next_upstream off;
```

`proxy_pass` 后不加 URI 尾斜杠，保留 `/api/...` 路径与查询参数；保留 Authorization 和请求体，覆盖旧媒体地址。跨域 301/302 会依赖客户端重定向行为，不能作为旧 App API 的透明切换。TLS 校验必须显式启用。根据实际链路配置可信代理来源，不能将任意客户端 X-Forwarded-For 当作可信 IP；不盲设 Express `trust proxy=true`。[Nginx 代理与 HTTPS 上游说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

## 现在向 Google 源服务器采集的最少信息

最新操作：应用账号真实连接和权限、ECS 80/443 安全组及 Caddy validate 已由用户确认完成。Google 进程路径与数据位置已在前序确认；下一项只采集旧 Nginx 入口。采用 `deploy/aliyun-production/inspect-google-routing.py` 的只读摘要，补充下方历史命令未包含的 location、include、上传设置及安全 header 摘要；脚本通过 inline heredoc 交付，不在冻结的 v1 发布包内。REVIEW 行仅表示摘要隐藏了相关值，需据实际配置处理，不能当作配置错误或直接覆盖依据。

以下两段均为只读，可在现有 Google SSH 终端执行。不要执行 `cat .env`、`systemctl show --property=Environment`、完整 `ps aux` 或直接粘贴 `nginx -T` 输出。

第一段确认主服务、工作目录、进程真实数据路径和有限的非秘密配置；只打印白名单字段，未设置时打印 `<default>`。

```bash
hostname
systemctl show outdoor-fit-api --no-pager \
  --property=LoadState --property=ActiveState --property=MainPID \
  --property=WorkingDirectory --property=User
sudo python3 - <<'PY'
import os
import subprocess

pid = int(subprocess.check_output([
    'systemctl', 'show', 'outdoor-fit-api', '--property=MainPID', '--value'
], text=True).strip())
if pid <= 0:
    raise SystemExit('SOURCE_SERVICE_NOT_RUNNING')
base = '/proc/' + str(pid)
print('EXE=' + os.readlink(base + '/exe'))
print('CWD=' + os.readlink(base + '/cwd'))
with open(base + '/environ', 'rb') as stream:
    env = dict(item.partition(b'=')[::2] for item in stream.read().split(b'\0') if b'=' in item)
for name in ['PORT', 'NODE_ENV', 'DATABASE_PATH', 'EQUIPMENT_UPLOAD_DIR',
             'MEDIA_UPLOAD_DIR', 'MEDIA_SEED_DIR', 'SMS_MODE', 'TEST_SMS_CODE_ENABLED']:
    value = env.get(name.encode())
    print(name + '=' + ('<default>' if value is None else value.decode('utf-8', errors='replace')))
files = set()
for fd in os.listdir(base + '/fd'):
    try:
        target = os.readlink(base + '/fd/' + fd)
        if any(part in target.lower() for part in ('.sqlite', '.db', '-wal', '-shm')):
            files.add(target)
    except OSError:
        pass
for target in sorted(files):
    print('OPEN_DATABASE_FILE=' + target)
PY
```

第二段只提取 Nginx 路由所需元数据，代理 URL 只输出 scheme/主机/端口，不输出认证信息、查询参数或路径。原始配置不会打印；这些摘要足够定位后续应编辑的站点文件，但不能代替编辑时保留原 ACL/header/include。

```bash
sudo python3 - <<'PY'
import re
import subprocess
from urllib.parse import urlsplit

result = subprocess.run(['nginx', '-T'], stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True)
if result.returncode:
    raise SystemExit('NGINX_CONFIG_READ_FAILED')
source = '<unknown>'
for line in result.stdout.splitlines():
    found = re.fullmatch(r'# configuration file (/.+):', line)
    if found:
        source = found.group(1)
        continue
    line = line.strip()
    if re.fullmatch(r'server_name\s+[A-Za-z0-9.*_ -]+;', line):
        print('NGINX_SERVER', source, line)
    elif re.fullmatch(r'listen\s+[0-9A-Fa-f:.\[\] ]+(?:\s+(?:ssl|http2|default_server|ipv6only=on|ipv6only=off))*;', line):
        print('NGINX_LISTEN', source, line)
    elif re.fullmatch(r'root\s+/[A-Za-z0-9_./-]+;', line):
        print('NGINX_ROOT', source, line)
    elif line.startswith('proxy_pass ') and line.endswith(';'):
        try:
            value = urlsplit(line[len('proxy_pass '):-1].strip())
            if value.scheme in ('http', 'https') and value.hostname:
                print('NGINX_UPSTREAM', source, value.scheme, value.hostname, value.port or ('443' if value.scheme == 'https' else '80'))
            else:
                print('NGINX_UPSTREAM_REQUIRES_LOCAL_REVIEW', source)
        except ValueError:
            print('NGINX_UPSTREAM_REQUIRES_LOCAL_REVIEW', source)
PY
systemctl list-timers --all --no-pager
df -h /home/dukaiyu2004/outdoor-fit-api
```

另需操作者确认是否存在其他写同库/媒体的进程、cron 或手工脚本；不要求回传其命令内容或凭据。若第一段显示主 PID 不是 Node，需要对其实际 Node 子进程按相同白名单采集，不能从 shell 管理进程的环境推断应用路径。
