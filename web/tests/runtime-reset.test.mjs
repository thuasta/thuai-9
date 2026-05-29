import assert from "node:assert/strict";
import {
  MAX_MARKET_HISTORY,
  applyMessage,
  createInitialState,
  markNewsAsRead,
  resetRuntimeState,
  setCandleOptions,
  unreadNewsCount,
} from "../src/store.js";
import { debugSetPlayerMessage } from "../src/actions.js";
import { buildSampleMessages } from "../src/sample-data.js";

testResetClearsPerMatchRuntimeState();
testResetReplayDataDoesNotLeakAcrossMatches();
testUnreadNewsKeepsCountingPastCap();
testUnreadNewsIgnoresRebroadcastOfSameId();
testCandleAccumulatorBoundedLikeHistory();
testSetCandleOptionsStaysConsistentWithLiveAccumulator();
testSampleDemoReportsWinnerNotTie();
testDebugSetPlayerCoercesToSafeInteger();

function liveObserverState() {
  const state = createInitialState({ role: "observer" });
  state.connection.role = "observer";
  return state;
}

function tradingTick(month, tick, midPrice) {
  return [
    {
      messageType: "GAME_STATE",
      stage: "TradingDay",
      currentMonth: month,
      currentDay: 1,
      currentTick: tick,
      totalTicks: tick,
    },
    {
      messageType: "MARKET_STATE",
      bids: [],
      asks: [],
      lastPrice: midPrice,
      midPrice,
      volume: tick,
      tick,
    },
  ];
}

function feed(state, messages) {
  for (const message of messages) applyMessage(state, message);
}

function testResetClearsPerMatchRuntimeState() {
  const state = liveObserverState();
  // Accumulate "match A" runtime state: candles, events, news, summaries.
  for (let tick = 1; tick <= 5; tick += 1) feed(state, tradingTick(1, tick, 1000 + tick));
  applyMessage(state, { messageType: "NEWS_BROADCAST", newsId: 1, content: "a" });
  applyMessage(state, {
    messageType: "DAY_SETTLEMENT",
    day: 1,
    winnerPlayerId: 0,
    reason: "NAV",
    players: [],
  });
  applyMessage(state, { messageType: "PLAYER_SUMMARY_STATE", playerId: 0, token: "alpha", nav: 1 });

  assert.ok(state.market.candles.length > 0);
  assert.ok(state.market.history.length > 0);
  assert.ok(state.events.length > 0);
  assert.ok(state.news.items.length > 0);
  assert.ok(state.dailySummaries.length > 0);
  assert.ok(Object.keys(state.playerSummaries).length > 0);

  // New match begins — nothing from match A may remain.
  resetRuntimeState(state);

  assert.equal(state.market.candles.length, 0);
  assert.equal(state.market.history.length, 0);
  assert.equal(state.events.length, 0);
  assert.equal(state.news.items.length, 0);
  assert.equal(state.news.arrivalCount, 0);
  assert.equal(state.dailySummaries.length, 0);
  assert.deepEqual(state.playerSummaries, {});

  // Then match B accumulates cleanly with no leftover candles from match A.
  for (let tick = 1; tick <= 3; tick += 1) feed(state, tradingTick(1, tick, 2000 + tick));
  assert.equal(state.market.history.length, 3);
}

function testResetReplayDataDoesNotLeakAcrossMatches() {
  // resetRuntimeState with preserveReplay must keep the replay sub-state intact
  // (used by the replay seek/rebuild path) while still clearing runtime data.
  const state = liveObserverState();
  state.replay.enabled = true;
  state.replay.frameCount = 42;
  feed(state, tradingTick(1, 1, 1000));
  resetRuntimeState(state, { preserveReplay: true });
  assert.equal(state.replay.enabled, true);
  assert.equal(state.replay.frameCount, 42);
  assert.equal(state.market.history.length, 0);
}

