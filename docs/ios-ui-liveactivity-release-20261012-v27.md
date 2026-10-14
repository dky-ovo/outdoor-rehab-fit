# iOS 1.2.4（19）：界面与 Live Activity 发布记录

本轮已完成界面修复、云端原生构建和 **App Store Connect 上传**，版本为 **1.2.4（19）**。Apple 已处理通过（`VALID`），内部测试状态为 `READY_FOR_BETA_TESTING`。用户已授权上传；本地准备工具本身不登录、不触发构建或提交。

## 目标固定值

| 项目 | 值 |
| --- | --- |
| EAS 项目／owner | `1d1f05e7-ef12-456a-9c53-31bce530f5b3` ／ `maxcch.c` |
| slug | `outdoor-rehab-fit` |
| 主应用 bundle | `com.polyu.rs.outdoorrehabfit` |
| Widget bundle | `com.polyu.rs.outdoorrehabfit.timer-widget` |
| App Store Connect App ID | `6742685136` |
| 应用版本／OTA runtime | `1.2.4` ／ `1.2.4` |
| profile／channel | `production` ／ `production` |
| API | `https://api.outdoorfit.hk/api` |
| Xcode image | `macos-sequoia-15.6-xcode-26.2` |
| buildNumber | EAS remote 自动递增，以本轮真实返回值为准 |

1.2.4 仅写入隔离目录的配置，根 `app.json`、Android 项目与 Build 17 OTA 配置不改。Live Activity 原生修复需要新 IPA，不能以 OTA 代替。根 `app.json` 静态写着 1.1.1，而动态 `app.config.js` 原解析为 1.2.2，故不能只读取静态配置判断发布版本。

本轮开始时，历史最新完成构建为 1.1.8（17），ID `2eb1e7e8-5820-411d-bf5e-0cd1a4202f55`。本次只提交新的 1.2.4（19），不使用旧构建。

首次 Apple 查询返回 `403 FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`。账号持有人自行接受 Program License Agreement 后，2026-10-12 07:25 UTC 的 Apple 查询恢复成功，限制已解除。没有代用户接受协议。

## 为什么使用隔离目录

根 `.easignore` 排除了全部 `server/`，但当前手机代码需要其中九个纯共享模块；同时它没有排除 `.tmp/`、部分安装器测试目录、模型训练目录和旧 app 配置副本。直接上传工作目录会遗漏必要代码，还可能带上不需要的本地文件。

本地工具 `scripts/ios-ui-liveactivity-v27-release.cjs` 复制明确列出的客户端源码、资源、插件、iOS 本地模块和九个纯共享模块。服务器应用、数据库、模型训练资料、测试账号、部署包、私钥和本地环境文件不进入 stage。它核对客户端到共享模块的 import 闭包；增加未允许的服务端依赖、私钥文件、链接、源文件变化或 stage 混入额外文件都会停止。

目标 stage：`workspace-artifacts/ios-ui-liveactivity-20261012-v27/project`。源码清单和哈希写在其上一级 `source-manifest.json`，不进入上传目录。不得在 stage 内保存构建日志、凭据或查询结果。不得把根仓库 `node_modules` 链接后上传；EAS 在云端按 lockfile 安装依赖。

最终 stage：**528 个文件、184,342,716 字节**；源码清单 SHA-256 为 `1f6610f0053584fd783ef19a4c14135e2bf88afb2897a1511e095e9c1f59addc`。源码与 stage 逐项验证通过，根配置未改。Expo 公开配置解析确认 1.2.4 runtime、目标项目和 Widget；已用本机 EAS CLI 24.7.0 的实际 Ignore 解析器核对全部路径，没有遗漏共享模块。此为本地目录核验，不是云端编译完成。首次尝试的旧 stage／manifest 已保存在同目录的 `project-attempt1-before-input-fix`／`source-manifest-attempt1.json`，不要上传旧目录。

## 2026-10-12 实际执行结果

