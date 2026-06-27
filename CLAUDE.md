# CLAUDE.md — Autism Central

> Persistent project memory. Read this before making changes. It is written so a
> Claude instance with no prior context can continue work without asking.

---

## Project Overview

**Autism Central** is a private, offline-first app that helps a parent/caregiver
track an autistic child's therapy journey: therapy-session attendance, uploaded
documents, daily at-home activities & moods, milestones ("wins"), notes for the
therapist, parent wellbeing check-ins, and optional AI features (a therapist-plan
→ home-routine generator, a weekly recap, and gentle ideas for a logged concern).

- **Who it's for:** one family / one child per install (the app models a single
  child profile). Designed for a non-technical parent on an iPhone.
- **Core problem:** therapy (OT / Speech / ABA) generates a lot of scattered
  paper, dates, and observations. This consolidates them into one calm, private
  place and turns the data into encouragement + something shareable with the
  therapy team — without feeling clinical or judgmental.
- **Stage:** **production / live**, actively iterated. Deployed at
  **https://autism-central.in** (GitHub Pages + custom domain). The
  cloud/AI backend is real and deployed (Firebase project `autism-central-99c51`).
  It is feature-rich but single-author and lightly tested (no automated tests).

> ⚠️ **Naming gotcha:** the repo folder is `AutismIosApp` and the original README
> title is "Autism Session Tracker", but this is **not** a native iOS app and the
> product name is **Autism Central**. It is a **Progressive Web App** (vanilla JS,
> no build step). "iOS" in the folder name refers only to it being installed to
> the iPhone Home Screen. Do not introduce Swift/Xcode/Capacitor unless explicitly
> asked — see the README's "Want a native App Store app instead?" section.

---

## Architecture

### Tech stack
- **Frontend:** plain **ES modules** (vanilla JavaScript), **no framework, no
  bundler, no build step**. Files are served as-is. Browser-native everything.
- **Storage (local):** **IndexedDB** via a tiny hand-rolled wrapper (`js/db.js`).
- **Charts/graphics:** hand-written SVG/HTML string builders (`js/charts.js` plus
  `barChart`/`moodLineChart` inside `app.js`). No charting library.
- **PWA:** `manifest.webmanifest` + service worker `sw.js` (network-first).
- **Cloud (optional, but enabled):** **Firebase** Web SDK **v10.12.5**, loaded
  lazily from the gstatic CDN — Auth (email/password), Firestore (named database
  `autism`), Storage (documents), and callable Cloud Functions.
- **Cloud Functions:** **Node 22**, `firebase-functions` v6, `firebase-admin` v13,
  **`@anthropic-ai/sdk` ^0.71.0**. Model used: **`claude-opus-4-8`**.
- **Hosting:** GitHub Pages (static), custom domain via `CNAME` (`autism-central.in`).
  Firebase Hosting is **not** used — only Functions/Firestore/Auth/Storage.

### Folder structure
```
index.html              App shell: top bar, <main id="view">, bottom tab bar, #modal-root
manifest.webmanifest    PWA metadata (name "Autism Central", theme #0f766e, icons)
sw.js                   Service worker. CACHE const = 'session-tracker-vNN' — BUMP ON EVERY RELEASE
make_icons.py           One-off Python script to regenerate icons/ (Pillow)
CNAME                   "autism-central.in" (GitHub Pages custom domain)
.firebaserc             Firebase project alias: default = autism-central-99c51
firebase.json           Functions source = functions/, runtime nodejs22
css/
  styles.css            ALL styling. CSS custom props at :root, dark mode via prefers-color-scheme
js/
  app.js                ~2200 lines. The entire app: state, rendering, views, modals, event wiring, cloud init
  db.js                 IndexedDB wrapper. Exports `db`, `STORE`, `uid()`
  cloud.js              Firebase adapter. Exports `createCloud(config, databaseId)` — SAME shape as db.js + auth/storage/functions
  charts.js             donut(), ring(), heatmap() — return HTML/SVG strings
  content.js            DEFAULT_CTAS, DEFAULT_RESOURCES, CAT_COLORS (editable seed data)
  firebase-config.js    CLOUD_ENABLED flag, public firebaseConfig, firestoreDatabaseId='autism'
icons/                  icon-192/512/180/maskable-512 PNGs
functions/
  index.js              3 callable functions: generateHomePlan, weeklyRecap, concernIdeas
  package.json          name autism-central-functions, node 22
docs/
  USER_MANUAL.md        End-user manual (shipped v29)
  PUSH_NOTIFICATIONS.md Implementation PLAN for real push (NOT built — see "Current State")
```