function testUnreadNewsKeepsCountingPastCap() {
  const state = liveObserverState();
  // Drive well past MAX_NEWS (80) distinct news items.
  for (let id = 1; id <= 100; id += 1) {
    applyMessage(state, { messageType: "NEWS_BROADCAST", newsId: id, content: `n${id}` });
  }
  // The visible list is capped...
  assert.equal(state.news.items.length, 80);
  // ...but unread reflects every arrival, not the capped length.
  assert.equal(unreadNewsCount(state), 100);

  markNewsAsRead(state);
  assert.equal(unreadNewsCount(state), 0);

  // Further arrivals keep incrementing even though the list stays pinned at 80.
  for (let id = 101; id <= 110; id += 1) {
    applyMessage(state, { messageType: "NEWS_BROADCAST", newsId: id, content: `n${id}` });
  }
  assert.equal(state.news.items.length, 80);
  assert.equal(unreadNewsCount(state), 10);
}

function testUnreadNewsIgnoresRebroadcastOfSameId() {
  const state = liveObserverState();
  applyMessage(state, { messageType: "NEWS_BROADCAST", newsId: 5, content: "v1" });
  applyMessage(state, { messageType: "NEWS_BROADCAST", newsId: 5, content: "v2" });
  // A re-broadcast of an already-seen id is not a new arrival.
  assert.equal(unreadNewsCount(state), 1);
  assert.equal(state.news.items.length, 1);
}

function testCandleAccumulatorBoundedLikeHistory() {
  const state = liveObserverState();
  // Single-tick candles so every snapshot yields a candle, then exceed the cap.
  setCandleOptions(state, { interval: 1 });
  const total = MAX_MARKET_HISTORY + 50;
  for (let tick = 1; tick <= total; tick += 1) {
    feed(state, tradingTick(1, tick, 1000 + (tick % 7)));
  }
  assert.ok(state.market.history.length <= MAX_MARKET_HISTORY);
  assert.ok(state.market.candles.length <= MAX_MARKET_HISTORY);
}

function testSetCandleOptionsStaysConsistentWithLiveAccumulator() {
  const state = liveObserverState();
  setCandleOptions(state, { interval: 1 });
  for (let tick = 1; tick <= 60; tick += 1) {
    feed(state, tradingTick(1, tick, 1000 + tick));
  }
  const liveCount = state.market.candles.length;
  // Toggling a display option rebuilds from history; the visible candle set must
  // not change just because of the rebuild (no silent drop / no extra candles).
  setCandleOptions(state, { interval: 1 });
  assert.equal(state.market.candles.length, liveCount);
}

function testSampleDemoReportsWinnerNotTie() {
  const state = liveObserverState();
  for (const message of buildSampleMessages("observer")) applyMessage(state, message);
  // winnerPlayerId 0 (player1) — the reducer reads winnerPlayerId, so a tie
  // (-1) here would mean the field name regressed.
  const summary = state.dailySummaries.find((item) => item.day === 1);
  assert.ok(summary);
  assert.equal(summary.winnerPlayerId, 0);
  assert.equal(state.settlement.winnerPlayerId, 0);
}

function testDebugSetPlayerCoercesToSafeInteger() {
  // Fractional input is truncated to a whole number (C# long/int reader rejects
  // a JSON float and silently drops the whole message otherwise).
  const fractional = debugSetPlayerMessage("0", { mora: "1.5", gold: "2.9" });
  assert.equal(fractional.mora, 1);
  assert.equal(fractional.gold, 2);
  assert.ok(Number.isInteger(fractional.mora));
  assert.ok(Number.isInteger(fractional.gold));

  // Values beyond the JS safe-integer range are clamped, not passed through as
  // a lossy/float-y number.
  const huge = debugSetPlayerMessage("0", { mora: 1e30, gold: -1e30 });
  assert.equal(huge.mora, Number.MAX_SAFE_INTEGER);
  assert.equal(huge.gold, Number.MIN_SAFE_INTEGER);

  // Empty fields stay omitted (no key on the wire).
  const empty = debugSetPlayerMessage("0", { mora: "", gold: null });
  assert.equal("mora" in empty, false);
  assert.equal("gold" in empty, false);
}
