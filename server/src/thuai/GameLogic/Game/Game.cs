namespace Thuai.GameLogic;

using Thuai.Utility;
using Thuai.GameLogic.StrategyCards;

public record MonthSettlementResult(
    int Month,
    Dictionary<string, long> MonthNavs,
    Dictionary<string, long> CumulativeNavs,
    string WinnerToken,
    string Reason,
    string FinalBonusWinnerToken,
    int FinalBonusPoints);

public partial class Game
{
    private readonly object _lock = new();
    private readonly GameSettings _settings;

    public GameStage Stage { get; private set; } = GameStage.Waiting;
    public int CurrentTick { get; private set; }
    public int CurrentMonthNumber { get; private set; }
    public int CurrentDayNumber { get; private set; }
    public TradingDay? CurrentTradingDay { get; private set; }
    public StrategyCardManager CardManager { get; } = new();
    public MonthSettlementResult? LatestSettlement { get; private set; }
    public bool HasPendingSettlementNotification { get; private set; }
    public Dictionary<string, long> CumulativeNavs { get; } = new();

    private int _waitingTicksRemaining;
    private int _strategyTicksRemaining;
    private bool _settlementProcessed;
    private readonly Dictionary<string, bool> _playerStrategySelected = new();

    public Game(GameSettings settings)
    {
        _settings = settings;
        _waitingTicksRemaining = settings.PlayerWaitingTicks;
    }

    public void Initialize()
    {
        Stage = GameStage.Waiting;
        CurrentTick = 0;
        CurrentMonthNumber = 0;
        CurrentDayNumber = 0;
        CurrentTradingDay = null;
        LatestSettlement = null;
        HasPendingSettlementNotification = false;
        CardManager.Reset();
        foreach (var token in Players.Keys.ToList())
        {
            Scoreboard[token] = 0;
            CumulativeNavs[token] = 0;
        }
    }

    public void Tick()
    {
        lock (_lock)
        {
            switch (Stage)
            {
                case GameStage.Waiting:
                    TickWaiting();
                    break;
                case GameStage.PreparingGame:
                    TransitionToStrategySelection();
                    break;
                case GameStage.StrategySelection:
                    TickStrategySelection();
                    break;
                case GameStage.TradingDay:
                    TickTradingDay();
                    break;
                case GameStage.Settlement:
                    TickSettlement();
                    break;
                case GameStage.Finished:
                    break;
            }

            CurrentTick++;
        }

        AfterGameTickEvent?.Invoke(this, new AfterGameTickEventArgs(this));
    }

    private void TickWaiting()
    {
        if (Players.Count >= _settings.MinimumPlayerCount)
        {
            _waitingTicksRemaining--;
            if (_waitingTicksRemaining <= 0)
            {
                Stage = GameStage.PreparingGame;
            }
        }
    }

    private void TransitionToStrategySelection()
    {
        if (CurrentMonthNumber >= _settings.TradingDayCount)
        {
            Stage = GameStage.Finished;
            return;
        }

        CurrentMonthNumber++;
        CurrentDayNumber = 0;
        _strategyTicksRemaining = _settings.StrategySelectionTicks;

        foreach (var player in Players.Values)
        {
            player.ResetForNewMonth();
            StrategyCardManager.ResetMonthlyCardState(player);
        }

        CardManager.GenerateDraftOptions();
        _playerStrategySelected.Clear();
        foreach (var player in Players.Values)
        {
            _playerStrategySelected[player.Token] = false;
        }

        Stage = GameStage.StrategySelection;
    }

    private void TickStrategySelection()
    {
        _strategyTicksRemaining--;

        // Transition when all players have selected or time runs out.
        bool allSelected = _playerStrategySelected.Values.All(v => v);
        if (allSelected || _strategyTicksRemaining <= 0)
        {
            TransitionToTradingDay();
        }
    }

    private void TransitionToTradingDay()
    {
        CurrentTradingDay = new TradingDay(
            Players,
            _settings.TradingDayTicks,
            _settings.InitialGoldPrice,
            _settings.NewsIntervalMin,
            _settings.NewsIntervalMax,
            _settings.ResearchWindowTicks,
            _settings.ResearchSettlementDelay,
            _settings.BaseResearchReward,
            _settings.NpcOrdersPerTick,
            CurrentMonthNumber
        );
        CurrentTradingDay.Initialize();

        Stage = GameStage.TradingDay;
    }

