# AI 推荐单句入口（2026-09-17）

## 用户要求

不再在常规推荐气泡里只突出一段中医说明，改为简单提示查看下方的详细说明与器材教学。

## 修改

- 中文常规推荐预览：`可先了解下方的詳細說明及器材教學。`
- 英文预览：`You can read the detailed explanation and equipment guides below.`
- 删除推荐预览中的中医短句选取逻辑及每条气泡的重复通用安全说明。顶部固定安全提示不修改。
- 中医、物理治疗等完整内容仍保留在独立详情页；普通分类推荐的额外描述也只在详情里展示。
- 详情按钮、阅读页、返回行为、器材图片/名称/教学入口和推荐排序不修改。
- 已保存的历史记录只改变显示，不改存储或发给 API 的全文。新旧中英文肩周炎/膝痛推荐均覆盖。
- 特定禁忌、风险拒绝、直接使用步骤、独立中医查询、未知模型正文继续使用原有保护逻辑，不随意用通用句子替换。

## 验证

- 预览逻辑、聊天历史、聊天滚动和详情组件：4 套、142 项测试通过。
- TypeScript 检查及修改文件的 `git diff --check` 通过。
- 验证短中医证据、普通分类推荐、中英文肩/膝问题、历史恢复、全文保留、顶部固定提示、打开详情及返回和器材跳转。
- 本轮仅修改展示函数及对应测试，没有修改聊天 UI 布局、服务端或原生代码；未进行三端重新导出或真机点击验证。
- 未发布 OTA、未重新 Build、未上传后端。兼容安装包通过前端 OTA 获取变更即可。

安卓发布命令（电脑 Windows PowerShell）：

```powershell
cd "D:\polyu work\outdoor-rehab-fit-anesthesia"

$otaOutput = "workspace-artifacts/android-ai-neutral-preview-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

powershell -ExecutionPolicy Bypass -File ".\scripts\publish-android-preview-update.ps1" -Message "AI推荐改为简洁说明入口" -InputDir $otaOutput
```
