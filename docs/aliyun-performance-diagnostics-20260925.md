# 阿里 ECS 只读性能采集（2026-09-25）

脚本：[inspect-aliyun-performance.sh](../scripts/inspect-aliyun-performance.sh)。在阿里 ECS 执行，需要 Bash、curl、GNU timeout 和现有 Docker 访问权限；仅检查正在运行的 `outdoor-fit-production-api-1`。

上传脚本至 ECS 的 `/root/inspect-aliyun-performance.sh` 后执行：

```bash
bash /root/inspect-aliyun-performance.sh
```

需要留存输出时可执行下面这段；报告只包含固定阶段名、状态码、时间、字节数及内存统计，没有密码、连接地址、SQL、业务记录或图片正文。`mktemp` 创建新的私有报告，不覆盖已有文件。

```bash
umask 077
report=$(mktemp /root/outdoor-fit-performance.XXXXXX)
set -o pipefail
bash /root/inspect-aliyun-performance.sh | tee "$report"
result=$?
printf 'REPORT_FILE=%s\nSCRIPT_EXIT=%s\n' "$report" "$result"
```

采集内容：

- ECS 经 HTTPS 请求 `api.outdoorfit.hk` 的 health、器材目录、两张已知主图，每个地址仅一次 GET，正文丢弃，不跟随重定向。每次是新 curl 连接，最多 20 秒、16 MiB；不带登录凭证。
- 在原有容器内运行独立短期 Node 进程，读取已有配置、CA 和密码文件，用证书身份校验连接 RDS。只执行本连接的会话初始化、`START TRANSACTION READ ONLY`、三次 `SELECT 1`、`ROLLBACK`，最后关闭连接。不会导入生产入口、启动后台任务、查询业务行、建表或修改数据。
- 同一独立进程经容器内 `127.0.0.1:3000` 请求相同四个公开接口。无需向宿主机开放 API 端口。容器内检查合计有 29 秒硬期限，单次 HTTP 最多 3.5 秒。
- 读取 `/proc` 中现有生产 Node 的 RSS 和线程数。`DIAGNOSTIC_NODE_RSS_BYTES` 属于采集进程，不能当作应用 JS 堆大小。

解读：

- `PUBLIC_*_DNS_SECONDS`、`TCP_READY_SECONDS`、`TLS_READY_SECONDS`、`TTFB_SECONDS` 都是自请求开始的累计秒数。TLS 阶段约为 `TLS_READY - TCP_READY`，TLS 完成后到首字节约为 `TTFB - TLS_READY`；后一差值仍包含 HTTP 网络往返和服务端处理，不能当作 SQL 耗时。`TOTAL - TTFB` 主要反映正文传输。
- `LOCAL_*_HEADERS_MS` 是 Node fetch 收到响应头的时间，包含 Node 客户端开销，并非精确的网络首字节计时；它与外网 curl 不属于完全相同的测试方法。
- `RDS_CONNECT_INCLUDING_TLS_MS` 包含新连接握手、认证与 TLS，不能单独分离 TLS 耗时。`RDS_DNS_MS` 是前置一次 DNS 查询，不记录地址。`RDS_SESSION_INIT_MS` 测实际应用的两条会话初始化语句；`RDS_SELECT_ONE_1_MS` 可包含首次预编译，后两次重用同连接与预编译语句。
- 此处 RDS 测试绕过应用池，**没有测到池排队、真实目录 SQL 的单独耗时或自动暂停状态**。一次新连接较慢不能证明 RDS 自动暂停。生产 API 的本地 health/目录计时才包含其现有池及接口链路，仍不能单独归因。
- `DIAGNOSTICS=PASS` 表示小样本请求完成，并非性能达标判定。图片已删除、暂时网络失败、超时等会输出安全状态并返回非零。全脚本最坏约两分钟；避免连续循环压测。

没有停止/重启容器，没有修改配置、凭证、数据或文件存储，没有触发导入/清理。普通访问可能进入服务器现有访问日志。Google 旧域名现已反向代理到阿里，不能用它作为旧服务器的性能对照。脚本在本地仅做语法与输出隐私检查，尚未在真实 ECS/RDS 执行。
