# 收藏、图片和服务器迁移后的性能检查

用户确认 Android 1.2.3 / Build 17 已发布并接收 v6，打开收藏及从收藏进入器材详情均仍等待。本次检查实际线上公开目录和图片，追踪手机导航、书签读取、目录合并、图片文件缓存、原生图片解码与 MySQL 接口。未连接用户手机，因此没有真机帧率、逐次图片命中或点击到首帧数据，不能宣称所有卡顿已解决。

## 已核实的区别和问题

1. 收藏原来是 Tabs 的直接子页，详情属于另一个隐藏的 Outdoor Tab。Expo Router 将不属于 Stack 的 PUSH 转成 NAVIGATE，底部 Tabs 默认不提供推进动画、首次进入还会懒挂载。因此收藏点击与教学列表内部推进不是相同导航。Git 中 2026-08-20 的版本已经存在跨 Tab 路由，不能将这个结构问题归因于阿里服务器。
2. 收藏记录一直存手机的按账号 AsyncStorage，不是每次去 RDS 查收藏。此前首次挂载仍从 ready=false 开始，等待一次本地读取，即使登录时后台同步已经读过。v7 复用同账号已提交的内存快照、合并在途读取；保存成功更新快照，失败保留上次成功值，账号切换不提供旧账号快照。
3. v6 的预解码只处理非空 imageUrl。本次线上 29 个器材仅健骑机（id 9）和漫步机（id 18）有远程主图，其余 27 项仍使用内置资源。这些器材的列表 icon 与详情 horizontal 多数是不同文件；部分详情 JPEG 宽达 4096–4800 像素。v7 将权威目录合并后实际使用的内置小图与横图也加入有界预处理，收藏优先，保留 12 项、32 MiB 估算预算、2 个解码任务和 1024×1024 上限。预算不是整个应用真实内存上限；超过预算或尚未准备好时仍按原显示路径加载。
4. 详情首屏同时创建音频、视频 WebView 和示范 GIF。v7 的文字和主图不等待网络或播放器；次要原生内容在本屏过渡结束后初始化，没有过渡事件则使用短暂回退。保留其空间，避免后补内容挤动页面。

v7 为收藏建立自己的 native Stack，详情复用现有教学组件，支持标题返回、Android 返回与地图返航。只有进入的详情做轻微缩放，收藏列表本身不放大、不左右移动。

## 已排除的解释

- 收藏卡片和教学卡片共用 EquipmentCardImage；同一个云端 imageUrl 会同时赋给 icon/pic/horizontalPic，并经过相同 URL 解析，不是收藏单独搜索另一张照片。
- 手机私有文件缓存的 get 是内存 Map 查找，磁盘目录只在冷启动恢复一次，并非每次点击重新计算全部图片哈希。
- 线上目录 51,540 字节、43,852 个字符，通过实际 publicEquipmentCatalog 校验，未触发 512 KiB 限制；不是目录始终无法缓存。
- 数值 require 资源通过 Expo 的资源映射寻找安装包/OTA 本地资源，没有发现每次点击强制 Asset.downloadAsync 的代码路径。
- ImageRef 在原生层直接提供已解码 Drawable；v6 的 1024 尺寸限制确实传入 Glide，没有发现被忽略。仅两张远程图时，12 项上限并非它们必然反复淘汰的原因。
- 两张替换图片公开接口均返回 200，支持 Range，具有 30 天缓存头，未跳转 Google。RDS 保存器材图片路径等记录，器材图片文件仍在 ECS；缓存命中后不需要再查询 RDS 取图片。

## 本机公开接口小样本（香港时间 2026-09-25）

以下是开发电脑当前网络经新 curl 连接的观测，不能代表手机网络或高并发分位数；TLS_READY/TTFB 均为自请求开始累计时间。

| 请求 | HTTP | TLS_READY 秒 | TTFB 秒 | 完整响应秒 | 正文大小 |
|---|---:|---:|---:|---:|---:|
| health | 200 | 1.105 | 1.430 | 1.430 | 39 B |
| 器材目录 1 | 200 | 0.558 | 0.920 | 1.264 | 51,540 B |
| 器材目录 2 | 200 | 0.496 | 0.837 | 1.301 | 51,540 B |
| 健骑机主图 GET | 200 | 0.506 | 0.844 | 2.329 | 1,735,216 B |
| 健骑机主图 Range 0–31 | 206 | — | 0.903 | 0.904 | 32 B |

