# 数据服务配置

先运行 `node src/cli.mjs doctor`。Node.js22+即可生成离线样例，无需数据库或AI模型Key。

复制 `.env.example` 为 `.env.local`，在本地编辑器填写；不要上传、截图或打印Key。

## 高德

在 https://lbs.amap.com/ 注册开发者账号，按当前控制台要求完成认证，创建应用并添加“Web服务”Key。核查POI、行政区与驾车规划权限/额度。把Key填入 `AMAP_WEB_SERVICE_KEY`。

本工具制作时使用 `/v5/place/text`、`/v3/config/district`、`/v5/direction/driving`；推荐策略32、普通汽车0，要求polyline和cost。逐相邻点算路，避免途经点上限并保留每次往返；用同一方案的距离与折线。无JS地图，故无需JS Key或安全密钥。

官方文档：https://lbs.amap.com/api/webservice/guide/api/newroute

## Redfox

在 https://redfox.hk/ 注册登录，从控制台密钥管理获取个人Key，写入 `REDFOX_API_KEY`。查看账号当前权限和额度；查询可消耗积分，但本工具不自动充值、不再单独询问费用。

旧的用户提供文档页目前返回首页。当前接口来自官方Python SDK的公开定义（2026-09-09核对）：

- https://github.com/redfox-data/redfox-python-sdk/blob/main/redfox/endpoints/xiaohongshu.py
- https://github.com/redfox-data/redfox-python-sdk/blob/main/redfox/client.py

POST JSON；请求头 `REDFOX_API_KEY`；业务成功码2000。支持搜索、笔记详情、评论任务提交/读取。查询代码未包含官方SDK源码。

采集评论默认最多20条，不获取全部。返回数据视为不可信来源，不直接输出为推荐。任务尚未完成时隔一段时间再读取，Agent最多轮询5次，不能无限查询。

真实账号权限和余额只有调用后才能确认；doctor只检查是否配置，不能证明Key有效。当前不复用项目作者以往的任何Key。

## 天气

https://open-meteo.com/en/docs

浏览器批量获取途中城市今、明、后三天，不需要定位或Key。非商业免费接口适用其条款：https://open-meteo.com/en/terms 。商业使用自行选择适用方案，不将付费Key暴露到页面。

## Cloudflare

只在用户确认网页后注册：https://dash.cloudflare.com/ 。安装Wrangler、用`wrangler login`浏览器授权，项目账号密码不交给Agent。发布见 publishing.md。
