# 官网独立发布（阿里云）

本目录部署 `https://outdoorfit.hk/`，`https://www.outdoorfit.hk/` 保留路径并以 308 跳转到主域名。现有 `app`、`api`、`admin` 路由原样保留。只重建 Caddy，会有短暂入口连接中断；API 容器、数据库、手机客户端、媒体文件不作修改。

## 交付目录

```text
public-website-20260928/
  install.py
  build_manifest.py
  website-manifest.json
  website/
    index.html
    ...仅已审阅的静态网站文件...
```

网站完成后，把可发布静态文件放入本目录下的 `website/`，再运行 `python build_manifest.py`。也可用 `--website <目录> --output <清单路径>` 对指定目录生成清单。打包时必须同时包含清单与相应网站文件。清单校验逐文件 SHA-256、大小及完整文件集合；不允许链接、隐藏文件、密钥、数据库或服务器脚本混入官网。

## 服务器执行

父级交付包应保存为本目录的 `outdoor-fit-public-website-20260928-v1.tar.gz`，归档内顶层目录固定为 `public-website-20260928/`，其中含 `install.py`、`website-manifest.json` 和 `website/`。不要把 tar 包自身放进 website，也不要把私有服务器配置加入包。正式交付时另给归档的实际 SHA-256。

Windows PowerShell 上传（仅在交互提示时输入 SSH 密码）：

```powershell
scp -P 28832 "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\public-website-20260928\outdoor-fit-public-website-20260928-v1.tar.gz" root@47.83.186.36:/root/
ssh -p 28832 root@47.83.186.36
```

先用交付时的实际 SHA-256 核对 `/root/outdoor-fit-public-website-20260928-v1.tar.gz`，然后在 SSH 的 Bash 里运行：

```bash
set -euo pipefail
umask 077
cd /root
update_dir="$(mktemp -d /root/public-website-install.XXXXXXXX)"
printf 'WEBSITE_PACKAGE_DIR=%s\n' "$update_dir"
tar --extract --gzip --file=outdoor-fit-public-website-20260928-v1.tar.gz \
  --directory="$update_dir" --no-same-owner --no-same-permissions --keep-old-files
python3 "$update_dir/public-website-20260928/install.py" --check
python3 "$update_dir/public-website-20260928/install.py"
```

`--check` 只读取包、当前容器和配置，不写入文件、不验证候选、不重建容器。正式安装自动从现场 Caddy 的 Compose labels 和 mounts 识别当前配置，拒绝镜像/挂载漂移；不依赖早期 v2 路径。完整展开配置仅存于权限 0700 的状态目录，JSON 文件 0600，勿复制到公开网站或聊天。

安装将新增发布目录 `/opt/outdoor-fit/production/releases/public-website-20260928-v1/`，新挂载目标是独立的 `/srv/website`。发布目录及其所有子目录明确设为 0755，静态文件 0644，使 Caddy 的 UID 1000 可遍历和读取；候选 Caddyfile 为 UID/GID 1000、0600，通过单独文件 mount 供 Caddy 读取。私有状态目录仍为 0700，不把该状态目录作为站点根目录。旧 Caddyfile 保留不改。若已有主域名、官网挂载、通配域名或外部配置 import，脚本会停止供人工核对，不覆盖已存在官网。现有版本目录不得删除后盲目重跑。

先验证候选配置，随后仅以 `--no-deps --no-build --pull never --force-recreate caddy` 激活 Caddy，不构建/拉取镜像。网站处理片段同时用于主站和容器内部 `127.0.0.1:8099` 探针，该端口不会映射到宿主；探针携带官网 Host 头核对首页字节 SHA，因此 DNS 尚未配置时也能验证静态文件已被 Caddy 正确提供。此项不代表公网 HTTPS 已生效。

成功输出包含：

```text
WEBSITE_LOCAL_INDEX=PASS
WEBSITE_EXISTING_HOSTS=PASS
WEBSITE_API_CONTAINER_UNCHANGED=PASS
WEBSITE_INSTALL=PASS
WEBSITE_PUBLIC_HTTPS=NOT_YET_VERIFIED
```

## DNS 与 HTTPS

在阿里云 DNS 为 `outdoorfit.hk` 配置下列记录，现有 `app`、`api`、`admin` 记录保留：

| 主机记录 | 类型 | 值 |
| --- | --- | --- |
| `@` | A | `47.83.186.36` |
| `www` | CNAME | `outdoorfit.hk` |

DNS 生效、Caddy 自动签发证书后执行：

```bash
python3 install.py --verify-https
```

若仍在同一个 SSH shell，可直接使用 `python3 "$update_dir/public-website-20260928/install.py" --verify-https`；重新登录则使用先前输出的实际解压路径。

该步骤正常验证公开 TLS，核对主域名首页哈希、www 的 308 重定向以及现有三站点。只有输出 `WEBSITE_HTTPS=PASS` 后才可视为域名正式完成。它不会重启容器，不关闭 TLS 校验；若解析/证书尚未就绪，等待后重试这一步。

## 回退与诊断

状态和回退脚本保存在 `/opt/outdoor-fit/production/.update-state/public-website-20260928-v1/`。激活或核验失败会尝试仅恢复旧 Caddy 服务。SSH 中断后先检查状态，必要时运行：

```bash
bash /opt/outdoor-fit/production/.update-state/public-website-20260928-v1/rollback.sh
```

若其他人员已更改 Caddy，请先核对再回退，避免覆盖后续配置。脚本只打印固定状态码；具体命令诊断保存为私有 `diagnostics.log`，可能含配置内容，不能公开。不会自动删除任何备份或发布目录。安装锁只阻止本官网安装器重复运行，执行期间请勿并行运行其他服务器更新。

参考：[Caddy 配置验证](https://caddyserver.com/docs/command-line#caddy-validate)、[Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)。