### Key files & what they own
- **`js/app.js`** — owns everything UI: the `state` object, `render()` switch over
  5 views (`dashboard`/`sessions`/`program`/`cta`/`resources`), all modals, all
  data-mutating helpers, the global `data-act` click delegator (single
  `document.addEventListener('click', …)` near the bottom), the guided tour, the
  reminder loop, and `initCloud()`.
- **`js/db.js`** — the local data layer. `STORE = { programs, sessions, checks, kv }`.
  `uid()` = `Date.now().toString(36) + '-' + random`. DB name `session-tracker`, version 1.
- **`js/cloud.js`** — the cloud data layer with an **identical method signature** to
  `db.js` (`getAll/get/put/delete/clear/byIndex`) so `app.js` can swap `DB` between
  the two transparently. Adds `signIn/signUp/signOutUser`, `onUser`, `callFunction`,
  `uploadDocument/deleteDocument`. All Firestore calls are wrapped in a 10s
  `guard()` timeout so a missing/unreachable DB can never hang the UI.
- **`functions/index.js`** — the only server code. See "Cloud Functions" below.

### Data model
**IndexedDB stores (and their Firestore mirror `users/{uid}/{store}/{docId}`):**
- `programs` — therapy plans. `{ id, type:'OT'|'Speech'|'ABA', track:'Institute'|'Home', name, cycleStart(ISO), createdAt }`
- `sessions` — individual sessions, indexed by `programId`. `{ id, programId, number, date, status:'scheduled'|'attended'|'missed', notes, documents[], plannedDate?, sessionMood?(0-4), cancelReason?, preTracked? }`
- `checks` — completion log. **Key = `` `${dateISO}|${itemId}` ``**. Daily-activity
  checks use the CTA id; AI-plan step checks use itemId `` `ai:${dayIdx}:${stepIdx}` ``
  (the `ai:` prefix is **deliberately excluded** from the daily-ritual streak count).
- `kv` — catch-all key/value store. Known keys:
  `customCtas`, `customResources`, `aiPlan`, `childProfile`, `milestones`,
  `therapistNotes`, `parentWellbeing` (map dateISO→1..5, capped 30 days),
  `dailyLogs` (map dateISO→{childMood,win,concern,sleep,eating,medication,homeExercise,sensory[],concernHandled}, capped 60 days),
  `settings` (reminderEnabled, reminderTime, lastNotified).

**Documents (file uploads):** when signed in & cloud-healthy, stored in Cloud
Storage at `users/{uid}/docs/{id}` and referenced by `{id,name,type,size,url,path}`.
When offline/local, stored as a raw `Blob` on the session's `documents[]` entry.
Backup/restore (`exportData`/`importData`) converts blobs ↔ data URLs.

### Data flow / the DB-swap design (non-obvious, important)
`app.js` keeps a module-level `let DB = localDB;`. On boot it always renders against
local IndexedDB first (instant, never blocks). If `CLOUD_ENABLED`, `initCloud()`
runs and `cloud.onUser` fires: on sign-in it calls `checkCloudHealth()` (a probe
read); only if that succeeds does it set `DB = cloud.db` and re-render. **The whole
rest of the app is written against the `DB` interface and is agnostic to which
backend is live.** This is why local and cloud adapters must keep identical shapes.

### Non-obvious design decisions
- **No build step on purpose** — so the owner can edit a file on github.com from
  their phone and GitHub Pages redeploys in ~1 min. Keep it dependency-free.
- **Network-first service worker** — deployed code changes go live on next online
  open with no reinstall. The trade-off: you **must bump the `CACHE` const in
  `sw.js`** (`session-tracker-vNN`) on each release or the offline cache goes stale.
