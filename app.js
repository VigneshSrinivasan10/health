/* ===========================================================================
   Daily Check-in — rate your emotions at the end of the day.
   A list of emotions, each with a 1–5 intensity rating, plus an optional note.
   Plain HTML/CSS/JS + PouchDB (IndexedDB). Local-only. No server, no build.
   =========================================================================== */

"use strict";

const db = new PouchDB("checkins");

let CATALOG = null;
const state = {
  tab: "today",
  ratings: {},   // { emotionName: 1..5 }
  note: "",
  segment: null, // morning | afternoon | evening (defaults to now)
  date: null,    // day being logged (YYYY-MM-DD, defaults to today)
  filter: "all", // history filter by segment
  editId: null,  // _id of the check-in being edited (null = new)
  editTs: null,  // its original timestamp, for the banner
};

/* time-of-day segments */
const SEGMENTS = [
  { id: "morning", label: "Morning", start: 0, end: 12, color: "#E8952E" },
  { id: "afternoon", label: "Afternoon", start: 12, end: 17, color: "#2FA8D8" },
  { id: "evening", label: "Evening", start: 17, end: 24, color: "#7A5AF8" },
];
const SEG_ICON = {
  morning: '<path d="M12 4v2M5.5 10.5 7 12M18.5 10.5 17 12M3 17h18M7.5 17a4.5 4.5 0 0 1 9 0M9 21h6"/>',
  afternoon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  evening: '<path d="M20 14.5A7.5 7.5 0 1 1 9.5 4a6 6 0 0 0 10.5 10.5z"/>',
};
const segFromHour = (h) => SEGMENTS.find((s) => h >= s.start && h < s.end) || SEGMENTS[2];
const segFor = (id) => SEGMENTS.find((s) => s.id === id) || SEGMENTS[2];
const currentSegId = () => segFromHour(new Date().getHours()).id;
const entrySeg = (e) => e.segment || segFromHour(new Date(e.ts).getHours()).id;
function segChip(id) {
  const s = segFor(id);
  return `<span class="seg-badge" style="--sc:${s.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SEG_ICON[id]}</svg>${s.label}</span>`;
}

/* ---- helpers ------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const keyToDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const prettyDate = (k) => keyToDate(k).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const SEG_HOUR = { morning: 9, afternoon: 14, evening: 20 };
const toneOf = (name) => (CATALOG.moods.find((m) => m.name === name) || {}).tone || "neutral";
const toneColor = (t) => (t === "pleasant" ? "#3CC28B" : t === "unpleasant" ? "#8C7BF0" : "#7F8C99");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1900);
}

/* ---- data --------------------------------------------------------------- */
async function saveCheckin() {
  const rated = Object.entries(state.ratings).filter(([, r]) => r > 0);
  if (!rated.length) { toast("Rate at least one emotion first"); return; }
  const emotions = rated.map(([name, rating]) => ({ name, rating, tone: toneOf(name) }));

  if (state.editId) {
    // update the existing check-in in place (keep its original date/time)
    const doc = await db.get(state.editId);
    doc.emotions = emotions;
    doc.note = state.note.trim();
    doc.segment = state.segment || currentSegId();
    await db.put(doc);
    clearDraft();
    toast("Updated ✓");
    state.tab = "history";
    render();
    return;
  }

  const seg = state.segment || currentSegId();
  const todayK = dayKey(new Date());
  const chosen = state.date || todayK;
  // today → keep the real current time; a past day → put it at the segment's hour
  const when = chosen === todayK ? new Date() : (() => { const d = keyToDate(chosen); d.setHours(SEG_HOUR[seg] || 20, 0, 0, 0); return d; })();
  const ts = when.getTime();
  await db.put({
    _id: `checkin_${ts}_${Math.random().toString(36).slice(2, 6)}`,
    type: "checkin",
    ts,
    date: when.toISOString(),
    day: dayKey(when),
    segment: seg,
    emotions,
    note: state.note.trim(),
  });
  clearDraft();
  toast(chosen === todayK ? "Checked in 💜" : `Logged for ${prettyDate(chosen)} ✓`);
  render();
}

function clearDraft() {
  state.ratings = {}; state.note = ""; state.segment = currentSegId();
  state.date = dayKey(new Date());
  state.editId = null; state.editTs = null;
}

async function loadForEdit(id) {
  const doc = await db.get(id);
  state.editId = id;
  state.editTs = doc.ts;
  state.ratings = {};
  (doc.emotions || []).forEach((m) => { state.ratings[m.name] = m.rating; });
  state.note = doc.note || "";
  state.segment = entrySeg(doc);
  state.tab = "today";
  render();
}

