namespace Thuai.Utility;

using System.Text.Json.Serialization;

public record Config
{
    [JsonPropertyName("server")]
    public ServerSettings Server { get; init; } = new();

    [JsonPropertyName("token")]
    public TokenSettings Token { get; init; } = new();

    [JsonPropertyName("log")]
    public LogSettings Log { get; init; } = new();

    [JsonPropertyName("game")]
    public GameSettings Game { get; init; } = new();

    [JsonPropertyName("recorder")]
    public RecorderSettings Recorder { get; init; } = new();

    [JsonPropertyName("newsGeneration")]
    public NewsGenerationSettings NewsGeneration { get; init; } = new();
}

public record ServerSettings
{
    [JsonPropertyName("port")]
    public int Port { get; init; } = 14514;

    [JsonPropertyName("acceptAnyToken")]
    public bool AcceptAnyToken { get; init; } = false;
}

public record TokenSettings
{
    [JsonPropertyName("loadTokenFromEnv")]
    public bool LoadTokenFromEnv { get; init; } = true;

    [JsonPropertyName("tokenLocation")]
    public string TokenLocation { get; init; } = "TOKENS";

    [JsonPropertyName("tokenDelimiter")]
    public string TokenDelimiter { get; init; } = ",";
}

public record LogSettings
{
    [JsonPropertyName("target")]
    public string Target { get; init; } = "Console";

    [JsonPropertyName("minimumLevel")]
    public string MinimumLevel { get; init; } = "Information";

    [JsonPropertyName("targetDirectory")]
    public string TargetDirectory { get; init; } = "./logs";

    [JsonPropertyName("rollingInterval")]
    public string RollingInterval { get; init; } = "Day";
}

public record GameSettings
{
    [JsonPropertyName("ticksPerSecond")]
    public int TicksPerSecond { get; init; } = 10;

    [JsonPropertyName("tradingDayTicks")]
    public int TradingDayTicks { get; init; } = 30;

    [JsonPropertyName("tradingDayCount")]
    public int TradingDayCount { get; init; } = 3;

    [JsonPropertyName("infiniteMode")]
    public bool InfiniteMode { get; init; } = false;

    [JsonPropertyName("strategySelectionTicks")]
    public int StrategySelectionTicks { get; init; } = 40;

    [JsonPropertyName("minimumPlayerCount")]
    public int MinimumPlayerCount { get; init; } = 2;

    [JsonPropertyName("playerWaitingTicks")]
    public int PlayerWaitingTicks { get; init; } = 200;

    [JsonPropertyName("disconnectedPlayerRetentionTicks")]
    public int DisconnectedPlayerRetentionTicks { get; init; } = 0;

    [JsonPropertyName("initialMora")]
    public long InitialMora { get; init; } = 1_000_000;

    [JsonPropertyName("initialGold")]
    public int InitialGold { get; init; } = 1000;

    [JsonPropertyName("initialGoldPrice")]
    public long InitialGoldPrice { get; init; } = 1000;

    [JsonPropertyName("defaultNetworkDelay")]
    public int DefaultNetworkDelay { get; init; } = 1;

    [JsonPropertyName("defaultFeeRate")]
    public double DefaultFeeRate { get; init; } = 0.0002;

    [JsonPropertyName("maxOrdersPerTick")]
    public int MaxOrdersPerTick { get; init; } = 2;

    [JsonPropertyName("maxImmediateOrdersPerDay")]
    public int MaxImmediateOrdersPerDay { get; init; } = 1;

    [JsonPropertyName("maxRestingOrdersPerDay")]
    public int MaxRestingOrdersPerDay { get; init; } = 1;

    [JsonPropertyName("maxReportsPerNews")]
    public int MaxReportsPerNews { get; init; } = 1;

    [JsonPropertyName("newsIntervalMin")]
    public int NewsIntervalMin { get; init; } = 200;

    [JsonPropertyName("newsIntervalMax")]
    public int NewsIntervalMax { get; init; } = 400;

    [JsonPropertyName("researchWindowTicks")]
    public int ResearchWindowTicks { get; init; } = 2;

    [JsonPropertyName("researchSettlementDelay")]
    public int ResearchSettlementDelay { get; init; } = 3;

