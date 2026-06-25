# Autism Session Tracker

A simple, private app to track **OT**, **Speech**, and **ABA** therapy sessions — attendance,
documents, daily at-home activities, and recommended online resources.

Built as a **Progressive Web App (PWA)**: no App Store, no Apple Developer account, no monthly fees.
You add it to your iPhone home screen and it behaves like a normal app (own icon, full screen, works offline).

## What it does

- **Therapy plans**
  - **OT** and **Speech** → a cycle of **24 sessions** each.
  - **ABA** → a **monthly cycle** (starts on a date, ends the same date next month; tap *Start next month* to roll over).
- **Attendance** — tap a session → mark **Attended (Yes, green)** or **Missed (No, red)**. Untapped sessions stay grey.
- **Documents** — upload photos / PDFs / reports to a specific session (stored privately on your device).
- **Daily dashboard** — a checklist of at-home activities (CTAs) to follow, grouped by therapy area. Resets each day.
- **Resources dashboard** — curated links to reputable OT / Speech / ABA resources. Add your own too.
- **Private & offline** — all data lives in your browser/app storage on the device. Nothing is sent to any server.

> ⚠️ Because data is stored on the device, deleting the app or clearing site data erases it.
> Treat this as a personal tracker, not a medical record. Keep originals of important documents elsewhere.

---

## Run it locally on your Mac (to try it first)

You don't strictly need this, but it's the fastest way to see it:

```bash
cd ~/AutismSessionTracker
python3 -m http.server 8123
```

Then open <http://localhost:8123> in Safari or Chrome on your Mac.
(Press `Ctrl+C` in Terminal to stop.)

> Note: the home-screen install and offline features only work over **HTTPS**, which is why we deploy
> to free hosting below before installing on your iPhone.

---

## Deploy it (free) and install on your iPhone

The goal: get the app on a public **HTTPS** URL, then add it to your iPhone home screen.
**GitHub Pages** is the recommended free host — and once it's set up, you can even edit and
re-deploy *from your phone*.

### Step 1 — Put the code on GitHub (one-time, from your Mac)

1. Create a free account at <https://github.com> if you don't have one.
2. Create a new **empty** repository, e.g. `session-tracker` (Public is fine; the app holds no data, only code).
3. In Terminal:

   ```bash
   cd ~/AutismSessionTracker
   git add .
   git commit -m "Autism session tracker PWA"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/session-tracker.git
   git push -u origin main
   ```

   (Replace `<YOUR-USERNAME>`. GitHub will ask you to sign in / paste a token the first time.)

### Step 2 — Turn on GitHub Pages

1. On GitHub, open your repo → **Settings** → **Pages**.
2. Under **Source**, choose **Deploy from a branch**.
3. Branch: **main**, folder: **/ (root)** → **Save**.
4. Wait ~1 minute. The page will show your live URL:

   ```
   https://<YOUR-USERNAME>.github.io/session-tracker/
   ```

### Step 3 — Install on your iPhone (this is the "deploy to your phone" part)

1. On your iPhone, open **Safari** (must be Safari, not Chrome) and go to the URL above.
2. Tap the **Share** button (the square with an up-arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Name it (e.g. "Sessions") → **Add**.

You now have an app icon on your home screen. Open it — it runs full-screen, works offline,
and keeps your data on the phone. 🎉

### Step 4 — Updating the app later (from your phone or Mac)

Because the service worker is **network-first**, any change you push goes live next time the app
is opened online — no reinstall needed.

- **From your Mac:** edit files, then `git add . && git commit -m "..." && git push`.
- **From your phone:** open the repo on github.com in your browser → tap a file → the pencil ✏️ →
  edit → **Commit changes**. GitHub Pages redeploys automatically in ~1 minute.

---

## Other hosting options (if you prefer)

- **Netlify Drop** — <https://app.netlify.com/drop>. Drag the `AutismSessionTracker` folder onto the page;
  you instantly get an HTTPS URL. Easiest, but updates mean re-dragging the folder.
- **Vercel** — `npx vercel` from the project folder, follow the prompts. Free HTTPS URL, redeploys on `git push`.

All three give you an HTTPS URL you can install from in Step 3.

---

## Editing the content

- **Daily activities** and **resource links** live in [`js/content.js`](js/content.js) — plain lists you can edit.
- You can also add your own activities/resources right inside the app (stored on-device).
- Colors and styling are in [`css/styles.css`](css/styles.css).

---

## Want a *native* App Store app instead?

That's a different path and **cannot** be deployed from your phone:
it requires **Xcode on a Mac**, a paid **Apple Developer account ($99/yr)**, and **App Store review**.
The PWA above avoids all of that and is usually the right choice for a personal tracker.
If you decide you need the native route later (e.g. for push notifications or App Store distribution),
the same screens can be rebuilt in Swift or wrapped with a tool like Capacitor — ask and I'll set it up.

## Project structure

```
index.html              app shell + tab bar
css/styles.css          all styling (light + dark mode)
js/app.js               app logic, views, session/date rules
js/db.js                on-device storage (IndexedDB)
js/content.js           default daily activities + resource links (edit me)
manifest.webmanifest    PWA metadata (name, icons, colors)
sw.js                   service worker (offline + auto-updating)
icons/                  app icons (regenerate with: python3 make_icons.py)
```
