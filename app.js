/* ===========================================================================
   Daily Check-in — a simple end-of-day mood journal.
   Pick how you're feeling, choose moods, rate them, add a note.
   Plain HTML/CSS/JS + PouchDB (IndexedDB). Local-only. No server, no build.
   =========================================================================== */

"use strict";

const db = new PouchDB("checkins");

let CATALOG = null;
const state = {
  tab: "today",
  valence: null,          // 1..5
  moods: {},              // { name: rating(1..5) }
  note: "",
};

/* ---- helpers ------------------------------------------------------------ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const scaleFor = (v) => CATALOG.scale.find((s) => s.v === v);
const toneColor = (t) => (t === "pleasant" ? "#57C79A" : t === "unpleasant" ? "#8C7BF0" : "#7F8C99");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 1900);
}

/* ---- data --------------------------------------------------------------- */
async function saveCheckin() {
  if (!state.valence) { toast("Pick how you're feeling first"); return; }
  const now = new Date();
  const doc = {
    _id: `checkin_${now.getTime()}`,
    type: "checkin",
    ts: now.getTime(),
    date: now.toISOString(),
    day: dayKey(now),
    valence: state.valence,
    moods: Object.entries(state.moods).map(([name, rating]) => ({ name, rating })),
    note: state.note.trim(),
  };
  await db.put(doc);
  state.valence = null; state.moods = {}; state.note = "";
  toast("Checked in 💜");
  render();
}

async function allCheckins() {
  const res = await db.allDocs({
    include_docs: true, startkey: "checkin_", endkey: "checkin_￰",
  });
  return res.rows.map((r) => r.doc).sort((a, b) => b.ts - a.ts);
}

async function deleteCheckin(id) {
  const d = await db.get(id); await db.remove(d);
}

