# 璃月黄金交易所 Web 展示与接口文档规划

## Context

本仓库当前是“璃月黄金交易所”Agent 大赛后端与选手 SDK 仓库。规则要求 3 个交易日、逐 Tick 撮合、新闻/研报、策略卡、资产净值 NAV 结算，因此 Web 前端需要同时承担比赛观战展示、选手调试控制台、盘口/K 线可视化、实时事件解说和结算呈现。

源码现状是：服务端没有 HTTP API，只有 WebSocket；协议消息已经定义在 [BroadcastMessages.cs](server/src/thuai/Protocol/Messages/BroadcastMessages.cs) 与 [PerformMessages.cs](server/src/thuai/Protocol/Messages/PerformMessages.cs)，但观战连接、显式握手、部分实时事件接线和展示所需摘要消息还缺失。推荐先把 WebSocket 协议作为唯一权威接口补齐，并同步产出前端展示方案、服务端到前端 API 调用规范、选手 SDK 调用说明。

## Recommended scope

本轮建议交付 3 类内容：

1. Web 前端规划文档：明确页面、组件、数据流、K 线聚合、事件流和观战/选手视角。
2. WebSocket API 规范文档：基于现有后端消息定义，补充 Web 前端需要的最小协议扩展。
3. 选手 SDK 调用说明：覆盖 Python/C++ SDK 的连接、回调、动作调用、规则限制和常见陷阱。

不建议首期新增 HTTP 业务 API 或 Node BFF；现有比赛状态是逐 Tick 推送，WebSocket-first 更贴合后端实现，也避免维护双协议。

## Critical source facts to preserve

- 规则来源：[rule.md](rule.md)
  - 每场 3 个交易日，每日 2000 Tick。
  - 初始资产为 1,000,000 Mora 与 1,000 Gold。
  - 交易日结束按盘口中间价折算 NAV；胜者得 1 分。
  - 新闻后 50 Tick 内提交研报，100 Tick 结算。
  - 策略选择阶段 40 Tick，策略卡分基建、风控、金融科技。
- 服务端消息基类：[Message.cs](server/src/thuai/Protocol/Messages/Message.cs)
  - JSON，字段 camelCase，空字段忽略。
  - `messageType` 为消息分发字段。
- 客户端动作协议：[PerformMessages.cs](server/src/thuai/Protocol/Messages/PerformMessages.cs)
  - `LIMIT_BUY`、`LIMIT_SELL`、`CANCEL_ORDER`、`SUBMIT_REPORT`、`SELECT_STRATEGY`、`ACTIVATE_SKILL`。
- 服务端广播协议：[BroadcastMessages.cs](server/src/thuai/Protocol/Messages/BroadcastMessages.cs)
  - `GAME_STATE`、`MARKET_STATE`、`PLAYER_STATE`、`NEWS_BROADCAST`、`REPORT_RESULT`、`STRATEGY_OPTIONS`、`TRADE_NOTIFICATION`、`SKILL_EFFECT`、`ERROR`。
- 当前广播出口：[Program.cs](server/src/thuai/Program.cs)
  - 已发送 `GAME_STATE`、`MARKET_STATE`、`PLAYER_STATE`、`STRATEGY_OPTIONS`。
  - `NEWS_BROADCAST` 当前主要见于内幕消息预览路径。
  - `REPORT_RESULT`、`TRADE_NOTIFICATION`、`SKILL_EFFECT`、`ERROR` 有 schema，但需要补真实发送链路。
- 当前连接绑定：[AgentServer.MessageReceiving.cs](server/src/thuai/Connection/AgentServer/AgentServer.MessageReceiving.cs)
  - 服务端收到第一条带 `token` 的动作消息后才把 socket 绑定到玩家。
  - 这会阻碍纯观战 Web 或连接后只看状态的控制台。
- 当前发送逻辑：[AgentServer.MessageSending.cs](server/src/thuai/Connection/AgentServer/AgentServer.MessageSending.cs)
  - `PublishToAll` 只发给已绑定 token 的 player socket。
  - 观战连接需要独立 role/socket 管理。
