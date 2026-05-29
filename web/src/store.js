import {
  DEFAULT_CANDLE_INTERVAL,
  DEFAULT_PRICE_FIELD,
  ingestMarketSnapshot,
  createCandleAccumulator,
  normalizeInterval,
} from "./candles.js";
import { DEFAULT_COLOR_SCHEME, normalizeColorScheme } from "./appearance.js";
import {
  DEFAULT_LOCALHOST_PORT,
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  parseServerChoice,
} from "./connection.js";

const MAX_EVENTS = 160;
const MAX_MARKET_HISTORY = 8000;
const MAX_NEWS = 80;
const VALID_VIEWS = new Set(["main", "logs", "rankings", "info", "debug", "server-debug"]);
const AUTO_OPEN_SETTLEMENT_MODAL = false;

export function routeFromLocation(location) {
  const search = new URLSearchParams(location.search);
  const pathMode = location.pathname.includes("player") ? "player" : "observer";
  const mode = search.get("mode") || pathMode;
  const role = mode === "player" ? "player" : mode === "admin" ? "admin" : "observer";
  const rawServer = search.get("server") || DEFAULT_SERVER_URL;
  const server = normalizeServerUrl(rawServer);
  const serverChoice = parseServerChoice(server);
  return {
    role,
    token: search.get("token") || "player1",
    adminSecret: search.get("secret") || "",
    server,
    localhostPort: serverChoice.localhostPort,
  };
}

export function createInitialState(route = {}) {
  return {
    connection: {
      role: route.role || "observer",
      token: route.token || "player1",
      adminSecret: route.adminSecret || "",
      server: route.server || DEFAULT_SERVER_URL,
      localhostPort: route.localhostPort || DEFAULT_LOCALHOST_PORT,
      status: "idle",
      protocolVersion: "legacy",
      capabilities: [],
      reconnectAttempt: 0,
      lastError: "",
      lastSent: "",
      statusLabel: "",
      statusDetail: "",
      currentMatchId: null,
      currentMatchStatus: "",
    },
    game: {
      stage: "",
      currentMonth: 0,
      currentDay: 0,
      currentTick: 0,
      totalTicks: 0,
      stageTick: 0,
      stageTickLimit: 0,
      dayTick: 0,
      dayTickLimit: 2000,
      scores: [],
    },
    market: {
      bids: [],
      asks: [],
      lastPrice: 0,
      midPrice: 0,
      volume: 0,
      tick: 0,
      interval: DEFAULT_CANDLE_INTERVAL,
      priceField: DEFAULT_PRICE_FIELD,
      history: [],
      candles: [],
      candleAccumulator: createCandleAccumulator(),
    },
    player: emptyPlayerState(),
    playerSummaries: {},
    playerDirectory: emptyPlayerDirectory(),
    dailySummaries: [],
    strategy: {
      options: null,
    },
    news: {
      items: [],
      results: {},
    },
    events: [],
    settlement: null,
    replay: {
      enabled: false,
      loaded: false,
      playing: false,
      frameIndex: 0,
      frameCount: 0,
      speed: 1,
      label: "",
      error: "",
      hasStats: false,
      statEventCount: 0,
    },
    ui: {
      eventCounter: 0,
      showSettlement: false,
      colorScheme: normalizeColorScheme(route.colorScheme || DEFAULT_COLOR_SCHEME),
      activeView: "main",
      readNewsCount: 0,
    },
  };
}

export function setConnectionPatch(state, patch) {
  Object.assign(state.connection, patch);
}

export function setMode(state, role) {
  state.connection.role = role === "player" ? "player" : role === "admin" ? "admin" : "observer";
  if (state.connection.role !== "player" && (state.ui.activeView === "info" || state.ui.activeView === "debug")) {
    state.ui.activeView = "main";
  }
  if (state.connection.role !== "admin" && state.ui.activeView === "server-debug") {
    state.ui.activeView = "main";
  }
}

