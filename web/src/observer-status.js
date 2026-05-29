function normalizeMatchId(rawValue) {
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeMatchStatus(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  return value === "pending" || value === "running" || value === "finished" ? value : "";
}

function matchLabel(matchId) {
  return matchId ? `第 ${matchId} 场对局` : "下一场对局";
}

export function normalizeObserverMatch(payload) {
  return {
    matchId: normalizeMatchId(payload?.match_id),
    matchStatus: normalizeMatchStatus(payload?.status),
  };
}

export function describeObserverConnection(match, options = {}) {
  const matchId = normalizeMatchId(match?.matchId);
  const matchStatus = normalizeMatchStatus(match?.matchStatus);
  const socketConnected = Boolean(options.socketConnected);
  const manuallyDisconnected = Boolean(options.manuallyDisconnected);
  const reconnectAttempt = Number(options.reconnectAttempt) || 0;
  const retryHint = reconnectAttempt > 0 ? " 页面会自动重试连接。" : "";
  const label = matchLabel(matchId);

  if (socketConnected) {
    if (matchStatus === "running") {
      return {
        status: "connected",
        statusLabel: "观战已连接",
        statusDetail: `正在直播 ${label}。`,
      };
    }
    if (matchStatus === "pending") {
      return {
        status: "connected",
        statusLabel: "观战已连接",
        statusDetail: `${label} 已排队，等待正式开赛。`,
      };
    }
    if (matchStatus === "finished") {
      return {
        status: "waiting",
        statusLabel: "等待下一场",
        statusDetail: `${label} 已结束，等待下一场开始。`,
      };
    }
    return {
      status: "connected",
      statusLabel: "观战已连接",
      statusDetail: "实时观战连接正常。",
    };
  }

  if (manuallyDisconnected) {
    return {
      status: "disconnected",
      statusLabel: "已断开",
      statusDetail: "已停止自动观战连接。",
    };
  }

  if (!matchId || !matchStatus) {
    return {
      status: "waiting",
      statusLabel: "等待下一场",
      statusDetail: `当前没有可观战的直播对局。${retryHint || " 页面会自动等待下一场开始。"}`,
    };
  }

  if (matchStatus === "pending") {
    return {
      status: "starting",
      statusLabel: "比赛即将开始",
      statusDetail: `${label} 已进入队列，正在等待直播服务启动。${retryHint}`,
    };
  }

  if (matchStatus === "running") {
    return {
      status: "starting",
      statusLabel: "比赛启动中",
      statusDetail: `${label} 正在建立观战连接。${retryHint || " 请稍候。"}`,
    };
  }

  return {
    status: "waiting",
    statusLabel: "等待下一场",
    statusDetail: `${label} 已结束，页面会自动等待下一场。`,
  };
}
