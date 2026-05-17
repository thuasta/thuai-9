namespace Thuai.Connection;

using Thuai.Protocol.Messages;

public partial class AgentServer
{
    // Called by GameController to link socket to player token
    public void HandleAfterPlayerConnectEvent(object? sender, AfterPlayerConnectEventArgs e)
    {
        BindPlayerSocket(e.SocketId, e.Token);
    }

    private void BindPlayerSocket(Guid socketId, string token)
    {
        if (_tokenSockets.TryGetValue(token, out var existingSocketId) && existingSocketId != socketId)
        {
            RemoveSocket(existingSocketId);
        }

        _socketTokens[socketId] = token;
        _socketRoles[socketId] = SocketRole.Player;
        _tokenSockets[token] = socketId;
    }
}
