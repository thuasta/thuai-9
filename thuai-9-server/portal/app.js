const state = {
  authMode: "login",
  accessToken: localStorage.getItem("thuai9AccessToken") || "",
  gameToken: localStorage.getItem("thuai9GameToken") || "",
};

const logPollers = new Map();

const els = {
  authForm: document.getElementById("authForm"),
  authSubmit: document.getElementById("authSubmit"),
  authStatus: document.getElementById("authStatus"),
  teamNameField: document.getElementById("teamNameField"),
  sessionPanel: document.getElementById("sessionPanel"),
  gameToken: document.getElementById("gameToken"),
  uploadForm: document.getElementById("uploadForm"),
  uploadStatus: document.getElementById("uploadStatus"),
  submissionsList: document.getElementById("submissionsList"),
  leaderboardBody: document.getElementById("leaderboardBody"),
};

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authTab));
});

document.getElementById("logoutButton")?.addEventListener("click", logout);
document.getElementById("refreshLeaderboard")?.addEventListener("click", loadLeaderboard);
document.getElementById("refreshSubmissions")?.addEventListener("click", loadSubmissions);
els.authForm?.addEventListener("submit", submitAuth);
els.uploadForm?.addEventListener("submit", submitCode);

renderSession();
loadLeaderboard();
if (state.accessToken) {
  loadSubmissions();
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.authTab === state.authMode);
  });
  els.teamNameField?.classList.toggle("is-hidden", state.authMode !== "register");
  const nameInput = els.teamNameField?.querySelector("input");
  if (nameInput) {
    nameInput.required = state.authMode === "register";
  }
  els.authSubmit.textContent = state.authMode === "register" ? "注册" : "登录";
  setStatus(els.authStatus, "");
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(els.authForm);
  const payload = {
    email: String(form.get("email") || "").trim(),
    password: String(form.get("password") || ""),
  };
  if (state.authMode === "register") {
    payload.name = String(form.get("name") || "").trim();
  }

  setStatus(els.authStatus, "请求中...");
  try {
    const json = await requestJson(state.authMode === "register" ? "/api/register" : "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.accessToken = json.access_token;
    state.gameToken = json.game_token || "";
    localStorage.setItem("thuai9AccessToken", state.accessToken);
    localStorage.setItem("thuai9GameToken", state.gameToken);
    setStatus(els.authStatus, "登录成功", "ok");
    renderSession();
    loadSubmissions();
  } catch (error) {
    setStatus(els.authStatus, error.message, "error");
  }
}

async function submitCode(event) {
  event.preventDefault();
  if (!state.accessToken) {
    setStatus(els.uploadStatus, "请先登录。", "error");
    return;
  }

  const form = new FormData(els.uploadForm);
  const file = form.get("file");
  if (!file || !file.name) {
    setStatus(els.uploadStatus, "请选择 .zip 文件。", "error");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".zip")) {
    setStatus(els.uploadStatus, "只接受 .zip 文件。", "error");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setStatus(els.uploadStatus, "文件超过 10 MB 限制。", "error");
    return;
  }

  const rawName = String(form.get("name") || "").trim();
  if (rawName.length > 64) {
    setStatus(els.uploadStatus, "代码名称不能超过 64 个字符。", "error");
    return;
  }
  if (rawName) {
    form.set("name", rawName);
  } else {
    form.delete("name");
  }

  setStatus(els.uploadStatus, "上传中...");
  try {
    await requestJson("/api/submissions/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${state.accessToken}` },
      body: form,
    });
    els.uploadForm.reset();
    setStatus(els.uploadStatus, "上传成功，编译完成后可派遣。", "ok");
    await loadSubmissions();
  } catch (error) {
    setStatus(els.uploadStatus, error.message, "error");
  }
}