- SDK 示例：
  - Python：[sdk-python/main.py](sdk-python/main.py)、[agent.py](sdk-python/sdk_python/agent.py)
  - C++：[sdk-cpp/src/main.cpp](sdk-cpp/src/main.cpp)、[agent.hpp](sdk-cpp/src/agent.hpp)
  - 默认连接 `ws://localhost:14514`，通过 `TOKEN` / `SERVER` 环境变量配置。

## Frontend display plan

### Web mode split

推荐一套 Web SPA，提供两个主要模式：

1. Observer 展示页 `/observer`
   - 面向比赛大屏、裁判台、直播讲解。
   - 默认展示公共市场视角、双方资产摘要、新闻/技能/成交事件、比分和结算。
2. Player 控制台 `/player`
   - 面向调试与演示。
   - 展示当前玩家私有盘口视角、资产、挂单、策略卡、新闻研报，并提供可选手动操作面板。

结算页可先做成 observer/player 内的全屏弹层，而不是单独路由。

### Observer 页面布局

- 顶部状态条
  - 当前阶段 `stage`
  - 当前交易日 `currentDay`
  - 当前 Tick / 日内 Tick
  - 连接状态
  - 比分 `scores`
- 主图表区
  - K 线图
  - 成交量柱图
  - 可切换 `midPrice` / `lastPrice` 价格口径
- 盘口区
  - 买一到买十、卖一到卖十
  - best bid / best ask / spread / mid / last
- 事件流区
  - 新闻发布
  - 研报结算
  - 逐笔成交
  - 技能触发
  - 错误/系统提示
- 玩家对比区
  - 双方 NAV
  - Mora / frozenMora
  - Gold / frozenGold / lockedGold
  - activeCards
  - 挂单数量摘要
- 策略与结算区
  - 策略候选卡
  - 选择阶段倒计时
  - 当日结算结果
  - 最终冠军

### Player 页面布局

- 顶部状态条
  - token、连接状态、阶段、交易日、Tick。
- 市场区
  - 玩家视角 K 线与盘口。
  - 注意：当前服务端会按玩家视角合并“恶意做空”的 fake asks。
- 资产区
  - `mora`、`frozenMora`、`gold`、`frozenGold`、`lockedGold`、`nav`。
- 挂单区
  - `pendingOrders` 表格：`orderId`、`side`、`price`、`quantity`、`remainingQuantity`、`status`。
- 策略区
  - `STRATEGY_OPTIONS` 选择。
  - 已激活卡牌 `activeCards`。
  - 主动技能按钮与冷却状态；若后端暂不补冷却字段，则首期只显示卡名与手动触发入口。
- 新闻/研报区
  - `NEWS_BROADCAST` 列表。
  - `SUBMIT_REPORT` 操作。
  - `REPORT_RESULT` 展示。
- 手动交易区
  - 限价买入、限价卖出、撤单、激活技能。

### Component breakdown

- `TopStatusBar`
- `ConnectionStatus`
- `StageBadge`
- `TickProgress`
- `MarketChartPanel`
- `OrderBookPanel`
- `PriceSummaryCard`
- `EventFeedPanel`
- `PortfolioPanel`
- `PlayerComparisonPanel`
- `PendingOrdersTable`
- `ActiveCardsPanel`
- `StrategyOptionsPanel`
- `OrderEntryPanel`
- `ReportSubmitPanel`
- `SkillActionPanel`
- `ScoreboardPanel`
- `DaySettlementModal`
- `FinalResultPanel`

## Frontend data flow

### Store slices

建议前端状态分为：

- `connection`
  - WebSocket 状态、role、token、重连状态。
- `game`
  - `stage`、`currentDay`、`currentTick`、`dayTick`、`dayTickLimit`、`scores`。
- `market`
  - 最新 `MARKET_STATE`、盘口、K 线 candles、volume baseline。
- `players`
  - player 模式的 `PLAYER_STATE`。
  - observer 模式的 `PLAYER_SUMMARY_STATE`。