export function setActiveView(state, view) {
  const nextView = String(view || "main");
  state.ui.activeView = VALID_VIEWS.has(nextView) ? nextView : "main";
}

export function markNewsAsRead(state) {
  state.ui.readNewsCount = state.news.items.length;
}

export function resetUiCollections(state) {
  state.events = [];
  state.news.items = [];
  state.news.results = {};
  state.dailySummaries = [];
  state.playerSummaries = {};
  state.playerDirectory = emptyPlayerDirectory();
  state.ui.readNewsCount = 0;
}

export function resetRuntimeState(state, options = {}) {
  const initial = createInitialState({
    role: state.connection.role,
    token: state.connection.token,
    adminSecret: state.connection.adminSecret,
    server: state.connection.server,
    localhostPort: state.connection.localhostPort,
    colorScheme: state.ui.colorScheme,
  });
  const activeView = state.ui.activeView;
  const colorScheme = state.ui.colorScheme;
  const replay = { ...state.replay };

  state.game = initial.game;
  state.market = initial.market;
  state.player = initial.player;
  state.playerSummaries = initial.playerSummaries;
  state.playerDirectory = initial.playerDirectory;
  state.dailySummaries = initial.dailySummaries;
  state.strategy = initial.strategy;
  state.news = initial.news;
  state.events = initial.events;
  state.settlement = initial.settlement;
  state.ui = {
    ...initial.ui,
    activeView,
    colorScheme,
  };
  if (options.preserveReplay) {
    state.replay = replay;
  } else {
    state.replay = initial.replay;
  }
}

export function setReplayPatch(state, patch) {
  Object.assign(state.replay, patch);
}

export function unreadNewsCount(state) {
  return Math.max(0, state.news.items.length - state.ui.readNewsCount);
}

export function setCandleOptions(state, options) {
  state.market.interval = normalizeInterval(options.interval ?? state.market.interval);
  state.market.priceField = options.priceField || state.market.priceField;
  const accumulator = createCandleAccumulator({
    interval: state.market.interval,
    priceField: state.market.priceField,
  });
  for (const snapshot of state.market.history) {
    ingestMarketSnapshot(accumulator, snapshot);
  }
  state.market.candleAccumulator = accumulator;
  state.market.candles = accumulator.candles;
}

export function setColorScheme(state, value) {
  state.ui.colorScheme = normalizeColorScheme(value);
}

