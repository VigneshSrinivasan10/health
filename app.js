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
};

/* ---- helpers ------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const now = new Date();
  await db.put({
    _id: `checkin_${now.getTime()}`,
    type: "checkin",
    ts: now.getTime(),
    date: now.toISOString(),
    day: dayKey(now),
    emotions: rated.map(([name, rating]) => ({ name, rating, tone: toneOf(name) })),
    note: state.note.trim(),
  });
  state.ratings = {}; state.note = "";
  toast("Checked in 💜");
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

function emotionGroup(label, tone) {
  const list = CATALOG.moods.filter((m) => m.tone === tone);
  if (!list.length) return "";
  return `
    <div class="group-label" style="color:${toneColor(tone)}">${label}</div>
    <div class="card rating-card">
      ${list.map((m) => `
        <div class="rate-row ${state.ratings[m.name] ? "active" : ""}">
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
  const doneToday = entries.some((e) => e.day === dayKey(now));
  const count = Object.values(state.ratings).filter((r) => r > 0).length;

  view.innerHTML = `
    <div class="lg-head">
      <div class="lg-sub">${esc(dateStr)}${st ? ` · 🔥 ${st}-day streak` : ""}</div>
      <h1>How are you feeling?</h1>
      <p class="lead">Rate how strongly you feel each emotion today. Skip the ones that don't apply.</p>
    </div>

    ${emotionGroup("Pleasant", "pleasant")}
    ${emotionGroup("Neutral", "neutral")}
    ${emotionGroup("Difficult", "unpleasant")}

    <div class="group-label">Notes <span class="hint">optional</span></div>
    <div class="card note-card">
      <textarea id="note" rows="4" placeholder="Anything on your mind about today?">${esc(state.note)}</textarea>
    </div>

    <button class="save-btn ${count ? "" : "disabled"}" id="saveBtn">
      ${count ? `Save check-in${count ? ` · ${count} rated` : ""}` : "Rate an emotion to save"}
    </button>

    ${entries.length ? `
      <div class="group-label">Recent</div>
      <div class="card list-card">${entries.slice(0, 3).map((e) => entryRow(e, true)).join("")}</div>` : ""}
  `;
  wireToday();
}

function wireToday() {
  const view = $("#view");
  view.querySelectorAll(".dots").forEach((row) => {
    const name = row.dataset.emo;
    row.querySelectorAll(".dot").forEach((d) => {
      d.onclick = () => {
        const r = Number(d.dataset.r);
        state.ratings[name] = (state.ratings[name] === r) ? 0 : r;  // tap same value to clear
        if (state.ratings[name] === 0) delete state.ratings[name];
        renderToday();
      };
    });
  });
  const note = $("#note", view);
  if (note) note.oninput = () => { state.note = note.value; };
  $("#saveBtn", view).onclick = saveCheckin;
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
  view.innerHTML = `
    <div class="lg-head"><h1>History</h1></div>

    <div class="card summary-card">
      <div class="stat"><div class="stat-num">${entries.length}</div><div class="stat-lbl">check-ins</div></div>
      <div class="stat"><div class="stat-num">${st}</div><div class="stat-lbl">day streak</div></div>
      <div class="stat"><div class="stat-num small">${esc(topEmotion(entries))}</div><div class="stat-lbl">most rated</div></div>
    </div>

    <div class="group-label">Mood balance <span class="hint">last 2 weeks</span></div>
    <div class="card trend-card">${trendBars(trend(entries, 14))}<div class="trend-legend"><span><i style="background:${toneColor("pleasant")}"></i>pleasant</span><span><i style="background:${toneColor("unpleasant")}"></i>difficult</span></div></div>

    <div class="group-label">All check-ins</div>
    <div class="card list-card">${entries.map((e) => entryRow(e, false)).join("")}</div>

    <div class="tools">
      <button class="tool-btn" id="exportBtn">Export</button>
      <button class="tool-btn" id="importBtn">Import</button>
    </div>
    <input type="file" id="importFile" accept="application/json" style="display:none" />
    <p class="foot-note">Local-only · your journal is stored on this device and never leaves it.</p>
  `;

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
    <div class="entry">
      <div class="entry-main">
        <div class="entry-head">
          <span class="entry-when">${when}</span><span class="entry-time">${time}</span>
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
        await db.put({ _id: `checkin_${ts}`, type: "checkin", ts, date: new Date(ts).toISOString(), day: dayKey(new Date(ts)), emotions, note: c.note || "" });
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
