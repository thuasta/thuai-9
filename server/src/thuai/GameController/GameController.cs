namespace Thuai.GameController;

using Serilog;
using Thuai.GameLogic;
using Thuai.Utility;

public partial class GameController
{
    public Game Game { get; }
    public bool IsRunning { get; private set; }

    private readonly ClockProvider _clockProvider;
    private readonly GameSettings _settings;
    private readonly INewsGenerator _newsGenerator;

    private const double TpsClockFixRatio = 0.92;

    public GameController(GameSettings settings, INewsGenerator? newsGenerator = null)
    {
        _settings = settings;
        _newsGenerator = newsGenerator ?? new TemplateNewsGenerator();
        int clockMs = (int)(TpsClockFixRatio * 1000.0 / settings.TicksPerSecond);
        _clockProvider = new ClockProvider(clockMs);
        Game = new Game(settings, _newsGenerator);
    }

    public void Start()
    {
        Game.Initialize();
        _newsGenerator.StartWarmup();
        IsRunning = true;

        Task.Run(async () =>
        {
            Log.Information("GameController started at {TPS} TPS", _settings.TicksPerSecond);

            while (IsRunning)
            {
                Task clock = _clockProvider.CreateClock();

                Game.Tick();

                if (Game.Stage == GameStage.Finished)
                {
                    IsRunning = false;
                    Log.Information("Game finished");
                }

                await clock;
            }
        });
    }

    public void Stop()
    {
        IsRunning = false;
    }
}