function cancelEdit() {
  clearDraft();
  state.tab = "history";
  render();
}

async function allCheckins() {
  const res = await db.allDocs({ include_docs: true, startkey: "checkin_", endkey: "checkin_￰" });
  return res.rows.map((r) => r.doc).sort((a, b) => b.ts - a.ts);
}

async function deleteCheckin(id) { const d = await db.get(id); await db.remove(d); }

function streak(entries) {
  if (!entries.length) return 0;
  const days = new Set(entries.map((e) => e.day));
  let n = 0; const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/* net emotional balance for a check-in: pleasant adds, unpleasant subtracts */
function netScore(emotions) {
  return (emotions || []).reduce((s, e) => {
    const t = e.tone || toneOf(e.name);
    return s + (t === "pleasant" ? e.rating : t === "unpleasant" ? -e.rating : 0);
  }, 0);
}

/* =========================================================================
   CHECK-IN SCREEN — the emotions dashboard
   ========================================================================= */
function ratingDots(name) {
  const cur = state.ratings[name] || 0;
  return `<div class="dots" data-emo="${esc(name)}">
    ${[1, 2, 3, 4, 5].map((i) => `<button class="dot ${i <= cur ? "on" : ""}" data-r="${i}" style="--dc:${toneColor(toneOf(name))}"></button>`).join("")}
  </div>`;
}

/* board: tap an emotion to pick it */
function emotionGroup(label, tone) {
  const list = CATALOG.moods.filter((m) => m.tone === tone);
  if (!list.length) return "";
  return `
    <div class="group-label" style="color:${toneColor(tone)}">${label}</div>
    <div class="card chip-card"><div class="chips">
      ${list.map((m) => `<button class="chip ${state.ratings[m.name] != null ? "sel" : ""}" data-emo="${esc(m.name)}" style="--tc:${toneColor(tone)}">${esc(m.name)}</button>`).join("")}
    </div></div>`;
}

/* the picked emotions, with their 1–5 level dots, gathered at the bottom */
function selectedLevels() {
  const picked = CATALOG.moods.filter((m) => state.ratings[m.name] != null);
  if (!picked.length) return "";
  return `
    <div class="group-label">How strong? <span class="hint">tap the dots</span></div>
    <div class="card rating-card">
      ${picked.map((m) => `
        <div class="rate-row active">
          <span class="rr-name">${esc(m.name)}</span>
          ${ratingDots(m.name)}
        </div>`).join("")}
    </div>`;
}

async function renderToday() {
  const view = $("#view");
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const entries = await allCheckins();
  const st = streak(entries);
  const count = Object.values(state.ratings).filter((r) => r > 0).length;
  if (!state.segment) state.segment = currentSegId();

  const segTabs = SEGMENTS.map((s) => `
    <button class="seg ${state.segment === s.id ? "active" : ""}" data-seg="${s.id}" style="--sc:${s.color}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SEG_ICON[s.id]}</svg>
      ${s.label}
    </button>`).join("");

  const editing = !!state.editId;
  const editWhen = editing ? new Date(state.editTs).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "";
  const todayK = dayKey(now);
  const yesterK = dayKey(addDays(now, -1));
  if (!state.date) state.date = todayK;
  const backdating = !editing && state.date !== todayK;
  const customDate = state.date !== todayK && state.date !== yesterK;

  const shortDate = customDate ? keyToDate(state.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const dateRow = editing ? "" : `
    <div class="group-label">When</div>
    <div class="date-row">
      <button class="date-quick ${state.date === todayK ? "active" : ""}" data-d="${todayK}">Today</button>
      <button class="date-quick ${state.date === yesterK ? "active" : ""}" data-d="${yesterK}">Yesterday</button>
      <label class="date-other ${customDate ? "active" : ""}" title="Pick a date">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 3v3M16 3v3"/></svg>
        ${shortDate ? `<span>${esc(shortDate)}</span>` : ""}
        <input type="date" id="dateInput" max="${todayK}" value="${state.date}" />
      </label>
    </div>`;

  view.innerHTML = `
    <div class="lg-head">
      <div class="lg-sub">${editing ? "Editing a check-in" : backdating ? `Logging for ${esc(prettyDate(state.date))}` : esc(dateStr) + (st ? ` · 🔥 ${st}-day streak` : "")}</div>
      <h1>${editing ? "Edit check-in" : "How are you feeling?"}</h1>
      <p class="lead">Tap the emotions you're feeling, then set how strong each one is.</p>
    </div>

    ${editing ? `<div class="edit-banner"><span>${esc(editWhen)}</span><button id="cancelEdit">Cancel</button></div>` : ""}

    ${dateRow}

    <div class="group-label">Time of day</div>
    <div class="seg-tabs">${segTabs}</div>

    ${emotionGroup("Pleasant", "pleasant")}
    ${emotionGroup("Neutral", "neutral")}
    ${emotionGroup("Difficult", "unpleasant")}

    ${selectedLevels()}

    <div class="group-label">Notes <span class="hint">optional</span></div>
    <div class="card note-card">
      <textarea id="note" rows="4" placeholder="Anything on your mind about today?">${esc(state.note)}</textarea>
    </div>

    <button class="save-btn ${count ? "" : "disabled"}" id="saveBtn">${editing ? "Save changes" : "Save"}</button>

    ${!editing && entries.length ? `
      <div class="group-label">Recent</div>
      <div class="card list-card">${entries.slice(0, 3).map((e) => entryRow(e, true)).join("")}</div>` : ""}
  `;
  wireToday();
}

function wireToday() {
  const view = $("#view");
  view.querySelectorAll(".date-quick").forEach((b) => {
    b.onclick = () => { state.date = b.dataset.d; renderToday(); };
  });
  const dateInput = $("#dateInput", view);
  if (dateInput) dateInput.onchange = () => { if (dateInput.value) { state.date = dateInput.value; renderToday(); } };
  view.querySelectorAll(".seg").forEach((b) => {
    b.onclick = () => {
      state.segment = b.dataset.seg;
      view.querySelectorAll(".seg").forEach((x) => x.classList.toggle("active", x === b));
    };
  });
  view.querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.emo;
      if (state.ratings[name] != null) delete state.ratings[name];   // tap again to remove
      else state.ratings[name] = 3;                                  // default middle level
      renderToday();
    };
  });
  view.querySelectorAll(".dots").forEach((row) => {
    const name = row.dataset.emo;
    row.querySelectorAll(".dot").forEach((d) => {
      d.onclick = () => { state.ratings[name] = Number(d.dataset.r); renderToday(); };
    });
  });
  const note = $("#note", view);
  if (note) note.oninput = () => { state.note = note.value; };
  $("#saveBtn", view).onclick = saveCheckin;
  const cancel = $("#cancelEdit", view);
  if (cancel) cancel.onclick = cancelEdit;
}