export function applyMessage(state, message) {
  if (!message || typeof message !== "object") return;

  switch (message.messageType) {
    case "HELLO_ACK":
      state.connection.protocolVersion = message.protocolVersion || "v1";
      state.connection.capabilities = Array.isArray(message.capabilities)
        ? message.capabilities
        : [];
      state.connection.role = message.role || state.connection.role;
      state.connection.token = message.token || state.connection.token;
      pushEvent(state, {
        kind: "system",
        title: "握手完成",
        detail: `protocol=${state.connection.protocolVersion}`,
      });
      break;

    case "GAME_STATE":
      state.game = {
        ...state.game,
        stage: message.stage || "",
        currentMonth: numberOr(message.currentMonth, state.game.currentMonth),
        currentDay: numberOr(message.currentDay, 0),
        currentTick: numberOr(message.currentTick, 0),
        totalTicks: numberOr(message.totalTicks, 0),
        stageTick: numberOr(message.stageTick, state.game.stageTick),
        stageTickLimit: numberOr(message.stageTickLimit, state.game.stageTickLimit),
        dayTick: numberOr(message.dayTick, state.market.tick || state.game.dayTick),
        dayTickLimit: numberOr(message.dayTickLimit, state.game.dayTickLimit),
        scores: normalizeScores(message.scores),
      };
      break;

    case "MARKET_STATE":
      state.market.bids = Array.isArray(message.bids) ? message.bids : [];
      state.market.asks = Array.isArray(message.asks) ? message.asks : [];
      state.market.lastPrice = numberOr(message.lastPrice, 0);
      state.market.midPrice = numberOr(message.midPrice, 0);
      state.market.volume = numberOr(message.volume, 0);
      state.market.tick = numberOr(message.tick, 0);
      state.game.dayTick = state.market.tick;
      appendMarketSnapshot(state);
      break;

    case "PLAYER_STATE":
      state.player = normalizePlayerState(message);
      registerPlayerIdentity(state, state.player.playerId, message.token || state.connection.token);
      break;

    case "PLAYER_SUMMARY_STATE":
      {
        const summary = normalizePlayerSummary(message);
        registerPlayerIdentity(state, summary.playerId, summary.token);
        const key = summary.playerId >= 0 ? String(summary.playerId) : summary.token;
        if (key) {
          state.playerSummaries[key] = summary;
        }
      }
      break;

    case "NEWS_BROADCAST":
      upsertNews(state, message);
      pushEvent(state, {
        kind: "news",
        title: `新闻 #${message.newsId ?? "-"}`,
        detail: message.content || "",
        tick: numberOr(message.publishTick, state.market.tick),
      });
      break;

    case "REPORT_RESULT":
      if (canDisplayPrivateEvents(state)) {
        upsertReportResult(state, message);
        const actor = actorFromMessage(state, message);
        pushEvent(state, {
          kind: "report",
          title: `${actor} 研报${message.isCorrect ? "命中" : "偏离"}`,
          detail: `news=${message.newsId ?? "-"} prediction=${message.prediction ?? "-"} reward=${message.reward ?? 0} change=${message.actualChange ?? 0}`,
          tick: numberOr(message.settlementTick, state.market.tick),
          playerId: numberOr(message.playerId, -1),
          playerToken: message.playerToken || "",
          reward: numberOr(message.reward, 0),
          isPrivate: true,
        });
      }
      break;

    case "STRATEGY_OPTIONS":
      state.strategy.options = {
        infrastructure: message.infrastructure || null,
        riskControl: message.riskControl || null,
        finTech: message.finTech || null,
      };
      break;

    case "TRADE_NOTIFICATION":
      if (canDisplayPrivateEvents(state)) {
        const side = String(message.side || "");
        pushEvent(state, {
          kind: "trade",
          title: `${actorFromMessage(state, message)} ${side === "Sell" ? "卖出成交" : "买入成交"}`,
          detail: `trade=${message.tradeId ?? "-"} order=${message.orderId ?? "-"} price=${message.price ?? 0} qty=${message.quantity ?? 0} fee=${message.fee ?? 0}`,
          tick: numberOr(message.tick, state.market.tick),
          playerId: numberOr(message.playerId, -1),
          playerToken: message.playerToken || "",
          side,
          price: numberOr(message.price, 0),
          quantity: numberOr(message.quantity, 0),
          isPrivate: true,
        });
      }
      break;

    case "SKILL_EFFECT":
      pushEvent(state, {
        kind: "skill",
        title: `${message.skillName || "技能触发"}`,
        detail: `${playerDisplayName(state, message.sourcePlayerId)}${message.targetPlayerId !== undefined && message.targetPlayerId !== null ? ` -> ${playerDisplayName(state, message.targetPlayerId)}` : ""} ${message.description || ""}`.trim(),
        tick: numberOr(message.tick, state.market.tick),
        playerId: numberOr(message.sourcePlayerId, -1),
        targetPlayerId: numberOr(message.targetPlayerId, -1),
      });
      break;

    case "REPLAY_ORDER":
      pushEvent(state, {
        kind: "order",
        title: `${actorFromMessage(state, message)} ${sideLabel(message.side)}挂单`,
        detail: `order=${message.orderId ?? "-"} price=${message.price ?? 0} qty=${message.quantity ?? 0} remain=${message.remainingQuantity ?? message.quantity ?? 0} status=${message.status || "-"}`,
        tick: numberOr(message.tick, state.market.tick),
        playerId: numberOr(message.playerId, -1),
        playerToken: message.playerToken || "",
        side: message.side || "",
        price: numberOr(message.price, 0),
        quantity: numberOr(message.quantity, 0),
        isPrivate: true,
      });
      break;

    case "REPLAY_TRADE":
      pushEvent(state, {
        kind: "trade",
        title: `成交 #${message.tradeId ?? "-"}`,
        detail: `买方 ${playerDisplayName(state, message.buyerPlayerId, message.buyerToken)} / 卖方 ${playerDisplayName(state, message.sellerPlayerId, message.sellerToken)} price=${message.price ?? 0} qty=${message.quantity ?? 0}`,
        tick: numberOr(message.tick, state.market.tick),
        price: numberOr(message.price, 0),
        quantity: numberOr(message.quantity, 0),
        buyerPlayerId: numberOr(message.buyerPlayerId, -1),
        sellerPlayerId: numberOr(message.sellerPlayerId, -1),
        buyerToken: message.buyerToken || "",
        sellerToken: message.sellerToken || "",
        isPrivate: true,
      });
      break;

    case "REPLAY_DRAFT":
      pushEvent(state, {
        kind: "strategy",
        title: `第 ${message.month ?? state.game.currentMonth} 月策略池`,
        detail: (Array.isArray(message.offerings) ? message.offerings : []).join(" / "),
        tick: numberOr(message.tick, state.market.tick),
      });
      break;

    case "REPLAY_EVENT":
      pushEvent(state, {
        kind: message.kind || "system",
        title: message.title || "回放事件",
        detail: message.detail || "",
        tick: numberOr(message.tick, state.market.tick),
      });
      break;

    case "DAY_SETTLEMENT":
      state.settlement = { ...message };
      upsertDailySummary(state, message);
      state.ui.showSettlement = AUTO_OPEN_SETTLEMENT_MODAL;
      pushEvent(state, {
        kind: "settlement",
        title: `第 ${message.day ?? state.game.currentDay} 日结算`,
        detail: `winner=${message.winnerPlayerId >= 0 ? playerDisplayName(state, message.winnerPlayerId) : "Tie"} reason=${message.reason || "-"}`,
      });
      break;

    case "ERROR":
      state.connection.lastError = message.message || "";
      pushEvent(state, {
        kind: "error",
        title: `错误 ${message.errorCode ?? ""}`.trim(),
        detail: message.message || "",
      });
      break;

    case "DEBUG_ACK":
      pushEvent(state, {
        kind: message.ok ? "system" : "error",
        title: `${message.command || "DEBUG"} · ${message.ok ? "ok" : "fail"}`,
        detail: message.error || "",
      });
      break;

    case "DEBUG_QUERY_RESPONSE":
      pushEvent(state, {
        kind: "system",
        title: `DEBUG_QUERY · ${message.stage || "?"}`,
        detail: JSON.stringify(message, null, 2),
      });
      break;

    default:
      pushEvent(state, {
        kind: "system",
        title: message.messageType || "未知消息",
        detail: "未识别的 messageType",
      });
      break;
  }
}

