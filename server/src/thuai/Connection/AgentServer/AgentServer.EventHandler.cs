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
            // A new socket is taking over this token (reconnect). Close the
            // displaced connection's underlying socket so its OS file descriptor
            // and Fleck bookkeeping are released — RemoveSocket only drops our
            // tracking dictionaries and would otherwise leak the live connection
            // until the remote peer happens to close it.
            if (_sockets.TryGetValue(existingSocketId, out var displaced))
            {
                try { displaced.Close(); }
                catch (Exception ex) { Serilog.Log.Debug(ex, "Failed to close displaced socket {SocketId}", existingSocketId); }
            }
            RemoveSocket(existingSocketId);
        }

        _socketTokens[socketId] = token;
        _socketRoles[socketId] = SocketRole.Player;
        _tokenSockets[token] = socketId;
    }
}
