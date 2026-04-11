namespace Thuai.GameLogic;

public partial class Game
{
    public class AfterGameTickEventArgs : EventArgs
    {
        public Game Game { get; }

        public AfterGameTickEventArgs(Game game)
        {
            Game = game;
        }
    }

    public event EventHandler<AfterGameTickEventArgs>? AfterGameTickEvent;
}
