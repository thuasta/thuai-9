namespace Thuai.Recorder;

using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;
using Serilog;

public class Recorder : IDisposable
{
    public bool KeepRecord { get; init; }

    private readonly RecordPage _recordPage = new();
    private int _pageNumber;
    private readonly string _recordsDir;
    private readonly string _targetRecordFilePath;
    private readonly string _targetResultFilePath;
    private readonly string _historyReplayDir;
    private readonly int _flushEveryRecords;
    private bool _disposed;
    private bool _historyReplaySaved;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false
    };

    public Recorder(string recordsDir = "./data", bool keepRecord = false, int flushEveryRecords = 1000)
    {
        _recordsDir = recordsDir;
        KeepRecord = keepRecord;
        _flushEveryRecords = Math.Max(1, flushEveryRecords);
        _targetRecordFilePath = Path.Combine(recordsDir, "replay.dat");
        _targetResultFilePath = Path.Combine(recordsDir, "result.json");
        _historyReplayDir = Path.Combine(recordsDir, "history-replay");

        Directory.CreateDirectory(recordsDir);

        // Clean previous replay
        if (File.Exists(_targetRecordFilePath))
            File.Delete(_targetRecordFilePath);
    }

    public void Record(object gameState)
    {
        string json = JsonSerializer.Serialize(gameState, JsonOptions);
        _recordPage.Enqueue(json);

        if (_recordPage.Length >= _flushEveryRecords)
        {
            Save();
        }
    }

    public void Save()
    {
        if (_recordPage.Length == 0) return;

        try
        {
            _pageNumber++;
            string pageName = $"{_pageNumber}.json";
            string content = _recordPage.ToJson();

            using var zipFile = new FileStream(_targetRecordFilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite);
            using var archive = new ZipArchive(zipFile, ZipArchiveMode.Update);

            var entry = archive.CreateEntry(pageName, CompressionLevel.SmallestSize);
            using var writer = new StreamWriter(entry.Open());
            writer.Write(content);

            _recordPage.Clear();

            if (KeepRecord)
            {
                string copyDir = Path.Combine(_recordsDir, "copy",
                    $"{DateTime.Now:yyyyMMdd_HHmmss}_{Guid.NewGuid():N}");
                Directory.CreateDirectory(copyDir);
                File.Copy(_targetRecordFilePath, Path.Combine(copyDir, "record_copy.dat"));
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save recording");
        }
    }

    public void SaveResults(Dictionary<string, long> scores)
    {
        try
        {
            var result = new GameResult { Scores = scores };
            string json = JsonSerializer.Serialize(result, JsonOptions);
            // Write atomically: an external reader (the evaluator) polls this file,
            // and a non-atomic File.WriteAllText can be observed mid-write as
            // truncated/invalid JSON. Write to a temp file, then move into place.
            string tempPath = _targetResultFilePath + ".tmp";
            File.WriteAllText(tempPath, json);
            File.Move(tempPath, _targetResultFilePath, overwrite: true);
            Log.Information("Results saved to {Path}", _targetResultFilePath);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save results");
        }
    }

    public void Flush()
    {
        if (_recordPage.Length > 0)
            Save();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Flush();
        SaveHistoryReplay();
    }

    private void SaveHistoryReplay()
    {
        if (_historyReplaySaved || !File.Exists(_targetRecordFilePath))
            return;

        try
        {
            Directory.CreateDirectory(_historyReplayDir);

            string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmssfff");
            string historyReplayPath = Path.Combine(_historyReplayDir, $"{timestamp}.dat");
            int duplicateIndex = 1;
            while (File.Exists(historyReplayPath))
            {
                historyReplayPath = Path.Combine(_historyReplayDir, $"{timestamp}_{duplicateIndex}.dat");
                duplicateIndex++;
            }

            File.Copy(_targetRecordFilePath, historyReplayPath);
            _historyReplaySaved = true;
            Log.Information("Replay history saved to {Path}", historyReplayPath);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save replay history");
        }
    }
}

public record GameResult
{
    [JsonPropertyName("scores")]
    public Dictionary<string, long> Scores { get; init; } = new();
}
