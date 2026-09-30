# 隐私声明交付记录（2026-09-24）

## 实现范围

- 主项目仍为 `D:\polyu work\outdoor-rehab-fit-anesthesia`，未修改 E 盘项目副本。
- 设置中新增「私隱政策聲明 / Privacy Policy」，位于免责声明下方；访客与注册用户均可访问。
- 声明随 APP 语言切换，繁体中文、英文各 7 节；完整内容随 APP 打包，可离线阅读。
- 新页面支持长文滚动、文字选择、安全区留白及返回设置；没有改变注册或同意流程。
- 后台现有 APP 文字维护增加「隐私政策声明」分组，可分别维护中英文标题及正文，共 26 个双语正文字段；沿用现有文字编辑权限。
- 本次仅加入用户提供的声明，不代表对文中隐私、加密或法律合规陈述作出审计结论。

## 文档来源核对

来源：`E:\微信\WeChat Files\wxid_ds3b0l9hqdgm22\FileStorage\File\2026-09\Outdoor Fit 私隱政策聲明.docx`。

SHA-256：`418E64A40766E1F5D16BE6F571514250799A3E56953565DC044FD700DF596E83`。

已依据文档技能提取 Word 正文及 OOXML 结构，逐节核对标题、正文和项目符号；Word 中的两处批注未作为修改正文的指令，未发布到 APP。英文首节两个连续段落合并为一个包含换行的显示块，词句保持不变。当前 Windows 文档运行环境不提供技能要求的受管理 LibreOffice，因此未进行 DOCX 渲染，视觉检查针对最终 APP 页面完成。

## 验证结果

- `node scripts/verify-privacy-policy-source.cjs`：通过，2 种语言、14 节，与原文一致。
- 文字目录生成和一致性检查通过：前后端均为 811 个字段。
- 隐私声明、联系我们、体能活动建议、后台文字维护及文字覆盖工具：5 个前端测试套件，94 项通过。
- 后端文字维护与权限：16 项通过。
- 发布校验、应用与回滚：14 项通过；1 项 POSIX 权限测试在 Windows 跳过。
- ZIP 安全解包：8 项通过。沙箱限制临时目录创建，提升执行权限后通过；无服务器连接。
- TypeScript 检查通过；Android、iOS、Web 本地导出均成功。
- 本地浏览器 390 × 844 宽度实际点击：设置入口、中文全部章节和最后一段、返回设置、切换英文、英文最后一段均正常；页面控制台没有错误日志。
- 未在 Android/iOS 真机上执行本轮检查；导出成功不等于原生安装包 Build 或 OTA 已发布。

## 部署包

`deploy/2026-09-24/outdoor-fit-privacy-policy-20260924-update.zip`

- 大小：157,838,082 字节（150.53 MiB）。
- SHA-256：`C22F115050C98E7B7A1940C2F7C4C62F57749BB4C8D45BAFEE1A9C5990EFDE8D`。
- 251 个 ZIP 条目；246 个完整 Web 文件和唯一后端目录文件的 247 个有效载荷哈希全部复核通过。
- 唯一后端更新为 `src/appTextCatalog.json`；不覆盖数据库、账户、上传文件、环境配置、依赖或 Nginx。
- 安装前检查现有后台版本和文字目录兼容性，不兼容时会在停止服务或替换文件前退出。安装会短暂重启 API 以读取新目录。
- 已保存的后台文字覆盖值不会清除；完整 Web 来自当前 D 盘代码，不是只含单页的差分包。
- 尚未上传、安装、发布 OTA 或触发 EAS Build。

## 上传（Windows PowerShell）

```powershell
gcloud storage cp "D:\polyu work\outdoor-rehab-fit-anesthesia\deploy\2026-09-24\outdoor-fit-privacy-policy-20260924-update.zip" "gs://outdoor-rehab-fit/"
```

## 安装（现有 Google 服务器 SSH）

不需要额外 `.sha256` 文件。请完整复制，保持 `unzip` 与 `>` 在同一行。

```bash
cd /home/dukaiyu2004 &&
gcloud storage cp gs://outdoor-rehab-fit/outdoor-fit-privacy-policy-20260924-update.zip /home/dukaiyu2004/ &&
printf '%s  %s\n' 'C22F115050C98E7B7A1940C2F7C4C62F57749BB4C8D45BAFEE1A9C5990EFDE8D' 'outdoor-fit-privacy-policy-20260924-update.zip' | sha256sum -c - &&
unzip -p outdoor-fit-privacy-policy-20260924-update.zip install-privacy-policy-20260924.sh > install-privacy-policy-20260924.sh &&
sudo bash /home/dukaiyu2004/install-privacy-policy-20260924.sh /home/dukaiyu2004/outdoor-fit-privacy-policy-20260924-update.zip
```

## 手机 OTA（Windows PowerShell，顺序执行）

本轮无新增原生依赖，兼容的已安装版本可通过 OTA 更新。服务器部署不会自动更新手机。

Android preview：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "设置新增中英文隐私声明" -NonInteractive
```

等待安卓发布完成并恢复配置后，iOS production：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"
npx eas-cli@latest update --platform ios --channel production --message "设置新增中英文隐私声明" --non-interactive
```
