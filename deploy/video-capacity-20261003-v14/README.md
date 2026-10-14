# 视频并发优化 v14

目标镜像 `outdoor-fit-api:20261003-v14`，归档 `outdoor-fit-video-capacity-20261003-v14-delta.tar.gz`。本地完成编码、验证及封包，不表示生产已部署或50人复测已通过。

## 更新内容

- 当前公开教学视频生成 H.264/AAC 低码率 MP4 副本，目标音视频合计不超过1.5Mbps。保留原片，检查时长、完整解码、faststart、SHA-256和视觉对比。
- 新网页播放采用内容版本地址；读取当前媒体公开、删除、归档状态。既有API视频地址、手机App播放和管理员下载保留原片；私有附件不进入公开播放或CDN。
- 设备、媒体编号及原始视频的学习身份保留，数据库不迁移、不修改业务记录。未知或变更过的源视频继续用原片。
- 网页优先加载主影片，附加媒体延迟加载；字体失败可回退，首播与缓冲有状态提示。带内容哈希的网页资源长期缓存，HTML检查更新。
- 本轮CDN尚未开通，保持现有服务器出网。CDN配置接口已准备，但不创建付费云资源、不自动配置域名，也不发布手机OTA。

## 预检与安装

安装器只接受正在运行的v13，核验全部v13 API源码和网页文件，保留现场域名、密钥、RDS、数据库连接池和队列设置。预检检查低码率副本哈希、QA、全部54个已知源文件的SHA及文件名，以及现场Caddy语法；清单内任何原片变化、缺失或其他现场漂移都会在重启前停止。不在清单的未知视频仍使用原片。不要跳过预检或删除状态目录强制重装。

先把归档上传到服务器 `/root/`，在新目录解包。SSH内执行：

```bash
set -euo pipefail
umask 077
cd /root
sha256sum outdoor-fit-video-capacity-20261003-v14-delta.tar.gz
# 与交付说明中的SHA-256一致后继续。
mkdir outdoor-fit-video-capacity-20261003-v14-upload
tar -xzf outdoor-fit-video-capacity-20261003-v14-delta.tar.gz -C outdoor-fit-video-capacity-20261003-v14-upload
cd outdoor-fit-video-capacity-20261003-v14-upload/outdoor-fit-video-capacity-20261003-v14
python3 install.py --check-only
python3 install.py
```

预检成功 `VIDEO_CAPACITY_PREFLIGHT=PASS`；安装成功 `VIDEO_CAPACITY_UPDATE=PASS`。`VIDEO_SOURCE_MATCHES` 是实际匹配的源文件数，最终公开播放状态仍由接口逐次检查。安装短暂重建API/Caddy，不删除原片，不改业务数据库。不要把生产密码发到聊天中。

## 回退与恢复

原镜像、网页、Caddy及已解析Compose保存在root私有状态目录。服务激活前创建回退脚本；激活失败尝试回退。回退恢复原网页、原Caddy及原API环境/挂载，不删除原片、学习记录或新副本。

```bash
bash /opt/outdoor-fit/production/.update-state/video-capacity-20261003-v14/rollback.sh
```

回退成功 `VIDEO_CAPACITY_ROLLBACK=PASS`。发现后续部署、环境或挂载变化、回退配置篡改、原网页/Caddy变更时拒绝覆盖。SSH中断后先检查状态与容器，不删除状态、发布目录或旧镜像来重新安装。

## 安装后复测

确认实际网页SHA和新播放地址后，按1、10、25、50人逐级播放；分别测同片、不同影片、首次加载和学习进度同步。浏览器测试与无缓存Range传输分开顺序运行，最多50个并发用户。记录首播、缓冲、实际解码帧、接口5xx和最终同步完整性，保留原v13基线。未取得生产部署证据前不把旧版重复测试标成v14结果。

单台电脑共用一条网络的50个浏览器实例不能证明50台独立设备在不同网络下的最大容量。复测需要同时查看ECS公网出网监控，区分服务器与测试端网络瓶颈。