function upsertDailySummary(state, message) {
  const day = numberOr(message.day, state.game.currentDay);
  const summary = {
    day,
    winnerPlayerId: numberOr(message.winnerPlayerId, -1),
    reason: message.reason || "",
    players: Array.isArray(message.players) ? message.players : [],
  };
  const index = state.dailySummaries.findIndex((item) => item.day === day);
  if (index >= 0) {
    state.dailySummaries[index] = summary;
  } else {
    state.dailySummaries.push(summary);
  }
  state.dailySummaries.sort((a, b) => a.day - b.day);
}

export function pushEvent(state, event) {
  state.ui.eventCounter += 1;
  state.events.unshift({
    id: state.ui.eventCounter,
    day: event.day ?? state.game.currentDay,
    tick: event.tick ?? state.market.tick ?? state.game.currentTick,
    kind: event.kind || "system",
    title: event.title || "事件",
    detail: event.detail || "",
    playerId: numberOr(event.playerId, -1),
    playerToken: event.playerToken || "",
    targetPlayerId: numberOr(event.targetPlayerId, -1),
    targetPlayerToken: event.targetPlayerToken || "",
    buyerPlayerId: numberOr(event.buyerPlayerId, -1),
    sellerPlayerId: numberOr(event.sellerPlayerId, -1),
    buyerToken: event.buyerToken || "",
    sellerToken: event.sellerToken || "",
    side: event.side || "",
    price: numberOr(event.price, 0),
    quantity: numberOr(event.quantity, 0),
    reward: numberOr(event.reward, 0),
    isPrivate: Boolean(event.isPrivate),
  });

  if (state.events.length > MAX_EVENTS) {
    state.events.length = MAX_EVENTS;
  }
}

