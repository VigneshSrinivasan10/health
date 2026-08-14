/* ===========================================================================
   Health — a local-only recreation of the Apple Health app.
   Plain HTML/CSS/JS + PouchDB (IndexedDB). No build step, no server, no CDN.
   All data lives in your browser and never leaves this device.
   =========================================================================== */

"use strict";

const db = new PouchDB("health");

/* ---- app state ---------------------------------------------------------- */
const state = {
  tab: "summary",
  nav: [],            // detail navigation stack
  period: "W",        // D | W | M | 6M | Y  (per open metric)
  add: null,          // metric id currently being logged
};

let CATALOG = null;   // loaded from data/metrics.json
const M = (id) => CATALOG.metrics[id];

/* ---- small helpers ------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const rand = (min, max) => min + Math.random() * (max - min);

function fmtNum(v, precision = 0) {
  if (v == null || isNaN(v)) return "—";
  const r = Number(v).toFixed(precision);
  const [int, dec] = r.split(".");
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? `${withSep}.${dec}` : withSep;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1900);
}

function localDatetimeValue(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---- data layer --------------------------------------------------------- */
async function addSample(metricId, value, when = new Date()) {
  const ts = when.getTime();
  const id = `sample_${metricId}_${ts}_${Math.random().toString(36).slice(2, 7)}`;
  await db.put({ _id: id, type: "sample", metric: metricId, value: Number(value), ts, date: when.toISOString() });
}

async function samplesFor(metricId, sinceTs = 0) {
  const res = await db.allDocs({
    include_docs: true,
    startkey: `sample_${metricId}_`,
    endkey: `sample_${metricId}_￰`,
  });
  return res.rows
    .map((r) => r.doc)
    .filter((d) => d && d.ts >= sinceTs)
    .sort((a, b) => a.ts - b.ts);
}

async function deleteSample(id) {
  const doc = await db.get(id);
  await db.remove(doc);
}

/* Aggregate a set of samples into a single figure per the metric's rule. */
function aggregate(samples, agg) {
  if (!samples.length) return null;
  const vals = samples.map((s) => s.value);
  if (agg === "sum") return vals.reduce((a, b) => a + b, 0);
  if (agg === "latest") return samples[samples.length - 1].value;
  return vals.reduce((a, b) => a + b, 0) / vals.length; // avg
}

/* Value shown for a metric "today" (or most recent, for latest-type). */
async function currentValue(metricId) {
  const def = M(metricId);
  if (def.agg === "latest") {
    const all = await samplesFor(metricId);
    return all.length ? { value: all[all.length - 1].value, when: all[all.length - 1].ts } : null;
  }
  const today = startOfDay(new Date()).getTime();
  const todays = await samplesFor(metricId, today);
  if (!todays.length) {
    // fall back to the most recent day that has data
    const all = await samplesFor(metricId);
    if (!all.length) return null;
    const lastDay = startOfDay(all[all.length - 1].ts).getTime();
    const grp = all.filter((s) => s.ts >= lastDay);
    return { value: aggregate(grp, def.agg), when: all[all.length - 1].ts, stale: true };
  }
  return { value: aggregate(todays, def.agg), when: todays[todays.length - 1].ts };
}

