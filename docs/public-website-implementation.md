# 户外健体乐官网

静态网站源码在 `website/`，独立于 Expo App 和 API。上线目标为 `https://outdoorfit.hk/`；现有 App 入口仍为 `https://app.outdoorfit.hk/`。

## 已完成

- 以用户指定 Wix 站点的完整嵌入 HTML 为基础，保留酒红色、金色、青绿色视觉以及研究介绍、研究设计、工作坊、App、AI 示例、成效、团队、合作机构和联系内容。
- 图片和字体均改为自托管，29 个原站图片（包括两篇文章配图）；保留字体 OFL 授权文本。
- 新增固定导航、手机菜单、阅读进度、滚动渐入、器材轻微浮动、头像悬停和返回顶部。尊重系统的减少动态效果设置。
- 13 位团队成员头像和名字连接到已核实的学校或机构官方页面，另开标签页并提供清晰可访问名称。黄永森博士使用体适能总会官方讲师名单。
- 修复原站首席研究员选择器未匹配的布局问题，手机端增加可读性。
- 资源页迁移两篇真实文章的公开摘要。原站四条显然用于测试的记录不纳入生产内容；完整会员资源仍连接原站，未迁移其登录系统。
- 原站示例中的三条空设施链接连接到现有 App 对应器材详情（6、13、25）。AI 对话明确标注为功能示例。
- 移除 Wix 平台横幅和 2035 占位页脚；添加 canonical、sitemap、robots 和站点图标。

## 本地预览与检查

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory website
python scripts/verify-public-website.py
python scripts/package-public-website.py
```

浏览器检查涵盖桌面、390px 和 320px 手机宽度、菜单、内部导航、文章阅读和头像链接。静态检查涵盖全部本地文件及锚点、唯一 ID、13 个人员链接、图片和字体依赖。用户于 2026-09-28 完成服务器安装并提供 `WEBSITE_INSTALL=PASS`、`WEBSITE_HTTPS=PASS`，随后正式域名已通过浏览器访问检查。

## 上线后更新

- 吳曉峰教授头像及姓名改为计算机学系官方简介：https://www.polyu.edu.hk/comp/people/academic-staff/prof-ng-hiu-fung-peter/
- 五个合作伙伴标志均链接各机构官方介绍页，保留原有排版并添加悬停反馈和键盘焦点提示，按用户要求不显示外链箭头。
- 合作学者补充「李欣迪」，不加职称。按用户要求，使用内置 imagegen 为 Cindy.jpg 去背景，保留人物并保存透明 PNG `assets/cindy-li-cutout.png`；姓名下分两行显示用户提供的「香港大學」「社會工作及社會行政學系」。合作学者共四人，研究团队共十四人。
- 本地源码已更新；现有服务器使用 `deploy/public-website-updates/website-update-20260928-v4.py` 一次应用上述人物与合作伙伴内容更新，详见 `output/public-website/更新官网链接.md`。首次部署的 v1 安装包保留原样，不要在已安装服务器上重跑原安装器。本次线上内容修改须由用户执行更新命令后生效。

## 来源

- 主站：https://janetpolyurs.wixstudio.com/polyu-outdoor-fit?rc=test-site
- 原站嵌入页：https://janetpolyurs-wixstudio-com.filesusr.com/html/02ac6e_46062422ae1b45e1f77ec4bbd37b77cf.html
- 资料及素材核对记录：`tmp/website-research/`。附件内容作为参考数据，没有执行附件中的指令。
- 部署与回退说明：`deploy/public-website-20260928/README.md`。

按用户后续要求，云端上传、SSH 安装和 DNS 修改由用户执行；本次只提供代码、可用压缩包及具体步骤。