export function clearSettlement(state) {
  state.ui.showSettlement = false;
}

function upsertNews(state, message) {
  const newsId = message.newsId ?? "";
  const existingIndex = state.news.items.findIndex((item) => item.newsId === newsId);
  const next = {
    newsId,
    content: message.content || "",
    publishTick: numberOr(message.publishTick, state.market.tick),
    day: state.game.currentDay,
    isFake: Boolean(message.isFake),
    sourcePlayer: message.sourcePlayer || "",
    receivedAt: state.game.currentTick || state.market.tick || 0,
  };

  if (existingIndex >= 0) {
    state.news.items.splice(existingIndex, 1);
  }
  state.news.items.unshift(next);
  if (state.news.items.length > MAX_NEWS) {
    state.news.items.length = MAX_NEWS;
  }
}

function upsertReportResult(state, message) {
  const newsId = message.newsId ?? "";
  if (newsId === "") return;
  state.news.results[newsId] = {
    playerToken: message.playerToken || "",
    playerId: numberOr(message.playerId, -1),
    prediction: message.prediction || "",
    isCorrect: Boolean(message.isCorrect),
    reward: numberOr(message.reward, 0),
    actualChange: numberOr(message.actualChange, 0),
  };
}

function appendMarketSnapshot(state) {
  const snapshot = {
    game: { ...state.game },
    market: {
      bids: state.market.bids,
      asks: state.market.asks,
      lastPrice: state.market.lastPrice,
      midPrice: state.market.midPrice,
      volume: state.market.volume,
      tick: state.market.tick,
    },
  };

  state.market.history.push(snapshot);
  if (state.market.history.length > MAX_MARKET_HISTORY) {
    state.market.history.shift();
  }

  ingestMarketSnapshot(state.market.candleAccumulator, snapshot);
  state.market.candles = state.market.candleAccumulator.candles;
}

function normalizePlayerState(message) {
  return {
    playerId: numberOr(message.playerId, -1),
    token: message.token || "",
    mora: numberOr(message.mora, 0),
    frozenMora: numberOr(message.frozenMora, 0),
    gold: numberOr(message.gold, 0),
    frozenGold: numberOr(message.frozenGold, 0),
    lockedGold: numberOr(message.lockedGold, 0),
    nav: numberOr(message.nav, 0),
    activeCards: Array.isArray(message.activeCards) ? message.activeCards : [],
    pendingOrders: Array.isArray(message.pendingOrders) ? message.pendingOrders : [],
  };
}