/* =========================================================================
   HISTORY SCREEN
   ========================================================================= */
async function renderHistory() {
  const view = $("#view");
  const entries = await allCheckins();

  if (!entries.length) {
    view.innerHTML = `
      <div class="lg-head"><h1>History</h1></div>
      <div class="card empty-card">
        <div class="empty-emoji">📊</div>
        <p>No check-ins yet. Head to <b>Check-in</b> and rate how today felt.</p>
      </div>`;
    return;
  }

  const st = streak(entries);
  const filtered = state.filter === "all" ? entries : entries.filter((e) => entrySeg(e) === state.filter);
  view.innerHTML = `
    <div class="lg-head"><h1>History</h1></div>

    <div class="card summary-card">
      <div class="stat"><div class="stat-num">${entries.length}</div><div class="stat-lbl">check-ins</div></div>
      <div class="stat"><div class="stat-num">${st}</div><div class="stat-lbl">day streak</div></div>
      <div class="stat"><div class="stat-num small">${esc(topEmotion(entries))}</div><div class="stat-lbl">most rated</div></div>
    </div>

    <div class="group-label">Mood balance <span class="hint">last 2 weeks</span></div>
    <div class="card trend-card">${trendBars(trend(entries, 14))}<div class="trend-legend"><span><i style="background:${toneColor("pleasant")}"></i>pleasant</span><span><i style="background:${toneColor("unpleasant")}"></i>difficult</span></div></div>

    <div class="group-label">All check-ins <span class="hint">tap an entry to edit</span></div>
    <div class="filter-row" id="filterRow">
      ${[{ id: "all", label: "All" }, ...SEGMENTS].map((s) => `<button class="filter-chip ${state.filter === s.id ? "active" : ""}" data-f="${s.id}">${s.label}</button>`).join("")}
    </div>
    <div class="card list-card">${filtered.length ? filtered.map((e) => entryRow(e, false)).join("") : `<div class="entry"><div class="entry-main"><div class="entry-note" style="margin:6px 0">No ${state.filter} check-ins yet.</div></div></div>`}</div>

    <div class="tools">
      <button class="tool-btn" id="exportBtn">Export</button>
      <button class="tool-btn" id="importBtn">Import</button>
    </div>
    <input type="file" id="importFile" accept="application/json" style="display:none" />
    <p class="foot-note">Local-only · your journal is stored on this device and never leaves it.</p>
  `;

  view.querySelectorAll(".filter-chip").forEach((b) => {
    b.onclick = () => { state.filter = b.dataset.f; renderHistory(); };
  });
  view.querySelectorAll(".entry.editable").forEach((row) => {
    row.onclick = () => loadForEdit(row.dataset.eid);
  });
  view.querySelectorAll(".del-btn").forEach((b) => {
    b.onclick = async (e) => { e.stopPropagation(); await deleteCheckin(b.dataset.id); toast("Deleted"); renderHistory(); };
  });
  $("#exportBtn").onclick = () => exportData(entries);
  $("#importBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = importData;
}

function entryRow(e, compact) {
  const emos = (e.emotions || []).slice().sort((a, b) => b.rating - a.rating);
  const tags = emos.map((m) => `<span class="tag" style="--tc:${toneColor(m.tone || toneOf(m.name))}">${esc(m.name)} <b>${m.rating}</b></span>`).join("");
  const when = new Date(e.ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = new Date(e.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const net = netScore(e.emotions);
  const netCls = net > 0 ? "pos" : net < 0 ? "neg" : "neu";
  return `
    <div class="entry ${compact ? "" : "editable"}" ${compact ? "" : `data-eid="${e._id}"`}>
      <div class="entry-main">
        <div class="entry-head">
          <span class="entry-when">${when}</span>
          ${segChip(entrySeg(e))}
          <span class="entry-time">${time}</span>
          <span class="net ${netCls}">${net > 0 ? "+" : ""}${net}</span>
        </div>
        ${tags ? `<div class="entry-tags">${tags}</div>` : ""}
        ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ""}
      </div>
      ${compact ? "" : `<button class="del-btn" data-id="${e._id}" title="Delete">✕</button>`}
    </div>`;
}

function topEmotion(entries) {
  const totals = {};
  entries.forEach((e) => (e.emotions || []).forEach((m) => { totals[m.name] = (totals[m.name] || 0) + m.rating; }));
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : "—";
}

function trend(entries, days) {
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(netScore(e.emotions)); });
  const out = []; const d = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const dd = new Date(d); dd.setDate(d.getDate() - i);
    const key = dayKey(dd); const nets = byDay[key];
    out.push({ key, net: nets ? nets.reduce((a, b) => a + b, 0) / nets.length : null });
  }
  return out;
}