- `strategy`
  - `STRATEGY_OPTIONS`、已选/已激活策略、技能状态。
- `events`
  - 新闻、成交、研报结果、技能效果、错误、结算事件。

### WebSocket lifecycle

- 建立连接后发送新增 `HELLO`。
- 服务端返回 `HELLO_ACK`。
- 服务端立即补发当前快照。
- 后续按 Tick 接收 snapshot 与 event。
- 断线后指数退避重连，重连后重新 `HELLO`。

Player 连接示例：

```json
{
  "messageType": "HELLO",
  "role": "player",
  "token": "player1",
  "protocolVersion": "v1"
}
```

Observer 连接示例：

```json
{
  "messageType": "HELLO",
  "role": "observer",
  "protocolVersion": "v1"
}
```

### K line aggregation

后端当前没有直接广播 OHLC/K 线；前端从逐 Tick `MARKET_STATE` 聚合。

推荐内部结构：

```ts
type Candle = {
  day: number
  bucketStartTick: number
  bucketEndTick: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}
```

聚合规则：

1. 默认价格口径用 `midPrice`，另以 `lastPrice` 做可选折线。
2. 默认 20 Tick 一根 K 线，可切换 10 / 20 / 50 / 100 Tick。
3. 用 `currentDay + MARKET_STATE.tick` 归属交易日。
4. `bucket = floor((tick - 1) / interval)`。
5. 新桶第一条：`open = high = low = close = midPrice`。
6. 同桶更新：`high = max(high, midPrice)`、`low = min(low, midPrice)`、`close = midPrice`。
7. `volume` 是当日累计成交量，柱图必须用差分：`delta = max(0, currentVolume - previousVolume)`。
8. 跨日、tick 回退、断线重连后第一条 snapshot 只重置 volume baseline，不计入 delta。
9. 非 `TradingDay` 阶段不生成 candle。

### Global/private view handling

- `GAME_STATE`、`STRATEGY_OPTIONS`、公共新闻适合全局广播。
- `PLAYER_STATE` 是私有状态，仅发给对应玩家。
- `MARKET_STATE` 当前会按玩家视角混入对手伪卖盘；player 页面直接展示收到的视角。
- observer 页面首期只展示公共真实盘口，不展示“对手被污染后的盘口”。技能影响通过 `SKILL_EFFECT` 事件解释。

## Server API/protocol work needed for Web support

### 1. Add handshake messages

修改/新增位置：

- [PerformMessages.cs](server/src/thuai/Protocol/Messages/PerformMessages.cs)
- [BroadcastMessages.cs](server/src/thuai/Protocol/Messages/BroadcastMessages.cs)
- [AgentServer.MessageReceiving.cs](server/src/thuai/Connection/AgentServer/AgentServer.MessageReceiving.cs)

新增 C->S：`HELLO`

```json
{
  "messageType": "HELLO",
  "role": "player",
  "token": "player1",
  "protocolVersion": "v1"
}
```

新增 S->C：`HELLO_ACK`

```json
{
  "messageType": "HELLO_ACK",
  "role": "player",
  "token": "player1",
  "protocolVersion": "v1",
  "capabilities": ["gameState", "marketState", "playerState", "actions"]
}
```

要求：

- `role=player` 时 `token` 必填，并绑定 socket 到 player。
- `role=observer` 时不需要 token，绑定到 observer socket 集合。
- 保留旧 SDK 兼容：老客户端第一条动作消息带 token 时仍可懒绑定。

### 2. Add observer socket management

修改位置：

- [AgentServer.MessageSending.cs](server/src/thuai/Connection/AgentServer/AgentServer.MessageSending.cs)
- AgentServer socket 管理相关 partial class。

新增能力：

- 记录 socket role。
- 支持 observer 集合。
- 增加 `PublishToObservers`。
- 明确 `PublishToPlayers` / `PublishToAllConnections` 的语义。
- `PublishToAll` 若保留原名，需要文档说明它当前是“所有已绑定 player”。