function normalizePlayerSummary(message) {
  const pendingOrders = Array.isArray(message.pendingOrders) ? message.pendingOrders : [];
  return {
    playerId: numberOr(message.playerId, -1),
    token: message.token || message.playerToken || "",
    mora: numberOr(message.mora, 0),
    frozenMora: numberOr(message.frozenMora, 0),
    gold: numberOr(message.gold, 0),
    frozenGold: numberOr(message.frozenGold, 0),
    lockedGold: numberOr(message.lockedGold, 0),
    nav: numberOr(message.nav, 0),
    activeCards: Array.isArray(message.activeCards) ? message.activeCards : [],
    pendingOrders,
    pendingOrderCount: numberOr(message.pendingOrderCount, pendingOrders.length),
    tradeCount: numberOr(message.tradeCount, numberOr(message.monthlyTradeCount, 0)),
    monthlyTradeCount: numberOr(message.monthlyTradeCount, numberOr(message.tradeCount, 0)),
  };
}

function emptyPlayerState() {
  return {
    playerId: -1,
    token: "",
    mora: 0,
    frozenMora: 0,
    gold: 0,
    frozenGold: 0,
    lockedGold: 0,
    nav: 0,
    activeCards: [],
    pendingOrders: [],
  };
}

function emptyPlayerDirectory() {
  return {
    labelsById: {},
    idsByToken: {},
  };
}

// The platform endpoint maps the game server's 0-based player_id (same index as
// the playerId in the live GAME_STATE stream) to a team name. We key labels by
// player_id directly — observers never receive the in-game token, so a
// token-keyed bridge could never resolve for them.
export function applyPlayerMap(state, entries) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    const id = numberOr(entry.player_id, -1);
    const teamName = String(entry.team_name || "").trim();
    if (id < 0 || !teamName) continue;
    state.playerDirectory.labelsById[id] = teamName;
  }
}

function normalizeScores(scores) {
  if (!Array.isArray(scores)) return [];
  return scores.map((score) => ({
    playerId: numberOr(score.playerId, -1),
    playerToken: score.playerToken || score.token || "",
    score: score.score ?? 0,
  }));
}

function registerPlayerIdentity(state, playerId, token) {
  const id = numberOr(playerId, -1);
  const label = String(token || "").trim();
  if (id < 0 || !label) return;
  state.playerDirectory.idsByToken[label] = id;
  // Only fall back to the in-game token as a label if the platform mapping
  // hasn't already supplied a team name for this player (don't clobber it).
  if (!state.playerDirectory.labelsById[id]) {
    state.playerDirectory.labelsById[id] = label;
  }
}

function actorFromMessage(state, message) {
  return playerDisplayName(state, numberOr(message.playerId, -1), message.playerToken || "");
}

function canDisplayPrivateEvents(state) {
  return state.replay.enabled || state.connection.role === "admin" || state.connection.role === "player";
}

function sideLabel(side) {
  const normalized = String(side || "").toLowerCase();
  if (normalized === "sell") return "卖出";
  if (normalized === "buy") return "买入";
  return "";
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function playerDisplayName(state, playerId, token = "") {
  const tokenLabel = String(token || "").trim();
  if (tokenLabel === "SYSTEM") return "系统";
  const id = numberOr(playerId, -1);

  // Replay: identities come from the replay payload's own tokens. Never consult
  // labelsById — those describe whichever match the live poll is tracking now,
  // which has nothing to do with the match being replayed.
  if (state.replay.enabled) {
    if (tokenLabel) return tokenLabel;
    return id >= 0 ? `选手 ${id}` : "-";
  }

  // Live observer: show the platform team name (keyed by playerId), never the
  // raw in-game token (observers don't receive it anyway).
  if (state.connection.role === "observer") {
    if (id >= 0 && state.playerDirectory.labelsById[id]) {
      return state.playerDirectory.labelsById[id];
    }
    return id >= 0 ? `选手 ${id}` : "-";
  }

  // Live player / admin: own token, then any team-name label, then the id.
  if (id >= 0 && id === state.player.playerId && state.connection.token) {
    return state.connection.token;
  }
  if (tokenLabel) return tokenLabel;
  if (id < 0) return "-";
  if (state.playerDirectory.labelsById[id]) {
    return state.playerDirectory.labelsById[id];
  }
  return `选手 ${id}`;
}
