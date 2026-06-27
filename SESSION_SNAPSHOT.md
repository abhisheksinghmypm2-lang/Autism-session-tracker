# SESSION_SNAPSHOT.md

> Snapshot of the current working session, overwritten each time. For the durable
> project picture, read `CLAUDE.md`.

## Date & Context
- **Date:** 2026-06-28
- **What prompted this snapshot:** Bootstrapping persistent project memory — the
  user asked to scan the whole project and generate `CLAUDE.md` (long-term memory)
  and this `SESSION_SNAPSHOT.md` (resumable session state). Likely an account
  switch / handoff so another Claude instance can continue cold.

## What We Were Doing
- **Task:** a full read-through and documentation pass of the Autism Central PWA.
  No code/behavior changes were requested or made.
- **Goal:** produce accurate, specific project documentation grounded in the actual
  source, git history, and config — not generic boilerplate.

## Progress Made This Session
- **Scanned the whole repo:** `index.html`, all of `js/` (`app.js` ~2200 lines,
  `db.js`, `cloud.js`, `charts.js`, `content.js`, `firebase-config.js`),
  `functions/index.js`, `sw.js`, `manifest.webmanifest`, `firebase.json`,
  `.firebaserc`, `CNAME`, `.gitignore`, `css/styles.css` (header), README, and
  both `docs/` files. Reviewed `git log` (40 commits) and confirmed a clean tree.
- **Files created:**
  - `CLAUDE.md` — full project memory (overview, architecture, env/setup,
    conventions, current state, active work, decisions log, gotchas).
  - `SESSION_SNAPSHOT.md` — this file.
- **Key facts established (see CLAUDE.md for detail):**
  - It's a **vanilla-JS PWA**, not a native iOS app, despite the `AutismIosApp`
    folder name. Product name "Autism Central"; legacy internal app id
    `session-tracker` (used in IndexedDB name, SW cache prefix, backup format).
  - Cloud = Firebase project `autism-central-99c51`, **named Firestore DB `autism`**,
    region `us-central1`; 3 callable Cloud Functions using `@anthropic-ai/sdk`
    (model `claude-opus-4-8`): `generateHomePlan`, `weeklyRecap`, `concernIdeas`.
  - `js/db.js` (local IndexedDB) and `js/cloud.js` (Firebase) share an identical
    interface; `app.js` swaps `DB` between them and defaults to local so nothing hangs.

## Exactly Where We Left Off
- **Last thing done:** wrote `CLAUDE.md` and `SESSION_SNAPSHOT.md` to the repo root.
- **Very next action when resuming:** these two new files are **untracked** — review
  them, then commit if happy:
  ```bash
  cd ~/AutismIosApp
  git add CLAUDE.md SESSION_SNAPSHOT.md
  git commit -m "Add project memory (CLAUDE.md) + session snapshot"
  ```
- **No first command is strictly required** to resume coding — the tree was clean
  before these two doc files were added.

## Open Questions
- **Should the docs be committed?** They were created but not yet committed (awaiting
  the user). No git operations were performed this session.
- **Next feature direction not chosen.** The one major documented-but-unbuilt feature
  is **push notifications** (`docs/PUSH_NOTIFICATIONS.md`). Unconfirmed whether that's
  the intended next piece of work.

## Relevant Context
- **Latest commit:** `85598bc` — "Add in-app guided tour + user manual (v29)"
  (2026-06-27). Working tree was clean at session start.
- **Release ritual:** any frontend change must **bump the `CACHE` const in `sw.js`**
  (`session-tracker-vNN`) and use a matching `(vNN)` commit suffix, then `git push`
  (GitHub Pages auto-redeploys ~1 min). Currently at **v29**.
- **Live URL:** https://autism-central.in (GitHub Pages + `CNAME`).
- **AI/cloud setup is real:** secrets `ANTHROPIC_API_KEY` (required) and
  `YOUTUBE_API_KEY` (optional) live as Firebase function secrets, not in the repo.
- **Constraints to honor:** no build step / no framework / no TypeScript / phone-
  editable; privacy-first (on-device by default); strictly separate from the
  unrelated "Navyug School Website" project on this machine.