function streak(entries) {
  if (!entries.length) return 0;
  const days = new Set(entries.map((e) => e.day));
  let n = 0; const d = new Date();
  // allow the streak to count from today or yesterday
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/* =========================================================================
   CHECK-IN SCREEN
   ========================================================================= */
async function renderToday() {
  const view = $("#view");
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const entries = await allCheckins();
  const st = streak(entries);
  const doneToday = entries.some((e) => e.day === dayKey(now));

  const faces = CATALOG.scale.map((s) => `
    <button class="face ${state.valence === s.v ? "sel" : ""}" data-v="${s.v}" style="--fc:${s.color}">
      <span class="face-emoji">${s.emoji}</span>
      <span class="face-label">${esc(s.label)}</span>
    </button>`).join("");

  const chips = CATALOG.moods.map((m) => `
    <button class="chip ${state.moods[m.name] != null ? "sel" : ""}" data-mood="${esc(m.name)}" style="--tc:${toneColor(m.tone)}">${esc(m.name)}</button>`).join("");

  const selected = Object.keys(state.moods);
  const ratingsBlock = selected.length ? `
    <div class="section-label">How strong? <span class="hint">tap the dots</span></div>
    <div class="card ratings">
      ${selected.map((name) => `
        <div class="rating-row">
          <span class="rr-name">${esc(name)}</span>
          <div class="dots" data-mood="${esc(name)}">
            ${[1, 2, 3, 4, 5].map((i) => `<button class="dot ${i <= state.moods[name] ? "on" : ""}" data-r="${i}"></button>`).join("")}
          </div>
        </div>`).join("")}
    </div>` : "";

  view.innerHTML = `
    <div class="lg-head">
      <div class="lg-sub">${esc(dateStr)}${st ? ` · 🔥 ${st}-day streak` : ""}</div>
      <h1>How are you feeling?</h1>
    </div>

    <div class="faces">${faces}</div>

    <div class="section-label">What's contributing? <span class="hint">optional</span></div>
    <div class="card"><div class="chips">${chips}</div></div>

    ${ratingsBlock}

    <div class="section-label">Notes <span class="hint">optional</span></div>
    <div class="card note-card">
      <textarea id="note" rows="4" placeholder="Anything on your mind about today?">${esc(state.note)}</textarea>
    </div>

    <button class="save-btn ${state.valence ? "" : "disabled"}" id="saveBtn">${doneToday ? "Add another check-in" : "Save today's check-in"}</button>

    ${entries.length ? recentPeek(entries.slice(0, 3)) : `<p class="empty-note">Your check-ins will show up here and in History.</p>`}
  `;

  wireToday();
}

function recentPeek(entries) {
  return `
    <div class="section-label">Recent</div>
    <div class="card list-card">
      ${entries.map((e) => entryRow(e, true)).join("")}
    </div>`;
}

function wireToday() {
  const view = $("#view");
  view.querySelectorAll(".face").forEach((b) => {
    b.onclick = () => { state.valence = Number(b.dataset.v); renderToday(); };
  });
  view.querySelectorAll(".chip").forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.mood;
      if (state.moods[name] != null) delete state.moods[name];
      else state.moods[name] = 3;   // default intensity
      renderToday();
    };
  });
  view.querySelectorAll(".dots").forEach((row) => {
    row.querySelectorAll(".dot").forEach((d) => {
      d.onclick = () => { state.moods[row.dataset.mood] = Number(d.dataset.r); renderToday(); };
    });
  });
  const note = $("#note", view);
  if (note) note.oninput = () => { state.note = note.value; };
  $("#saveBtn", view).onclick = () => { if (state.valence) saveCheckin(); else toast("Pick how you're feeling first"); };
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
        <div class="empty-emoji">🗒️</div>
        <p>No check-ins yet. Head to <b>Check-in</b> and log how today felt.</p>
      </div>`;
    return;
  }

  const st = streak(entries);
  const last14 = trend(entries, 14);

  view.innerHTML = `
    <div class="lg-head"><h1>History</h1></div>

    <div class="card summary-card">
      <div class="stat"><div class="stat-num">${entries.length}</div><div class="stat-lbl">check-ins</div></div>
      <div class="stat"><div class="stat-num">${st}</div><div class="stat-lbl">day streak</div></div>
      <div class="stat"><div class="stat-num">${avgValence(entries)}</div><div class="stat-lbl">avg mood</div></div>
    </div>

    <div class="section-label">Last 2 weeks</div>
    <div class="card trend-card">${trendBars(last14)}</div>

    <div class="section-label">All check-ins</div>
    <div class="card list-card">
      ${entries.map((e) => entryRow(e, false)).join("")}
    </div>

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
  const s = scaleFor(e.valence) || {};
  const moods = (e.moods || []).map((m) => `<span class="tag">${esc(m.name)}${m.rating ? ` <b>${m.rating}</b>` : ""}</span>`).join("");
  const when = new Date(e.ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = new Date(e.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `
    <div class="entry">
      <div class="entry-emoji" title="${esc(s.label || "")}">${s.emoji || "•"}</div>
      <div class="entry-main">
        <div class="entry-head"><span class="entry-when">${when}</span><span class="entry-time">${time}</span></div>
        <div class="entry-mood-label" style="color:${s.color || "var(--muted)"}">${esc(s.label || "")}</div>
        ${moods ? `<div class="entry-tags">${moods}</div>` : ""}
        ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ""}
      </div>
      ${compact ? "" : `<button class="del-btn" data-id="${e._id}" title="Delete">✕</button>`}
    </div>`;
}

function avgValence(entries) {
  const a = entries.reduce((s, e) => s + e.valence, 0) / entries.length;
  return (scaleFor(Math.round(a)) || {}).emoji || a.toFixed(1);
}

function trend(entries, days) {
  const byDay = {};
  entries.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e.valence); });
  const out = [];
  const d = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const dd = new Date(d); dd.setDate(d.getDate() - i);
    const key = dayKey(dd);
    const vals = byDay[key];
    out.push({ key, label: dd.getDate(), avg: vals ? vals.reduce((a, b) => a + b, 0) / vals.length : null, dow: dd.getDay() });
  }
  return out;
}

function trendBars(data) {
  return `<div class="trend">${data.map((d) => {
    if (d.avg == null) return `<span class="tb empty" title="${d.key}: no check-in"></span>`;
    const s = scaleFor(Math.round(d.avg)) || {};
    const h = 20 + (d.avg / 5) * 80;
    return `<span class="tb" style="height:${h}%;background:${s.color}" title="${d.key}: ${s.label}"></span>`;
  }).join("")}</div>`;
}

/* ---- export / import ---------------------------------------------------- */
async function exportData(entries) {
  const blob = new Blob([JSON.stringify({ app: "daily-checkin", exported: new Date().toISOString(), checkins: entries }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `checkins-${dayKey(new Date())}.json`; a.click();
  URL.revokeObjectURL(url); toast("Exported");
}

async function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    let n = 0;
    for (const c of (data.checkins || [])) {
      if (c.valence == null) continue;
      const ts = c.ts || Date.parse(c.date) || Date.now();
      const doc = { _id: `checkin_${ts}`, type: "checkin", ts, date: new Date(ts).toISOString(), day: dayKey(new Date(ts)), valence: c.valence, moods: c.moods || [], note: c.note || "" };
      try { await db.put(doc); n += 1; } catch (_) { /* skip dupes */ }
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
