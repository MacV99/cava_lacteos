// ── Configuración ────────────────────────────────────────────────────────────
// Pega aquí la URL del deployment de Google Apps Script (Implementar → Aplicación web).
const API_URL = "https://script.google.com/macros/s/AKfycbxAETSMOzO6ozHdy88OoXiKUMZ2YW05VoFvXWGqZHdwDozsGBe6Iiit-hNl9GK-OB_p/exec";

const CACHE_KEY = "cava_panel_v1";

// ── Estado en memoria ─────────────────────────────────────────────────────────
let liveData = [];        // lista de chats
let currentSenderId = null;

// ── SVG logos de canal ─────────────────────────────────────────────────────────
const ICON_IG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.17.4.37 1 .42 2.2.06 1.3.07 1.7.07 4.9s0 3.6-.07 4.9c-.05 1.2-.25 1.8-.42 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.17-1 .37-2.2.42-1.3.06-1.7.07-4.9.07s-3.6 0-4.9-.07c-1.2-.05-1.8-.25-2.2-.42-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.17-.4-.37-1-.42-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.05-1.2.25-1.8.42-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.17 1-.37 2.2-.42C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zm6.8-11.1a1.54 1.54 0 1 1-1.54-1.54 1.54 1.54 0 0 1 1.54 1.54z"/></svg>`;
const ICON_FB = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.21 2 11.4c0 2.96 1.46 5.6 3.75 7.32V22l3.43-1.88c.91.25 1.87.39 2.82.39 5.52 0 10-4.21 10-9.4S17.52 2 12 2zm1.02 12.66l-2.55-2.72-4.97 2.72 5.47-5.8 2.61 2.72 4.91-2.72-5.47 5.8z"/></svg>`;
const ICON_WA = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.16c-.24.68-1.42 1.31-1.96 1.36-.5.06-1.13.08-1.83-.11-.42-.13-.96-.31-1.65-.6-2.91-1.26-4.81-4.19-4.96-4.39-.14-.2-1.19-1.58-1.19-3.01s.75-2.14 1.02-2.43c.27-.29.58-.36.78-.36l.56.01c.18.01.42-.07.66.5.24.59.82 2.02.89 2.17.07.14.12.31.02.51-.1.2-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.13.57.16.27.72 1.18 1.54 1.91 1.06.94 1.95 1.24 2.23 1.38.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.22.61-.13.25.09 1.58.74 1.85.88.27.14.45.2.51.31.07.12.07.66-.17 1.34z"/></svg>`;

function canalInfo(canal) {
  const c = (canal || "").toLowerCase();
  if (c === "instagram") return { cls: "instagram", svg: ICON_IG, label: "Instagram" };
  if (c === "messenger" || c === "page") return { cls: "messenger", svg: ICON_FB, label: "Messenger" };
  if (c === "whatsapp") return { cls: "whatsapp", svg: ICON_WA, label: "WhatsApp" };
  return { cls: "unknown", svg: "", label: "Sin canal" };  // "?" lo pone el CSS (::before)
}

// ── JSONP (GET a GAS) ──────────────────────────────────────────────────────────
function fetchJSONP(url) {
  return new Promise((resolve, reject) => {
    const cb = "_cb_" + Date.now();
    const script = document.createElement("script");
    const timer = setTimeout(() => { cleanup(); reject("timeout"); }, 12000);
    function cleanup() { clearTimeout(timer); delete window[cb]; script.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject("load failed"); };
    script.src = `${url}?callback=${cb}`;
    document.head.appendChild(script);
  });
}

// ── POST a GAS (text/plain) ─────────────────────────────────────────────────────
async function postData(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    mode: "cors",
    redirect: "follow",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ── Caché local ─────────────────────────────────────────────────────────────────
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } }
function writeCache(d) { liveData = d; try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { } }

// ── Helpers ──────────────────────────────────────────────────────────────────────
function parseHistorial(raw) {
  try { const x = JSON.parse(raw || "[]"); return Array.isArray(x) ? x : []; }
  catch { return []; }
}
function isOn(activado) { return String(activado).trim().toLowerCase() !== "false"; }
function lastUserText(hist) {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i].role === "user") return hist[i].content;
  return hist.length ? hist[hist.length - 1].content : "";
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// Parsea el formato Bogotá "d/m/yyyy, h:mm:ss am/pm" → epoch ms (0 si no parsea).
// Necesario porque ese formato NO es ordenable lexicográficamente (día/mes sin cero,
// hora 12h con am/pm).
function fechaMs(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)/i);
  if (!m) return 0;
  let [, d, mo, y, h, mi, se, ap] = m;
  h = +h % 12; if (/pm/i.test(ap)) h += 12;
  return new Date(+y, +mo - 1, +d, h, +mi, +se).getTime();
}

// ── Render lista ──────────────────────────────────────────────────────────────────
function renderList(filter = "") {
  const list = document.getElementById("chat-list");
  const loading = document.getElementById("loading");
  const empty = document.getElementById("empty");
  loading.classList.add("hidden");

  const q = filter.trim().toLowerCase();
  const rows = liveData
    .filter(c => c.sender_id)
    .filter(c => !q || (c.nombre || "").toLowerCase().includes(q))
    .sort((a, b) => fechaMs(b.ultima_vez) - fechaMs(a.ultima_vez));

  const countEl = document.getElementById("chat-count");
  if (countEl) countEl.textContent = rows.length ? `${rows.length}` : "";

  if (!rows.length) { list.innerHTML = ""; empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  list.innerHTML = rows.map(c => {
    const ci = canalInfo(c.canal);
    const hist = parseHistorial(c.historial);
    const on = isOn(c.activado);
    return `
      <div class="chat-row" data-id="${esc(c.sender_id)}">
        <span class="canal-badge canal-badge--${ci.cls}">${ci.svg}</span>
        <div class="chat-row__info">
          <div class="chat-row__name">${esc(c.nombre || "Sin nombre")}</div>
          <div class="chat-row__preview">${esc(lastUserText(hist) || "—")}</div>
        </div>
        <div class="chat-row__meta">
          <span class="chat-row__time">${esc((c.ultima_vez || "").split(",")[0])}</span>
          <span class="ai-pill ai-pill--${on ? "on" : "off"}">IA ${on ? "on" : "off"}</span>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".chat-row").forEach(row => {
    row.addEventListener("click", () => openChat(row.dataset.id));
  });
}

// ── Vista conversación ──────────────────────────────────────────────────────────
function openChat(senderId) {
  const c = liveData.find(x => x.sender_id === senderId);
  if (!c) return;
  currentSenderId = senderId;

  const ci = canalInfo(c.canal);
  document.getElementById("chat-canal").className = `canal-badge canal-badge--${ci.cls}`;
  document.getElementById("chat-canal").innerHTML = ci.svg;
  document.getElementById("chat-nombre").textContent = c.nombre || "Sin nombre";
  document.getElementById("chat-ultima").textContent = `${ci.label} · ${c.ultima_vez || ""}`;

  const toggle = document.getElementById("chat-toggle");
  toggle.checked = isOn(c.activado);

  const conv = document.getElementById("conversation");
  const hist = parseHistorial(c.historial);
  conv.innerHTML = hist.length
    ? hist.map(m => {
      const bot = m.role === "assistant";
      return `<div class="bubble bubble--${bot ? "bot" : "user"}">
          <span class="bubble__role">${bot ? "Bot" : "Cliente"}</span>${esc(m.content)}</div>`;
    }).join("")
    : `<div class="empty">Sin historial de conversación.</div>`;

  showView("view-chat");
  conv.scrollTop = conv.scrollHeight;
}

// ── Toggle IA (optimista) ────────────────────────────────────────────────────────
function toggleAI(senderId, on) {
  const c = liveData.find(x => x.sender_id === senderId);
  if (!c) return;
  const nuevo = on ? "TRUE" : "FALSE";
  c.activado = nuevo;          // memoria
  writeCache(liveData);        // caché
  renderList(document.getElementById("search").value);  // refrescar pill en lista

  postData({ action: "toggle", sender_id: senderId, activado: nuevo })
    .then(() => notify(on ? "IA activada ✓" : "IA desactivada ✓"))
    .catch(() => {
      // rollback
      c.activado = on ? "FALSE" : "TRUE";
      writeCache(liveData);
      document.getElementById("chat-toggle").checked = !on;
      renderList(document.getElementById("search").value);
      notify("Error al guardar", "err");
    });
}

// ── Renombrar chat (optimista) ───────────────────────────────────────────────────
function renameChat(senderId) {
  const c = liveData.find(x => x.sender_id === senderId);
  if (!c) return;
  const actual = (c.nombre || "").trim();
  const raw = prompt("Nombre del cliente:", actual);
  if (raw === null) return;        // canceló
  const nuevo = raw.trim();
  if (nuevo === actual) return;

  const prev = c.nombre;
  c.nombre = nuevo;                 // memoria
  writeCache(liveData);            // caché
  document.getElementById("chat-nombre").textContent = nuevo || "Sin nombre";
  renderList(document.getElementById("search").value);

  postData({ action: "rename", sender_id: senderId, nombre: nuevo })
    .then(() => notify("Nombre guardado ✓"))
    .catch(() => {
      c.nombre = prev;             // rollback
      writeCache(liveData);
      document.getElementById("chat-nombre").textContent = (prev || "").trim() || "Sin nombre";
      renderList(document.getElementById("search").value);
      notify("Error al guardar", "err");
    });
}

// ── Navegación entre vistas ──────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("view--active"));
  document.getElementById(id).classList.add("view--active");
}

// ── Carga de datos ────────────────────────────────────────────────────────────────
async function loadData() {
  const cached = readCache();
  if (cached) { writeCache(cached); renderList(); }

  if (API_URL.startsWith("PEGAR")) {
    document.getElementById("loading").textContent = "Falta configurar API_URL en app.js";
    return;
  }
  try {
    const fresh = await fetchJSONP(API_URL);
    const changed = JSON.stringify(fresh) !== JSON.stringify(liveData);
    writeCache(fresh);
    if (!cached || changed) renderList(document.getElementById("search").value);
  } catch (e) {
    if (!cached) document.getElementById("loading").textContent = "Error al cargar. Revisa la conexión.";
    notify("Error al actualizar", "err");
  }
}

// ── Notificación pill ────────────────────────────────────────────────────────────
function notify(msg, type = "ok") {
  let pill = document.getElementById("notif-pill");
  if (!pill) { pill = document.createElement("div"); pill.id = "notif-pill"; document.body.appendChild(pill); }
  pill.textContent = msg;
  pill.dataset.type = type;
  pill.style.opacity = "1";
  clearTimeout(pill._timer);
  pill._timer = setTimeout(() => { pill.style.opacity = "0"; }, 2500);
}

// ── Instalación PWA ────────────────────────────────────────────────────────────────
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById("btn-install").classList.remove("hidden");
});

// ── Wiring ──────────────────────────────────────────────────────────────────────────
document.getElementById("btn-back").addEventListener("click", () => showView("view-list"));
document.getElementById("chat-nombre").addEventListener("click", () => {
  if (currentSenderId) renameChat(currentSenderId);
});
document.getElementById("btn-refresh").addEventListener("click", loadData);
document.getElementById("search").addEventListener("input", (e) => renderList(e.target.value));
document.getElementById("chat-toggle").addEventListener("change", (e) => {
  if (currentSenderId) toggleAI(currentSenderId, e.target.checked);
});
document.getElementById("btn-install").addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById("btn-install").classList.add("hidden");
});

const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (standalone) document.getElementById("btn-install").classList.add("hidden");

loadData();
