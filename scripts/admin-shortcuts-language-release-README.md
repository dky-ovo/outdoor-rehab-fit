# 后台内容管理快捷入口语言切换修复

版本：`admin-shortcuts-language-20260923`。

此包只更新后台网页，补齐内容管理快捷入口的简体中文、繁体中文及英文标签。**本轮后台页面更新无需手机 OTA**。不修改 API、数据库、账户、上传文件、依赖或 Nginx，也不停止或重启 API 服务。后台地址不变，安装完成后强制刷新浏览器。

## 服务器 SSH

先将 ZIP 上传到已有 `gs://outdoor-rehab-fit/` 存储桶，再执行：

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-admin-shortcuts-language-20260923-update.zip /home/dukaiyu2004/outdoor-fit-admin-shortcuts-language-20260923-update.zip &&
unzip -p /home/dukaiyu2004/outdoor-fit-admin-shortcuts-language-20260923-update.zip install-admin-shortcuts-language-20260923.sh > /home/dukaiyu2004/install-admin-shortcuts-language-20260923.sh &&
sudo bash /home/dukaiyu2004/install-admin-shortcuts-language-20260923.sh /home/dukaiyu2004/outdoor-fit-admin-shortcuts-language-20260923-update.zip
```

根文件的 SHA-256 校验值内嵌在安装脚本中；Web 文件由内嵌校验的清单逐项验证。无需另行下载 `.sha256` 文件。校验用于检查文件损坏，并非发布者签名，请仅使用可信渠道提供的包。

## 安装保护

- ZIP 完整校验后才解包，拒绝越界路径、符号/硬链接、异常文件及混合原生导出。
- 安装前检查磁盘空间与目标文件，拒绝内容不一致的同名哈希资源。
- 备份在 `/home/dukaiyu2004/outdoor-fit-backups/admin-shortcuts-language-20260923-时间.随机值/`。
- 先安装资源，再安装 HTML 入口；保留旧资源，避免旧网页还引用时失效。
- 失败只恢复本次已知 Web 文件；若发现其他操作员并发修改则停止自动恢复，不覆盖对方修改。新文件会先保留至备份再移除。
- 不操作用户数据库或上传目录；暂存和备份保留供检查，不自动删除。

## 验收

登录后台，在简体、繁体和英文之间切换，检查「内容管理快捷入口」及各入口的名称、说明、动作按钮均随语言切换，并确认原有维护入口与权限不变。