    private void TickTradingDay()
    {
        CurrentTradingDay?.Tick();
        CurrentDayNumber = CurrentTradingDay?.CurrentTick ?? CurrentDayNumber;

        if (CurrentTradingDay?.IsFinished == true)
        {
            Stage = GameStage.Settlement;
        }
    }

    private void TickSettlement()
    {
        if (!_settlementProcessed)
        {
            if (CurrentTradingDay != null)
            {
                var navs = CurrentTradingDay.CalculateSettlement();
                foreach (var (token, nav) in navs)
                {
                    CumulativeNavs[token] = CumulativeNavs.GetValueOrDefault(token, 0) + nav;
                }

                LatestSettlement = DetermineMonthResult(navs);
                HasPendingSettlementNotification = true;
            }
            _settlementProcessed = true;
            return;
        }

        _settlementProcessed = false;
        if (CurrentMonthNumber >= _settings.TradingDayCount)
        {
            Stage = GameStage.Finished;
        }
        else
        {
            TransitionToStrategySelection();
        }
    }

    public void MarkSettlementNotificationPublished()
    {
        HasPendingSettlementNotification = false;
    }

    /// <summary>
    /// Force-exit the Waiting stage. Intended for admin debug use to start
    /// the game without configuring a low PlayerWaitingTicks. Has no effect
    /// outside of Waiting.
    /// </summary>
    public void SkipWaiting()
    {
        lock (_lock)
        {
            if (Stage == GameStage.Waiting && Players.Count >= _settings.MinimumPlayerCount)
                _waitingTicksRemaining = 0;
        }
    }

    /// <summary>
    /// Handle a player's strategy card selection during the draft phase.
    /// Returns true if the selection was accepted.
    /// </summary>
    public bool SelectStrategy(string playerToken, string cardName)
    {
        lock (_lock)
        {
            if (Stage != GameStage.StrategySelection) return false;
            if (!Players.TryGetValue(playerToken, out var player)) return false;
            if (_playerStrategySelected.GetValueOrDefault(playerToken, false)) return false;

            var card = CardManager.SelectCard(player, cardName);
            if (card == null) return false;

            _playerStrategySelected[playerToken] = true;
            return true;
        }
    }

    private MonthSettlementResult DetermineMonthResult(Dictionary<string, long> navs)
    {
        string winnerToken = "";
        string reason = "tie";
        string finalBonusWinnerToken = "";
        int finalBonusPoints = 0;

        var orderedByNav = navs
            .OrderByDescending(entry => entry.Value)
            .ThenByDescending(entry => Players[entry.Key].MonthlyTradeCount)
            .ToList();

        if (orderedByNav.Count >= 2)
        {
            var top = orderedByNav[0];
            var second = orderedByNav[1];

            if (top.Value > second.Value)
            {
                winnerToken = top.Key;
                reason = "higher NAV";
            }
            else
            {
                int topTrades = Players[top.Key].MonthlyTradeCount;
                int secondTrades = Players[second.Key].MonthlyTradeCount;
                if (topTrades > secondTrades)
                {
                    winnerToken = top.Key;
                    reason = "trade-count tiebreaker";
                }
            }
        }
        else if (orderedByNav.Count == 1)
        {
            winnerToken = orderedByNav[0].Key;
            reason = "only player";
        }

        if (!string.IsNullOrEmpty(winnerToken))
        {
            Scoreboard[winnerToken] = Scoreboard.GetValueOrDefault(winnerToken, 0) + 1;
        }

        if (CurrentMonthNumber >= _settings.TradingDayCount)
        {
            var cumulativeOrdered = CumulativeNavs
                .OrderByDescending(entry => entry.Value)
                .ToList();
            if (cumulativeOrdered.Count >= 2 && cumulativeOrdered[0].Value > cumulativeOrdered[1].Value)
            {
                finalBonusWinnerToken = cumulativeOrdered[0].Key;
                finalBonusPoints = 2;
                Scoreboard[finalBonusWinnerToken] = Scoreboard.GetValueOrDefault(finalBonusWinnerToken, 0) + 2;
            }
        }

        return new MonthSettlementResult(
            CurrentMonthNumber,
            new Dictionary<string, long>(navs),
            new Dictionary<string, long>(CumulativeNavs),
            winnerToken,
            reason,
            finalBonusWinnerToken,
            finalBonusPoints);
    }
}
