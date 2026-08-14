# Daily Check-in — a simple mood journal

An end-of-day mental-health check-in, as an installable, offline-first PWA.
One question — *how are you feeling?* — then pick the moods behind it, rate how
strong each one is, and jot a note if you want. That's it.

- **Simple by design.** No accounts, no dashboards, no noise. Open it, tap a face,
  save.
- **Local-only.** Every check-in lives in your browser via **PouchDB (IndexedDB)**.
  Nothing is uploaded, shared, or synced.
- **Offline-first PWA.** Installable to your home screen; works with no connection.
- **No build step.** Plain HTML/CSS/JS + an editable mood list. Light & dark mode.

## What it does

**Check-in**
- Choose how the day felt on a 5-point scale (Very Unpleasant → Very Pleasant).
- Optionally tap the moods contributing to it (Calm, Grateful, Anxious, Tired…).
- Rate how strong each selected mood is (1–5 dots).
- Add a free-text note.
- Save — it's logged with the date & time. Keeps a gentle day-streak.

**History**
- Totals, current streak, and your average mood.
- A two-week mood trend (a colored bar per day).
- Every past check-in with its moods, ratings, and notes (tap ✕ to delete).
- **Export / Import** your journal as JSON for backup.

## Run locally

It's static, but a service worker + `fetch()` need `http://`, not `file://`:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy to GitHub Pages

1. Push these files to a repo.
2. Repo **Settings → Pages → Source** → **GitHub Actions** (a workflow is included),
   or **Deploy from a branch** → `main` / `/ (root)`.
3. Your app is live at `https://<you>.github.io/health/`. HTTPS is automatic, so the
   service worker and "Add to Home Screen" work out of the box.

Asset paths are **relative** so it serves fine from that subpath; `.nojekyll` tells
Pages to serve files as-is.

### Install on your phone
Open the Pages URL in Chrome/Safari → menu → **Add to Home Screen**. It launches
standalone and offline, with the check-in icon.

## Customize the moods

Everything the app offers is in `data/moods.json` — edit and commit:

```json
"moods": [
  { "name": "Grateful", "tone": "pleasant" },
  { "name": "Anxious",  "tone": "unpleasant" }
]
```

`tone` (`pleasant` / `neutral` / `unpleasant`) just colors the chip. The 5-point
face scale is in the same file under `scale`.

## Your data

Everything is in a single local PouchDB named `checkins`. Back it up any time from
**History → Export**. To wipe it entirely from the console:

```js
new PouchDB('checkins').destroy()
```

## Files

```
index.html            app shell + PWA wiring
styles.css            calm, simple look — light + dark mode
app.js                check-in flow, ratings, notes, history, storage
data/moods.json       the editable mood list + the 5-point face scale
vendor/pouchdb.min.js vendored so it works offline (no CDN dependency)
manifest.webmanifest  PWA manifest
sw.js                 service worker (offline app shell)
icons/                app icons
.nojekyll             serve files raw on GitHub Pages
```

*This is a personal journaling tool, not a medical device or a substitute for
professional care. If you're struggling, please reach out to someone you trust or a
local support line.*