### 3. Send initial snapshot after HELLO

修改位置：

- [Program.cs](server/src/thuai/Program.cs)
- 或抽出 `GameStatePublisher` 以复用当前 `BroadcastGameState` 的组包逻辑。

HELLO 后立即发送：

- player：`GAME_STATE`、当前玩家视角 `MARKET_STATE`、`PLAYER_STATE`、当前 `STRATEGY_OPTIONS`。
- observer：`GAME_STATE`、公共 `MARKET_STATE`、所有 `PLAYER_SUMMARY_STATE`、当前 `STRATEGY_OPTIONS`。

### 4. Wire existing domain events to broadcast messages

需要连接 [TradingDay.cs](server/src/thuai/GameLogic/TradingDay.cs) 中已有事件到 WebSocket 出口：

- `OnNewsPublished` -> `NEWS_BROADCAST`
- `OnTradeExecuted` -> `TRADE_NOTIFICATION`
- `OnReportSettled` -> `REPORT_RESULT`
- `OnSkillActivated` -> `SKILL_EFFECT`

发送建议：

- 新闻：发给所有 player 和 observer；内幕预览继续只给拥有卡牌的玩家。
- 成交：发给相关玩家；observer 可收到简化成交事件。
- 研报结果：至少发给对应玩家；observer 版建议带可选 `playerToken`。
- 技能效果：发给所有 player 和 observer，供事件流讲解。

### 5. Add display-focused messages/fields

推荐新增：

- `PLAYER_SUMMARY_STATE`
  - 给 observer 展示双方资产摘要，不泄漏完整挂单列表。
- `DAY_SETTLEMENT`
  - 给结算弹层展示当日胜者、原因、NAV、交易笔数、比分。

推荐补充字段：

- `GAME_STATE`
  - 保留 `totalTicks`，但文档注明当前含义有歧义。
  - 新增 `stageTick`、`stageTickLimit`、`dayTick`、`dayTickLimit`。
- `REPORT_RESULT`
  - observer 用可选 `playerToken`。
- `PLAYER_STATE`
  - 可选 `activeCardStates` 或 `skillStates`，用于技能冷却与持续时间展示。

### 6. Standardize ERROR responses

当前 `ERROR` schema 已存在，但失败路径需要真实返回。

需要覆盖：

- 未握手。
- 未知 token。
- 非当前阶段调用。
- 每 Tick 指令超限。
- 余额/持仓不足。
- 订单不存在或不可撤。
- 研报窗口关闭。
- 策略卡不可选或重复选择。
- 技能不存在、CD 未到、参数缺失。
- 熔断期间禁止新订单。

建议错误码：

- `100x` 握手/鉴权。
- `200x` 参数/动作合法性。
- `300x` 阶段/节流。
- `400x` 服务端内部错误。

## API specification document plan

建议新增文档：

- `docs/web/frontend-display.md`
- `docs/api/websocket-protocol.md`
- `docs/sdk/contestant-sdk.md`

### `docs/web/frontend-display.md`

内容结构：

1. 展示目标和使用场景。
2. Observer 页面信息架构。
3. Player 控制台信息架构。
4. 组件清单。
5. K 线聚合规则。
6. 事件流分类和展示优先级。
7. 私有状态与公共状态边界。
8. 结算页展示字段。

### `docs/api/websocket-protocol.md`

内容结构：

1. 概述
   - 默认地址 `ws://localhost:14514`。
   - 根路径直连。
   - JSON、camelCase、`messageType`。
2. 连接生命周期
   - connect -> HELLO -> HELLO_ACK -> snapshot -> tick stream -> reconnect。
3. 角色权限
   - `player`。
   - `observer`。
4. 通用字段语义
   - `price`、`quantity`、`tick`、`volume`、`currentTick`、`dayTick`。
5. Client -> Server schema
   - `HELLO`
   - `LIMIT_BUY`
   - `LIMIT_SELL`
   - `CANCEL_ORDER`
   - `SUBMIT_REPORT`
   - `SELECT_STRATEGY`
   - `ACTIVATE_SKILL`
