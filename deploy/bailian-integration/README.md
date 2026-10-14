# OutdoorFit 百炼模型接入手机

手机通过现有 OutdoorFit 后端调用百炼：手机聊天 → OutdoorFit API → 新加坡百炼模型 → 手机显示回答。本次已准备后端和手机兼容代码，开关默认关闭；尚未发布新版、填写真实密钥或完成线上连通测试。

当前训练模型用于从候选 FAQ 中选择主题。第一阶段只启用影片入口、运动记录、App 功能和个人目标四类问题。现有能直接回答的问题仍立即返回；百炼处理部分规则未匹配的 App 问法。其他聊天继续沿用原有处理流程。

## 在百炼取得调用凭据

1. 打开百炼国际站，选择新加坡及部署模型所在的工作空间。
2. 在模型部署详情确认服务已就绪，并确认 **Model Code** 为 `qwen3-14b-1f1a8952705b`。训练任务 ID 或模型名称不能代替部署后的 Model Code。
3. 在同一工作空间创建或取得 API Key，直接保存到服务器的私有配置文件。不要放入手机设置、前端代码、`EXPO_PUBLIC_*` 或聊天消息。

新加坡通用 Base URL 是 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`，因此暂时不需要提供工作空间 ID。也支持控制台给出的 `https://工作空间ID.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`。API Key 必须属于模型部署所在工作空间。参见 [API 部署与调用说明](https://www.alibabacloud.com/help/en/model-studio/model-deployment-quick-start)及 [Base URL 说明](https://www.alibabacloud.com/help/en/model-studio/base-url)。

## 配置服务器

将以下四项写入服务器私有环境文件，例如现有部署私有目录中的 `bailian.env`，文件权限设为仅管理员可读。示例中的密钥需在服务器编辑器里替换：

```dotenv
BAILIAN_FAQ_ENABLED=false
BAILIAN_MODEL_ID=qwen3-14b-1f1a8952705b
BAILIAN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
DASHSCOPE_API_KEY=在服务器填写真实密钥
```

先保持 `false`。已有线上容器需要先发布包含本次修改的后端镜像和手机更新，随后才启用模型；仅填写环境变量或普通 `docker restart` 不会更新代码。

本目录的 `compose.override.yaml` 只向 `api` 服务传入这四项配置。将它叠加在**当前发布使用的 Compose 文件之后**，并加载私有环境文件。旧版本安装脚本及旧镜像不能代替本次发布。

以下是运维命令模板。先将 `CURRENT_API_CONFIG`、`CURRENT_ENV`、`BAILIAN_ENV`、`BAILIAN_OVERRIDE` 指向实际文件；`CURRENT_API_CONFIG` 必须已经指向兼容的新后端镜像，并保留线上数据库、挂载和其他环境设置。如果当前发布使用多份 Compose 文件，继续保留全部文件及其顺序。

```bash
docker compose -p outdoor-fit-production \
  --env-file "$CURRENT_ENV" --env-file "$BAILIAN_ENV" \
  -f "$CURRENT_API_CONFIG" -f "$BAILIAN_OVERRIDE" config --quiet
```

先发布手机兼容更新，再将私有文件中的 `BAILIAN_FAQ_ENABLED` 改为 `true`。按照现有部署的队列排空流程短暂停止新聊天请求，然后重新创建 API 容器：

```bash
docker compose -p outdoor-fit-production \
  --env-file "$CURRENT_ENV" --env-file "$BAILIAN_ENV" \
  -f "$CURRENT_API_CONFIG" -f "$BAILIAN_OVERRIDE" \
  up -d --no-deps --no-build --pull never --force-recreate api
```

恢复入口前检查容器健康状态。配置核验使用 `config --quiet`，避免将包含密钥的完整配置打印到终端或聊天中。此次本地环境没有 Docker，Compose 合并、镜像构建及线上发布仍需在部署环境验证。

## 验证模型与手机

新后端包含一个显式运行的连通检查。以下命令会产生一次真实模型调用费用，输出模型编号、是否选中预期主题和耗时，不输出密钥或原始模型回复：

```bash
docker exec outdoor-fit-production-api-1 node src/checkBailian.js --run
```

预期 `ok` 为 `true`，`model` 为你的 Model Code，选择结果为 `app-videos`。这个检查沿用实际请求的 3 秒期限；失败时检查部署就绪状态、Model Code、密钥工作空间、网络及响应时间。单次通过只说明该次连通和选择正确，不代表整体模型准确率。

手机继续使用现有 OutdoorFit API 地址及登录状态。将本次客户端代码通过适用的 OTA 或新版安装包发布后，在英文聊天中测试 `Which section lets me replay the clips?`。该句用于验证规则未覆盖的影片入口问法；普通已知 FAQ 可能直接由原有规则回答，不会调用百炼。

再测试运动记录、App 功能和个人目标，以及模型不应处理的器材教学和症状问题。百炼弃答、返回格式错误或超时会回退原有流程；回退能否生成回答仍取决于原有服务配置及网络。

## 接入边界与回退

后端只向百炼发送当前问题、语言和公开 FAQ 候选，不传账号、定位、历史记录或目录中的其他字段。模型只能返回候选 ID；实际文字由当前审核的 FAQ 内容生成。手机也按同一主题重新显示审核内容，不直接展示模型自由生成的文字。

如需停用百炼，将 `BAILIAN_FAQ_ENABLED=false` 后按相同流程重新创建 API 容器。手机继续使用原有聊天处理方式。要覆盖完整自由对话，需要另行准备相应训练数据与评估，不能仅更换模型编号。
