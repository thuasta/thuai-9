namespace Thuai.Connection;

using Serilog;
using Thuai.GameLogic;
using Thuai.GameLogic.StrategyCards;
using Thuai.Protocol.Messages;

/// <summary>
/// Handles DEBUG_* admin commands by mutating Game state directly. Each
/// handler returns a response (DebugAck or DebugQueryResponse) that the
/// caller dispatches to the issuing admin socket.
/// </summary>
public static class AdminCommandHandler
{
    public static Message Handle(Game game, PerformMessage message)
    {
        return message switch
        {
            DebugQueryMessage q => HandleQuery(game, q),
            DebugGiveCardMessage g => HandleGiveCard(game, g),
            DebugInjectNewsMessage n => HandleInjectNews(game, n),
            DebugAdvanceStageMessage a => HandleAdvanceStage(game, a),
            DebugSetPlayerMessage s => HandleSetPlayer(game, s),
            _ => Ack(message.MessageType, false, "unknown debug command")
        };
    }

    private static DebugAckMessage Ack(string command, bool ok, string? error = null) =>
        new() { Command = command, Ok = ok, Error = error };

    private static DebugQueryResponseMessage HandleQuery(Game game, DebugQueryMessage _)
    {
        var players = game.GetPlayersSnapshot().Select(p => new DebugPlayerSnapshot
        {
            Token = p.Token,
            Mora = p.Mora,
            FrozenMora = p.FrozenMora,
            Gold = p.Gold,
            FrozenGold = p.FrozenGold,
            LockedGold = p.LockedGold,
            MonthlyTradeCount = p.MonthlyTradeCount,
            ActiveCards = p.ActiveCards.Select(c => c.Name).ToList()
        }).ToList();

        var draft = new DebugDraftSnapshot
        {
            Infrastructure = game.CardManager.CurrentInfrastructure?.Name,
            RiskControl = game.CardManager.CurrentRiskControl?.Name,
            FinTech = game.CardManager.CurrentFinTech?.Name
        };

        return new DebugQueryResponseMessage
        {
            Stage = game.Stage.ToString(),
            CurrentMonth = game.CurrentMonthNumber,
            CurrentDay = game.CurrentDayNumber,
            CurrentTick = game.CurrentTick,
            Scoreboard = game.GetScoreboardSnapshot(),
            CumulativeNavs = game.GetCumulativeNavsSnapshot(),
            Players = players,
            Draft = draft
        };
    }

    private static DebugAckMessage HandleGiveCard(Game game, DebugGiveCardMessage msg)
    {
        var player = game.FindPlayer(msg.TargetToken);
        if (player == null)
            return Ack(msg.MessageType, false, $"unknown token: {msg.TargetToken}");

        IStrategyCard? card = msg.CardName switch
        {
            "内幕消息" => new InsiderInfo(),
            "闪电交易" => new FlashTrading(),
            "止损名刀" => new StopLossBlade(),
            "定向增发" => new TargetedPurchase(),
            "网络风暴" => new NetworkStorm(),
            "舆情打击" => new PublicOpinionAttack(),
            _ => null
        };

        if (card == null)
            return Ack(msg.MessageType, false, $"unknown card: {msg.CardName}");

        if (player.ActiveCards.Any(c => c.Name == card.Name))
            return Ack(msg.MessageType, false, $"player already owns {card.Name}");

        card.OnAcquire(player);
        player.ActiveCards.Add(card);
        Log.Information("DEBUG_GIVE_CARD: {Card} → {Token}", card.Name, player.Token);
        return Ack(msg.MessageType, true);
    }

    private static DebugAckMessage HandleInjectNews(Game game, DebugInjectNewsMessage msg)
    {
        if (game.CurrentTradingDay == null)
            return Ack(msg.MessageType, false, "no trading day in progress");

        if (!Enum.TryParse<NewsSentiment>(msg.Sentiment, ignoreCase: true, out var sentiment))
            return Ack(msg.MessageType, false, $"sentiment must be Bullish or Bearish, got: {msg.Sentiment}");

        var news = game.CurrentTradingDay.InjectFakeNews(
            game.CurrentTradingDay.CurrentTick,
            sourcePlayer: "DEBUG",
            sentiment,
            msg.Content);
        Log.Information("DEBUG_INJECT_NEWS: id={Id} sentiment={Sentiment}", news.NewsId, sentiment);
        return Ack(msg.MessageType, true);
    }

    private static DebugAckMessage HandleAdvanceStage(Game game, DebugAdvanceStageMessage msg)
    {
        if (game.Stage != GameStage.Waiting)
            return Ack(msg.MessageType, false,
                $"DEBUG_ADVANCE_STAGE only supported from Waiting (current: {game.Stage})");

        game.SkipWaiting();
        Log.Information("DEBUG_ADVANCE_STAGE: skipping waiting stage");
        return Ack(msg.MessageType, true);
    }

    private static DebugAckMessage HandleSetPlayer(Game game, DebugSetPlayerMessage msg)
    {
        var player = game.FindPlayer(msg.TargetToken);
        if (player == null)
            return Ack(msg.MessageType, false, $"unknown token: {msg.TargetToken}");

        if (msg.Mora.HasValue)
            player.AddMora(msg.Mora.Value - player.Mora);
        if (msg.Gold.HasValue)
            player.AddGold(msg.Gold.Value - player.Gold);

        Log.Information("DEBUG_SET_PLAYER: {Token} mora={Mora} gold={Gold}",
            player.Token, player.Mora, player.Gold);
        return Ack(msg.MessageType, true);
    }
}