/* diverging bar chart around a center line */
function trendBars(data) {
  const maxAbs = Math.max(4, ...data.map((d) => Math.abs(d.net || 0)));
  return `<div class="trend">${data.map((d) => {
    if (d.net == null) return `<span class="tcol"><span class="tb empty"></span></span>`;
    const frac = Math.min(1, Math.abs(d.net) / maxAbs);
    const h = 6 + frac * 44; // px from center
    const up = d.net >= 0;
    const color = up ? toneColor("pleasant") : toneColor("unpleasant");
    return `<span class="tcol" title="${d.key}: ${d.net > 0 ? "+" : ""}${d.net.toFixed(1)}">
      <span class="tb ${up ? "up" : "spacer"}" style="${up ? `height:${h}px;background:${color}` : ""}"></span>
      <span class="tb ${up ? "spacer" : "down"}" style="${up ? "" : `height:${h}px;background:${color}`}"></span>
    </span>`;
  }).join("")}</div>`;
}

/* ---- export / import ---------------------------------------------------- */
async function exportData(entries) {
  const blob = new Blob([JSON.stringify({ app: "daily-checkin", exported: new Date().toISOString(), checkins: entries }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `checkins-${dayKey(new Date())}.json`; a.click();
  URL.revokeObjectURL(url); toast("Exported");
}

async function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let n = 0;
    for (const c of (data.checkins || [])) {
      const emotions = c.emotions || [];
      if (!emotions.length) continue;
      const ts = c.ts || Date.parse(c.date) || Date.now();
      try {
        await db.put({ _id: `checkin_${ts}`, type: "checkin", ts, date: new Date(ts).toISOString(), day: dayKey(new Date(ts)), segment: c.segment || segFromHour(new Date(ts).getHours()).id, emotions, note: c.note || "" });
        n += 1;
      } catch (_) { /* skip dupes */ }
    }
    toast(`Imported ${n} check-ins`); renderHistory();
  } catch (err) { toast("Could not read that file"); }
}

/* =========================================================================
   ROUTER / BOOT
   ========================================================================= */
function render() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === state.tab));
  if (state.tab === "today") renderToday(); else renderHistory();
  $("#view").scrollTop = 0;
}

async function boot() {
  CATALOG = await (await fetch("./data/moods.json")).json();
  document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => { state.tab = t.dataset.tab; render(); }; });
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

boot();
