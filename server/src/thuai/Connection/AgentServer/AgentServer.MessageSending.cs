namespace Thuai.Connection;

using Serilog;
using Thuai.Protocol.Messages;

public partial class AgentServer
{
    private async Task SendMessageLoop(Guid socketId, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            if (!_socketMessageSendingQueue.TryGetValue(socketId, out var queue))
                break;

            if (queue.TryDequeue(out var message))
            {
                try
                {
                    if (_sockets.TryGetValue(socketId, out var socket))
                    {
                        await socket.Send(message.Json);
                    }
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Error sending message to {SocketId}", socketId);
                }
            }
            else
            {
                await Task.Delay(MessageProcessingInterval, ct);
            }
        }
    }

    // Publish message to specific player (by token)
    public void Publish(Message message, string token)
    {
        foreach (var (socketId, socketToken) in _socketTokens)
        {
            if (socketToken == token && _socketMessageSendingQueue.TryGetValue(socketId, out var queue))
            {
                queue.Enqueue(message);
            }
        }
    }

    // Publish message to ALL connected players
    public void PublishToAll(Message message)
    {
        foreach (var (socketId, _) in _socketTokens)
        {
            if (_socketMessageSendingQueue.TryGetValue(socketId, out var queue))
            {
                queue.Enqueue(message);
            }
        }
    }
}