- **Cloud is non-blocking by default** — every cloud call is timeout-guarded and
  the UI defaults to local; a broken Firebase config must never freeze the app.
  This was a hard-won fix (see commits `8d10061`, `992a780`).
- **All dates are local-time ISO strings** (`YYYY-MM-DD`) via `toISO()`; the code
  deliberately avoids `Date.toISOString()` / UTC round-trips to prevent off-by-one
  day bugs across timezones. Use the existing `todayISO/addDays/addMonths/fmtDate`.
- **AI runs server-side only** — the Anthropic key lives in a Firebase secret, never
  in the client. AI features are gated behind `aiReady()` (requires cloud + signed-in
  + healthy). The client never sees the API key.

---

## Environment & Setup

### Run locally
```bash
cd ~/AutismIosApp
python3 -m http.server 8123
# open http://localhost:8123
```
The static frontend needs no install. Home-screen install + offline only work over
HTTPS (hence the GitHub Pages deploy). Cloud sync works on `localhost` because
`localhost` is an authorized Firebase domain (you must add it in the console).

### Cloud Functions (deploy / dev)
```bash
cd functions
npm install
# set secrets once (never hard-code):
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set YOUTUBE_API_KEY      # optional; enables per-day videos
firebase deploy --only functions                    # project autism-central-99c51
```

### Required secrets / env (names only)
- **`ANTHROPIC_API_KEY`** — Firebase secret. Required for all 3 functions.
- **`YOUTUBE_API_KEY`** — Firebase secret. Optional; only used by `generateHomePlan`
  to attach a verified, embeddable YouTube video per day. Functions degrade
  gracefully without it.
- No frontend env vars. `js/firebase-config.js` holds the **public** Firebase Web
  config (apiKey etc. — these identify the project, they are not secrets) and is
  committed intentionally.

### External services
- **Firebase** project `autism-central-99c51`: Auth (Email/Password), **Firestore
  named database `autism`** (NOT `(default)` — see `firestoreDatabaseId` in
  `firebase-config.js`), Storage, Functions (region **`us-central1`**).
- **Anthropic API** (via Cloud Functions). **YouTube Data API v3** (optional).
- **GitHub Pages** for hosting; **custom domain** `autism-central.in` via `CNAME`.
- Firestore & Storage **security rules** must be published so each user can only
  read/write `users/{uid}/**` — the exact rules are in the README ("Cloud sync setup"
  steps 4–5). They are not stored in this repo.

### Setup gotchas
- **Named Firestore DB:** if you forget `firestoreDatabaseId = 'autism'`, reads hit
  the non-existent `(default)` DB, `checkCloudHealth()` fails, and the app silently
  stays local (Settings shows "Not connected"). This is expected behavior, not a bug.
- **Authorized domains:** sign-in fails unless your host (`<user>.github.io`,
  `autism-central.in`, `localhost`) is added under Auth → Settings → Authorized domains.
- **iOS reminders** only fire after the app is added to the Home Screen, and may be
  delayed/coalesced by the OS. These are *in-app* `Notification`s, not true push.
- **Service worker caching during dev:** if local changes don't appear, bump the
  `CACHE` const in `sw.js` or unregister the SW in devtools.

---

## Conventions

### Naming
- **Files:** lowercase, single word where possible (`app.js`, `db.js`, `cloud.js`).
- **Functions:** camelCase. View renderers are `render<Thing>(v)` where `v` is the
  `<main id="view">` element. Modals are `<thing>Modal()`. Data getters/setters are
  `get<Thing>()` / `save<Thing>()` (e.g. `getMilestones`/`saveMilestones`).
- **kv keys & ids:** camelCase kv keys; entity ids are prefixed
  (`cta-`, `res-`, `tn-`, `ms-`) + `uid()`. Session/program ids are bare `uid()`.
- **CSS:** kebab-case class names; CSS custom properties at `:root`
  (`--brand`, `--ot`, `--speech`, `--aba`, `--green`, `--red`, …).

### Code style
- **Terse, modern, dependency-free.** Heavy use of template literals that return
  HTML strings, then assigned via `innerHTML`. **Always run user-supplied text
  through `esc()`** before interpolating into HTML (existing code is careful about this).
