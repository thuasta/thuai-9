const state = {
  authMode: "login",
  accessToken: localStorage.getItem("thuai9AccessToken") || "",
  gameToken: localStorage.getItem("thuai9GameToken") || "",
};

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

  setStatus(els.uploadStatus, "上传中...");
  try {
    await requestJson("/api/submissions/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${state.accessToken}` },
      body: form,
    });
    els.uploadForm.reset();
    setStatus(els.uploadStatus, "上传成功，等待评测。", "ok");
    loadSubmissions();
  } catch (error) {
    setStatus(els.uploadStatus, error.message, "error");
  }
}

async function loadSubmissions() {
  if (!state.accessToken) {
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
  if (!Array.isArray(submissions) || submissions.length === 0) {
    els.submissionsList.className = "empty";
    els.submissionsList.textContent = "暂无提交记录。";
    return;
  }

  els.submissionsList.className = "";
  els.submissionsList.innerHTML = `
    <ul class="submission-list">
      ${submissions.map((item) => `
        <li data-submission-id="${item.id}">
          <div class="submission-row">
            <div>
              <strong>#${item.id} ${escapeHtml(item.language)}</strong>
              <div class="submission-meta">${formatTime(item.uploaded_at)}</div>
            </div>
            <span>${escapeHtml(item.status)}</span>
            <button type="button" class="link-button" data-action="toggle-logs" data-submission-id="${item.id}">查看日志</button>
          </div>
          <div class="submission-logs" data-logs-for="${item.id}" hidden></div>
        </li>
      `).join("")}
    </ul>
  `;

  els.submissionsList.querySelectorAll("[data-action='toggle-logs']").forEach((button) => {
    button.addEventListener("click", () => toggleLogs(button.dataset.submissionId));
  });
}

async function toggleLogs(submissionId) {
  if (!state.accessToken) return;
  const panel = els.submissionsList.querySelector(`[data-logs-for="${submissionId}"]`);
  if (!panel) return;
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
  if (panel.dataset.loading === "1") return;
  panel.hidden = false;
  panel.dataset.loading = "1";
  panel.innerHTML = `<div class="logs-status">加载中…</div>`;
  try {
    const data = await requestJson(`/api/submissions/${submissionId}/logs`, {
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
    if (panel.hidden) return; // collapsed mid-flight — don't write into a hidden panel
    panel.innerHTML = renderLogsBody(data);
  } catch (error) {
    if (!panel.hidden) {
      panel.innerHTML = `<div class="logs-status is-error">${escapeHtml(error.message)}</div>`;
    }
  } finally {
    delete panel.dataset.loading;
  }
}

function renderLogsBody(data) {
  const sections = [];
  if (data.compile_log) {
    sections.push(`
      <section class="log-section">
        <h4>编译日志</h4>
        <pre>${escapeHtml(truncate(data.compile_log))}</pre>
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

function truncate(text) {
  const str = String(text || "");
  if (str.length <= MAX_LOG_DISPLAY) return str;
  const dropped = str.length - MAX_LOG_DISPLAY;
  return `... [前 ${dropped} 字符已省略] ...\n` + str.slice(-MAX_LOG_DISPLAY);
}

function renderLeaderboard(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    els.leaderboardBody.innerHTML = `<tr><td colspan="6">暂无对战数据。</td></tr>`;
    return;
  }

  els.leaderboardBody.innerHTML = entries.map((entry, index) => {
    return `
      <tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(entry.team_name)}</strong></td>
        <td>${entry.total_score}</td>
        <td>${formatScore(entry.average_score)}</td>
        <td>${entry.best_score ?? "-"}</td>
        <td>${entry.total_matches}</td>
      </tr>
    `;
  }).join("");
}

function logout() {
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
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(2).replace(/\.?0+$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
