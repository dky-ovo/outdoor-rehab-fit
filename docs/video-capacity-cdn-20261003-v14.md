# 公开教学视频CDN接入准备

用户已确认CDN尚未开通。本轮v14先优化视频与网页，CDN默认禁用。没有加速域名、证书和回源验证时，不设置 `MEDIA_VIDEO_CDN_ORIGIN`。

## 阿里云控制台配置

1. 为公开视频建立独立加速域名，例如 `video.outdoorfit.hk`；这是待配置示例，不表示已注册或可用。按实际使用地域选择加速范围及计费方式，控制台显示费用后再开通。保留现有 app/api/admin 域名用途。[添加加速域名](https://www.alibabacloud.com/help/en/cdn/add-a-domain-name)
2. 源站选择现有 `app.outdoorfit.hk`，使用HTTPS/443。进入“回源配置”，分别将“回源HOST”和“默认回源SNI”设置为 `app.outdoorfit.hk`，两项都需要配置。源站不能指向新加速域名本身，避免回源循环。[回源HOST](https://www.alibabacloud.com/help/en/cdn/user-guide/configure-the-default-origin-host)、[回源SNI](https://www.alibabacloud.com/help/en/cdn/user-guide/configure-sni)
3. 配置加速域名的有效HTTPS证书，在DNS添加阿里云返回的CNAME记录。只有域名、TLS和回源都验证通过后才切换应用。
4. 只缓存公开的 `/api/media/<媒体ID>/<内容SHA>.mp4` 播放资源，尊重源站缓存头，先使用1小时缓存。登录、学习同步、资料、管理员上传/下载、私有附件等API不缓存；错误响应不缓存。CDN域名不能成为整个应用API的通用缓存入口。
5. 启用“Range回源”，分片大小先用512KB。源站已支持单段Range/206；上线仍需对新视频实测206、Content-Range、Content-Type及拖动播放。Range回源可以降低完整文件回源的流量，但会增加回源请求数，需要同时查看源站请求和数据库负载。[Range回源说明](https://www.alibabacloud.com/help/en/cdn/user-guide/object-chunking)
6. 删除、归档或撤下视频后立即刷新对应版本地址的CDN缓存。公共视频缓存存在传播时间，不能把它作为私有资料的访问控制。

## 切换前验证

先从v14公开设备接口取得实际内容版本MP4路径。使用该路径验证源站和CDN返回相同字节、视频总长度、SHA/版本、Range响应及TLS，不需要登录凭证。随后才配置服务端 `MEDIA_VIDEO_CDN_ORIGIN=https://实际加速域名`；保持 `MEDIA_VIDEO_DELIVERY_ROOT=/app/data/video-delivery` 与 `MEDIA_VIDEO_DELIVERY_MANIFEST=/app/data/video-delivery/manifest.json`。

CDN开通和应用切换需要另一次可回退的配置更新。本次安装器刻意要求现场CDN为空，避免在未验证域名时自动改变媒体出口。CDN上线后再次执行冷/热缓存50人测试，并比较ECS公网出网、CDN命中率、首播和缓冲。单凭带宽设置100Mbps或压缩理论值不能宣称不卡顿。

参考阿里云官方说明：[Range回源](https://www.alibabacloud.com/help/en/cdn/user-guide/object-chunking)、[ECS公网带宽与监控](https://www.alibabacloud.com/help/zh/ecs/user-guide/network-bandwidth)。