健骑机主图尺寸 2474×3264，漫步机主图 HEAD 给出 1,036,424 字节。首次拉取原图可能慢于原来已内置在安装包里的小图；这不能解释每次暖缓存仍等待，后者需要手机端实际观测。

## 数据库和部署差异

此前 Google 使用 Node/systemd、本机 SQLite、nginx；阿里使用 Docker、远程 RDS MySQL Serverless、Caddy。因此业务配置即使相似，数据库访问成本并不相同。旧 Google 域名现在反向代理阿里，不能用它当作旧后端基线。

MySQL 适配器每次借连接会执行两次串行 SET。匿名目录两次业务查询合计至少 6 条数据库命令；旧式 equipment-images 路径较旧 SQLite 版多一次已索引的墓碑查询，以及两次会话初始化。没有发现目录 N+1 或每张图片全表扫描。鉴权重复读取完整头像行、共享 4 个连接的排队也是待测候选。本次不在缺少 RDS 阶段计时的情况下混入会话初始化、鉴权一致性或连接池语义改动。

用户曾确认 RDS Serverless 自动暂停开启，尚未确认关闭。[阿里云官方说明](https://www.alibabacloud.com/help/en/rds/apsaradb-rds-for-mysql/rds-mysql-serverless)记录：无连接一段时间后可暂停，恢复约 6–40 秒，恢复期间不可用。建议交互型生产应用关闭自动启停，保持自动扩缩容；持续运行将产生相应计算费用。控制台实例配置的“调整弹性设置／Modify Scaling Settings → 高级设置 → Automatic Stop and Restart → Disable”可关闭。开启该选项不代表本次一定发生过暂停，应在实例任务记录核对实际启停时间。

## 服务器进一步定位

已准备 [ECS 只读采集说明](aliyun-performance-diagnostics-20260925.md) 和 `scripts/inspect-aliyun-performance.sh`。它测 ECS 公网与容器内部接口、新 RDS 连接/初始化/SELECT 1 耗时及 API RSS，不重启应用、不修改业务数据、不显示密码。尚未在真实 ECS 执行；直连 SQL 不经过生产池，也不能单独证明自动暂停。

Windows PowerShell 上传：

```powershell
scp -P 28832 "D:\polyu work\outdoor-rehab-fit-anesthesia\scripts\inspect-aliyun-performance.sh" root@47.83.186.36:/root/inspect-aliyun-performance.sh
```

阿里 ECS Bash 执行：

```bash
(
set -e
cd /root
printf '%s\n' '932461632e1dcf898a5613d8838203c2d58dbda9a5660136270628ec3b0ba874  inspect-aliyun-performance.sh' | sha256sum -c -
bash inspect-aliyun-performance.sh
)
```

返回输出后才能继续区分服务器内部处理与公网传输。Android v7 发布命令见 [发布说明](android-build17-favorites-performance-ota.md)；准备产物不等于已经上传或发布。

## 已完成验证与交付

导航、详情、图片文件/解码缓存、收藏、登录/删除账号以及相关聊天推荐回归通过。最终修改后的书签、收藏 Hook、图片适配器/内存/Hook 组合 5 套 69 项通过；书签专项包含 A→B→A 旧队列不可覆盖最新值、失败保存不可吞掉已有收藏、legacy 迁移不能复制到另一账号等 11 项。导航相关 103 项及图片相关 74 项检查通过。较广组合执行也全部通过；自动检查均非 Android 真机流畅度测量。

v7 已实际导出并独立 Verify 通过：

- 目录：`workspace-artifacts/android-build17-favorites-performance-20260925-v7/export/`
- 241 文件，共 167,480,103 字节（含可复用资源，不代表每台手机实际下载量）。
- Hermes：`_expo/static/js/android/entry-e1fdbfa8a4baa54c4aa3c001cfc38f54.hbc`。
- `release-manifest.json` SHA256：`3f32347f7eb4264bdaf592b70aa60d17b358c32367a7698a122ebb5a87cd25d8`。
- 原 app.json 按字节恢复，SHA256 `d2ac8fca2075fce08a9f79ab3e7163a5eb2b84bb8be521638dbb1197c5d4b1fe`，临时备份已不存在。
- 旧 v6 封存工具和说明未更改；本次没有发布 OTA、上传 ECS、修改 RDS 或重新启动生产容器。

只读服务器采集脚本 10,886 字节，SHA256 在上方命令内。Bash 和内嵌 Node 语法检查通过，未在真实 RDS 执行。下一步需用户手机确认实际画面与 ECS 采集结果，才能继续给尚未被测量证实的等待归因。
