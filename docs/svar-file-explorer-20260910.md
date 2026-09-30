# 后台文件资源管理器（本地实现）

## 范围

- 网页后台通过 `components/AdminMediaLibrary.web.js` 使用 SVAR React File Manager 2.6.0（MIT）。原生 `AdminMediaLibrary.js` 保留，不向 Android / iOS 导入 SVAR 或 CSS。
- 仅连接现有 OUTDOOR-FIT API；未配置 SVAR demo 服务或第三方存储。Willow 使用 `fonts={false}`；`adminMediaExplorerIcons.js` 自带 SVG 文件图标与导航/操作图标的 CSS mask，不请求 SVAR 图标 CDN 或任何图标字体。长目录名允许换行，悬停名称显示完整标题。
- 目录树显示已加载页面的目录及祖先，打开目录再向服务器请求该目录的第一页；文件列表每次真实请求最多 20 项，保留上一页 / 下一页，没有预先加载所有文件的假分页。
- 支持列表 / 图标、双击打开、右键菜单、Ctrl / Shift 多选、Ctrl+A/C/X/V、F2 重命名、Delete 确认移到回收站。剪贴板保存不可变文件 UUID，跨目录和跨页不依赖显示路径。
- 新建文件夹、单文件、多选文件和整个文件夹上传沿用已有上传/取消/进度流程，保留分类、回收站恢复和归档。仅复制真实上传内容；历史外部链接提示不可复制。
- 目录移动、重命名不改原媒体 URL。删除被 APP 使用的媒体仍由后台阻止；删除进入回收站，不永久删除磁盘文件。
- 选择窗口支持 video / image / GIF 类型，无法选用归档、回收站、附件或不匹配媒体。视频预览复用 `MediaVideo`，显式传递 `source`。
- 权限变化或切换账号清空旧列表、剪贴板、预览和待确认操作；设备内容编辑人员可按原权限在媒体选择窗口上传，不能获得独立文件库的剪切、删除等维护权限。
- 搜索沿用服务器全库名称搜索，并在输入框注明。排序由服务器执行，SVAR 按本页 `serverOrder` 保持服务器顺序，避免数字文件名在各页分别重排。

## 验证

- 2026-09-10：前端适配器、组件和本地图标单测 27 项通过。后台预览限定 65vh，保留原始比例和播放控件；默认 APP 视频宽度不变。确认和预览弹窗均通过 portal 挂载到 document.body，避免原生网页滚动容器的 transform / overflow 裁切，保留独立焦点控制。
- 已安装 SVAR DataStore 的真实依赖测试 2 项通过：25 个数字视频文件名跨 20 项分页保持服务器排序；拦截器阻止乐观重命名、删除和复制。
- Web JSX 解析通过；Node 环境导入 SVAR 成功，组件进一步通过 browserReady 只在浏览器渲染。
- 此说明不代表已进行线上部署或手机真机验证。浏览器视觉和交互验证由主任务另行记录。

```powershell
npx jest --roots ./components ./utils --runTestsByPath utils/__tests__/adminMediaExplorer-test.js utils/__tests__/adminMediaExplorerIcons-test.js components/__tests__/AdminMediaExplorer-test.js --runInBand --watch=false
node --test --experimental-test-isolation=none scripts/__tests__/svar-filemanager-store-test.cjs
```

## 官方资料

- [安装、MIT 许可、组件导入](https://docs.svar.dev/react/filemanager/getting_started/)
- [React 18 / 19 兼容的 2.6.0 包](https://www.npmjs.com/package/@svar-ui/react-filemanager)
- [自定义后端连接](https://docs.svar.dev/react/filemanager/guides/working_with_server/)
- [数据和动态加载](https://docs.svar.dev/react/filemanager/guides/loading_data/)
- [右键菜单配置](https://docs.svar.dev/react/filemanager/api/properties/menuoptions/)
- [拦截事件](https://docs.svar.dev/react/filemanager/api/methods/intercept/)
- [语言本地化](https://docs.svar.dev/react/filemanager/guides/localization/)
