import {
  activateSkillMessage,
  cancelOrderMessage,
  helloMessage,
  limitBuyMessage,
  limitSellMessage,
  selectStrategyMessage,
  sendJson,
  submitReportMessage,
} from "./actions.js";
import { buildSampleMessages } from "./sample-data.js";
import {
  applyMessage,
  clearSettlement,
  createInitialState,
  pushEvent,
  routeFromLocation,
  setActiveView,
  setCandleOptions,
  setColorScheme,
  setConnectionPatch,
  setMode,
} from "./store.js";
import { renderApp } from "./render.js";
import { applyColorScheme, loadColorScheme, saveColorScheme } from "./appearance.js";

const state = createInitialState(routeFromLocation(window.location));
setColorScheme(state, loadColorScheme());
applyColorScheme(state.ui.colorScheme);
let ws = null;
let reconnectTimer = null;
let manuallyClosed = false;

bindControls();
renderApp(state);

function bindControls() {
  document.getElementById("modeTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button) return;
    setMode(state, button.dataset.mode);
    updateRoute();
    renderApp(state);
  });

  document.querySelector(".menu-panel")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    if (state.connection.role !== "player" && (button.dataset.view === "info" || button.dataset.view === "debug")) {
      return;
    }
    setActiveView(state, button.dataset.view);
    renderApp(state);
  });

  document.body.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-modal]");
    if (openButton) {
      openModal(openButton.dataset.openModal);
      return;
    }

    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) {
      closeModal(closeButton.dataset.closeModal);
      return;
    }

    const summaryButton = event.target.closest("[data-summary-day]");
    if (summaryButton) {
      showSummaryDetail(Number(summaryButton.dataset.summaryDay));
      return;
    }

    const playerButton = event.target.closest("[data-player-token]");
    if (playerButton) {
      showPlayerDetail(playerButton.dataset.playerToken);
    }
  });

  document.getElementById("serverInput")?.addEventListener("change", (event) => {
    setConnectionPatch(state, { server: event.target.value.trim() || "ws://localhost:14514" });
    updateRoute();
    renderApp(state);
  });

  document.getElementById("tokenInput")?.addEventListener("change", (event) => {
    setConnectionPatch(state, { token: event.target.value.trim() || "player1" });
    updateRoute();
    renderApp(state);
  });

  document.getElementById("connectButton")?.addEventListener("click", connect);
  document.getElementById("disconnectButton")?.addEventListener("click", () => disconnect(true));
  document.getElementById("demoButton")?.addEventListener("click", loadDemo);

  document.getElementById("priceModeSelect")?.addEventListener("change", (event) => {
    setCandleOptions(state, { priceField: event.target.value });
    renderApp(state);
  });

  document.getElementById("intervalSelect")?.addEventListener("change", (event) => {
    setCandleOptions(state, { interval: event.target.value });
    renderApp(state);
  });

  document.getElementById("colorSchemeSelect")?.addEventListener("change", (event) => {
    setColorScheme(state, event.target.value);
    saveColorScheme(state.ui.colorScheme);
    renderApp(state);
  });

  document.getElementById("orderForm")?.addEventListener("submit", handleOrder);
  document.getElementById("cancelForm")?.addEventListener("submit", handleCancel);
  document.getElementById("reportForm")?.addEventListener("submit", handleReport);
  document.getElementById("quickReportForm")?.addEventListener("submit", handleQuickReport);
  document.getElementById("skillForm")?.addEventListener("submit", handleSkill);

  document.getElementById("strategyOptions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='select-strategy']");
    if (!button) return;
    sendAction(selectStrategyMessage(state.connection.token, button.dataset.cardName));
  });

  document.getElementById("closeSettlementButton")?.addEventListener("click", () => {
    clearSettlement(state);
    renderApp(state);
  });

  window.addEventListener("resize", () => renderApp(state));
}

function connect() {
  clearTimeout(reconnectTimer);
  manuallyClosed = false;

  if (ws && ws.readyState <= 1) {
    ws.close();
  }

  const server = document.getElementById("serverInput")?.value.trim() || state.connection.server;
  const token = document.getElementById("tokenInput")?.value.trim() || state.connection.token;
  setConnectionPatch(state, {
    server,
    token,
    status: "connecting",
    lastError: "",
  });
  updateRoute();
  renderApp(state);

  try {
    ws = new WebSocket(server);
  } catch (error) {
    handleSocketError(error);
    return;
  }

  ws.addEventListener("open", () => {
    setConnectionPatch(state, {
      status: "connected",
      reconnectAttempt: 0,
      lastError: "",
    });
    sendAction(cancelOrderMessage(state.connection.token || "player1", -1), { silent: true });
    sendAction(helloMessage(state.connection.role, state.connection.token), { silent: true });
    renderApp(state);
  });

  ws.addEventListener("message", (event) => {
    try {
      applyMessage(state, JSON.parse(event.data));
    } catch (error) {
      pushEvent(state, {
        kind: "error",
        title: "消息解析失败",
        detail: error.message,
      });
    }
    renderApp(state);
  });

  ws.addEventListener("error", () => {
    handleSocketError(new Error("WebSocket error"));
  });

  ws.addEventListener("close", () => {
    const nextStatus = manuallyClosed ? "disconnected" : "error";
    setConnectionPatch(state, { status: nextStatus });
    renderApp(state);
    if (!manuallyClosed) scheduleReconnect();
  });
}

function disconnect(byUser) {
  manuallyClosed = byUser;
  clearTimeout(reconnectTimer);
  if (ws && ws.readyState <= 1) {
    ws.close();
  }
  setConnectionPatch(state, { status: "disconnected" });
  renderApp(state);
}

