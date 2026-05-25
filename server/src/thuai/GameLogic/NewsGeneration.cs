namespace Thuai.GameLogic;

using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Serilog;
using Thuai.Utility;

public sealed record NewsGenerationRequest(
    NewsSentiment Sentiment,
    int? PublishTick = null,
    bool IsFake = false,
    string? SourcePlayer = null);

public interface INewsGenerator
{
    string GenerateContent(NewsGenerationRequest request);
    void StartWarmup();
}

public sealed class TemplateNewsGenerator : INewsGenerator
{
    private static readonly string[] BullishNews =
    [
        "华清街婚庆行会临时追加百桌金箔甜点，金铺柜员忙到贴错标签",
        "南门矿队今日只送来半车碎矿，账房称剩余车队还堵在山道口",
        "三家首饰铺同步改成只接熟客，排号木牌挂到了香料摊前",
        "运金马车在桥头排成长队，车夫抱着茶碗等北门批条",
        "街道办临时征调金砖修缮镇库封印，登记簿被红章盖满",
        "商会大婚改用金叶请帖，刻印师傅连夜向各铺借料",
        "隔壁街区查验通关文书，金器外运车队暂留北门等批条",
        "矿井深处传出塌方声，工头让采矿队先回棚内点名",
        "华清街新茶饮流行撒金箔，茶摊老板抱着账本挨家问铺",
        "几位大户把金条搬进祠堂做契约抵押，库房钥匙排队交接"
    ];

    private static readonly string[] BearishNews =
    [
        "华清街旧井翻修挖出前朝金库，库吏正忙着给砖块重新编号",
        "隔壁票号清点库房，成箱金锭被搬到门口等商队验收",
        "街道办取消金漆刷墙工程，工匠把未拆封金粉退回铺里",
        "落魄民科摆出点石成金炉，围观商贩抢着递石头试火",
        "执法队查封炒金茶馆，柜台后翻出一摞未登记金券",
        "华清街老掌柜改行卖烧饼，徒弟把库里金条逐根装箱",
        "顺风船队提前靠岸，码头工人拿金砖临时垫住货棚门",
        "街道办试行重金属保管费，富户连夜把箱笼抬到当铺",
        "交易所核验黄金券底账，几名跑腿抱着实物样锭排队",
        "外乡商队带来新式镀金器，首饰铺学徒围着样品记尺寸"
    ];

    public string GenerateContent(NewsGenerationRequest request) => PickTemplate(request.Sentiment);

    public void StartWarmup()
    {
    }

    public static string PickTemplate(NewsSentiment sentiment)
    {
        var templates = sentiment == NewsSentiment.Bullish ? BullishNews : BearishNews;
        return templates[Random.Shared.Next(templates.Length)];
    }
}

