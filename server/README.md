# THUAI-9 Server

The game server for the 9th Tsinghua University AI Challenge — a gold trading exchange simulation where two AI agents compete as institutional traders across 3 trading days.

---

## Run Executable

The server will read `config` and `data` folder to get configuration file and store replay data. If they don't exist, the server will create them with a default configuration file.

The server will get all available tokens by reading from environment variables, which is not convenient for competitor's testing and debugging. To get tokens from file, change the configuration file's `token` options. For example:

```json
{
  ...
  "token": {
    "loadTokenFromEnv": false,
    "tokenLocation": "TOKENS",
    "tokenDelimiter": ","
  }
  ...
}
```

Then server will get all possible tokens from `TOKENS` file using a comma as delimiter.

After game is finished, a replay file and a result file are generated, OVERWRITING the previous one!!! If you still need previous


## Quick Start with Code (Some Information is Outdated!!)

### Run with Docker

```bash
# Build
docker build -t thuai9-server .

# Run (provide player tokens via env)
docker run -p 14514:14514 -e TOKENS="player1,player2" thuai9-server
```

### Run locally (.NET 9.0 SDK required)

```bash
cd server
dotnet run --project src/thuai
```

The server listens on `ws://0.0.0.0:14514` by default.

### Run tests

```bash
dotnet test
```

51 unit tests covering OrderBook, MatchEngine, Player, NewsSystem, and Game state machine.

---

## Configuration

On first launch, the server creates `config/config.json` with default settings:

```json
{
  "server": {
    "port": 14514,
    "acceptAnyToken": false
  },
  "token": {
    "loadTokenFromEnv": true,
    "tokenLocation": "TOKENS",
    "tokenDelimiter": ","
  },
  "log": {
    "target": "Console",
    "minimumLevel": "Information"
  },
  "game": {
    "ticksPerSecond": 10,
    "tradingDayTicks": 2000,
    "tradingDayCount": 3,
    "strategySelectionTicks": 40,
    "minimumPlayerCount": 2,
    "playerWaitingTicks": 200,
    "initialMora": 1000000,
    "initialGold": 1000,
    "initialGoldPrice": 1000,
    "defaultNetworkDelay": 1,
    "defaultFeeRate": 0.0002,
    "maxImmediateOrdersPerDay": 1,
    "maxRestingOrdersPerDay": 1,
    "newsIntervalMin": 200,
    "newsIntervalMax": 400,
    "researchWindowTicks": 50,
    "researchSettlementDelay": 100,
    "baseResearchReward": 10000,
    "npcOrdersPerTick": 3
  },
  "recorder": { "keepRecord": false }
}
```

Player tokens are loaded from the `TOKENS` environment variable (comma-separated) or from a file at the path in `tokenLocation` if `loadTokenFromEnv` is `false`.
Set `server.acceptAnyToken` to `true` to accept any non-empty player token instead of enforcing the preloaded token list.

---

## Architecture

```plain
Server Process
├── AgentServer (WebSocket, port 14514)
│   ├── Per-socket message queues (ConcurrentQueue)
│   ├── Parsing task (10ms polling)
│   └── Sending task (10ms polling)
├── GameController
│   ├── Tick loop (10 TPS, ClockProvider)
│   └── Message dispatch
├── Game (State machine)
│   ├── Stage: Waiting → PreparingGame → StrategySelection → TradingDay → Settlement → (×3) → Finished
│   └── Players, Scoreboard, StrategyCardManager
├── TradingDay (per-round)
│   ├── OrderBook (price-time priority, SortedSet)
│   ├── MatchEngine (order matching, trade execution)
│   ├── NewsSystem (璃月快报, every 200-400 ticks)
│   ├── NPCTrader (system liquidity)
│   ├── ResearchSystem (research reports with time decay)
│   └── Strategy card effects (per tick)
└── Recorder (replay.dat ZIP + result.json)
```

### Game Flow

```plain
Wait for 2 players → 200 tick countdown
  ↓
For each of 3 trading days:
  ├── Strategy Selection (40 ticks blind draft, 1 random card per category)
  ├── Trading Day (2000 ticks)
  │     - Players submit orders, news triggers, NPCs trade, cards activate
  └── Settlement (1 tick)
        - NAV calculated, day winner gets 1 point
  ↓
Game finished → save results → highest score wins
```

### Scoring

- Each day: player with higher NAV gets 1 point
- Tiebreaker: player with more trades (excluding wash trades) gets 1 point
- Best of 3 trading days

---

## Message Protocol

JSON messages over WebSocket with `messageType` discriminator.

### Client → Server