async function loadSubmissions() {
  if (!state.accessToken) {
    stopAllLogPolling();
    els.submissionsList.className = "empty";
    els.submissionsList.textContent = "登录后显示提交记录。";
    return;
  }
  try {
    const submissions = await requestJson("/api/submissions/", {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    renderSubmissions(submissions);
  } catch (error) {
    els.submissionsList.className = "empty";
    els.submissionsList.textContent = error.message;
  }
}

async function loadLeaderboard() {
  try {
    const entries = await requestJson("/api/leaderboard/");
    renderLeaderboard(entries);
  } catch (error) {
    els.leaderboardBody.innerHTML = `<tr><td colspan="7">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderSession() {
  const loggedIn = Boolean(state.accessToken);
  els.sessionPanel?.classList.toggle("is-hidden", !loggedIn);
  els.gameToken.textContent = state.gameToken || "-";
}

const MAX_LOG_DISPLAY = 8 * 1024;

function renderSubmissions(submissions) {
  stopAllLogPolling();
  if (!Array.isArray(submissions) || submissions.length === 0) {
    els.submissionsList.className = "empty";
    els.submissionsList.textContent = "暂无提交记录。";
    return;
  }

  els.submissionsList.className = "";
  els.submissionsList.innerHTML = `
    <ul class="submission-list">
      ${submissions.map((item) => {
        const canDispatch = item.status === "ready" && !item.is_dispatched;
        const dispatchLabel = item.is_dispatched
          ? "当前出战"
          : item.status === "ready"
            ? "派遣此代码"
            : "仅 ready 可派遣";
        return `
          <li data-submission-id="${item.id}">
            <div class="submission-row">
              <div class="submission-main">
                <div class="submission-title">
                  <strong>${escapeHtml(item.name || `代码 #${item.id}`)}</strong>
                  <span class="submission-id">#${item.id}</span>
                  ${item.is_dispatched ? '<span class="submission-badge is-dispatched">当前派遣</span>' : ""}
                </div>
                <div class="submission-meta">
                  <span>${formatTime(item.uploaded_at)}</span>
                  <span>${escapeHtml(item.language)}</span>
                  <span>${escapeHtml(item.status)}</span>
                </div>
              </div>
              <div class="submission-actions">
                <button
                  type="button"
                  class="link-button"
                  data-action="dispatch"
                  data-submission-id="${item.id}"
                  ${canDispatch ? "" : "disabled"}
                >
                  ${dispatchLabel}
                </button>
                <button type="button" class="link-button" data-action="toggle-logs" data-submission-id="${item.id}">查看日志</button>
                <button type="button" class="link-button" data-action="download-logs" data-submission-id="${item.id}">下载日志</button>
              </div>
            </div>
            <div class="submission-logs" data-logs-for="${item.id}" hidden></div>
          </li>
        `;
      }).join("")}
    </ul>
  `;

  els.submissionsList.querySelectorAll("[data-action='dispatch']").forEach((button) => {
    button.addEventListener("click", () => dispatchSubmission(button.dataset.submissionId));
  });
  els.submissionsList.querySelectorAll("[data-action='toggle-logs']").forEach((button) => {
    button.addEventListener("click", () => toggleLogs(button.dataset.submissionId));
  });
  els.submissionsList.querySelectorAll("[data-action='download-logs']").forEach((button) => {
    button.addEventListener("click", () => downloadSubmissionLogs(button.dataset.submissionId));
  });
}

async function dispatchSubmission(submissionId) {
  if (!state.accessToken) return;
  try {
    await requestJson(`/api/submissions/${submissionId}/dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    setStatus(els.uploadStatus, "已切换当前出战代码。", "ok");
    await loadSubmissions();
  } catch (error) {
    setStatus(els.uploadStatus, error.message, "error");
  }
}

async function toggleLogs(submissionId) {
  if (!state.accessToken) return;
  const panel = els.submissionsList.querySelector(`[data-logs-for="${submissionId}"]`);
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    stopLogPolling(submissionId);
    return;
  }
  if (panel.dataset.loading === "1") return;
  panel.hidden = false;
  await loadSubmissionLogs(submissionId, panel);
}

async function loadSubmissionLogs(submissionId, panel) {
  stopLogPolling(submissionId);
  panel.dataset.loading = "1";
  panel.innerHTML = `<div class="logs-status">加载中…</div>`;
  try {
    const data = await requestJson(`/api/submissions/${submissionId}/logs`, {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    if (panel.hidden) return;
    panel.innerHTML = renderLogsBody(data);
    if (shouldPollLogs(data.status)) {
      const timerId = setTimeout(() => {
        const nextPanel = els.submissionsList.querySelector(`[data-logs-for="${submissionId}"]`);
        if (!nextPanel || nextPanel.hidden) {
          stopLogPolling(submissionId);
          return;
        }
        loadSubmissionLogs(submissionId, nextPanel);
      }, 1500);
      logPollers.set(String(submissionId), timerId);
    }
  } catch (error) {
    if (!panel.hidden) {
      panel.innerHTML = `<div class="logs-status is-error">${escapeHtml(error.message)}</div>`;
    }
  } finally {
    delete panel.dataset.loading;
  }
}

async function downloadSubmissionLogs(submissionId) {
  if (!state.accessToken) return;
  try {
    const response = await fetch(`/api/submissions/${submissionId}/logs/download`, {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    if (!response.ok) {
      let json = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      throw new Error(formatApiError(json, response.status));
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `submission-${submissionId}-logs.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    setStatus(els.uploadStatus, error.message, "error");
  }
}

function shouldPollLogs(status) {
  return status === "pending" || status === "compiling";
}

function stopLogPolling(submissionId) {
  const key = String(submissionId);
  const timerId = logPollers.get(key);
  if (timerId) {
    clearTimeout(timerId);
    logPollers.delete(key);
  }
}

function stopAllLogPolling() {
  for (const timerId of logPollers.values()) {
    clearTimeout(timerId);
  }
  logPollers.clear();
}

function renderLogsBody(data) {
  const sections = [];
  const compileLog = data.compile_log || fallbackCompileLog(data.status);
  if (compileLog) {
    sections.push(`
      <section class="log-section">
        <h4>编译日志</h4>
        <pre>${escapeHtml(truncate(compileLog))}</pre>
      </section>
    `);
  }
  if (Array.isArray(data.matches) && data.matches.length > 0) {
    sections.push(`
      <section class="log-section">
        <h4>对局日志（最近 ${data.matches.length} 场）</h4>
        ${data.matches.map((m) => `
          <article class="match-log">
            <header>
              <strong>对局 #${escapeHtml(String(m.match_id))}</strong>
              <span>${escapeHtml(m.status)}</span>
              <span>${escapeHtml(formatTime(m.scheduled_at))}</span>
              ${m.score !== null && m.score !== undefined ? `<span>得分 ${escapeHtml(String(m.score))}</span>` : ""}
            </header>
            <pre>${m.log ? escapeHtml(truncate(m.log)) : "（无输出）"}</pre>
          </article>
        `).join("")}
      </section>
    `);
  }
  if (sections.length === 0) {
    return `<div class="logs-status">暂无运行日志。</div>`;
  }
  return sections.join("");
}

function fallbackCompileLog(status) {
  if (status === "pending") return "等待评测器开始编译...";
  if (status === "compiling") return "编译中...";
  return "";
}

function truncate(text) {
  const str = String(text || "");
  if (str.length <= MAX_LOG_DISPLAY) return str;
  const dropped = str.length - MAX_LOG_DISPLAY;
  return `... [前 ${dropped} 字符已省略] ...\n` + str.slice(-MAX_LOG_DISPLAY);
}

function renderLeaderboard(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    els.leaderboardBody.innerHTML = `<tr><td colspan="7">暂无对战数据。</td></tr>`;
    return;
  }

  els.leaderboardBody.innerHTML = entries.map((entry, index) => {
    return `
      <tr>
        <td>${index + 1}</td>
        <td>
          <strong>${escapeHtml(entry.submission_name || `代码 #${entry.submission_id}`)}</strong>
          <span class="submission-id">#${entry.submission_id}</span>
        </td>
        <td>${escapeHtml(entry.team_name)}</td>
        <td>${formatInt64Score(entry.total_score)}</td>
        <td>${formatScore(entry.average_score)}</td>
        <td>${formatInt64Score(entry.best_score)}</td>
        <td>${entry.total_matches}</td>
      </tr>
    `;
  }).join("");
}

function logout() {
  stopAllLogPolling();
  state.accessToken = "";
  state.gameToken = "";
  localStorage.removeItem("thuai9AccessToken");
  localStorage.removeItem("thuai9GameToken");
  setStatus(els.authStatus, "已退出。");
  setStatus(els.uploadStatus, "");
  renderSession();
  loadSubmissions();
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, options);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(formatApiError(json, res.status));
  }
  return json;
}

function formatApiError(json, status) {
  const detail = json?.detail;
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail.map(formatValidationError).join("；");
  }
  if (detail && typeof detail === "object") {
    return detail.msg || JSON.stringify(detail);
  }
  return `请求失败 (${status})`;
}

function formatValidationError(error) {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const field = Array.isArray(error.loc) ? error.loc.filter((part) => part !== "body").join(".") : "";
  const message = error.msg || "输入不合法";
  return field ? `${field}: ${message}` : message;
}

function setStatus(el, message, type = "") {
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", type === "error");
  el.classList.toggle("is-ok", type === "ok");
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatScore(value) {
  if (value === null || value === undefined) return "-";
  const text = String(value).trim();
  return text || "-";
}

function formatInt64Score(value) {
  if (value === null || value === undefined) return "-";
  return escapeHtml(String(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