/* ---- period bucketing --------------------------------------------------- */
function buckets(period) {
  const now = new Date();
  const list = [];
  if (period === "D") {
    const base = startOfDay(now);
    for (let h = 0; h < 24; h += 1) {
      const start = new Date(base); start.setHours(h);
      const end = new Date(base); end.setHours(h + 1);
      list.push({ start: start.getTime(), end: end.getTime(), label: h % 6 === 0 ? (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`) : "" });
    }
  } else if (period === "W") {
    for (let i = 6; i >= 0; i -= 1) {
      const s = startOfDay(addDays(now, -i));
      list.push({ start: s.getTime(), end: addDays(s, 1).getTime(), label: "SMTWTFS"[s.getDay()] });
    }
  } else if (period === "M") {
    for (let i = 29; i >= 0; i -= 1) {
      const s = startOfDay(addDays(now, -i));
      list.push({ start: s.getTime(), end: addDays(s, 1).getTime(), label: i % 7 === 0 ? String(s.getDate()) : "" });
    }
  } else if (period === "6M") {
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 5; i >= 0; i -= 1) {
      const s = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const e = new Date(base.getFullYear(), base.getMonth() - i + 1, 1);
      list.push({ start: s.getTime(), end: e.getTime(), label: "JFMAMJJASOND"[s.getMonth()] });
    }
  } else { // Y
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 11; i >= 0; i -= 1) {
      const s = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const e = new Date(base.getFullYear(), base.getMonth() - i + 1, 1);
      list.push({ start: s.getTime(), end: e.getTime(), label: i % 2 === 0 ? "JFMAMJJASOND"[s.getMonth()] : "" });
    }
  }
  return list;
}

function bucketize(samples, bks, agg) {
  return bks.map((b) => {
    const inb = samples.filter((s) => s.ts >= b.start && s.ts < b.end);
    return { ...b, value: inb.length ? aggregate(inb, agg === "sum" ? "sum" : agg === "latest" ? "latest" : "avg") : null, count: inb.length };
  });
}

/* =========================================================================
   RENDERING
   ========================================================================= */
function icon(name, color) {
  const paths = {
    flame: '<path d="M12 2c1.5 3.5-1 5-1 7 0 1.4.9 2.3 2 2.3 1.4 0 2-1.2 1.8-2.6C17.6 11 19 13 19 15.5 19 19 16 22 12 22S5 19 5 15.5C5 10 10 8 12 2z"/>',
    heart: '<path d="M12 20s-6.5-4.2-9-8C1.5 9 2.6 5.5 6 5.5c1.8 0 2.9 1 3.5 2 .6-1 1.7-2 3.5-2 3.4 0 4.5 3.5 3 6.5-2.5 3.8-9 8-9 8z"/>',
    body: '<circle cx="12" cy="5" r="2.4"/><path d="M12 8v7m0 0-3 5m3-5 3 5M7 11h10"/>',
    fork: '<path d="M8 3v7a2 2 0 0 0 2 2v9M8 3v5M6 3v5m10-5c-1.5 0-2 2-2 4s.5 3 2 3v6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    bed: '<path d="M3 18v-6a2 2 0 0 1 2-2h10a3 3 0 0 1 3 3v5M3 14h18M3 18v2M21 17v3" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    mind: '<path d="M12 3c4 0 6 2.6 6 6 0 2.3-1.2 3.4-1.2 5.2 0 1 .4 1.5.4 2.3 0 1.4-1 2.2-2.4 2.2-1 0-1.6-.5-2.8-.5s-1.8.5-2.8.5C7.8 18.7 7 18 7 16.6c0-.8.3-1.3.3-2.3C7.2 12.4 6 11.3 6 9c0-3.4 2-6 6-6z" fill="none" stroke="currentColor" stroke-width="1.9"/>',
    lungs: '<path d="M12 3v8M8 8c-2 1-3 3-3 6 0 3 1 5 3 5s2-2 2-4V9M16 8c2 1 3 3 3 6 0 3-1 5-3 5s-2-2-2-4V9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    pulse: '<path d="M3 12h4l2-5 3 10 2-7 2 2h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    drop: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z"/>',
  };
  const fillStroke = ["body", "fork", "bed", "mind", "lungs", "pulse"].includes(name) ? "" : `fill="${color}"`;
  return `<svg viewBox="0 0 24 24" ${fillStroke} style="color:${color}">${paths[name] || paths.pulse}</svg>`;
}

/* ---------- Activity rings ---------- */
function rings(move, ex, stand) {
  const defs = [
    { p: move.v / move.goal, from: "#FA114F", to: "#FF4D6E", r: 82, label: "Move" },
    { p: ex.v / ex.goal, from: "#7AE82A", to: "#B4FF00", r: 60, label: "Exercise" },
    { p: stand.v / stand.goal, from: "#12D6E0", to: "#1EEAEF", r: 38, label: "Stand" },
  ];
  const w = 17;
  let arcs = "";
  let gdefs = "";
  defs.forEach((d, i) => {
    const c = 2 * Math.PI * d.r;
    const p = Math.max(0, Math.min(1, d.p || 0));
    const off = c * (1 - p);
    gdefs += `<linearGradient id="rg${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d.to}"/><stop offset="1" stop-color="${d.from}"/></linearGradient>`;
    arcs += `<circle cx="100" cy="100" r="${d.r}" fill="none" stroke="${d.from}" stroke-opacity="0.2" stroke-width="${w}"/>`;
    arcs += `<circle cx="100" cy="100" r="${d.r}" fill="none" stroke="url(#rg${i})" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 100 100)"/>`;
  });
  return `<svg viewBox="0 0 200 200" class="rings"><defs>${gdefs}</defs>${arcs}</svg>`;
}

/* ---------- Summary ---------- */
async function renderSummary() {
  const view = $("#view");
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const [move, ex, stand] = await Promise.all([
    currentValue("active_energy"), currentValue("exercise_minutes"), currentValue("stand_hours"),
  ]);
  const mv = { v: move ? move.value : 0, goal: M("active_energy").goal };
  const ev = { v: ex ? ex.value : 0, goal: M("exercise_minutes").goal };
  const sv = { v: stand ? stand.value : 0, goal: M("stand_hours").goal };

  const favCards = await Promise.all(CATALOG.favorites.map((id) => favoriteCard(id)));

  view.innerHTML = `
    <div class="lg-head">
      <div class="lg-sub">${esc(dateStr)}</div>
      <h1>Summary</h1>
    </div>

    <section class="card activity-card" data-open="metric:active_energy">
      <div class="card-head">
        <div class="ch-title" style="color:#FA114F">Activity</div>
        <div class="chevron">›</div>
      </div>
      <div class="activity-body">
        ${rings(mv, ev, sv)}
        <div class="activity-legend">
          <div><span class="lg-name" style="color:#FF4D6E">Move</span><div class="lg-val">${fmtNum(mv.v)}<small>/${fmtNum(mv.goal)} KCAL</small></div></div>
          <div><span class="lg-name" style="color:#B4FF00">Exercise</span><div class="lg-val">${fmtNum(ev.v)}<small>/${fmtNum(ev.goal)} MIN</small></div></div>
          <div><span class="lg-name" style="color:#1EEAEF">Stand</span><div class="lg-val">${fmtNum(sv.v)}<small>/${fmtNum(sv.goal)} HRS</small></div></div>
        </div>
      </div>
    </section>

    <div class="section-label">Favorites</div>
    <div class="fav-grid">${favCards.join("")}</div>

    <div class="section-label">Highlights</div>
    <div class="card highlight-card">${await highlight()}</div>
  `;
  bindOpeners(view);
}

async function favoriteCard(id) {
  const def = M(id);
  const cur = await currentValue(id);
  const bks = bucketize(await samplesFor(id, buckets("W")[0].start), buckets("W"), def.agg);
  const spark = miniBars(bks, def.color);
  const label = def.agg === "latest" ? (cur && cur.when ? new Date(cur.when).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "") : (cur && cur.stale ? "Latest" : "Today");
  const val = cur ? fmtNum(cur.value, def.precision) : "—";
  return `
    <div class="card fav-card" data-open="metric:${id}">
      <div class="fav-top">
        <div class="fav-ic">${icon(def.icon, def.color)}</div>
        <div class="fav-name" style="color:${def.color}">${esc(def.name)}</div>
        <div class="chevron">›</div>
      </div>
      <div class="fav-when">${esc(label)}</div>
      <div class="fav-val">${val} <span>${esc(def.unit)}</span></div>
      <div class="fav-spark">${spark}</div>
    </div>`;
}

async function highlight() {
  // Simple week-over-week comparison for steps.
  const def = M("steps");
  const wk = buckets("W");
  const cur = bucketize(await samplesFor("steps", wk[0].start), wk, def.agg).filter((b) => b.value != null);
  if (!cur.length) return `<div class="hl-empty">Log some data and your highlights will appear here.</div>`;
  const avg = cur.reduce((a, b) => a + b.value, 0) / cur.length;
  return `
    <div class="hl-row" data-open="metric:steps">
      <div class="fav-ic">${icon("flame", def.color)}</div>
      <div>
        <div class="hl-name">Steps</div>
        <div class="hl-text">You're averaging <b>${fmtNum(avg)}</b> steps a day over the past week.</div>
      </div>
      <div class="chevron">›</div>
    </div>`;
}

/* small 7-bar sparkline */
function miniBars(bks, color) {
  const max = Math.max(1, ...bks.map((b) => b.value || 0));
  return `<div class="spark">${bks.map((b) => {
    const h = b.value ? Math.max(8, (b.value / max) * 100) : 6;
    const on = b.value != null;
    return `<span style="height:${h}%;background:${on ? color : "var(--sep)"};opacity:${on ? 1 : 0.5}"></span>`;
  }).join("")}</div>`;
}

/* ---------- Sharing (local-data management) ---------- */
async function renderSharing() {
  const view = $("#view");
  const info = await db.info();
  view.innerHTML = `
    <div class="lg-head"><h1>Sharing</h1></div>
    <div class="card info-card">
      <div class="info-ic">${icon("heart", "#FA114F")}</div>
      <div class="info-title">Your data stays on this device</div>
      <p class="info-text">This is a local-only app. Every reading is stored in your browser (IndexedDB via PouchDB) and is never uploaded, shared, or synced. It works fully offline.</p>
    </div>

    <div class="section-label">Your Database</div>
    <div class="card list-card">
      <div class="list-row static"><span>Data points stored</span><b>${fmtNum(info.doc_count)}</b></div>
    </div>

    <div class="section-label">Manage Data</div>
    <div class="card list-card">
      <button class="list-row action" id="exportBtn"><span>Export all data (JSON)</span><div class="chevron">›</div></button>
      <button class="list-row action" id="importBtn"><span>Import data from file</span><div class="chevron">›</div></button>
      <button class="list-row action danger" id="reseedBtn"><span>Reload sample data</span><div class="chevron">›</div></button>
      <button class="list-row action danger" id="wipeBtn"><span>Delete all health data</span><div class="chevron">›</div></button>
    </div>
    <input type="file" id="importFile" accept="application/json" style="display:none" />
    <p class="foot-note">Health · local-only recreation of Apple Health · built with plain HTML/CSS/JS + PouchDB.</p>
  `;

  $("#exportBtn").onclick = exportData;
  $("#importBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = importData;
  $("#reseedBtn").onclick = async () => {
    if (!confirm("Replace your data with a fresh set of ~60 days of sample data?")) return;
    await wipeAll(); await seed(); toast("Sample data reloaded"); render();
  };
  $("#wipeBtn").onclick = async () => {
    if (!confirm("Delete ALL health data on this device? This cannot be undone.")) return;
    await wipeAll(); toast("All data deleted"); render();
  };
}

async function exportData() {
  const res = await db.allDocs({ include_docs: true });
  const docs = res.rows.map((r) => r.doc).filter((d) => d.type === "sample");
  const blob = new Blob([JSON.stringify({ app: "health", exported: new Date().toISOString(), samples: docs }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `health-export-${dayKey(new Date())}.json`;
  a.click(); URL.revokeObjectURL(url);
  toast("Exported");
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const samples = data.samples || [];
    let n = 0;
    for (const s of samples) {
      if (!s.metric || s.value == null) continue;
      const when = new Date(s.date || s.ts || Date.now());
      await addSample(s.metric, s.value, when); n += 1;
    }
    toast(`Imported ${n} data points`); render();
  } catch (err) { toast("Could not read that file"); }
}

async function wipeAll() {
  const res = await db.allDocs();
  await Promise.all(res.rows.map((r) => db.get(r.id).then((d) => db.remove(d))));
  await db.put({ _id: "meta_seeded", type: "meta", value: true });
}

/* ---------- Browse ---------- */
function renderBrowse() {
  const view = $("#view");
  view.innerHTML = `
    <div class="lg-head"><h1>Browse</h1></div>
    <div class="search-wrap"><input id="browseSearch" type="search" placeholder="Search" autocomplete="off" /></div>
    <div class="section-label">Health Categories</div>
    <div class="card list-card" id="catList">
      ${CATALOG.categories.map((c) => `
        <button class="list-row cat" data-open="category:${c.id}">
          <div class="cat-ic" style="background:${c.color}">${icon(c.icon, "#fff")}</div>
          <span>${esc(c.name)}</span>
          <div class="chevron">›</div>
        </button>`).join("")}
    </div>
    <div id="searchResults"></div>
  `;
  bindOpeners(view);

  const search = $("#browseSearch");
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    const box = $("#searchResults");
    const cats = $("#catList").parentElement.querySelector(".section-label") ? true : true;
    if (!q) { box.innerHTML = ""; $("#catList").style.display = ""; document.querySelectorAll(".section-label").forEach((s) => s.style.display = ""); return; }
    $("#catList").style.display = "none";
    document.querySelectorAll(".section-label").forEach((s) => s.style.display = "none");
    const hits = Object.keys(CATALOG.metrics).filter((id) => M(id).name.toLowerCase().includes(q));
    box.innerHTML = `<div class="card list-card">${hits.length ? hits.map((id) => metricRow(id)).join("") : `<div class="list-row static">No results</div>`}</div>`;
    bindOpeners(box);
  };
}

function metricRow(id) {
  const def = M(id);
  return `<button class="list-row metric" data-open="metric:${id}">
    <div class="cat-ic small" style="background:${def.color}">${icon(def.icon, "#fff")}</div>
    <span>${esc(def.name)}</span><div class="chevron">›</div>
  </button>`;
}

/* =========================================================================
   DETAIL OVERLAY (category screen + metric screen)
   ========================================================================= */
function bindOpeners(root) {
  root.querySelectorAll("[data-open]").forEach((node) => {
    node.addEventListener("click", () => {
      const [type, id] = node.getAttribute("data-open").split(":");
      openDetail({ type, id });
    });
  });
}

function openDetail(screen) {
  state.nav.push(screen);
  if (screen.type === "metric") state.period = "W";
  drawDetail(true);
}

function popDetail() {
  state.nav.pop();
  if (!state.nav.length) {
    const d = $("#detail");
    d.classList.remove("show");
    setTimeout(() => { d.innerHTML = ""; d.setAttribute("aria-hidden", "true"); }, 260);
    return;
  }
  drawDetail(true);
}

async function drawDetail(animate) {
  const d = $("#detail");
  const screen = state.nav[state.nav.length - 1];
  const html = screen.type === "category" ? categoryScreen(screen.id) : await metricScreen(screen.id);
  d.innerHTML = html;
  d.setAttribute("aria-hidden", "false");
  d.querySelector(".back-btn").onclick = popDetail;
  bindOpeners(d);
  if (screen.type === "metric") wireMetricScreen(d, screen.id);
  requestAnimationFrame(() => d.classList.add("show"));
}

function categoryScreen(catId) {
  const cat = CATALOG.categories.find((c) => c.id === catId);
  return `
    <div class="nav-bar">
      <button class="back-btn"><span class="chev-l">‹</span> Browse</button>
      <div class="nav-title">${esc(cat.name)}</div>
      <div class="nav-right"></div>
    </div>
    <div class="detail-scroll">
      <h1 class="detail-h1" style="color:${cat.color}">${esc(cat.name)}</h1>
      <div class="card list-card">${cat.metrics.map((id) => metricRow(id)).join("")}</div>
    </div>`;
}

async function metricScreen(id) {
  const def = M(id);
  const cur = await currentValue(id);
  const back = state.nav.length > 1 && state.nav[state.nav.length - 2].type === "category"
    ? CATALOG.categories.find((c) => c.id === state.nav[state.nav.length - 2].id).name : "Summary";

  const valBlock = cur
    ? `<div class="detail-value"><span class="dv-num">${fmtNum(cur.value, def.precision)}</span> <span class="dv-unit">${esc(def.unit)}</span></div>
       <div class="detail-when">${cur.stale ? "Latest · " : ""}${new Date(cur.when).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>`
    : `<div class="detail-value"><span class="dv-num" style="opacity:.4">No Data</span></div>`;

  const chart = await chartFor(id, state.period);
  const recent = await recentList(id);

  return `
    <div class="nav-bar">
      <button class="back-btn"><span class="chev-l">‹</span> ${esc(back)}</button>
      <div class="nav-title">${esc(def.name)}</div>
      <button class="nav-add" id="navAdd">Add Data</button>
    </div>
    <div class="detail-scroll">
      <div class="detail-head" style="--mc:${def.color}">
        <div class="dh-ic">${icon(def.icon, def.color)}</div>
        ${valBlock}
      </div>

      <div class="period-tabs" id="periodTabs">
        ${["D", "W", "M", "6M", "Y"].map((p) => `<button class="ptab ${p === state.period ? "active" : ""}" data-p="${p}">${p}</button>`).join("")}
      </div>

      <div class="card chart-card">${chart}</div>

      <div class="section-label">Recent</div>
      <div class="card list-card" id="recentList">${recent}</div>
    </div>`;
}

function wireMetricScreen(root, id) {
  $("#navAdd", root).onclick = () => openAdd(id);
  root.querySelectorAll(".ptab").forEach((b) => {
    b.onclick = async () => {
      state.period = b.getAttribute("data-p");
      root.querySelectorAll(".ptab").forEach((x) => x.classList.toggle("active", x === b));
      $(".chart-card", root).innerHTML = await chartFor(id, state.period);
    };
  });
  root.querySelectorAll(".del-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      await deleteSample(btn.getAttribute("data-id"));
      toast("Deleted");
      drawDetail(false);
      if (state.tab === "summary") renderSummary();
    };
  });
}

async function recentList(id) {
  const def = M(id);
  const all = (await samplesFor(id)).slice(-12).reverse();
  if (!all.length) return `<div class="list-row static">No data yet. Tap <b>Add Data</b> to log a reading.</div>`;
  return all.map((s) => `
    <div class="list-row entry">
      <div class="entry-val">${fmtNum(s.value, def.precision)} <small>${esc(def.unit)}</small></div>
      <div class="entry-date">${new Date(s.ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
      <button class="del-btn" data-id="${s._id}" title="Delete">✕</button>
    </div>`).join("");
}

/* ---------- chart ---------- */
async function chartFor(id, period) {
  const def = M(id);
  const bks = buckets(period);
  const samples = await samplesFor(id, bks[0].start);
  const data = bucketize(samples, bks, def.agg);
  const present = data.filter((b) => b.value != null);

  // summary stat line
  let statLabel = "Average", statVal = "—";
  if (present.length) {
    if (def.agg === "sum") {
      const total = present.reduce((a, b) => a + b.value, 0);
      if (period === "D") { statLabel = "Total"; statVal = fmtNum(total, def.precision); }
      else { statLabel = "Daily Average"; statVal = fmtNum(total / present.length, def.precision); }
    } else {
      const avg = present.reduce((a, b) => a + b.value, 0) / present.length;
      statLabel = "Average"; statVal = fmtNum(avg, def.precision);
    }
  }

  const asLine = def.agg === "latest";
  const svg = asLine ? lineChart(data, def) : barChart(data, def);

  return `
    <div class="chart-stat"><div class="cs-label">${statLabel}</div><div class="cs-val">${statVal} <small>${esc(def.unit)}</small></div></div>
    ${svg}`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function barChart(data, def) {
  const W = 320, H = 150, padL = 4, padR = 4, padB = 18, padT = 6;
  const maxV = niceMax(Math.max(...data.map((b) => b.value || 0), def.goal || 0, 1));
  const n = data.length;
  const bw = (W - padL - padR) / n;
  const barW = Math.max(3, Math.min(bw * 0.62, 22));
  const plotH = H - padB - padT;
  let bars = "", labels = "", grid = "";

  // gridlines (0, mid, max)
  [0, 0.5, 1].forEach((f) => {
    const y = padT + plotH * (1 - f);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="grid"/>`;
    grid += `<text x="${W - padR}" y="${y - 3}" class="grid-txt" text-anchor="end">${fmtNum(maxV * f, def.precision)}</text>`;
  });
  // goal line
  if (def.goal && def.goal <= maxV) {
    const gy = padT + plotH * (1 - def.goal / maxV);
    grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" class="goal-line" stroke="${def.color}"/>`;
  }

  data.forEach((b, i) => {
    const cx = padL + bw * i + bw / 2;
    if (b.value != null) {
      const h = Math.max(2, (b.value / maxV) * plotH);
      const y = padT + plotH - h;
      bars += `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${h}" rx="${Math.min(barW / 2, 3)}" fill="${def.color}"/>`;
    }
    if (b.label) labels += `<text x="${cx}" y="${H - 4}" class="x-txt" text-anchor="middle">${esc(b.label)}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">${grid}${bars}${labels}</svg>`;
}

function lineChart(data, def) {
  const W = 320, H = 150, padL = 4, padR = 4, padB = 18, padT = 8;
  const pts = data.map((b, i) => ({ ...b, i })).filter((b) => b.value != null);
  if (!pts.length) return `<svg viewBox="0 0 ${W} ${H}" class="chart"></svg>`;
  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
  const n = data.length;
  const bw = (W - padL - padR) / n;
  const plotH = H - padB - padT;
  const x = (i) => padL + bw * i + bw / 2;
  const y = (v) => padT + plotH * (1 - (v - lo) / (hi - lo));

  let grid = "";
  [0, 0.5, 1].forEach((f) => {
    const gy = padT + plotH * (1 - f);
    grid += `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" class="grid"/>`;
    grid += `<text x="${W - padR}" y="${gy - 3}" class="grid-txt" text-anchor="end">${fmtNum(lo + (hi - lo) * f, def.precision)}</text>`;
  });

  const line = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const dots = pts.map((p) => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${def.color}"/>`).join("");
  let labels = "";
  data.forEach((b, i) => { if (b.label) labels += `<text x="${x(i)}" y="${H - 4}" class="x-txt" text-anchor="middle">${esc(b.label)}</text>`; });

  return `<svg viewBox="0 0 ${W} ${H}" class="chart"><defs></defs>${grid}<path d="${line}" fill="none" stroke="${def.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}

/* =========================================================================
   ADD DATA
   ========================================================================= */
const PAIR = { systolic: "diastolic" };
const PAIR_REV = { diastolic: "systolic" };

function openAdd(id) {
  state.add = id;
  const def = M(id);
  $("#addTitle").textContent = def.name.replace(/ \(.*/, "");
  $("#addValueLabel").textContent = PAIR[id] || PAIR_REV[id] ? "Systolic" : def.name;
  $("#addUnit").textContent = def.unit;
  $("#addWhen").value = localDatetimeValue();
  $("#addValue").value = "";
  $("#addHint").textContent = def.goal ? `Goal: ${fmtNum(def.goal, def.precision)} ${def.unit}` : "";

  const pair = PAIR[id] || PAIR_REV[id];
  const row2 = $("#addValueRow2");
  if (pair) {
    row2.style.display = "";
    $("#addValueLabel").textContent = "Systolic";
    $("#addValueLabel2").textContent = "Diastolic";
    $("#addUnit2").textContent = "mmHg";
    $("#addValue2").value = "";
  } else {
    row2.style.display = "none";
  }

  const bg = $("#addBg");
  bg.setAttribute("aria-hidden", "false");
  bg.classList.add("show");
  setTimeout(() => $("#addValue").focus(), 150);
}

function closeAdd() {
  const bg = $("#addBg");
  bg.classList.remove("show");
  setTimeout(() => bg.setAttribute("aria-hidden", "true"), 220);
  state.add = null;
}

async function saveAdd() {
  const id = state.add;
  if (!id) return;
  const def = M(id);
  const raw = parseFloat($("#addValue").value);
  if (isNaN(raw)) { toast("Enter a value"); return; }
  const when = $("#addWhen").value ? new Date($("#addWhen").value) : new Date();

  const pair = PAIR[id] || PAIR_REV[id];
  if (pair) {
    // Blood pressure: systolic in field 1, diastolic in field 2 (store both metrics)
    const dia = parseFloat($("#addValue2").value);
    const sysId = PAIR_REV[id] ? PAIR_REV[id] : id;         // ensure systolic
    const diaId = PAIR[id] ? PAIR[id] : id;                 // ensure diastolic
    await addSample("systolic", raw, when);
    if (!isNaN(dia)) await addSample("diastolic", dia, when);
  } else {
    await addSample(id, raw, when);
  }

  closeAdd();
  toast("Saved");
  if (state.nav.length) drawDetail(false);
  if (state.tab === "summary") renderSummary();
}

/* =========================================================================
   SEED SAMPLE DATA (first run)
   ========================================================================= */
async function seed() {
  const DAYS = 60;
  const bulk = [];
  const now = new Date();

  for (const id of Object.keys(CATALOG.metrics)) {
    const def = M(id);
    const every = def.seedEvery || 1;
    let last = null;
    for (let d = DAYS; d >= 0; d -= 1) {
      if (d % every !== 0) continue;
      const day = startOfDay(addDays(now, -d));

      if (def.agg === "latest") {
        // gentle random walk between min and max
        let v = last == null ? rand(def.seedMin, def.seedMax) : last + rand(-0.4, 0.4);
        v = Math.max(def.seedMin, Math.min(def.seedMax, v));
        last = v;
        const t = new Date(day); t.setHours(8, 30);
        bulk.push(sampleDoc(id, round(v, def.precision), t));
      } else if (def.range || def.seedCount) {
        // several readings per day (e.g. heart rate)
        const count = def.seedCount || 4;
        for (let k = 0; k < count; k += 1) {
          const t = new Date(day); t.setHours(7 + Math.floor(rand(0, 15)), Math.floor(rand(0, 59)));
          bulk.push(sampleDoc(id, round(rand(def.seedMin, def.seedMax), def.precision), t));
        }
      } else if (def.agg === "sum") {
        // one daily total, spread nothing fancy
        const t = new Date(day); t.setHours(12 + Math.floor(rand(0, 8)), Math.floor(rand(0, 59)));
        let v = round(rand(def.seedMin, def.seedMax), def.precision);
        if (id === "caffeine" && Math.random() < 0.2) v = 0;
        if (id === "mindful_minutes" && Math.random() < 0.4) continue;
        bulk.push(sampleDoc(id, v, t));
      } else { // avg without range
        const t = new Date(day); t.setHours(9, Math.floor(rand(0, 59)));
        bulk.push(sampleDoc(id, round(rand(def.seedMin, def.seedMax), def.precision), t));
      }
    }
  }

  bulk.push({ _id: "meta_seeded", type: "meta", value: true });
  await db.bulkDocs(bulk);
}

function round(v, p = 0) { const f = Math.pow(10, p); return Math.round(v * f) / f; }
function sampleDoc(metric, value, when) {
  const ts = when.getTime();
  return { _id: `sample_${metric}_${ts}_${Math.random().toString(36).slice(2, 7)}`, type: "sample", metric, value, ts, date: when.toISOString() };
}

/* =========================================================================
   ROUTER / BOOT
   ========================================================================= */
function render() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.getAttribute("data-tab") === state.tab));
  if (state.tab === "summary") renderSummary();
  else if (state.tab === "sharing") renderSharing();
  else renderBrowse();
  $("#view").scrollTop = 0;
}

function bindChrome() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => { state.tab = t.getAttribute("data-tab"); render(); };
  });
  $("#addCancel").onclick = closeAdd;
  $("#addSave").onclick = saveAdd;
  $("#addBg").addEventListener("click", (e) => { if (e.target === $("#addBg")) closeAdd(); });
  // Android back button / swipe closes the detail overlay first
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("#addBg").classList.contains("show")) closeAdd(); else if (state.nav.length) popDetail(); } });
}

async function boot() {
  CATALOG = await (await fetch("./data/metrics.json")).json();
  bindChrome();
  try {
    await db.get("meta_seeded");
  } catch (e) {
    if (e.status === 404) await seed();
  }
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