| messageType       | Fields                             | Description                                    |
| ----------------- | ---------------------------------- | ---------------------------------------------- |
| `LIMIT_BUY`       | `token`, `price`, `quantity`       | Place limit buy order                          |
| `LIMIT_SELL`      | `token`, `price`, `quantity`       | Place limit sell order                         |
| `CANCEL_ORDER`    | `token`, `orderId`                 | Cancel a pending order                         |
| `SUBMIT_REPORT`   | `token`, `newsId`, `prediction`    | Submit research report (`Long`/`Short`/`Hold`) |
| `SELECT_STRATEGY` | `token`, `cardName`                | Select strategy card during draft              |
| `ACTIVATE_SKILL`  | `token`, `skillName`, `targetPlayerId?`, `variant?` | 发动主动技能                        |

### Server → Client

| messageType          | Recipient              | Description                                                                 |
| -------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `GAME_STATE`         | All                    | Current stage, day, tick, scoreboard                                        |
| `MARKET_STATE`       | Per-player             | Order book bids/asks, last/mid price, volume                                |
| `PLAYER_STATE`       | Private                | Player's Mora/Gold (avail/frozen/locked), NAV, pending orders, active cards |
| `NEWS_BROADCAST`     | All (or insider early) | 璃月快报 news content                                                       |
| `REPORT_RESULT`      | Private                | Research report outcome (correct/incorrect, reward)                         |
| `STRATEGY_OPTIONS`   | All                    | Available cards during draft phase                                          |
| `TRADE_NOTIFICATION` | Private                | When player's order executes                                                |
| `SKILL_EFFECT`       | All                    | When a FinTech skill is activated                                           |
| `ERROR`              | Private                | Validation errors                                                           |

### Example

```json
// Client → Server
{ "messageType": "LIMIT_BUY", "token": "player1", "price": 1050, "quantity": 10 }

// Server → Client
{
  "messageType": "MARKET_STATE",
  "bids": [{"price": 1000, "quantity": 50}, {"price": 999, "quantity": 30}],
  "asks": [{"price": 1001, "quantity": 40}, {"price": 1002, "quantity": 20}],
  "lastPrice": 1000, "midPrice": 1000, "volume": 150, "tick": 42
}
```

---

## Strategy Cards (6 total)

### 基建类

| 卡名     | 效果                                       |
| -------- | ------------------------------------------ |
| 内幕消息 | 消耗摩拉提前获取新闻预览，低价版有50%概率为假 |
| 闪电交易 | 消耗摩拉，接下来3天每天多一次即时交易       |

### 风控类

| 卡名     | 效果                                                   |
| -------- | ------------------------------------------------------ |
| 止损名刀 | 消耗摩拉撤销所有挂单，接下来3天下跌亏损降为原本的20%    |
| 定向增发 | 以低于买一价2%折扣直接购入100单位黄金，锁定10天后解锁   |

### 金融科技类（带冷却/使用次数限制）

| 卡名     | 限制           | 效果                                         |
| -------- | -------------- | -------------------------------------------- |
| 网络风暴 | 全局3次        | 指定一名选手，其下一次交易/订单延迟1天        |
| 舆情打击 | 全局1次        | 伪造一条新闻全网广播，干扰对手的新闻和廉价内幕 |

---

## Order Matching

The matching engine uses **price-time priority**:

- **Bids**: highest price first; same price → earliest arrival
- **Asks**: lowest price first; same price → earliest arrival
- **Trade price**: maker's price (the order resting in the book first)
- **Asset flow**:
  - Buy order: freeze `price × qty` Mora; on match, refund excess + receive gold
  - Sell order: freeze gold; on match, gold sold + receive Mora minus fee
- **Network delay**: orders only enter the book at `submitTick + networkDelay`

See `src/thuai/GameLogic/MatchEngine.cs` for details.

---

## Output Files

After a game completes, the server writes:

| File                      | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `data/replay.dat`         | ZIP archive with per-tick game state snapshots (JSON)       |
| `data/result.json`        | Final scoreboard `{"scores": {"player1": 2, "player2": 1}}` |
| `logs/thuai-YYYYMMDD.log` | Server logs (if file logging enabled)                       |

---

## Development

### Project Structure

```plain
server/
├── src/thuai/
│   ├── Program.cs                    # Entry point, event wiring, broadcasting
│   ├── thuai.csproj                  # .NET 9.0 project file
│   ├── Utility/                      # Config, ClockProvider, Tools
│   ├── Connection/AgentServer/       # WebSocket server (Fleck, partial classes)
│   ├── GameController/               # Tick loop + message dispatch
│   ├── GameLogic/                    # Core game logic
│   │   ├── Game/                     # Master state machine
│   │   ├── StrategyCards/            # 6 cards + draft manager
│   │   └── ...                       # OrderBook, MatchEngine, NewsSystem, etc.
│   ├── Protocol/Messages/            # JSON message types
│   └── Recorder/                     # Replay recording
└── test/thuai.Tests/
    ├── UnitTest1.cs
    └── GameLogicTests.cs             # 50 unit tests
```

### Dependencies

- **.NET 9.0**
- **Fleck 1.2.0** — WebSocket server
- **Serilog 4.2.0** — Logging
- **xUnit 2.9.2** — Testing

---

## License

GPLv3 (see `/LICENSE`)
