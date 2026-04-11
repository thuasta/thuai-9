namespace Thuai.GameLogic;

/// <summary>
/// NPC trader (系统散户) that generates limit orders each tick to provide
/// market liquidity. Orders are placed near the current bid/ask spread
/// with small retail-sized quantities. When news sentiment is active,
/// NPCs bias their order flow in the direction of the news.
/// All NPC orders use PlayerToken "SYSTEM" and have zero network delay.
/// </summary>
public class NPCTrader
{
    private readonly Random _rng = new();
    private readonly int _ordersPerTick;

    /// <summary>
    /// Creates an NPC trader that generates approximately <paramref name="ordersPerTick"/>
    /// orders each tick (actual count varies by +/- 1 for realism).
    /// </summary>
    public NPCTrader(int ordersPerTick = 3)
    {
        _ordersPerTick = ordersPerTick;
    }

    /// <summary>
    /// Generate NPC orders for the current tick. Orders are placed near the
    /// current spread to build a realistic order book.
    /// <para>
    /// When <paramref name="sentiment"/> is Bullish, more buy orders are generated
    /// at slightly higher prices. When Bearish, more sell orders at lower prices.
    /// </para>
    /// </summary>
    public void GenerateOrders(MatchEngine engine, OrderBook orderBook,
        NewsSentiment? sentiment, int currentTick)
    {
        long mid = orderBook.MidPrice;

        // If both sides are empty and no last trade, skip — we have no price reference.
        if (mid <= 0)
            return;

        // Slight randomness in order count: ordersPerTick +/- 1.
        int orderCount = _ordersPerTick + _rng.Next(-1, 2);
        if (orderCount <= 0)
            orderCount = 1;

        // Sentiment determines buy/sell probability bias.
        double buyProbability = sentiment switch
        {
            NewsSentiment.Bullish => 0.65,
            NewsSentiment.Bearish => 0.35,
            _ => 0.5
        };

        for (int i = 0; i < orderCount; i++)
        {
            bool isBuy = _rng.NextDouble() < buyProbability;
            int quantity = _rng.Next(1, 11); // 1-10 units (retail-sized)

            long price = ComputePrice(isBuy, mid, orderBook, sentiment);

            // Safety: price must be positive.
            if (price <= 0)
                price = 1;

            engine.SubmitOrder("SYSTEM", isBuy ? OrderSide.Buy : OrderSide.Sell,
                price, quantity, currentTick);
        }
    }

    /// <summary>
    /// Compute a price for the NPC order. Prices cluster within 1-3 units of the
    /// mid-price on the appropriate side of the book. When sentiment is active,
    /// there is a small chance (30%) the order crosses the spread to apply
    /// directional pressure.
    /// </summary>
    private long ComputePrice(bool isBuy, long mid, OrderBook orderBook,
        NewsSentiment? sentiment)
    {
        // Base offset: 1-3 price units away from mid.
        long offset = _rng.Next(1, 4);

        if (isBuy)
        {
            // Anchor to best bid if available; otherwise use mid - offset.
            long anchor = orderBook.BestBid ?? (mid - offset);

            // Scatter around anchor: -1 to +1.
            long price = anchor + _rng.Next(-1, 2);

            // With bullish sentiment, occasionally cross the spread to push price up.
            if (sentiment == NewsSentiment.Bullish && _rng.NextDouble() < 0.3)
            {
                price = mid + _rng.Next(0, 2);
            }

            return price;
        }
        else
        {
            // Anchor to best ask if available; otherwise use mid + offset.
            long anchor = orderBook.BestAsk ?? (mid + offset);

            // Scatter around anchor: -1 to +1.
            long price = anchor + _rng.Next(-1, 2);

            // With bearish sentiment, occasionally cross the spread to push price down.
            if (sentiment == NewsSentiment.Bearish && _rng.NextDouble() < 0.3)
            {
                price = mid - _rng.Next(0, 2);
            }

            return price;
        }
    }
}