    [JsonPropertyName("baseResearchReward")]
    public long BaseResearchReward { get; init; } = 10000;

    [JsonPropertyName("npcOrdersPerTick")]
    public int NpcOrdersPerTick { get; init; } = 3;
}

public record RecorderSettings
{
    [JsonPropertyName("keepRecord")]
    public bool KeepRecord { get; init; } = false;

    [JsonPropertyName("flushEveryRecords")]
    public int FlushEveryRecords { get; init; } = 1000;

    [JsonPropertyName("statisticsSaveIntervalTicks")]
    public int StatisticsSaveIntervalTicks { get; init; } = 100;

    [JsonPropertyName("enableStatRecording")]
    public bool EnableStatRecording { get; init; } = true;

    [JsonPropertyName("statFlushEveryRecords")]
    public int StatFlushEveryRecords { get; init; } = 500;
}

public record NewsGenerationSettings
{
    public const string DefaultSystemPrompt =
        """
        你是 THUAI-9 黄金交易比赛的“华清街快报”新闻编辑。你的任务是生成游戏内短新闻。
        每条新闻必须像街区传闻或市场花边，中文输出，语气可以夸张、诙谐，但只能提供间接线索。
        你会收到隐藏方向：偏紧表示街上金料更难周转；偏松表示街上金料更容易周转。
        正文只能写具体街区事件、人物动作或店铺异状，不要替玩家总结市场结论。
        不要提到 LLM、AI、提示词、JSON、sentiment、Bullish、Bearish、真假新闻或游戏机制。
        不要出现这些词或近义表达：利好、利空、看涨、看跌、上涨、下跌、飙升、暴跌、拉升、跳水、走强、走弱、承压、金价、价格、短线、买入、卖出。
        不要写央行、国际金价、历史新高、避险情绪、现货市场、产量、库存、供应这类现实财经套话。
        不要给投资建议，不要写编号，不要解释原因，只生成一条 18 到 42 个中文字符的新闻正文。
        必须只返回 JSON 对象：{"content":"新闻正文"}。
        """;

    [JsonPropertyName("enabled")]
    public bool Enabled { get; init; } = false;

    [JsonPropertyName("provider")]
    public string Provider { get; init; } = "openai-compatible";

    [JsonPropertyName("baseUrl")]
    public string BaseUrl { get; init; } = "http://localhost:8080/v1";

    [JsonPropertyName("chatCompletionsPath")]
    public string ChatCompletionsPath { get; init; } = "/chat/completions";

    [JsonPropertyName("apiKey")]
    public string ApiKey { get; init; } = "";

    [JsonPropertyName("apiKeyEnv")]
    public string ApiKeyEnv { get; init; } = "THUAI_LLM_API_KEY";

    [JsonPropertyName("model")]
    public string Model { get; init; } = "local-model";

    [JsonPropertyName("temperature")]
    public double Temperature { get; init; } = 0.9;

    [JsonPropertyName("maxTokens")]
    public int MaxTokens { get; init; } = 256;

    [JsonPropertyName("timeoutMs")]
    public int TimeoutMs { get; init; } = 1500;

    [JsonPropertyName("prewarmTimeoutMs")]
    public int PrewarmTimeoutMs { get; init; } = 20000;

    [JsonPropertyName("chatTemplateEnableThinking")]
    public bool? ChatTemplateEnableThinking { get; init; } = null;

    [JsonPropertyName("maxContentLength")]
    public int MaxContentLength { get; init; } = 80;

    [JsonPropertyName("prewarmEnabled")]
    public bool PrewarmEnabled { get; init; } = true;

    [JsonPropertyName("prewarmPerSentiment")]
    public int PrewarmPerSentiment { get; init; } = 8;

    [JsonPropertyName("prewarmConcurrency")]
    public int PrewarmConcurrency { get; init; } = 2;

    [JsonPropertyName("refillThreshold")]
    public int RefillThreshold { get; init; } = 2;

    [JsonPropertyName("refillBatchSize")]
    public int RefillBatchSize { get; init; } = 4;

    [JsonPropertyName("systemPrompt")]
    public string SystemPrompt { get; init; } = DefaultSystemPrompt;
}
