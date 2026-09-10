# 路书小镇 · roadbook-town

把这个仓库链接发给你的 AI Agent，生成自己的自驾行程和像素小镇网页。

**当前版本：可在本地运行的 v0.1。** 固定模板、结构化校验、静态地图、查询适配器和发布命令已实现。真实高德/Redfox调用与Cloudflare发布需使用你自己的账号；本项目不附带任何 API Key 或原始检索材料。当前演示为已获公开授权的“广东山水自驾游”样例，仅供体验工具与数据结构；请在出行前自行复核道路、营业与天气信息。

## 给 Agent 的启动消息

> 请读取这个项目的 README.md 和 AGENTS.md，先询问我的出发城市、结束城市、游玩城市或大致想法、总天数，再引导我配置数据服务。先给文本行程供我确认，确认后使用固定模板生成网页，验收后再询问是否发布。

Agent 需要能读取文件、运行 Node.js 命令并联网。普通无工具聊天窗口无法完成全流程。不要求使用某一家 AI 服务或额外购买模型 API；路线选择和资料判断由你正在使用的 Agent 完成。

## 先体验，不需要 Key

需要 Node.js 22或更高版本。生成器无第三方运行依赖，不需要安装框架。

```bash
npm run doctor
npm test
npm run demo
npm run preview
```

打开提示的本机预览链接。`output/demo/index.html` 可以直接用浏览器打开；线路图、行程、便利贴均内嵌，天气仍需联网。测试浏览器用例需要本机 Chrome，见 `docs/testing.md`。

## 创建自己的行程

```bash
node src/cli.mjs init
```

由 Agent 按 `docs/planning.md` 收集需求，填写 `private/trip.json`，按 `docs/setup.md` 配置本地 Key。`examples/demo.trip.json` 是已公开授权的广东山水自驾游样例；可借鉴字段和流程，但须重新核验并生成自己的路线，不要直接当作旅行建议。

```bash
node src/cli.mjs poi 地点名 --city 所属城市
node src/cli.mjs research 城市游玩关键词
node src/cli.mjs research-food --city 柳州 --dish 螺蛳粉 --dish 柳州酸 --out private/food-liuzhou.json
node src/cli.mjs research --detail 笔记ID
node src/cli.mjs research --comments 笔记ID
node src/cli.mjs research --task 评论任务ID
node src/cli.mjs validate private/trip.json
node src/cli.mjs route private/trip.json
node src/cli.mjs plan private/trip.json
```

`research`与`research-food`只采集材料，不会伪装为已完成去广告或自动规划。美食先查地名＋美食类关键词，候选不足或关联不清时再查地名＋菜品；Redfox仍不足可用当地政府或文旅官方资料补足。Agent须按来源规则筛选、核验并写入数据。评论是异步采集任务，不是对外发评论。查询默认不再单独询问费用，不自动充值，失败不无限重试。

用户确认文本后：

```bash
node src/cli.mjs approve-plan private/trip.json --user-confirmed
node src/cli.mjs render private/trip.json
node src/cli.mjs preview output/trip/index.html
```

两个确认点由Agent负责尊重，参数不能证明人类真的已同意。工具用内容哈希防止已确认后改动行程却沿用旧确认。

网页确认后按 `docs/publishing.md` 发布到用户自己的 Cloudflare 项目。不要发布 `private/`、配置文件或整套仓库工作目录。

## 固定网页功能

- 米黄色方格、极简黑白像素小镇与少量蓝/黄/绿/珊瑚红。
- 真实道路静态SVG图，城市文字、住宿小屋、游玩旗帜、方向箭头、总里程与图例。
- 城市时间线、3日天气、菜品搜索、景点高德链接、简短口碑、酒店预留位。
- 蓝色选中态底部城市导航，滚动联动与重复城市独立锚点。
- 行前便利贴，增删勾选与同浏览器本地保存。
- 手机优先、减少动态效果兼容、离线正文及单HTML输出。

城市数、景点数、日期和里程全部从数据生成，不固定为某条示例路线。

## 文件与隐私

`private/`存放用户数据和原始来源；`output/`存放生成网页与报告；均被Git忽略。公开文件采用白名单扫描：`npm run audit`。首次发布仓库还需人工核查Git历史与素材，不要把含个人资料的旧工作目录直接推送。

详细规则：[Agent流程](AGENTS.md)、[数据结构](docs/data.md)、[规划原则](docs/planning.md)、[固定UI](docs/ui.md)、[配置](docs/setup.md)、[验收](docs/testing.md)、[发布](docs/publishing.md)、[许可](LICENSE)。

## 许可状态

这是公开使用工具的准备版本，不采用MIT等开放修改许可。可运行工具创建自己的行程，项目修改受限；分发暂按经作者授权后允许，最终公开前须确认具体授权方式。生成网页的修改、部署和分享有单独授权。GitHub公开仓库适用平台站内查看/Fork规则，不能承诺禁止所有复制。
