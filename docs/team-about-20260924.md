# 关于页面调整交付记录

日期：2026-09-24。主项目继续为 `D:\polyu work\outdoor-rehab-fit-anesthesia`。

> 后续部署状态：服务已从 Google SQLite/systemd 迁至阿里 ECS Docker/RDS。本文末尾的 Google 安装命令仅保留作历史记录，不适用于当前生产环境，不能重启已停用的 Google API。关于页面内容已包含在阿里 v1 网页包中；当前科研/收藏修复与客户端更新见 `docs/aliyun-fixes-20260924.md`。

## 内容及入口

- 「设置 → 关于此程序」现在显示原先「关于我们」中的程序介绍；`copy.intro` 原文及已保存的中英文后台覆盖值不变。
- 「设置 → 关于我们」改用 `Our Team Document (24.09.2026)v2.docx` 的新名单，繁体中文、英文各有研究及开发、其他联合研究员、合作学者、项目人员四个分组，共 16 位成员。
- Word 的两栏表格按原顺序整理为适合手机阅读的单列名单；姓名、职称、职责、机构逐项保留，仅清理表格布局空白。
- 团队页面使用独立 `teamInfo.*` 字段，防止旧 `copy.team` 缓存或后台覆盖值替换新名单。旧字段保留供旧 APP 使用，后台已明确标注。
- 后台文字维护新增「关于我们（团队）」分组，43 个双语字段可编辑；完整文字目录共 854 项，前后端一致。
- 两页访客可读，无需新增权限；支持离线阅读、语言切换、返回设置和底部完整滚动。未改注册、账户和同意流程。

## 来源及核对

来源：`E:\微信\WeChat Files\wxid_ds3b0l9hqdgm22\FileStorage\File\2026-09\Our Team Document (24.09.2026)v2.docx`。

SHA-256：`7748E292FB25556B73EF5425C171BD89533DBA990F5119497E06F78334DFE4F0`。

依据文档技能读取全部段落和 8 张表格，按正文顺序建立校验 fixture；文档无批注、修订记录和图片。校验程序逐项验证分组、成员及所属机构，不将姓名对应关系仅当作文本集合检查。Windows 环境缺少技能指定的受管理 LibreOffice，未渲染源 DOCX；最终 APP 中英文页面已实际进行视觉检查。

## 验证

- 来源逐项校验、前后端文字目录一致性检查通过。
- 前端 6 个相关套件共 115 项通过；后端文字维护 17 项通过。
- 发布校验/回滚 21 项通过，1 项 POSIX 权限测试在 Windows 跳过；ZIP 安全解包 8 项通过。
- TypeScript 检查通过；Android、iOS、Web 本地导出均成功。
- 浏览器 390 × 844 手机宽度实际点击两页中英文入口、返回与切换语言；两页均可读至末尾，团队名单未遮挡，控制台无错误日志。
- 本轮未在安卓或 iOS 真机复测；没有执行 EAS Build、上传、服务器安装或 OTA 发布。

## 更新包

`deploy/2026-09-24/outdoor-fit-team-about-20260924-update.zip`

- 大小：157,843,647 字节（150.53 MiB）。
- SHA-256：`350FBED488B74C3B18DE904427BD127167AA03E403C9B524A719F472A212D3F7`。
- 包含完整 Web 和唯一后端 `src/appTextCatalog.json`，同时包含上一轮隐私声明，不需要先安装隐私声明 ZIP。
- 不修改数据库、账户、上传文件、Nginx、密钥或服务器依赖。安装前检查后端兼容性，安装时短暂重启 API 以载入文字目录。
- 不依赖外部 `.sha256` 文件；安装器含内嵌校验。详细发布机制见 `scripts/team-about-release-README.md`。

上传（电脑 PowerShell）：

```powershell
gcloud storage cp "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\2026-09-24\outdoor-fit-team-about-20260924-update.zip" "gs://outdoor-rehab-fit/"
```

安装（现有 Google 服务器 SSH）：

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-team-about-20260924-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' '350FBED488B74C3B18DE904427BD127167AA03E403C9B524A719F472A212D3F7' 'outdoor-fit-team-about-20260924-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-team-about-20260924-update.zip install-team-about-20260924.sh > install-team-about-20260924.sh &&
sudo bash /home/dukaiyu2004/install-team-about-20260924.sh /home/dukaiyu2004/outdoor-fit-team-about-20260924-update.zip
```

手机 OTA（电脑 PowerShell，两个平台顺序执行）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "更新关于我们团队及关于此程序介绍" -NonInteractive
```

等待安卓发布完成并恢复根配置后：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
npx eas-cli@latest update --platform ios --channel production --message "更新关于我们团队及关于此程序介绍" --non-interactive
```

本轮无新增原生依赖，兼容已安装版本可使用 OTA；上传服务器不会自动更新手机。
