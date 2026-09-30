# iOS 页面布局与返回动画检查（2026-09-12）

## 本轮范围

针对用户反馈的 iOS 主页背景、设施教学底部滚动、详情右上位置按钮和返回动画进行本地修改。不改变功能、内容、访问权限、视频进度记录、计时流程或原有返回目的地。

本轮没有发布 OTA、创建 EAS Build、提交 Apple 或更新服务器。当前手机中的 Build 17 不会因为本地修改而自动变化。

## 修改与依据

### 1. 主页背景图

- 使用原有 `assets/images/hk.jpg`（5378 × 3586），不替换图片。
- 按主页背景容器的实际宽高计算等比例图片边界，避免百分比尺寸与原生 transform 混合定位。
- 保留此前的 1.14 倍缩放、向下偏移、问候文字、容器高度和首页其他内容。
- 原生端读取图片尺寸；Web 没有 `Image.resolveAssetSource` 时使用资源元数据或原图尺寸，不阻断页面加载。
- 这是针对布局稳定性的修正。尚无用户提供的异常截图，不能断言已经确认其具体视觉异常根因。

代码：`app/(tabs)/index.js`、`utils/homeHeroLayout.js`。

### 2. 设施教学底部滚动

- iOS 底部标签栏是绝对定位，高度为 78pt 加系统安全区；原详情仅用外部 marginBottom，无法为最后内容提供足够的可滚动空间。
- 分类、列表和详情统一读取实际底栏高度，在滚动内容内部增加底栏高度加 16pt 的余量；同步滚动指示器位置，避免自动 inset 重复计算。
- 分类页保留顶部安全区；Android 和 Web 保留原有底部间距，不额外重复加底栏。
- 详情滚动容器明确使用剩余高度，GIF 行不再使用可扩张压缩的 flex:1；长说明、视频和后台追加内容不设置固定内容总高度。

代码：`hooks/useFacilityScrollInsets.js`、`app/(tabs)/outdoor/index.js`、`list.js`、`detail.js`。

### 3. 右上角位置按钮

- 独立组件固定中文宽 76pt、英文宽 104pt，高 44pt。
- 图标 20pt、图文间隔 4pt，文字单行并限制放大比例，避免原生标题栏对子视图宽度测量不稳定。
- 不改变位置来源参数、设施编号或地图跳转目的地。
- 未升级原生导航依赖，也没有使用当前安装的 react-native-screens 4.16.0 未实现的 iOS 26 `hidesSharedBackground` 原生属性。
- 原生导航栏留白的实际表现仍需对应 iPhone 截图和系统版本复核。

代码：`components/FacilityLocationHeaderButton.js`、`app/(tabs)/outdoor/detail.js`。

### 4. 返回动画

- 多个页面为确保返回到指定上一级，使用 `router.replace`。已核对当前 Native Stack 的默认替换动画为 push，导致返回看起来仍是进入页面。
- 仅 iOS 功能子栈设置 `animationTypeForReplace: "pop"`，让返回替换使用与进入相反的动画方向。
- 应用在 outdoor、goals、chat、equipmentmap、location、participant-usage、research、risk、sessionlog、setting、stats 共 11 个功能栈。
- 不修改返回 handler、参数或父级目的地；正常 push、back、dismissTo 维持原语义。
- 根登录/入门流程、主 Tabs 和计时子栈不应用此规则；计时页面继续保留原有 `animation: "none"` 防闪屏处理。

代码：`utils/stackNavigationOptions.js` 及上述功能的 `_layout`。

## 验证结果

- 最终前端回归：81 个测试套件、931 项测试通过，1 个快照通过。
- TypeScript：`tsc --noEmit` 通过。
- 最终 iOS JavaScript 导出成功（2145 个模块）。这不是 Xcode 编译或云端 Build。
- 最终 Web 导出成功（1920 个模块）。
- 新增与本轮直接相关的测试：主页布局/资源兼容 22 项、设施滚动/按钮布局 11 项、iOS 返回配置及路由行为 28 项，共 61 项。
- `app.json` 校验值与修改前一致，未改变 Expo 项目、版本和发布账号配置。
- 后端应用代码未修改，本轮未重新执行后端全量测试。

使用隔离的本地内存数据库和虚拟测试账户，在 390 × 844 的浏览器窗口实际点击检查：

1. 登录后主页成功显示；原背景图片等比例填满，未观察到露底或拉伸。
2. 主页 → 设施教学 → 显示全部 → 太极揉推器详情。
3. 展开使用方法后可见 11 条步骤；向下滚动到详情末尾，实测 scrollTop 2309、clientHeight 702、scrollHeight 3011，满足到达底部。
4. 详情右上位置按钮正常显示，点击进入对应位置页。
5. 位置页 → 原设施详情 → 原分类列表 → 分类页 → 主页，参数和层级保留。

浏览器检查使用 computer-use 技能，没有连接生产数据库、修改真实用户或部署服务器。临时页面已关闭、窗口尺寸覆盖已恢复、本地测试服务已停止。隔离测试脚本增加了可选导出目录及端口参数，原默认行为不变。

## 本地输出

- iOS：`workspace-artifacts/ios-layout-fixes-20260912/ios/`
- iOS bundle：`entry-a9644575b9a9d3600a9856dd6334348a.hbc`
- Web：`workspace-artifacts/ios-layout-fixes-20260912/web/`
- Web bundle：`entry-c76d03c701b6aaa15fc76f7a065f4bef.js`
- 隔离浏览器夹具：`scripts/local-pdf-app-audit.mjs`，本轮运行端口 4192。

这些目录是导出验证产物，不是 IPA 安装包，也不是服务器部署包。

## 尚需真机复核

- 用户手机中原始背景异常和位置按钮留白的截图、机型、iOS 版本。
- iOS 原生导航栏最终显示、弹簧/侧滑动画方向和连续进退。
- 真机设施页面展开全部说明后的最底部操作，以及不同字号与安全区。

本轮均为 JavaScript/布局修改，没有新增原生依赖；可在确认发布目标后通过兼容的 iOS production OTA 推送。无需为这些界面修改部署服务器。