- **Event handling is centralized:** most interactions use `data-act="…"` attributes
  handled by the single global click delegator at the bottom of `app.js`. Add new
  actions there as a `case` rather than attaching per-element listeners, except for
  modal-local controls (those wire listeners right after `openModal()`).
- **Rendering is full re-render:** mutate the store, then call `render()`. There is
  no virtual DOM / diffing. Keep that pattern.
- Colors come from CSS vars (`COLORVAR`/`CAT_COLORS`/`MILESTONE_CATS`), not literals.

### Intentionally repeated patterns
- Each render gathers data with `await DB.<op>(...)` and builds one big `innerHTML`.
- `openModal(html)` then `el('id').addEventListener(...)` for modal-local logic.
- Timeout-guarded cloud calls (in `cloud.js`) so nothing hangs the UI.

### Explicitly NOT done (don't "fix" these)
- **No framework / no bundler / no npm for the frontend** — keep editable from a phone.
- **No TypeScript.**
- **No native iOS app** (unless explicitly requested).
- **No analytics / no third-party data sharing** — privacy is a core promise; data
  is on-device by default and only goes to the user's own Firebase when they sign in.
- **No automated test suite** (none exists today).

---

## Current State

### Fully working
- Therapy plans across two **tracks** (Institute / Home) and three **types**
  (OT & Speech = 24-session fixed cycles; ABA = monthly cycle with "Next month →").
- Session timeline, attendance marking (attended/missed/scheduled), session mood,
  miss reason, notes, document upload (local blob or cloud Storage).
- "Completed to date" quick-set stepper (`adjustCompleted`) using `preTracked` markers.
- Session scheduling: `plannedDate`, the 7-day upcoming strip, and dashboard reminders.
- Daily tab: child mood, win, concern, quick-log toggles (sleep/eating/medication/
  home-exercise), sensory chips, at-home activity checklist + streak + 12-week heatmap.
- Dashboard: personalized header, attendance donut, milestone card, parent wellbeing
  check-in (+ supportive surfacing on consecutive low days), session reminders.
- Progress view: sessions bar chart, child-mood line chart, milestone timeline,
  win-count delta vs previous period, **PDF report export** (`exportReport`, prints).
- Milestone Wall with photos, delete-with-undo, and a "Share this moment" image card
  (canvas → `navigator.share`/download).
- "Things to tell the therapist" running list (auto-populated from logged concerns).
- Resources with category filter chips + custom links.
- Cloud sync (Auth + Firestore + Storage) with health probe and "upload this device".
- **AI features (deployed):** `generateHomePlan` (therapist plan → 7-day routine +
  videos), `weeklyRecap`, `concernIdeas`. All gated by `aiReady()`.
- Backup/restore to a JSON file (including documents as data URLs).
- Offline support + offline banner; first-launch **guided tour** (replayable).

### Partially implemented / caveats
- **AI date alignment:** the AI plan maps "today" to a day index via
  `weekStartDate`; if today is outside the saved week's range, the Daily card shows
  a "this week's plan is set / regenerate" fallback rather than a day.
- **Document portability:** local (unsynced) document blobs only exist on the device
  that created them; moving requires Export → Import or being signed in.

### Known broken / incomplete
- **No true push notifications** — reminders are in-app `Notification`s only and
  depend on the app being opened. A full plan exists in
  `docs/PUSH_NOTIFICATIONS.md` but is **not built**.
- **No automated tests / no CI.**
- **Single child** — the data model assumes one `childProfile`; multi-child is not supported.

---

## Active Work

- **Most recent commit:** `85598bc` — *"Add in-app guided tour + user manual (v29)"*
  (2026-06-27). Working tree is **clean** (nothing uncommitted/in progress).
- **Recent trajectory (v26→v29):** milestone delete+undo (v26) → session scheduling
  & reminders (v27) → push-notification plan doc → AI weekly recap + concern gentle
  ideas (v28) → guided tour + user manual (v29). The arc is: deepen logging, add AI
  warmth, then onboarding/docs.
- **No refactor in progress.** `app.js` is large (~2200 lines) but stable.
- **Likely next step** (the obvious continuation, not yet started): implement the
  push-notification plan in `docs/PUSH_NOTIFICATIONS.md` (FCM token storage +
  scheduled daily-digest Cloud Function). This is the one major documented-but-unbuilt
  feature. If picking it up, that doc is the spec.

