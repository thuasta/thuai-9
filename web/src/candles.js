export const DEFAULT_CANDLE_INTERVAL = 10;
export const DEFAULT_PRICE_FIELD = "midPrice";
const VALID_CANDLE_INTERVALS = [1, 5, 10, 20, 50, 100];

export function createCandleAccumulator(options = {}) {
  return {
    interval: normalizeInterval(options.interval),
    priceField: options.priceField || DEFAULT_PRICE_FIELD,
    candles: [],
    lastVolume: null,
    lastSession: null,
    lastDay: null,
    lastTick: null,
    lastClose: null,
    seriesId: 0,
  };
}

export function ingestMarketSnapshot(accumulator, snapshot) {
  const game = snapshot.game || {};
  const market = snapshot.market || {};
  const session = toNumber(game.currentMonth, 1);
  const day = toNumber(game.currentDay, 0);
  const tick = toNumber(market.tick, 0);
  const volume = Math.max(0, toNumber(market.volume, 0));
  const price = toNumber(market[accumulator.priceField], 0);
  const lastTick = accumulator.lastTick ?? 0;
  const sessionChanged = accumulator.lastSession !== null && accumulator.lastSession !== session;
  const dayChanged = accumulator.lastDay !== null && accumulator.lastDay !== day;
  const tickWentBack = tick > 0 && lastTick > 0 && tick < lastTick;

  const resetVolume =
    accumulator.lastVolume === null ||
    sessionChanged ||
    tickWentBack;

  const volumeDelta = calculateVolumeDelta(accumulator, {
    volume,
    resetVolume,
    sessionChanged,
    dayChanged,
    tickWentBack,
  });

  if (sessionChanged || tickWentBack) {
    accumulator.seriesId += 1;
  }

  accumulator.lastVolume = volume;
  accumulator.lastSession = session;
  accumulator.lastDay = day;
  accumulator.lastTick = tick;

  if (game.stage !== "TradingDay" || day <= 0 || tick <= 0 || price <= 0) {
    return accumulator.candles;
  }

  const bucketIndex = Math.floor((tick - 1) / accumulator.interval);
  const bucketStartTick = bucketIndex * accumulator.interval + 1;
  const bucketEndTick = bucketStartTick + accumulator.interval - 1;
  const last = accumulator.candles[accumulator.candles.length - 1];

  if (!last || last.seriesId !== accumulator.seriesId || last.bucketStartTick !== bucketStartTick) {
    const open = accumulator.interval === 1 && accumulator.lastClose !== null
      ? accumulator.lastClose
      : price;
    accumulator.candles.push({
      seriesId: accumulator.seriesId,
      session,
      day,
      startDay: day,
      endDay: day,
      bucketStartTick,
      bucketEndTick,
      lastTick: tick,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume: volumeDelta,
    });
    accumulator.lastClose = price;
    return accumulator.candles;
  }

  last.high = Math.max(last.high, price);
  last.low = Math.min(last.low, price);
  last.close = price;
  last.endDay = day;
  last.lastTick = tick;
  last.volume += volumeDelta;
  accumulator.lastClose = price;
  return accumulator.candles;
}

export function rebuildCandles(snapshots, options = {}) {
  const accumulator = createCandleAccumulator(options);
  for (const snapshot of snapshots) {
    ingestMarketSnapshot(accumulator, snapshot);
  }
  return accumulator.candles;
}

export function normalizeInterval(value) {
  const interval = Number.parseInt(value, 10);
  return VALID_CANDLE_INTERVALS.includes(interval) ? interval : DEFAULT_CANDLE_INTERVAL;
}

function calculateVolumeDelta(accumulator, context) {
  const {
    volume,
    resetVolume,
    sessionChanged,
    dayChanged,
    tickWentBack,
  } = context;

  if (!resetVolume) {
    return Math.max(0, volume - accumulator.lastVolume);
  }

  if (accumulator.lastVolume === null) {
    return 0;
  }

  if (sessionChanged || (tickWentBack && dayChanged)) {
    return volume;
  }

  return 0;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
