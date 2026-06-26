# Autism Session Tracker

A simple, private app to track **OT**, **Speech**, and **ABA** therapy sessions — attendance,
documents, daily at-home activities, and recommended online resources.

Built as a **Progressive Web App (PWA)**: no App Store, no Apple Developer account, no monthly fees.
You add it to your iPhone home screen and it behaves like a normal app (own icon, full screen, works offline).

## What it does

- **Two tracks** — every plan belongs to a track: **At the Institute** (sessions with your professionals) or **At Home** (practice you run yourself). The dashboard and plans list are grouped by track.
- **Therapy plans**
  - **OT** and **Speech** → a cycle of **24 sessions** each.
  - **ABA** → a **monthly cycle** (starts on a date, ends the same date next month; tap *Start next month* to roll over).
- **Attendance** — tap a session → mark **Attended (Yes, green)** or **Missed (No, red)**. Untapped sessions stay grey.
- **Documents** — upload photos / PDFs / reports to a specific session (stored privately on your device).
- **Dashboards & charts** — daily-ritual **streak**, attendance **donut**, a 12-week activity **heatmap**, and a per-plan attendance **breakdown bar**.
- **Daily at-home checklist** — activities grouped by therapy area; resets each day.
- **Resources** — curated links to reputable OT / Speech / ABA resources. Add your own too.
- **Reminders** — optional daily nudge to complete the at-home activities (Settings → Daily reminder). On iPhone this needs the app added to the Home Screen.
- **Backup & restore** — Settings → export everything (including documents) to a file, and import it on another phone.
- **Private & offline** — all data lives in your browser/app storage on the device. Nothing is sent to any server.

> ⚠️ Because data is stored on the device, deleting the app or clearing site data erases it.
> Treat this as a personal tracker, not a medical record. Keep originals of important documents elsewhere.

---

## Run it locally on your Mac (to try it first)

You don't strictly need this, but it's the fastest way to see it:

```bash
cd ~/AutismIosApp
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
   cd ~/AutismIosApp
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

- **Netlify Drop** — <https://app.netlify.com/drop>. Drag the `AutismIosApp` folder onto the page;
  you instantly get an HTTPS URL. Easiest, but updates mean re-dragging the folder.
- **Vercel** — `npx vercel` from the project folder, follow the prompts. Free HTTPS URL, redeploys on `git push`.

All three give you an HTTPS URL you can install from in Step 3.

---

## Cloud sync setup (optional)

By default the app is fully on-device. Turn on **Firebase** sync to use it on multiple
devices, get automatic cloud backup, and let more than one caregiver share the same data.
It's free for this kind of personal use. ~10 minutes, one time.

1. **Create the project** — go to <https://console.firebase.google.com>, *Add project*
   (a name like `autism-session-tracker`; you can skip Google Analytics).
2. **Add a Web app** — on the project overview, click the **`</>`** (Web) icon, give it a
   nickname, *Register app*. Firebase shows a `firebaseConfig = { … }` block — keep it handy.
   (These values are not secret; they only identify your project.)
3. **Enable Email/Password sign-in** — left menu → *Build → Authentication → Get started →
   Sign-in method →* enable **Email/Password**.
4. **Create the database** — *Build → Firestore Database → Create database* (Production mode).
   Then open the **Rules** tab and paste:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
5. **Enable file storage** — *Build → Storage → Get started*. Open its **Rules** tab and paste:
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /users/{uid}/{allPaths=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
6. **Authorize your site** — *Authentication → Settings → Authorized domains → Add domain* →
   `YOUR-USERNAME.github.io` (and `localhost` for local testing).
7. **Plug it in** — open [`js/firebase-config.js`](js/firebase-config.js), paste your config
   values, and set `CLOUD_ENABLED = true`. Commit & push.
8. **Sign in** — open the app → ⚙️ *Settings → Account & sync → Create account*. On your first
   sign-in it offers to upload your existing on-device data. Sign in with the **same email &
   password** on any other phone (or give it to another caregiver) to share the same data.

> Just paste me the `firebaseConfig` block and I'll fill in step 7 for you.

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