### Release checklist (when shipping any frontend change)
1. Make the change.
2. **Bump the `CACHE` const in `sw.js`** (e.g. `session-tracker-v29` → `-v30`).
3. Commit with a `(vNN)` suffix in the message, matching the cache version.
4. `git push` → GitHub Pages redeploys in ~1 min.

---

## Key Decisions Log

- **PWA over native iOS** — avoids the $99/yr Apple account, App Store review, and a
  Mac/Xcode toolchain; lets the non-technical owner self-edit from a phone. (Native
  remains a documented future option in the README.)
- **No build tooling** — same reasoning; phone-editable, zero-install hosting.
- **Firebase chosen for cloud** — free tier covers personal use; gives Auth +
  Firestore offline cache + Storage + serverless Functions in one place.
- **Named Firestore database `autism`** (rather than `(default)`) — chosen in commit
  `c68a973`; the adapter targets it explicitly via `firestoreDatabaseId`.
- **Cloud made strictly non-blocking** (`8d10061`, `992a780`, `5d4...`) — earlier
  builds could hang on sign-in if Firestore was missing/unreachable; now everything
  defaults to local and only upgrades to cloud after a health probe.
- **AI server-side via Cloud Functions** — keeps the Anthropic key secret and lets
  `generateHomePlan` use web search + YouTube lookups the client couldn't do safely.
- **Model `claude-opus-4-8`** with `thinking:{type:'adaptive'}`; `generateHomePlan`
  additionally uses the `web_search_20260209` tool (max 5 uses).
- **Strict non-clinical AI tone** — a shared `TONE_RULES` string forbids diagnostic/
  medical/shaming language and frames everything as "discuss with your therapist".
- **Rebrand to "Autism Central"** (`2fa255f`) — note the repo folder name was left as
  `AutismIosApp`; product name and folder name intentionally diverge.
- **Accepted technical debt:** one ~2200-line `app.js` (no module split); full
  re-render on every change (no diffing); no tests. All accepted to keep the codebase
  small, dependency-free, and phone-editable.

---

## Gotchas & Watch-outs

- **BUMP `sw.js` CACHE on every release** — otherwise users get stale cached assets.
  This is the single easiest thing to forget. The cache name tracks the `vNN` in the
  commit message.
- **Repo name ≠ product** — folder `AutismIosApp`, product "Autism Central", and the
  IndexedDB / backup app id is the legacy string **`session-tracker`** (used in
  `DB_NAME`, the SW cache prefix, and `importData`'s `data.app` check — do **not**
  rename it or you'll break restore + caching).
- **Local vs cloud adapter must stay in lockstep** — if you add a method or change a
  signature in `db.js`, mirror it in `cloud.js`, and vice-versa. `app.js` calls them
  through the same `DB` variable.
- **Always `esc()` user text** before putting it in `innerHTML` (XSS + breakage).
- **Local-time dates only** — never introduce `toISOString()`/UTC date math; use the
  helpers in `app.js`. Mixing the two causes off-by-one-day bugs.
- **`checks` keys are `date|itemId`** and AI steps must keep the `ai:` itemId prefix,
  or they'll wrongly count toward the daily-ritual streak (`checkCountsByDate` filters them).
- **`stop_reason === 'refusal'`** is explicitly handled in every function — preserve
  that branch when editing prompts; it surfaces a friendly "try rephrasing" error.
- **The AI returns raw JSON** (no markdown fences requested, but `extractJson()`
  tolerates them and trailing prose). If you change the prompt's output shape, update
  the client parsers in `app.js` (`aiPreviewModal`, `weeklyRecapModal`, `concernIdeasModal`).
- **Pop-up blocker:** `exportReport()` opens a new window to print; it alerts the user
  to allow pop-ups if blocked.
- **Firebase SDK version is pinned** to `10.12.5` in `cloud.js` (`const V`). Bumping it
  changes every CDN import URL at once — test auth + Firestore after any change.
- **Two separate projects on this machine** — keep AutismIosApp and the "Navyug School
  Website" strictly separate (see user memory). Don't cross-pollinate.