- 原生修复：灵动岛紧凑计时器固定 50×24 pt，展开和锁屏时间单独占行；保留系统计时及返回 App 链接。参考 [GitHub Live Activities 示例](https://github.com/1998code/iOS16-Live-Activities) 与 [Apple Live Activities 尺寸规范](https://developer.apple.com/design/human-interface-guidelines/live-activities)。173 项相关 Jest 与 10 项 Widget 工程测试通过；增加 8 组 Xcode Preview 场景，但本机未运行这些原生预览。
- UI 修复：影片页避让 iOS 底栏；三个全屏弹窗使用独立安全区与原生 SafeAreaView；聊天工具栏支持换行，返回命中区域至少 44×44；空聊天框不再强制覆盖 iOS 的提示文字高度。UI 16 套／271 项回归通过，独立审查无阻断。
- 隔离网页在 393×852 下检查了首页、影片分类、播放／关闭、聊天与历史弹窗。发现并修复空提示两行截断；最终显示两行完整提示，截图保存在 `workspace-artifacts/ios-ui-20261012-qa`。本地账号和数据是虚构 fixture，未修改线上数据。浏览器全屏进入的是桌面全屏，不能据此声称 iPhone 原生横屏已验证。
- 最终 iOS Hermes 导出通过：2262 模块、238 资源，`ios-export-final/_expo/static/js/ios/entry-e9f7c06247442a3c417a3b563d1a4a3f.hbc`；这是客户端资源打包，不是 Swift 编译或已签名 IPA。
- 首次 `eas build --freeze-credentials` 将远程 buildNumber 从 17 增至 18，随后被 Apple 协议状态拦截；该次没有构建 UUID，也未开始云端编译。编号 18 未提交，不回退编号。
- 协议生效后，最终 stage 构建 **1.2.4（19）**，UUID `f9b0a113-c299-4870-b0cb-ca0cdf6be745`，2026-10-12 07:32:06 UTC 完成，EAS `FINISHED`、无错误。项目、owner、主 bundle、STORE 分发、production profile/channel、runtime 均验证通过。[构建记录](https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/builds/f9b0a113-c299-4870-b0cb-ca0cdf6be745)。
- 已下载并核对实际 IPA：172,223,899 字节，SHA-256 `3ae9806903305d89cdbcd083557e15b0bbab4ffe27a23114477e26852894cae9`。主 App 与 Widget 都是 1.2.4（19）、iOS 26.2 SDK、同一签名团队 `5FGVLJW5N7`；最低 iOS 分别 15.1／16.2。Mach-O entitlements 与描述文件中的 App ID／团队一致，描述文件未过期、为商店分发，Live Activities 与 Widget 配置正确。CMS 内容签名核验通过；Windows 未验证 Apple 信任链或完整 codesign 资源封印。详见 `workspace-artifacts/ios-ui-liveactivity-20261012-v27/ipa-inspection-report.json`。

App Store Connect **上传成功**：提交 ID `b4d68037-0a3b-4412-9bb3-c4c59aa1456f`，目标 App ID `6742685136`。CLI 已返回成功，2026-10-12 07:40:52 UTC 的 EAS 查询确认为 `FINISHED`、无错误。[提交记录](https://expo.dev/accounts/maxcch.c/projects/outdoor-rehab-fit/submissions/b4d68037-0a3b-4412-9bb3-c4c59aa1456f)。

Apple 处理通过：2026-10-12 **07:43:53 UTC（香港 15:43:53）** 的 Apple API 返回 1.2.4（19），Apple Build ID `fc09e32c-096b-472a-aa87-9cbef126290f`，`processingState=VALID`、`internalState=READY_FOR_BETA_TESTING`、`externalState=READY_FOR_BETA_SUBMISSION`、未过期。实际上传时间 07:42:05 UTC。可在 [App Store Connect → TestFlight](https://appstoreconnect.apple.com/apps/6742685136/testflight/ios) 查看。本轮没有修改测试组或提交外部测试／正式 App Store 审核；READY 状态不代表已经向所有测试员分发。

Windows 环境未完成 iPhone 真机键盘／灵动岛验收；云端原生编译、IPA 元数据和 Apple 处理成功不等于真机视觉验收。`ui-audit.json` 的早期 `UNAVAILABLE` 属于初始阶段，最终网页检查结论见其 `rootVisualReview`；Live Activity 审计中的初期待编译说明由本记录的实际云端结果补全。

## 本地准备与实际构建

等待 UI 和原生插件源码冻结后执行；工具拒绝覆盖已有 stage。

```powershell
Set-Location -LiteralPath 'D:\polyu work\outdoor-rehab-fit-anesthesia'
node '.\scripts\ios-ui-liveactivity-v27-release.cjs' prepare
node '.\scripts\ios-ui-liveactivity-v27-release.cjs' verify
node '.\scripts\ios-ui-liveactivity-v27-release.cjs' resolve-local
```

EAS CLI 已安装于 `C:\Users\杜铠羽\AppData\Local\npm-cache\_npx\6bc7bae5c2059953\node_modules\eas-cli\bin\run`，本轮主线程确认版本 24.7.0。在 stage 工作目录调用时，必须同时设置 `EAS_NO_VCS=1` 和**绝对路径** `EAS_PROJECT_ROOT`；仅设置前者仍可能向上找到原仓库 Git 根目录。

构建前核验 Expo 解析后的配置（包括插件补充的 Widget extension metadata），保存 JSON 于 stage 之外，再运行：

```powershell
node '.\scripts\ios-ui-liveactivity-v27-release.cjs' validate-config '.\workspace-artifacts\ios-ui-liveactivity-20261012-v27\resolved-config.json'
```

`resolve-local` 使用根项目已安装的 `@expo/config` 解析 stage，自动生成上述公开配置和 stage 外的 `local-metro.cjs`，不创建 node_modules 链接。Node 能向上找到依赖，但本地 Metro 导出还需要将**根 node_modules 目录**加入 watchFolders；该 wrapper 仅添加依赖，不把父目录的 app 或服务器源码加入文件映射。只在本地导出时，将 `EXPO_OVERRIDE_METRO_CONFIG` 设为 wrapper 的绝对路径，同时设 `EXPO_PUBLIC_API_BASE_URL=https://api.outdoorfit.hk/api`、`EXPO_NO_DOTENV=1`、`EXPO_OFFLINE=1`。由根 Expo CLI 执行 `export <stage绝对路径> --platform ios --output-dir <stage外输出目录> --max-workers 2`。

本地验证结束后恢复这些环境变量。**正式 EAS Build 前清除 `EXPO_OVERRIDE_METRO_CONFIG`**：上传只包含 stage 自身原始 Metro 配置，云端使用 lockfile 安装自己的依赖。不要上传本地 wrapper，不能把验证用导出或 resolved-config 放进 stage。

主线程从 stage 发起一次 iOS production build，使用以下 CLI 参数：

```text
build --platform ios --profile production --message ios-ui-liveactivity-20261012-v27 --freeze-credentials --non-interactive --no-wait --json
```

构建 profile 显式固定正式 API 与 `EXPO_NO_DOTENV=1`，远程构建环境不得加入相冲突的公开 API 覆盖。沿用现有主应用与 Widget 签名；`--freeze-credentials` 失败时先检查现有证书／描述文件，不能自动创建、吊销或换团队。历史 `workspace-artifacts/native-build-lockscreen-20260908/prepare-widget-signing.cjs` 仅供审计参考，其 `--apply` 会创建描述文件，本轮不运行。

## 指定本轮构建提交

保存本轮返回的 build UUID，按此 UUID 等待 `FINISHED`，再读取完整 build JSON 到 stage 外。将其交给本地 `validate-build <JSON路径> <本轮UUID>`；工具核对项目、owner、平台、商店分发、版本/runtime、profile/channel和 IPA 地址。再核对实际签名的 bundle、Widget、buildNumber 和目标 ASC App ID。

只提交本轮 UUID，不使用 `--latest`、`--auto-submit`，不提交旧 Build 17：

```text
submit --platform ios --profile production --id <本轮已核验UUID> --no-auto-testflight-setup --non-interactive --wait
```

应分别记录：云端编译完成、EAS 上传完成、Apple 处理完成、内部 TestFlight 可用。只有 Apple 实际状态证实后才能称可安装。本授权不自动创建测试组、不提交外部 Beta 审核、不发布正式 App Store、不发送 Android OTA。

## 验证边界和参考

本地 helper 测试验证隔离文件集合、原配置不变、遗漏依赖、私钥混入、源／stage 篡改、错误项目和指定构建校验；不验证云端签名或 iPhone 真机表现。Dynamic Island／锁屏显示和点击行为仍须真实构建及目标 iPhone 复核。

已完成 10 项 helper 回归，全部通过；构建验证兼容本机 EAS CLI 的实际 app/runtime/updateChannel 元数据结构，并强制核对 bundle。源码只读预审包含 526 个候选文件、9 个纯共享服务端模块和所有必需的本地原生文件。最终 stage 清单以源码冻结后的 `source-manifest.json` 为准。

- [Expo .easignore 文档](https://docs.expo.dev/build-reference/easignore/)：`.easignore` 优先于 `.gitignore`，不能假设后者的保护规则仍然生效。
- [Expo App Extensions 文档](https://docs.expo.dev/build-reference/app-extensions/)：CNG 构建前需声明 extension metadata 以检查目标签名。
- [Expo 构建环境](https://docs.expo.dev/build-reference/infrastructure/)：本轮核对存在 Xcode 26.2 指定镜像；SDK 54 的当前自动镜像是 26.0，显式固定可避免漂移。
- [Expo iOS 提交文档](https://docs.expo.dev/submit/ios/)：上传和 Apple 后续处理是不同阶段。
