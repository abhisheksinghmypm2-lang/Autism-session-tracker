# Implementation plan — Push notifications for session reminders

Status: **planned, not built.** This adds true push reminders ("Aarav has Speech
Therapy at 4pm") that arrive even when the app is closed, on top of the in-app
reminders shipped in v27.

Effort: ~half a day of work + ~10 min of Firebase-console setup by the owner.
Cost: free for this usage (FCM is free; Cloud Scheduler free tier = 3 jobs).

---

## ⚠️ Read first: the iOS reality

- iOS supports web-push for PWAs **only on iOS 16.4+**, and **only when the app
  is installed to the Home Screen** (Add to Home Screen). It does **not** work in
  a Safari tab.
- The user must explicitly grant notification permission, and the permission
  prompt can only be triggered from a user gesture (a tap) on iOS.
- Delivery timing is at the OS's discretion — a "8:00am" reminder may arrive a
  little late. This is fine for a daily "today's sessions" nudge; it is **not**
  suitable for precise, time-critical alarms.
- Android/desktop Chrome have none of these restrictions.

Because of this, the design below sends **one daily digest per user each morning**
listing that day's scheduled sessions — robust against timing jitter — rather
than per-session timed alarms.

---

## Architecture

```
  [Client]                    [Firestore]                 [Cloud Function]
  request permission   ->   users/{uid}/                  scheduled daily 08:00
  get FCM token        ->     pushTokens/{token}    <---  read tokens + that day's
  store token                 (+ tz, enabled flag)        sessions, send FCM push
                                                                |
  [Service worker] <----------------- FCM push ---------------- +
  show notification / focus app on tap
```

Four pieces. Steps 3 (console) and the deploy in step 4 need the owner; the rest
is code.

---

## Step 1 — Console setup (owner, ~10 min)

1. Firebase Console → **Project settings → Cloud Messaging**. Confirm the
   Cloud Messaging API (V1) is enabled.
2. Same page → **Web configuration → Web Push certificates → Generate key pair**.
   Copy the **VAPID public key** (starts with a long base64 string).
3. Add it to `js/firebase-config.js`:
   ```js
   export const fcmVapidKey = 'BPx...your-public-key...';
   ```
   (Public key — safe to commit, same as the rest of firebaseConfig.)
4. Google Cloud Console → enable **Cloud Scheduler API** (the scheduled function
   needs it; first deploy will prompt if missing).

No secrets needed — FCM send auth uses the function's default service account.

---

## Step 2 — Service worker: receive & display (code)

The app uses one SW at `sw.js`. FCM's JS SDK expects a SW it can register for
messaging. Simplest path that avoids a second SW: use the **VAPID + Push API
directly** (no firebase-messaging-sw.js) OR add a dedicated
`firebase-messaging-sw.js`. Recommended: dedicated file, registered separately,
so the existing offline cache logic in `sw.js` stays untouched.

Create `firebase-messaging-sw.js` at repo root:
```js
importScripts('https://www.gstatic.com/firebasejs/10.x.x/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.x.x/firebase-messaging-compat.js');
firebase.initializeApp({ /* same firebaseConfig as js/firebase-config.js */ });
const messaging = firebase.messaging();
messaging.onBackgroundMessage(({ notification }) => {
  self.registration.showNotification(notification.title, {
    body: notification.body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: '/index.html#sessions' },
  });
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/index.html'));
});
```
(Match the firebasejs version to what `js/cloud.js` imports.)

> Note: keep the config here in sync with `js/firebase-config.js`. Consider a
> tiny build/copy step or a comment cross-linking the two so they don't drift.

---

## Step 3 — Client: permission + token (code)

Add to `js/cloud.js` (extends `createCloud`, which already wraps the Firebase app):
```js
import { getMessaging, getToken } from 'firebase/messaging';
// inside createCloud(...), after app init:
const messaging = getMessaging(app);
async function enablePush(vapidKey) {
  if (!('Notification' in window)) return { ok:false, reason:'unsupported' };
  const perm = await Notification.requestPermission();      // must be from a tap
  if (perm !== 'granted') return { ok:false, reason:perm };
  const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: swReg });
  if (!token) return { ok:false, reason:'no-token' };
  // store under the signed-in user so the function can find it
  await setDoc(doc(db, 'users', auth.currentUser.uid, 'pushTokens', token), {
    token, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, enabled: true, createdAt: serverTimestamp(),
  });
  return { ok:true, token };
}
```
Expose `enablePush` on the returned cloud object.

UI: in **Settings → Account & sync** (see `settingsModal` in `js/app.js`), add a
"🔔 Remind me about sessions" toggle. On enable, call
`cloud.enablePush(fcmVapidKey)` and show a snackbar with the result (handle the
`unsupported` / `denied` / not-installed-to-home-screen cases with friendly copy,
per the no-shame tone rule).

Gate it: only show when `currentUser && cloudHealthy` (same gate as AI generate).

---

## Step 4 — Scheduled Cloud Function: send the digest (code + deploy)

Add to `functions/index.js`:
```js
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { initializeApp } = require('firebase-admin/app');
initializeApp();
const db = getFirestore('autism');   // NAMED database — must match firestoreDatabaseId

exports.sendSessionReminders = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'Asia/Kolkata' },   // 08:00 IST daily
  async () => {
    const today = new Date().toISOString().slice(0,10);
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      // sessions are stored per-user; read this user's scheduled sessions for today.
      // NOTE: confirm the synced shape — app currently stores sessions in the
      // 'sessions' store, mirrored to cloud by syncToCloud() in js/app.js. Verify
      // the Firestore path/collection the cloud adapter writes to before querying.
      const sessions = await getTodaysScheduledSessions(db, userDoc.id, today);
      if (!sessions.length) continue;
      const title = sessions.length === 1
        ? `Reminder: ${sessions[0].pName} today`
        : `${sessions.length} sessions scheduled today`;
      const body = sessions.map(s => s.pType).join(' · ');
      const tokensSnap = await userDoc.ref.collection('pushTokens').where('enabled','==',true).get();
      const tokens = tokensSnap.docs.map(d => d.id);
      if (!tokens.length) continue;
      const res = await getMessaging().sendEachForMulticast({ tokens, notification: { title, body } });
      // prune dead tokens
      res.responses.forEach((r, i) => {
        if (!r.success && ['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code)) {
          tokensSnap.docs[i].ref.delete();
        }
      });
    }
  }
);
```

Add deps in `functions/package.json`: `firebase-admin` (already needed for
admin SDK) — confirm it's present, run `npm install` in `functions/`.

Deploy (owner approves):
```
cd functions && npm install && cd ..
firebase deploy --only functions:sendSessionReminders
```
First deploy enables Cloud Scheduler + creates the job. Confirm in
GCP Console → Cloud Scheduler that the job exists and is enabled.

> **Data-model check before writing the query:** verify exactly how sessions are
> stored per-user in Firestore. The client uses a swappable DB layer
> (`localDB` vs `cloud.db`) and `syncToCloud()` in `js/app.js`. The function must
> query the same collection/path and read `status === 'scheduled'` +
> `plannedDate === today`, joining program name/type. If sessions aren't yet
> namespaced per-user in Firestore, that namespacing is a prerequisite.

---

## Step 5 — Testing

1. **Local function test:** `firebase functions:shell` → call
   `sendSessionReminders()` after seeding a scheduled session for today.
2. **Token flow:** open the installed PWA on an iPhone (iOS 16.4+, Home Screen),
   toggle reminders on, confirm a `pushTokens/{token}` doc appears in Firestore.
3. **End-to-end:** temporarily change the schedule to `*/5 * * * *` (every 5 min)
   or trigger the job manually from Cloud Scheduler ("Force run"); confirm the
   notification arrives on the phone and tapping it opens the Sessions tab.
4. Revert the schedule to `0 8 * * *`.
5. **Dead-token pruning:** uninstall the PWA, force-run again, confirm the token
   doc is deleted.

---

## Open decisions (resolve when picking this up)

- **Time of day / timezone:** hard-coded 08:00 IST above. Better: store each
  user's tz with their token (the client already captures it) and bucket sends by
  tz, or let the user pick a reminder time in Settings.
- **Per-session vs daily digest:** daily digest chosen for iOS reliability. If
  precise per-session timing is wanted later, that's a bigger change (per-session
  scheduled tasks) and still subject to iOS timing jitter.
- **Quiet days:** no push sent when nothing is scheduled (already handled by the
  `continue`).
- **Multi-device:** the `pushTokens` subcollection supports multiple devices per
  user out of the box.

---

## Files touched (summary)

| File | Change |
|---|---|
| `firebase-messaging-sw.js` (new) | background push handler + notificationclick |
| `js/firebase-config.js` | add `fcmVapidKey` export |
| `js/cloud.js` | `enablePush()` — permission, token, store in Firestore |
| `js/app.js` | Settings toggle "🔔 Remind me about sessions" + snackbar states |
| `functions/index.js` | `sendSessionReminders` scheduled function |
| `functions/package.json` | ensure `firebase-admin` dep |
| `sw.js` | bump CACHE version |