6. Server -> Client schema
   - `HELLO_ACK`
   - `GAME_STATE`
   - `MARKET_STATE`
   - `PLAYER_STATE`
   - `PLAYER_SUMMARY_STATE`
   - `NEWS_BROADCAST`
   - `REPORT_RESULT`
   - `STRATEGY_OPTIONS`
   - `TRADE_NOTIFICATION`
   - `SKILL_EFFECT`
   - `DAY_SETTLEMENT`
   - `ERROR`
7. 状态机
   - `Waiting`、`PreparingGame`、`StrategySelection`、`TradingDay`、`Settlement`、`Finished`。
8. 错误码。
9. 完整时序示例。

### Core API schemas to document

Client -> Server:

```json
{ "messageType": "LIMIT_BUY", "token": "player1", "price": 2000, "quantity": 10 }
```

```json
{ "messageType": "LIMIT_SELL", "token": "player1", "price": 2010, "quantity": 10 }
```

```json
{ "messageType": "CANCEL_ORDER", "token": "player1", "orderId": 123 }
```

```json
{ "messageType": "SUBMIT_REPORT", "token": "player1", "newsId": 5, "prediction": "Long" }
```

```json
{ "messageType": "SELECT_STRATEGY", "token": "player1", "cardName": "内幕消息" }
```

```json
{ "messageType": "ACTIVATE_SKILL", "token": "player1", "skillName": "暗池交易", "direction": "buy" }
```

Server -> Client:

```json
{
  "messageType": "GAME_STATE",
  "stage": "TradingDay",
  "currentDay": 1,
  "currentTick": 345,
  "totalTicks": 345,
  "scores": [{ "token": "player1", "score": 1 }]
}
```

```json
{
  "messageType": "MARKET_STATE",
  "bids": [{ "price": 1998, "quantity": 30 }],
  "asks": [{ "price": 2002, "quantity": 25 }],
  "lastPrice": 2000,
  "midPrice": 2000,
  "volume": 152,
  "tick": 345
}
```

```json
{
  "messageType": "PLAYER_STATE",
  "mora": 980000,
  "frozenMora": 20000,
  "gold": 1005,
  "frozenGold": 10,
  "lockedGold": 500,
  "nav": 1990000,
  "activeCards": ["内幕消息"],
  "pendingOrders": []
}
```

```json
{
  "messageType": "STRATEGY_OPTIONS",
  "infrastructure": { "name": "内幕消息", "description": "...", "category": "Infrastructure" },
  "riskControl": { "name": "冰山订单", "description": "...", "category": "RiskControl" },
  "finTech": { "name": "暗池交易", "description": "...", "category": "FinTech" }
}
```

新增推荐 schema：

```json
{
  "messageType": "PLAYER_SUMMARY_STATE",
  "token": "player1",
  "mora": 980000,
  "frozenMora": 20000,
  "gold": 1005,
  "frozenGold": 10,
  "lockedGold": 500,
  "nav": 1990000,
  "activeCards": ["内幕消息"],
  "pendingOrderCount": 1
}
```

```json
{
  "messageType": "DAY_SETTLEMENT",
  "day": 1,
  "winnerToken": "player1",
  "reason": "NAV",
  "scores": [{ "token": "player1", "score": 1 }],
  "players": [{ "token": "player1", "nav": 2034500, "tradeCount": 17 }]
}
```

## SDK guide plan

### `docs/sdk/contestant-sdk.md`

内容结构：

1. 快速开始
   - 启动服务端需要配置 `TOKENS`。
   - 选手进程配置 `TOKEN` 和 `SERVER`。
   - 默认 `SERVER=ws://localhost:14514`。
2. 通用生命周期
   - 连接 WebSocket。
   - 接收 game/market/player/news/strategy/trade/skill/error 回调。
   - 在回调里发动作。
