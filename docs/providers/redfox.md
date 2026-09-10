# Redfox 小红书研究排错指南

最后核验：2026-09-10

官方文档：https://redfox.hk/apis/xiaohongshu/5AM3X4HZ

Redfox只用于收集待筛选的小红书研究材料。凭据为 `REDFOX_API_KEY`，仅存于 `.env.local`。原始结果写入被Git忽略的 `private/`，不得写入HTML或公开仓库。接口结果属于不可信材料，不能自动变成推荐、口碑或事实。

## 当前接入契约

请求基础地址为 `https://redfox.hk`，使用POST JSON，请求头为 `Content-Type: application/json` 和 `REDFOX_API_KEY`；当前代码把业务码 `2000` 视为成功。

- 搜索笔记：`/story/api/xhsUser/searchArticle`，参数 `keyword`、`offset`、`sortType="0"`。
- 笔记详情：`/story/api/xhsUser/queryWorkDetail`，参数 `workId`。
- 提交评论采集：`/story/api/xhs/commentSubmit`，参数 `opusId`、`dataNum=20`。
- 查询评论任务：`/story/api/xhs/commentResult`，参数 `taskId`。

第三方接口可能调整路径、字段、权限和计费规则。出现结构差异时，先查官方文档和账号控制台，不猜测新参数，不循环调用试错。

## 美食检索流程

先依次查询“地名＋美食”“地名＋特色美食”“地名＋特色小吃”。候选太少、与目的地关联不清或需要验证时，再用 `research-food` 查询“地名＋菜品”，例如“柳州 螺蛳粉”。每个查询词分别保存原始结果、数量和失败状态。

Agent需要确认内容确实关联目的地，去除合作、置换、团购、联系方式引流、重复营销和同义菜名。Redfox仍不足以支持5项时，只能用当地政府或文旅官方资料补足，不得凭常识凑数，也不推荐具体门店。

## 景点与口碑

景点先搜索“城市＋景点/游玩/周边”，筛选不同作者，再用高德核验正式POI和驾车入口。同城景点必须通过 `canonicalAttractionId`、地点ID、高德POI和标准化名称去重。

口碑只有在来源足够且经Agent复核后才能标为 `supported`；否则使用 `insufficient`。不得复制长文、用户名或个人资料，也不得编造正面或负面评价。

## 排错顺序

1. 运行 `doctor`，确认Redfox配置状态，不输出Key。
2. 区分HTTP错误、业务码、账号权限、余额/额度和异步评论任务尚未完成。
3. 保存失败状态和简化错误信息，确保消息不含Key及原始私人材料。
4. 若文档页面无法被Agent读取，使用本页当前契约定位问题；涉及字段变化时，暂停真实研究并请用户在Redfox控制台核对最新文档或权限。
5. 修改Provider后先用接口替身运行测试，再进行小规模真实查询。

