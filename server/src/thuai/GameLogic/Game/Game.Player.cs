namespace Thuai.GameLogic;

public partial class Game
{
    public Dictionary<string, Player> Players { get; } = new();
    public Dictionary<string, int> Scoreboard { get; } = new();

    private int _nextPlayerId;

    /// <summary>
    /// Register a new player during the waiting phase.
    /// Returns true if the player was successfully added.
    /// </summary>
    public bool AddPlayer(string token)
    {
        lock (_lock)
        {
            if (Stage != GameStage.Waiting) return false;
            if (Players.ContainsKey(token)) return false;

            var player = new Player(token, _nextPlayerId++);
            Players[token] = player;
            Scoreboard[token] = 0;
            return true;
        }
    }

    /// <summary>
    /// Look up a player by token.
    /// </summary>
    public Player? FindPlayer(string token)
    {
        Players.TryGetValue(token, out var player);
        return player;
    }
}
