# 阿里生产环境 v2 小范围更新

本包更新科研统计 SQL 的 MySQL 排序规则处理，以及收藏页面的加载、缓存和取消收藏行为。网页沿用现有的双语团队名单和程序介绍。更新的是阿里后端与完整网页导出；已安装原生 App 的 JavaScript 需要另行通过其发布渠道更新。

固定基线：`outdoor-fit-production-20260924-v1`，原归档 SHA256 为
`3200ba265dc6a2f14838fa397cf73fdcf5dad7f0d3e08224affa9240a836a9a8`。
新发布目录为 `/opt/outdoor-fit/production/releases/outdoor-fit-production-20260924-v2`。

## 本地打包

只能在源码和 Web 导出均已冻结后执行：

```powershell
python scripts/package-aliyun-fixes.py --build --web-dir "D:\polyu work\outdoor-rehab-fit-anesthesia\tmp\aliyun-fixes-web-20260924-v2"
```

输出 `outdoor-fit-fixes-20260924-v2.tar.gz` 和 `SHA256SUMS`。文件已存在时拒绝覆盖。包只包含与不可变 v1 不同的两份后端源码、变化的网页文件、公开文件清单及部署工具。不会读取或打包生产 `.env`、数据库、上传、证书、私钥或依赖安装目录。

## ECS：准备阶段

先上传到新的私有目录，核对助手交付的实际归档 SHA256，再解压。不要运行旧 Google 的 ZIP 安装脚本。使用本包目录内的入口：

```bash
sudo python3 /本次解压目录/outdoor-fit-fixes-20260924-v2/apply-update.py stage
```

准备阶段会核对正在运行的 v1 API 镜像、62 个原后端文件及基线网页；克隆白名单文件到新目录，保留所有旧网页哈希资源，并应用增量。现场 `Caddyfile` 和 `compose.yaml` 原字节复制，保留已经验证的能力配置及域名，不使用本机尚未上线的代理模板。

镜像 v2 从本机已经存在的 v1 镜像构建，不运行 npm、不拉取基础镜像。随后校验候选 Compose/Caddy，以实际 Caddy 容器的 UID 读取网页入口并核对挂载文件哈希，再用候选 API 镜像运行纯合成 JSON 的 RDS 只读 SQL 检查；不读取业务行或执行 DML。准备阶段不修改正式环境文件，也不替换运行容器，不依赖额外 App 子域名的 DNS。

报告和环境文件备份保存在 `/opt/outdoor-fit/production/.update-state/20260924-v2` 私有目录。若准备失败，保留目录及镜像供诊断，不删除目录后盲目重跑。

## ECS：切换阶段

准备成功后，用同一份工具执行：

```bash
sudo python3 /本次解压目录/outdoor-fit-fixes-20260924-v2/apply-update.py activate
```

再次核对镜像、文件和现场配置后，正式 `production.env` 只替换 `RELEASE_TAG` 与 `ADMIN_WEB_DIR` 两行，其他字节保持不变，仍为 UID/GID 1000、权限 0400。工具使用已构建镜像启动 Compose 并等待 API 健康，再通过有效 TLS 证书检查 `api.outdoorfit.hk` 健康接口，以及 `admin.outdoorfit.hk` 网页入口和主 JavaScript 文件的实际内容哈希。全部通过才报告成功；切换期间容器可能短暂重新创建。

任何失败均输出安全错误码，不打印环境内容、数据库密码、SQL 或完整 Docker 错误。若切换失败且现场仍为本次版本，工具尝试恢复原环境文件及 v1 容器；遇到并发修改则停止并要求检查，避免覆盖其他操作。成功与失败均保留 v1 文件、镜像和私有备份。

## 只恢复代码

必要时使用同一工具显式恢复 v1：

```bash
sudo python3 /本次解压目录/outdoor-fit-fixes-20260924-v2/apply-update.py rollback
```

恢复只涉及代码、网页入口与环境文件的版本路径。不会恢复旧 SQLite、改动 RDS 数据或结构、覆盖媒体、替换 JWT/密码，亦不会启动 Google 旧 API。已经产生的新业务数据继续保留。
