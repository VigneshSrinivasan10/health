# Health — a local-only Apple Health clone

A recreation of the **Apple Health** app as an installable, offline-first PWA.
Track activity, heart, sleep, nutrition, body measurements and vitals — with the
familiar Health look: activity rings, favorite cards, browsable categories, and
per-metric detail charts (D / W / M / 6M / Y).

- **Local-only.** Every reading lives in your browser via **PouchDB (IndexedDB)**.
  Nothing is uploaded, shared, or synced. No accounts, no server.
- **Offline-first PWA.** Installable to your home screen; works with no connection.
- **No build step.** Plain HTML/CSS/JS + a JSON metric catalog. Light & dark mode.
- **Comes to life on first run** with ~60 days of realistic sample data so you can
  see the charts immediately. Wipe it any time from the **Sharing** tab.

## What's inside

**Summary** — today's date, the three **Activity rings** (Move / Exercise / Stand),
your **Favorites** as at-a-glance cards with weekly sparklines, and a **Highlights**
callout.

**Browse** — searchable Health Categories, each opening to its metrics:

| Category | Metrics |
| --- | --- |
| Activity | Steps · Distance · Active Energy · Exercise Minutes · Stand Hours · Flights |
| Body Measurements | Weight · Height · BMI · Body Fat · Lean Mass · Waist |
| Heart | Heart Rate · Resting HR · Walking HR · HRV |
| Nutrition | Dietary Energy · Water · Protein · Carbs · Fat · Caffeine |
| Sleep | Sleep |
| Mindfulness | Mindful Minutes |
| Respiratory | Blood Oxygen · Respiratory Rate |
| Vitals | Blood Pressure (Systolic / Diastolic) · Body Temperature |

**Metric detail** — a big current value, a D/W/M/6M/Y bar or line chart with an
average/total stat and a goal line, an **Add Data** button, and the recent-entries
list (tap ✕ to delete an entry).

**Sharing** — a reminder that your data stays on the device, plus **Export** /
**Import** (JSON) and **reset / delete all** controls.

## Run locally

It's static, but a service worker + `fetch()` need `http://`, not `file://`:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

(Any static server works: `npx serve`, etc.)

## Deploy to GitHub Pages

1. Push these files to a repo.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main` (or your branch), folder `/ (root)`.
3. Your app is at `https://<you>.github.io/health/`. HTTPS is automatic, so the
   service worker and "Add to Home Screen" work out of the box.

All asset paths are **relative** (`./app.js`, `./data/…`) so it serves correctly from
that `/health/` subpath. `.nojekyll` tells Pages to serve files as-is.

### Install on your phone
Open the Pages URL in Chrome/Safari → menu → **Add to Home Screen**. It launches
standalone, full-screen, offline — with the white-heart Health icon.

## Add or edit metrics

Everything the app knows is described in `data/metrics.json`:

```json
"steps": {
  "name": "Steps", "unit": "steps", "color": "#FA5838", "icon": "flame",
  "agg": "sum", "precision": 0, "goal": 10000, "seedMin": 3200, "seedMax": 13500
}
```

- `agg` — how a period is summarized: `sum` (steps, water), `avg` (heart rate),
  or `latest` (weight, drawn as a line chart).
- `color` / `icon` — the tile color and glyph (`flame`, `heart`, `body`, `fork`,
  `bed`, `mind`, `lungs`, `pulse`, `drop`).
- `goal` — optional; draws the dashed goal line and feeds the activity rings.
- `seedMin` / `seedMax` (and `seedEvery` / `seedCount`) — the range used to generate
  first-run sample data.

Add the metric's id to a category's `metrics` list to make it browsable, and to
`favorites` to pin it on Summary.

## Data, backup, reset

Everything is in a single local PouchDB named `health`. Use the **Sharing** tab to
export a JSON backup, import one, reload sample data, or delete everything. From the
console you can also wipe it entirely:

```js
new PouchDB('health').destroy()
```

## Files

```
index.html              app shell (tab bar, add-data sheet) + PWA wiring
styles.css              iOS Health look — grouped cards, rings, light + dark mode
app.js                  data layer, rings, charts, navigation, logging, seeding
data/metrics.json       the editable metric catalog (categories, units, colors, goals)
vendor/pouchdb.min.js   vendored so it works offline (no CDN dependency)
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline app shell)
icons/                  app icons (192, 512, maskable, apple-touch, favicon)
.nojekyll               serve files raw on GitHub Pages
```

*Health data shown is sample/manual only — this app does not read from Apple HealthKit
or any device sensors, and the figures are illustrative, not medical advice.*