function scheduleReconnect() {
  const attempt = state.connection.reconnectAttempt + 1;
  const delay = Math.min(10000, 500 * 2 ** Math.min(attempt, 5));
  setConnectionPatch(state, { reconnectAttempt: attempt });
  reconnectTimer = window.setTimeout(connect, delay);
}

function handleSocketError(error) {
  setConnectionPatch(state, {
    status: "error",
    lastError: error.message,
  });
  pushEvent(state, {
    kind: "error",
    title: "连接错误",
    detail: error.message,
  });
  renderApp(state);
}

function sendAction(message, options = {}) {
  try {
    sendJson(ws, message);
    setConnectionPatch(state, { lastSent: message.messageType });
    if (!options.silent) {
      pushEvent(state, {
        kind: "system",
        title: `已发送 ${message.messageType}`,
        detail: actionDetail(message),
      });
    }
  } catch (error) {
    applyMessage(state, {
      messageType: "ERROR",
      errorCode: 1000,
      message: error.message,
    });
  }
  renderApp(state);
}

function handleOrder(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const data = new FormData(event.currentTarget);
  const price = data.get("price");
  const quantity = data.get("quantity");
  const token = state.connection.token;
  const message = submitter?.value === "sell"
    ? limitSellMessage(token, price, quantity)
    : limitBuyMessage(token, price, quantity);
  sendAction(message);
}

function handleCancel(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  sendAction(cancelOrderMessage(state.connection.token, data.get("orderId")));
}

function handleReport(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  sendAction(submitReportMessage(
    state.connection.token,
    data.get("newsId"),
    data.get("prediction"),
  ));
}

function handleQuickReport(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const prediction = event.submitter?.value || data.get("prediction");
  sendAction(submitReportMessage(
    state.connection.token,
    data.get("newsId"),
    prediction,
  ));
}

function handleSkill(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  sendAction(activateSkillMessage(
    state.connection.token,
    String(data.get("skillName") || "").trim(),
    data.get("direction"),
  ));
}

function loadDemo() {
  disconnect(false);
  state.events = [];
  state.news.items = [];
  state.news.results = {};
  state.dailySummaries = [];
  state.playerSummaries = {};
  clearSettlement(state);
  for (const message of buildSampleMessages(state.connection.role)) {
    applyMessage(state, message);
  }
  renderApp(state);
}

function showSummaryDetail(day) {
  const summary = state.dailySummaries.find((item) => Number(item.day) === Number(day));
  if (!summary) return;
  const body = document.getElementById("detailModalBody");
  const title = document.getElementById("detailModalTitle");
  const eyebrow = document.getElementById("detailModalEyebrow");
  if (!body || !title || !eyebrow) return;

  eyebrow.textContent = "Daily Summary";
  title.textContent = `第 ${summary.day} 日总结`;
  body.innerHTML = `
    <section class="detail-section">
      <h3>结算结果</h3>
      <p>胜者：${escapeHtml(summary.winnerToken || "Tie")}</p>
      <p>原因：${escapeHtml(summary.reason || "-")}</p>
    </section>
    <div class="detail-grid">
      ${(summary.players || []).map((player) => `
        <section class="detail-section">
          <h3>${escapeHtml(player.token)}</h3>
          <p>NAV：${escapeHtml(player.nav)}</p>
          <p>Mora：${escapeHtml(player.mora)}</p>
          <p>Gold：${escapeHtml(player.gold)}</p>
          <p>Trades：${escapeHtml(player.tradeCount)}</p>
          <p>Frozen Mora：${escapeHtml(player.frozenMora)}</p>
          <p>Frozen Gold：${escapeHtml(player.frozenGold)}</p>
          <p>Locked Gold：${escapeHtml(player.lockedGold)}</p>
        </section>
      `).join("")}
    </div>
  `;
  openModal("detailModal");
}

function showPlayerDetail(token) {
  const player = state.playerSummaries[token];
  if (!player) return;
  const body = document.getElementById("detailModalBody");
  const title = document.getElementById("detailModalTitle");
  const eyebrow = document.getElementById("detailModalEyebrow");
  if (!body || !title || !eyebrow) return;

  eyebrow.textContent = "Player";
  title.textContent = `${token} 摘要`;
  body.innerHTML = `
    <section class="detail-section">
      <h3>当前状态</h3>
      <p>NAV：${escapeHtml(player.nav)}</p>
      <p>Mora：${escapeHtml(player.mora)}</p>
      <p>Gold：${escapeHtml(player.gold)}</p>
      <p>Pending Orders：${escapeHtml(player.pendingOrderCount ?? 0)}</p>
      <p>Active Cards：${escapeHtml((player.activeCards || []).join("、") || "暂无")}</p>
    </section>
  `;
  openModal("detailModal");
}

function openModal(id) {
  document.getElementById(id)?.removeAttribute("hidden");
}

function closeModal(id) {
  document.getElementById(id)?.setAttribute("hidden", "");
}

function updateRoute() {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", state.connection.role);
  url.searchParams.set("token", state.connection.token);
  url.searchParams.set("server", state.connection.server);
  window.history.replaceState({}, "", url);
}

function actionDetail(message) {
  if (message.messageType === "LIMIT_BUY" || message.messageType === "LIMIT_SELL") {
    return `price=${message.price} qty=${message.quantity}`;
  }
  if (message.messageType === "CANCEL_ORDER") {
    return `orderId=${message.orderId}`;
  }
  if (message.messageType === "SUBMIT_REPORT") {
    return `news=${message.newsId} ${message.prediction}`;
  }
  if (message.messageType === "SELECT_STRATEGY") {
    return String(message.cardName || "");
  }
  if (message.messageType === "ACTIVATE_SKILL") {
    return `${message.skillName || ""} ${message.direction || ""}`.trim();
  }
  return message.messageType;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
