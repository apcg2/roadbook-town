# 数据约定

参考 `examples/demo.trip.json`（已公开授权的广东山水自驾游样例）和 `schemas/trip.schema.json`。`tests/fixtures/virtual.trip.json`是仅供自动测试的虚构数据；`blank.trip.json`是未填草稿，校验失败是预期行为。

- `id`：稳定英文旅程ID，用于本地清单隔离；同一旅程更新不要改ID。
- `startDate/endDate`：含年份的ISO日期，首末日包含在行程内。
- `demo`：公开虚拟示例为true；经授权公开的真实示例与用户正式行程必须false。
- `places`：地点字典，kind为city/poi/area；name、city、address，GCJ-02高德坐标；城市天气另存WGS84。真实数据verified=true代表Agent已核验，并非工具自动查证。
- `canonicalAttractionId`：所有被play事件引用的地点必须提供。同一实际景点即使使用不同入口、停车场或别名，也必须共用同一规范标识；同城重复会被拒绝。
- `stops`：有序到访段。role依次为start、visit…、end；即使同城重复也有不同id。placeId引用city地点。region用于所属市州。
- `entryPlaceId`：可选的入城首站，例如沿途景点或停车入口；未提供时先到城市节点。用于先游览后入住的顺路安排，避免先绕到市中心。
- `events`：按日期、早上/上午/中午/下午/傍晚/晚上排序。type为arrive/play/stay/depart，每项引用placeId。
- `play`：summary最多15字，duration为显示时长，minutes为排程估值，reviews为supported或insufficient。supported每类2条短语，每条text最多5字并引用sourceIds。
- `stay`：默认placeId为住宿城市；有用户提供的具体酒店时增加hotel:{name,placeId}，实际酒店位置进入道路计算，地图小屋仍紧邻城市标签。
- `sightShortfallReason`：途中城市仅安排1个景点时必填，说明时间或证据不足；正常2—3个时省略。
- `foods`：途中城市必须恰好5项菜品，每项含name和sourceIds；不含门店，名称标准化后不得重复。
- `sources`：私有记录，含id、provider、url、fetchedAt、accepted、筛选说明。小红书来源provider=redfox且accepted=true才能支持口碑。不要把原文、账号或凭据放到生成HTML。
- `route`：由算路命令生成，存inputHash、legs、boundaries。每段from/to/distanceM/durationS/points。包括当地往返，不以展示的城际里程之和冒充总里程。
- `approval`：用户确认后工具记录planHash；任何行程变更使确认失效。
- `mapLabels`：遇到自动地图排版失败时，可指定某城市的{x,y}标签左上角（960×700画布），仍会执行碰撞检查；不能移动真实坐标。

时间线住宿每晚仅一次；通常晚数=结束日减开始日。跨夜驾驶等特殊需求当前需要调整行程或扩展模型，不能填假住宿满足校验。

本文schema用于编辑提示；运行时还检查日期、引用、事件顺序、住宿、口碑证据、路线和确认哈希。用户字符串均转义；不支持把HTML、CSS或脚本片段当作行程字段。

计算得到的预计时间只用于辅助规划。Agent必须按planning.md检查吃饭、休息、接驳与余量，不能把接口车程当作完整日程。