public sealed class OpenAiCompatibleNewsGenerator : INewsGenerator
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly string[] ProhibitedContentTerms =
    [
        "利好",
        "利空",
        "利多",
        "看涨",
        "看跌",
        "看多",
        "看空",
        "多头",
        "空头",
        "上涨",
        "下跌",
        "涨价",
        "跌价",
        "飙升",
        "暴跌",
        "拉升",
        "跳水",
        "走强",
        "走弱",
        "承压",
        "金价",
        "价格",
        "短线",
        "买入",
        "卖出",
        "满仓",
        "清仓",
        "央行",
        "国际金价",
        "历史新高",
        "避险情绪",
        "现货市场",
        "产量",
        "库存",
        "供应",
        "源源不断",
        "货架空空",
        "达标"
    ];

    private readonly NewsGenerationSettings _settings;
    private readonly INewsGenerator _fallback;
    private readonly HttpClient _httpClient;
    private readonly Uri _endpoint;
    private readonly string? _apiKey;
    private readonly ConcurrentQueue<string> _bullishPool = new();
    private readonly ConcurrentQueue<string> _bearishPool = new();
    private int _warmupStarted;
    private int _bullishRefillRunning;
    private int _bearishRefillRunning;

    public OpenAiCompatibleNewsGenerator(NewsGenerationSettings settings, INewsGenerator fallback)
    {
        _settings = settings;
        _fallback = fallback;
        _httpClient = new HttpClient();
        _endpoint = BuildEndpoint(settings.BaseUrl, settings.ChatCompletionsPath);
        _apiKey = ResolveApiKey(settings);
    }

    public string GenerateContent(NewsGenerationRequest request)
    {
        var pool = GetPool(request.Sentiment);
        if (pool.TryDequeue(out var preparedContent))
        {
            ScheduleRefillIfNeeded(request.Sentiment);
            return preparedContent;
        }

        try
        {
            return GenerateRemoteContentAsync(request, _settings.TimeoutMs, CancellationToken.None)
                .GetAwaiter()
                .GetResult();
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "LLM news generation failed; using template fallback");
            return _fallback.GenerateContent(request);
        }
        finally
        {
            ScheduleRefillIfNeeded(request.Sentiment);
        }
    }

    public void StartWarmup()
    {
        if (!_settings.PrewarmEnabled || _settings.PrewarmPerSentiment <= 0)
            return;

        if (Interlocked.Exchange(ref _warmupStarted, 1) == 1)
            return;

        Log.Information(
            "Starting LLM news warmup: provider={Provider}, endpoint={Endpoint}, model={Model}, perSentiment={Count}",
            _settings.Provider,
            _endpoint,
            _settings.Model,
            _settings.PrewarmPerSentiment);

        _ = Task.Run(() => FillPoolAsync(NewsSentiment.Bullish, _settings.PrewarmPerSentiment, CancellationToken.None));
        _ = Task.Run(() => FillPoolAsync(NewsSentiment.Bearish, _settings.PrewarmPerSentiment, CancellationToken.None));
    }

    private async Task FillPoolAsync(NewsSentiment sentiment, int targetCount, CancellationToken cancellationToken)
    {
        var pool = GetPool(sentiment);
        var missing = Math.Max(0, targetCount - pool.Count);
        if (missing == 0)
            return;

        var concurrency = Math.Max(1, _settings.PrewarmConcurrency);
        using var semaphore = new SemaphoreSlim(concurrency);
        var tasks = Enumerable.Range(0, missing).Select(async _ =>
        {
            await semaphore.WaitAsync(cancellationToken);
            try
            {
                var content = await GenerateRemoteContentAsync(
                    new NewsGenerationRequest(sentiment),
                    _settings.PrewarmTimeoutMs,
                    cancellationToken);
                pool.Enqueue(content);
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "LLM news warmup failed for sentiment={Sentiment}", sentiment);
            }
            finally
            {
                semaphore.Release();
            }
        });

        await Task.WhenAll(tasks);

        Log.Information(
            "LLM news warmup pool ready for sentiment={Sentiment}: queued={Count}",
            sentiment,
            pool.Count);
    }

    private void ScheduleRefillIfNeeded(NewsSentiment sentiment)
    {
        if (!_settings.PrewarmEnabled || _settings.RefillBatchSize <= 0)
            return;

        var pool = GetPool(sentiment);
        if (pool.Count > _settings.RefillThreshold)
            return;

        if (!TryBeginRefill(sentiment))
            return;

        _ = Task.Run(async () =>
        {
            try
            {
                var target = Math.Max(_settings.RefillThreshold, 0) + _settings.RefillBatchSize;
                await FillPoolAsync(sentiment, target, CancellationToken.None);
            }
            finally
            {
                EndRefill(sentiment);
            }
        });
    }

    private async Task<string> GenerateRemoteContentAsync(
        NewsGenerationRequest request,
        int timeoutMs,
        CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(Math.Max(1, timeoutMs)));

        var payload = new Dictionary<string, object?>
        {
            ["model"] = _settings.Model,
            ["messages"] = new[]
            {
                new Dictionary<string, string>
                {
                    ["role"] = "system",
                    ["content"] = string.IsNullOrWhiteSpace(_settings.SystemPrompt)
                        ? NewsGenerationSettings.DefaultSystemPrompt
                        : _settings.SystemPrompt
                },
                new Dictionary<string, string>
                {
                    ["role"] = "user",
                    ["content"] = BuildUserPrompt(request)
                }
            },
            ["temperature"] = _settings.Temperature,
            ["max_tokens"] = _settings.MaxTokens,
            ["stream"] = false
        };

        if (_settings.ChatTemplateEnableThinking.HasValue)
        {
            payload["chat_template_kwargs"] = new Dictionary<string, object?>
            {
                ["enable_thinking"] = _settings.ChatTemplateEnableThinking.Value
            };
        }

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, _endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
        };

        if (!string.IsNullOrWhiteSpace(_apiKey))
            httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        using var response = await _httpClient.SendAsync(httpRequest, timeout.Token);
        var responseBody = await response.Content.ReadAsStringAsync(timeout.Token);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"LLM endpoint returned {(int)response.StatusCode}: {TrimForLog(responseBody)}");
        }

        var assistantText = ExtractAssistantText(responseBody);
        var content = ExtractNewsContent(assistantText);
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException("LLM endpoint returned empty news content");
        if (ContainsProhibitedContentTerm(content))
        {
            throw new InvalidOperationException(
                $"LLM endpoint returned too-obvious news content: {TrimForLog(content)}");
        }

        return content;
    }

    private string BuildUserPrompt(NewsGenerationRequest request)
    {
        var hiddenCue = request.Sentiment == NewsSentiment.Bullish
            ? "偏紧线索：写一个让店铺排号变长、车队耽搁、工匠借料或金箔被消耗的街区小事"
            : "偏松线索：写一个让旧物翻出、商队提前到、富户搬箱或替代饰品流行的街区小事";
        var kind = request.IsFake
            ? "玩家制造的假新闻；写得像真实快讯，不要暴露其为假"
            : "系统新闻";
        var tick = request.PublishTick.HasValue ? request.PublishTick.Value.ToString() : "预生成池，不要写入正文";

        return
            "请生成一条 THUAI-9 游戏内新闻。\n" +
            $"hiddenCue: {hiddenCue}\n" +
            $"newsKind: {kind}\n" +
            $"publishTick: {tick}\n" +
            $"sourcePlayer: {request.SourcePlayer ?? "无"}\n" +
            $"maxContentLength: {_settings.MaxContentLength}\n" +
            "只写事件，不写结论；不要使用金价、看涨、看跌、上涨、下跌、产量、库存、供应等方向词。\n" +
            "输出格式必须是 JSON，例如 {\"content\":\"华清街某金铺临时只接熟客，柜员低头给木牌重新编号\"}。";
    }

    private static Uri BuildEndpoint(string baseUrl, string chatCompletionsPath)
    {
        var normalizedBaseUrl = string.IsNullOrWhiteSpace(baseUrl)
            ? "http://localhost:8080/v1"
            : baseUrl.Trim();
        var normalizedPath = chatCompletionsPath.Trim();

        if (string.IsNullOrWhiteSpace(normalizedPath))
            return new Uri(normalizedBaseUrl);

        return new Uri($"{normalizedBaseUrl.TrimEnd('/')}/{normalizedPath.TrimStart('/')}");
    }

    private static string? ResolveApiKey(NewsGenerationSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings.ApiKey))
            return settings.ApiKey;

        if (!string.IsNullOrWhiteSpace(settings.ApiKeyEnv))
            return Environment.GetEnvironmentVariable(settings.ApiKeyEnv);

        return null;
    }

    private ConcurrentQueue<string> GetPool(NewsSentiment sentiment) =>
        sentiment == NewsSentiment.Bullish ? _bullishPool : _bearishPool;

    private bool TryBeginRefill(NewsSentiment sentiment)
    {
        if (sentiment == NewsSentiment.Bullish)
            return Interlocked.Exchange(ref _bullishRefillRunning, 1) == 0;

        return Interlocked.Exchange(ref _bearishRefillRunning, 1) == 0;
    }

    private void EndRefill(NewsSentiment sentiment)
    {
        if (sentiment == NewsSentiment.Bullish)
        {
            Volatile.Write(ref _bullishRefillRunning, 0);
            return;
        }

        Volatile.Write(ref _bearishRefillRunning, 0);
    }

    private string ExtractNewsContent(string assistantText)
    {
        var cleaned = StripCodeFence(assistantText);
        var parsed = TryReadJsonContent(cleaned);
        var content = parsed ?? cleaned;

        content = string.Join(" ", content
            .Split(['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Trim()
            .Trim('"', '`');

        if (content.Length > _settings.MaxContentLength)
            content = content[.._settings.MaxContentLength].TrimEnd();

        return content;
    }

    private static bool ContainsProhibitedContentTerm(string content) =>
        ProhibitedContentTerms.Any(term => content.Contains(term, StringComparison.OrdinalIgnoreCase));

    private static string ExtractAssistantText(string responseBody)
    {
        using var document = JsonDocument.Parse(responseBody);
        if (!document.RootElement.TryGetProperty("choices", out var choices))
            throw new InvalidOperationException("LLM response is missing choices");

        foreach (var choice in choices.EnumerateArray())
        {
            if (choice.TryGetProperty("message", out var message)
                && message.TryGetProperty("content", out var content)
                && content.ValueKind == JsonValueKind.String)
            {
                return content.GetString() ?? "";
            }

            if (choice.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
                return text.GetString() ?? "";
        }

        throw new InvalidOperationException("LLM response is missing assistant content");
    }

    private static string? TryReadJsonContent(string text)
    {
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.String)
                return root.GetString();

            if (root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("content", out var content)
                && content.ValueKind == JsonValueKind.String)
            {
                return content.GetString();
            }
        }
        catch (JsonException)
        {
        }

        return null;
    }

    private static string StripCodeFence(string text)
    {
        var trimmed = text.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
            return trimmed;

        var firstLineEnd = trimmed.IndexOf('\n');
        var lastFenceStart = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        if (firstLineEnd >= 0 && lastFenceStart > firstLineEnd)
            return trimmed[(firstLineEnd + 1)..lastFenceStart].Trim();

        return trimmed.Trim('`').Trim();
    }

    private static string TrimForLog(string text)
    {
        var singleLine = string.Join(" ", text
            .Split(['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return singleLine.Length > 240 ? singleLine[..240] : singleLine;
    }
}

public static class NewsGeneratorFactory
{
    public static INewsGenerator Create(NewsGenerationSettings settings)
    {
        var fallback = new TemplateNewsGenerator();
        if (!settings.Enabled)
            return fallback;

        return settings.Provider.Trim().ToLowerInvariant() switch
        {
            "openai-compatible" or "openai" or "llama-server" => CreateOpenAiCompatible(settings, fallback),
            _ => WarnUnknownProvider(settings.Provider, fallback)
        };
    }

    private static INewsGenerator CreateOpenAiCompatible(
        NewsGenerationSettings settings,
        INewsGenerator fallback)
    {
        try
        {
            return new OpenAiCompatibleNewsGenerator(settings, fallback);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Invalid LLM news configuration; using template fallback");
            return fallback;
        }
    }

    private static INewsGenerator WarnUnknownProvider(string provider, INewsGenerator fallback)
    {
        Log.Warning("Unknown newsGeneration.provider={Provider}; using template fallback", provider);
        return fallback;
    }
}