3. Python SDK
   - 继承 `Agent`。
   - 覆写 async 回调。
   - `await agent.run()`。
   - 动作函数：`limit_buy`、`limit_sell`、`cancel_order`、`submit_report`、`select_strategy`、`activate_skill`。
   - `Prediction.LONG` / `Prediction.SHORT` / `Prediction.HOLD`。
   - 回调里避免阻塞；如接入大模型需异步并设置超时。
4. C++ SDK
   - 继承 `thuai::Agent`。
   - 覆写 virtual 回调。
   - `agent.run()`。
   - 动作函数：`limitBuy`、`limitSell`、`cancelOrder`、`submitReport`、`selectStrategy`、`activateSkill`。
   - `Prediction::Long` / `Prediction::Short` / `Prediction::Hold`。
5. 状态字段语义
   - `market_state.volume` 是当日累计量。
   - `market_state.tick` 是交易日内 Tick。
   - `game_state.currentTick` 是全局 Tick。
   - `player_state.pendingOrders` 是当前未完成挂单。
6. 规则限制
   - 每 Tick 最多 5 条交易指令。
   - 每 Tick 最多 1 条研报。
   - 新闻后 50 Tick 内可提交研报。
   - 策略阶段 40 Tick。
   - 默认网络延迟 5 Tick。
   - 手续费默认 0.02%。
7. 技能调用
   - `ACTIVATE_SKILL.direction` 当前主要用于“暗池交易”，取 `buy` 或 `sell`。
8. 常见陷阱
   - 不要在回调中长时间阻塞。
   - 不要把累计成交量当作单 Tick 成交量。
   - 注意阶段限制和 Tick 窗口。
   - 协议升级后，优先使用 `HELLO` 显式握手。

## Implementation order after approval

1. 先写文档
   - `docs/web/frontend-display.md`
   - `docs/api/websocket-protocol.md`
   - `docs/sdk/contestant-sdk.md`
2. 再补服务端最小 Web 支持
   - `HELLO` / `HELLO_ACK`
   - observer socket 管理
   - HELLO 后快照补发
   - 事件接线
   - `PLAYER_SUMMARY_STATE`、`DAY_SETTLEMENT`
   - `ERROR` 发送路径
3. 最后如需要，再创建 Web 前端工程或接入现有前端工程
   - 优先实现 observer MVP。
   - 再实现 player 控制台。

## Verification plan

### Documentation verification

- 对照 [PerformMessages.cs](server/src/thuai/Protocol/Messages/PerformMessages.cs) 和 [BroadcastMessages.cs](server/src/thuai/Protocol/Messages/BroadcastMessages.cs) 检查 schema 名称、字段名、大小写。
- 对照 [Program.cs](server/src/thuai/Program.cs) 标注哪些消息当前已发送、哪些需要补接线。
- 对照 [sdk-python/main.py](sdk-python/main.py) 和 [sdk-cpp/src/main.cpp](sdk-cpp/src/main.cpp) 检查 SDK 示例命令与回调名称。

### Server verification

- 单元测试/集成测试覆盖：
  - `HELLO` player 绑定。
  - `HELLO` observer 绑定。
  - HELLO 后立即收到快照。
  - observer 收到 `GAME_STATE`、公共 `MARKET_STATE`、`PLAYER_SUMMARY_STATE`。
  - player 收到 `PLAYER_STATE`。
  - 新闻、成交、研报结果、技能触发都有对应事件消息。
  - 非法动作返回 `ERROR`。
  - 旧 SDK 不发送 `HELLO` 但首条动作带 token 时仍可工作。

### Frontend verification

- K 线聚合单元测试：
  - 同桶 OHLC 更新。
  - `volume` 差分。
  - 跨日重置。
  - 断线重连后第一条 snapshot 不计成交量。
- 手工联调：
  - Observer 连接后不操作也能看到比赛状态。
  - Player 连接后能看到私有资产与挂单。
  - 新闻、研报、成交、技能能进入事件流。
  - 策略阶段倒计时与候选卡展示正确。
  - 三个交易日结束后显示最终比分和冠军。
