namespace Thuai.Connection;

using Thuai.Protocol.Messages;

public partial class AgentServer
{
    public class AfterMessageReceiveEventArgs : EventArgs
    {
        public Guid SocketId { get; init; }
        public PerformMessage Message { get; init; } = null!;
    }

    public class AfterPlayerConnectEventArgs : EventArgs
    {
        public Guid SocketId { get; init; }
        public string Token { get; init; } = "";
    }

    public class AfterPlayerDisconnectEventArgs : EventArgs
    {
        public Guid SocketId { get; init; }
        public string Token { get; init; } = "";
    }

    public event EventHandler<AfterMessageReceiveEventArgs>? AfterMessageReceiveEvent;
    public event EventHandler<AfterPlayerConnectEventArgs>? AfterPlayerConnectEvent;
    public event EventHandler<AfterPlayerDisconnectEventArgs>? AfterPlayerDisconnectEvent;
}
