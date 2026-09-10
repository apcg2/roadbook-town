# 高德 Web 服务排错指南

最后核验：2026-09-10

官方入口：https://lbs.amap.com/api

本项目只在制作阶段调用高德 Web 服务，凭据为 `AMAP_WEB_SERVICE_KEY`，仅存于 `.env.local`。生成的 HTML、示例、日志和错误消息均不得包含 Key。网页中的地点按钮使用高德 URI，不需要把 Web 服务 Key 写入页面。

## 本项目使用的请求

基础地址为 `https://restapi.amap.com/`：

- POI 文本搜索：`GET /v5/place/text`，使用 `keywords`、`region`、`city_limit=true`、`page_size=10`。
- 行政区边界：`GET /v3/config/district`，使用 `keywords`、`subdistrict=0`、`extensions=all`。
- 驾车路径：`GET /v5/direction/driving`，使用 `origin`、`destination`、`strategy=32`、`cartype=0`、`show_fields=polyline,cost`。

Agent必须核对 `status === "1"`。路径使用首条推荐方案的 `distance`、`cost.duration` 和各步骤 `polyline`；缺少任何一项都应失败，不得用直线距离或旧里程替代。

## 限流与重试

同一工具进程内所有 POI、行政区和路径请求共用队列，请求启动间隔至少350ms。不得并行启动多个高德 CLI 进程，因为不同进程无法共享限速状态。

- `10019`、`10020`、`10021`：视为瞬时QPS限制，约1秒、2秒退避，最多重试2次；每次重试仍经过共享队列。
- `10003`、`10044`：日调用量或额度问题，不重试。
- `10002`、`10012`、`10041`：Key或服务权限问题，不重试。
- HTTP错误、网络超时、无效JSON及其他业务码：报告准确阶段和代码，不无限重试。

## 排错顺序

1. 运行 `node src/cli.mjs doctor`，只确认配置状态，不输出Key。
2. 核对使用的是 Web 服务 Key，且开通了当前接口能力。
3. 核对城市、经纬度顺序为“经度,纬度”，坐标为GCJ-02。
4. 若为QPS错误，停止其他高德进程后再试；若为额度或权限错误，到高德控制台处理。
5. 官方字段或错误码与本页不一致时，以官方文档为准，并先更新Provider与测试，再继续真实查询。

