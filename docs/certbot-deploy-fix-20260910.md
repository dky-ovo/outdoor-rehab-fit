# Certbot Nginx 部署小补丁（2026-09-10）

## 原因与范围

用户提供的配置目录显示：目标网站在 `/etc/nginx/sites-enabled/outdoor-fit`，HTTPS server 引用了 `/etc/letsencrypt/options-ssl-nginx.conf`。原安装器把所有 include 都视为需要人工审查的路由配置，因此在停止 API、覆盖正式文件之前退出。原部署包下载与校验成功，失败不等于新后台已安装。

补丁不能仅根据 Certbot 文件名信任它。新辅助脚本会从 `nginx -T` 获取当前实际启用的文件，再读取该确切 TLS 配置，只接受明确的 TLS 指令及有效值；拒绝路由、访问控制、代理、再次 include、结构块、动态路径或未识别内容。无法证明安全时，依然停止。

- 不修改证书、私钥或 TLS 配置文件。
- 不删除原有 include，不改 HTTP 跳转、其他网站或原有 API 权限和请求头。
- 全站原有 25m 上传限制不变；仅文件上传接口使用 260m 限制及对应超时设置。
- 新增无写入 `--check` 预检，在依赖安装及线上文件覆盖之前检查。
- 复用已上传的完整部署包；不修改原 ZIP、API/Web 归档或任何源视频。
- 原包 SHA-256 必须为 `5573D56F81C701D657BD0DC01C9646949B20CBC4AD870E23CD53BFA1A12E47F2`。原包和补丁校验通过后，只在本次临时部署目录中替换 Nginx 辅助脚本。
- 保留原部署备份、数据库和文件保护逻辑；修正失败提示，尚未到数据库备份步骤时不再声称已有数据库备份。

## 本地验证

23 项测试通过：19 项 Nginx/TLS/路由检查及 4 项补丁安装器契约检查；JavaScript、Bash 和 PowerShell 语法检查通过。额外验证真实 server_name 识别，其他指令中的字符串不能误触发对非目标网站的修改。使用模拟文件系统验证只读预检零配置写入、失败恢复只改站点文件、不写 TLS 文件或证书。此验证不等同于已在生产服务器执行，服务器上的实际 TLS 文件仍由补丁运行时核验。

## 运行环境限制

服务器日志为 Node 20.19.2，原部署包的 OpenAI SDK 7.10.0 要求 Node 22 或以上。这是另一个未解决的兼容性问题，不是本次 Nginx 中断的原因。本补丁不升级全局 Node、服务运行环境或依赖，不会执行 npm audit fix，不应把 Nginx 修复等同于 Node 兼容问题已解决。运行环境升级需要另行安排。

## 使用

把 `outdoor-fit-certbot-deploy-fix-20260910.zip` 上传到现有 `gs://outdoor-rehab-fit/`，服务器保留原 611 MB 包。仅下载并解压小补丁，然后以 sudo 执行补丁中的 `install-file-storage-certbot-fix-20260910.sh`，参数仍为原完整部署包路径。

只有日志最后出现 `Deployment completed with inspected Certbot TLS configuration` 并通过 57 文件 / 54 视频绑定校验，才代表后台部署完成。出现新的人工审查错误时应保留输出，不要删除检查。手机 OTA 与 iOS 原生版本兼容性仍需单独处理。

本补丁在本地编写和测试；交付不代表已在服务器执行或已发布 OTA。
