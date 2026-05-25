namespace Thuai.GameLogic;

public class NewsSystem
{
    private readonly Random _rng = new();
    private readonly INewsGenerator _newsGenerator;
    private readonly int _researchWindow;
    private static readonly int[] ScheduledNewsDays = [1, 11, 21];
    private int _nextNewsId = 1;
    private int _scheduledIndex;
    private int _nextNewsTick;

    private readonly List<News> _allNews = new();
    private News? _latestNews;
    private News? _preGeneratedNews;

    public NewsSystem(
        int intervalMin = 1,
        int intervalMax = 1,
        int researchWindow = 2,
        INewsGenerator? newsGenerator = null)
    {
        _newsGenerator = newsGenerator ?? new TemplateNewsGenerator();
        _researchWindow = researchWindow;
        _scheduledIndex = 0;
        _nextNewsTick = ScheduledNewsDays[0];
    }

    public News? Tick(int currentTick)
    {
        if (_scheduledIndex >= ScheduledNewsDays.Length || currentTick < _nextNewsTick)
            return null;

        News news;
        if (_preGeneratedNews != null)
        {
            news = new News
            {
                NewsId = _preGeneratedNews.NewsId,
                PublishTick = currentTick,
                Content = _preGeneratedNews.Content,
                Sentiment = _preGeneratedNews.Sentiment,
                IsFake = false,
                SourcePlayer = null
            };
            _preGeneratedNews = null;
        }
        else
        {
            news = GenerateNews(currentTick);
        }

        _allNews.Add(news);
        _latestNews = news;

        _scheduledIndex++;
        _nextNewsTick = _scheduledIndex < ScheduledNewsDays.Length
            ? ScheduledNewsDays[_scheduledIndex]
            : int.MaxValue;

        return news;
    }

    /// <summary>
    /// Pre-generate the next news item so insider players can preview it early.
    /// The returned News has a placeholder PublishTick (the expected publish tick);
    /// the actual PublishTick is set when the news is formally published in Tick().
    /// Returns null when no scheduled news remains this month.
    /// </summary>
    public News? PreGenerateNextNews()
    {
        if (_scheduledIndex >= ScheduledNewsDays.Length)
            return null;

        if (_preGeneratedNews != null)
            return _preGeneratedNews;

        _preGeneratedNews = GenerateNews(_nextNewsTick);
        return _preGeneratedNews;
    }

    private News GenerateNews(int publishTick)
    {
        var sentiment = _rng.Next(2) == 0 ? NewsSentiment.Bullish : NewsSentiment.Bearish;
        var content = _newsGenerator.GenerateContent(new NewsGenerationRequest(sentiment, publishTick));

        return new News
        {
            NewsId = _nextNewsId++,
            PublishTick = publishTick,
            Content = content,
            Sentiment = sentiment,
            IsFake = false,
            SourcePlayer = null
        };
    }

    public News InjectFakeNews(
        int currentTick,
        string sourcePlayer,
        NewsSentiment sentiment,
        string? content = null)
    {
        var newsContent = string.IsNullOrWhiteSpace(content)
            ? _newsGenerator.GenerateContent(new NewsGenerationRequest(
                sentiment,
                currentTick,
                IsFake: true,
                SourcePlayer: sourcePlayer))
            : content.Trim();

        var news = new News
        {
            NewsId = _nextNewsId++,
            PublishTick = currentTick,
            Content = newsContent,
            Sentiment = sentiment,
            IsFake = true,
            SourcePlayer = sourcePlayer
        };

        _allNews.Add(news);
        _latestNews = news;
        return news;
    }

    public News? GetNews(int newsId)
    {
        return _allNews.Find(n => n.NewsId == newsId);
    }

    public bool IsWithinResearchWindow(int newsId, int currentTick)
    {
        var news = GetNews(newsId);
        if (news == null)
            return false;

        return currentTick - news.PublishTick <= _researchWindow;
    }

    public News? LatestNews => _latestNews;

    public IReadOnlyList<News> AllNews => _allNews;

    public NewsSentiment? CurrentSentiment => _latestNews?.Sentiment;

    public int? NextNewsTickForInsider => _nextNewsTick > 3 ? _nextNewsTick - 3 : null;
    public int PreviewTick => _scheduledIndex < ScheduledNewsDays.Length ? Math.Max(0, _nextNewsTick - 3) : -1;

    public int NextNewsTick => _nextNewsTick;

    public News CreateSpoofedView(News source)
    {
        var sentiment = _rng.Next(2) == 0 ? NewsSentiment.Bullish : NewsSentiment.Bearish;

        return new News
        {
            NewsId = source.NewsId,
            PublishTick = source.PublishTick,
            Content = _newsGenerator.GenerateContent(new NewsGenerationRequest(
                sentiment,
                source.PublishTick,
                source.IsFake,
                source.SourcePlayer)),
            Sentiment = sentiment,
            IsFake = source.IsFake,
            SourcePlayer = source.SourcePlayer
        };
    }

    public int? GetTicksUsed(int newsId, int submitTick)
    {
        var news = GetNews(newsId);
        if (news == null) return null;
        return submitTick - news.PublishTick;
    }

    public void Reset()
    {
        _allNews.Clear();
        _latestNews = null;
        _preGeneratedNews = null;
        _scheduledIndex = 0;
        _nextNewsTick = ScheduledNewsDays[0];
    }
}
