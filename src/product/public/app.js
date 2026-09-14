const TOKEN_KEY = "hatfield_product_token";

const el = {
  loginPanel: document.getElementById("login-panel"),
  appPanel: document.getElementById("app-panel"),
  tokenInput: document.getElementById("token-input"),
  loginBtn: document.getElementById("login-btn"),
  loginError: document.getElementById("login-error"),
  logoutBtn: document.getElementById("logout-btn"),
  roleLabel: document.getElementById("role-label"),
  clientTitle: document.getElementById("client-title"),
  clientMeta: document.getElementById("client-meta"),
  operatorPick: document.getElementById("operator-pick"),
  clientSelect: document.getElementById("client-select"),
  runOpenBtn: document.getElementById("run-open-btn"),
  retryBtn: document.getElementById("retry-btn"),
  retryRowInput: document.getElementById("retry-row-input"),
  actionError: document.getElementById("action-error"),
  actionOk: document.getElementById("action-ok"),
  jobsList: document.getElementById("jobs-list"),
  jobsEmpty: document.getElementById("jobs-empty"),
  refreshBtn: document.getElementById("refresh-btn"),
};

let state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  role: null,
  client: null,
  clients: [],
  selectedClientId: null,
  pollTimer: null,
};

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function show(msgEl, text) {
  msgEl.hidden = !text;
  msgEl.textContent = text || "";
}

function setAuthed(authed) {
  el.loginPanel.hidden = authed;
  el.appPanel.hidden = !authed;
}

function sheetShort(id) {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function renderSession() {
  if (state.role === "operator") {
    el.roleLabel.textContent = "Operator";
    el.operatorPick.hidden = false;
    el.clientSelect.innerHTML = state.clients
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === state.selectedClientId ? "selected" : ""}>${escapeHtml(
            c.displayName
          )}${c.enabled ? "" : " (paused)"}</option>`
      )
      .join("");
    const selected =
      state.clients.find((c) => c.id === state.selectedClientId) || state.clients[0];
    state.selectedClientId = selected?.id || null;
    el.clientTitle.textContent = selected?.displayName || "No clients configured";
    el.clientMeta.textContent = selected
      ? `Sheet ${sheetShort(selected.sheetId)}${selected.hasLoadedSheet ? " · loaded-clients linked" : ""}`
      : "Add a file under clients/*.json";
  } else {
    el.roleLabel.textContent = "Client";
    el.operatorPick.hidden = true;
    el.clientTitle.textContent = state.client?.displayName || "—";
    el.clientMeta.textContent = state.client
      ? `Sheet ${sheetShort(state.client.sheetId)}${
          state.client.enabled ? "" : " · paused"
        }${state.client.hasLoadedSheet ? " · loaded-clients linked" : ""}`
      : "";
    state.selectedClientId = state.client?.id || null;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function renderJobs(jobs) {
  el.jobsList.innerHTML = "";
  if (!jobs?.length) {
    el.jobsEmpty.hidden = false;
    return;
  }
  el.jobsEmpty.hidden = true;
  for (const job of jobs) {
    const li = document.createElement("li");
    const kind = job.kind === "retry-rows" ? `Retry ${(job.rows || []).join(", ")}` : "Run open rows";
    const detail = job.error || job.summary || "";
    li.innerHTML = `
      <div class="top">
        <span>${escapeHtml(kind)}</span>
        <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      </div>
      <div class="meta">${escapeHtml(formatWhen(job.createdAt))}${
        job.finishedAt ? ` → ${escapeHtml(formatWhen(job.finishedAt))}` : ""
      }</div>
      ${detail ? `<div class="meta">${escapeHtml(detail)}</div>` : ""}
    `;
    el.jobsList.appendChild(li);
  }
}

async function refreshJobs() {
  if (!state.token || !state.selectedClientId) {
    renderJobs([]);
    return;
  }
  const q =
    state.role === "operator" ? `?clientId=${encodeURIComponent(state.selectedClientId)}` : "";
  const data = await api(`/api/jobs${q}`);
  renderJobs(data.jobs || []);
  const busy = (data.jobs || []).some((j) => j.status === "queued" || j.status === "running");
  if (busy && !state.pollTimer) {
    state.pollTimer = setInterval(() => {
      refreshJobs().catch(() => {});
    }, 3000);
  }
  if (!busy && state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function bootstrapSession() {
  const me = await api("/api/me");
  state.role = me.role;
  if (me.role === "operator") {
    state.clients = me.clients || [];
    state.selectedClientId = state.clients[0]?.id || null;
    state.client = null;
  } else {
    state.client = me.client;
    state.clients = [];
    state.selectedClientId = me.client?.id || null;
  }
  setAuthed(true);
  renderSession();
  await refreshJobs();
}

async function login() {
  show(el.loginError, "");
  const token = el.tokenInput.value.trim();
  if (!token) {
    show(el.loginError, "Enter your access token.");
    return;
  }
  try {
    el.loginBtn.disabled = true;
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    state.token = token;
    localStorage.setItem(TOKEN_KEY, token);
    state.role = data.role;
    if (data.role === "operator") {
      state.clients = data.clients || [];
      state.selectedClientId = state.clients[0]?.id || null;
    } else {
      state.client = data.client;
      state.selectedClientId = data.client?.id || null;
    }
    setAuthed(true);
    renderSession();
    await refreshJobs();
  } catch (err) {
    show(el.loginError, err.message || "Login failed");
  } finally {
    el.loginBtn.disabled = false;
  }
}

function logout() {
  state.token = "";
  state.role = null;
  state.client = null;
  state.clients = [];
  localStorage.removeItem(TOKEN_KEY);
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  setAuthed(false);
  el.tokenInput.value = "";
}

async function startRun(kind) {
  show(el.actionError, "");
  show(el.actionOk, "");
  const body = { kind };
  if (state.role === "operator") {
    body.clientId = state.selectedClientId;
  }
  if (kind === "retry-rows") {
    const row = parseInt(el.retryRowInput.value, 10);
    if (!Number.isInteger(row) || row < 2) {
      show(el.actionError, "Enter a sheet row number (2 or higher).");
      return;
    }
    body.rows = [row];
  }
  try {
    el.runOpenBtn.disabled = true;
    el.retryBtn.disabled = true;
    const data = await api("/api/runs", { method: "POST", body: JSON.stringify(body) });
    show(el.actionOk, `Queued: ${data.job.id.slice(0, 8)}… (${data.job.status})`);
    await refreshJobs();
  } catch (err) {
    show(el.actionError, err.message || "Could not start run");
  } finally {
    el.runOpenBtn.disabled = false;
    el.retryBtn.disabled = false;
  }
}

el.loginBtn.addEventListener("click", () => login());
el.tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
el.logoutBtn.addEventListener("click", logout);
el.runOpenBtn.addEventListener("click", () => startRun("run-open"));
el.retryBtn.addEventListener("click", () => startRun("retry-rows"));
el.refreshBtn.addEventListener("click", () => refreshJobs().catch((e) => show(el.actionError, e.message)));
el.clientSelect.addEventListener("change", () => {
  state.selectedClientId = el.clientSelect.value;
  renderSession();
  refreshJobs().catch(() => {});
});

if (state.token) {
  bootstrapSession().catch(() => {
    logout();
  });
}
