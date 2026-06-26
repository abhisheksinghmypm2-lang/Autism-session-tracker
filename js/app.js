import { db as localDB, STORE, uid } from './db.js';
import { DEFAULT_CTAS, DEFAULT_RESOURCES, CAT_COLORS } from './content.js';
import { donut, ring, heatmap } from './charts.js';
import { CLOUD_ENABLED, firebaseConfig, firestoreDatabaseId } from './firebase-config.js';
import { createCloud } from './cloud.js';

// Active data layer: local IndexedDB by default, swapped to the cloud
// adapter when a user signs in (see cloud init at the bottom of this file).
let DB = localDB;
let cloud = null;
let currentUser = null;
let cloudHealthy = false;

/* ============================================================
   Session-type configuration
   - OT & Speech: a cycle of 24 sessions
   - ABA: a monthly cycle (start date -> same date next month)
   ============================================================ */
const TYPES = {
  OT:     { label: 'Occupational Therapy', total: 24, mode: 'fixed' },
  Speech: { label: 'Speech Therapy',       total: 24, mode: 'fixed' },
  ABA:    { label: 'ABA',                  total: null, mode: 'monthly' },
};
const COLORVAR = { OT: 'var(--ot)', Speech: 'var(--speech)', ABA: 'var(--aba)' };

// Two tracks: where the work happens.
const TRACKS = {
  Institute: { label: 'At the Institute', icon: 'institute', blurb: 'Therapy sessions with your professionals' },
  Home:      { label: 'At Home',          icon: 'home',      blurb: 'Practice & daily activities you run yourself' },
};

/* ---------------- inline icon set (line style, currentColor) ---------------- */
const ICONS = {
  institute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9.5 21v-3a2.5 2.5 0 0 1 5 0v3"/><path d="M9 9h.01M15 9h.01"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.6"/><path d="M9.5 21v-5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V21"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15v2M11.5 10v7M16 13v4M20.5 7v10"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.6C10.4 5.1 7.4 4.6 4 5.2v13c3.4-.6 6.4-.1 8 1.4 1.6-1.5 4.6-2 8-1.4v-13c-3.4-.6-6.4-.1-8 1.4Z"/><path d="M12 6.6v13.4"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1 3-1 5-2 6.5C8.5 11.7 8 13 8 14.5a4 4 0 0 0 8 0c0-1.7-1-3.2-2-4.5 2 1 3 3 3 5a5 5 0 0 1-10 0C7 11 9 7 12 3Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.4 12.2 2.6 2.6 4.6-5.2"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/></svg>',
};

// Contemporary color-coded stat chips for attended / missed / remaining.
function statChips(st) {
  const chip = (cls, icon, n, label) =>
    `<span class="chip ${cls}" title="${n} ${label}">${ic(icon)}<b>${n}</b></span>`;
  return `<div class="stat-chips">
    ${chip('chip-attended', 'check', st.attended, 'attended')}
    ${chip('chip-missed', 'cross', st.missed, 'missed')}
    ${chip('chip-remaining', 'clock', st.remaining, 'remaining')}
  </div>`;
}
const ic = (name) => `<span class="ic">${ICONS[name] || ''}</span>`;

/* ---------------- date helpers (all local-time, no UTC round-trips) ---------------- */
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayISO = () => toISO(new Date());
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function addMonths(iso, n) {
  const [y, m, dd] = iso.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0); // month overflow (Jan 31 -> Feb 28)
  return toISO(d);
}
function addDays(iso, n) {
  const [y, m, dd] = iso.split('-').map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/* ---------------- app state ---------------- */
const state = { view: 'dashboard', programId: null, programs: [], sessions: [], resFilter: 'All', sessionsTab: 'sessions', progressRange: 'month', dailyDate: '', sensoryOpen: false };

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============================================================
   Data operations
   ============================================================ */
async function loadPrograms() {
  state.programs = (await DB.getAll(STORE.programs))
    .map((p) => ({ track: 'Institute', ...p }))   // migrate older plans with no track
    .sort((a, b) => b.createdAt - a.createdAt);
}
async function loadSessions(programId) {
  state.sessions = (await DB.byIndex(STORE.sessions, 'programId', programId))
    .sort((a, b) => (a.number || 0) - (b.number || 0));
}
async function createProgram({ type, name, cycleStart, track, completed = 0 }) {
  const program = { id: uid(), type, track: track || 'Institute', name: name || TYPES[type].label, cycleStart, createdAt: Date.now() };
  await DB.put(STORE.programs, program);
  // `completed` = sessions already done before tracking started. They count as
  // attended but carry no individual date (flagged preTracked).
  if (TYPES[type].mode === 'fixed') {
    for (let i = 1; i <= TYPES[type].total; i++) {
      const s = blankSession(program.id, i);
      if (i <= completed) { s.status = 'attended'; s.preTracked = true; }
      await DB.put(STORE.sessions, s);
    }
  } else if (completed > 0) {
    for (let i = 1; i <= completed; i++) {
      const s = blankSession(program.id, i);
      s.status = 'attended'; s.preTracked = true;
      await DB.put(STORE.sessions, s);
    }
  } else {
    await DB.put(STORE.sessions, blankSession(program.id, 1, cycleStart));
  }
  return program;
}

// Quick-set how many sessions are completed to date. Only adds/removes
// "pre-tracked" markers — never overwrites sessions you've logged with a
// date, notes, documents, or an explicit miss.
async function adjustCompleted(delta) {
  const p = await DB.get(STORE.programs, state.programId);
  const sessions = (await DB.byIndex(STORE.sessions, 'programId', p.id)).sort((a, b) => a.number - b.number);
  const total = TYPES[p.type].total ?? sessions.length;
  const attended = sessions.filter((s) => s.status === 'attended').length;
  const target = Math.max(0, Math.min(total, attended + delta));
  if (target === attended) return;
  if (target > attended) {
    let need = target - attended;
    for (const s of sessions) {
      if (need <= 0) break;
      if (s.status === 'scheduled') { s.status = 'attended'; s.preTracked = true; await DB.put(STORE.sessions, s); need--; }
    }
  } else {
    let remove = attended - target;
    for (let i = sessions.length - 1; i >= 0 && remove > 0; i--) {
      const s = sessions[i];
      if (s.status === 'attended' && s.preTracked && !s.date && !s.notes && !(s.documents && s.documents.length)) {
        s.status = 'scheduled'; delete s.preTracked; await DB.put(STORE.sessions, s); remove--;
      }
    }
  }
  render();
}
function blankSession(programId, number, date = '') {
  return { id: uid(), programId, number, date, status: 'scheduled', notes: '', documents: [] };
}
async function deleteProgram(id) {
  const sess = await DB.byIndex(STORE.sessions, 'programId', id);
  for (const s of sess) await DB.delete(STORE.sessions, s.id);
  await DB.delete(STORE.programs, id);
}
function cycleEnd(program) {
  return TYPES[program.type].mode === 'monthly' ? addMonths(program.cycleStart, 1) : null;
}
function stats(program, sessions) {
  const attended = sessions.filter((s) => s.status === 'attended').length;
  const missed = sessions.filter((s) => s.status === 'missed').length;
  const total = TYPES[program.type].total ?? sessions.length;
  return { attended, missed, total, done: attended + missed, remaining: Math.max(0, total - attended - missed) };
}

/* ---------------- daily-ritual analytics ---------------- */
async function getCTAs() {
  const custom = (await DB.get(STORE.kv, 'customCtas'))?.value || [];
  return [...DEFAULT_CTAS, ...custom];
}
async function checkCountsByDate() {
  const all = await DB.getAll(STORE.checks);
  const map = {};
  for (const c of all) {
    if ((c.key.split('|')[1] || '').startsWith('ai:')) continue; // AI-plan steps don't count toward the daily-ritual streak
    const d = c.key.split('|')[0];
    map[d] = (map[d] || 0) + 1;
  }
  return map;
}

/* ---------------- AI home plan (generated from the therapist's plan) ---------------- */
const getAiPlan = async () => (await DB.get(STORE.kv, 'aiPlan'))?.value || null;
const saveAiPlan = (plan) => DB.put(STORE.kv, { key: 'aiPlan', value: plan });
const clearAiPlan = () => DB.delete(STORE.kv, 'aiPlan');
// AI step completion is stored in the checks store under an `ai:` itemId so it
// stays separate from the daily-ritual streak. dateForDay = weekStart + dayIdx.
const aiCheckKey = (dateISO, dayIdx, stepIdx) => `${dateISO}|ai:${dayIdx}:${stepIdx}`;
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]); // strip data: prefix
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function computeStreak(countsByDate, ctaCount) {
  if (!ctaCount) return 0;
  const complete = (iso) => (countsByDate[iso] || 0) >= ctaCount;
  let day = todayISO();
  if (!complete(day)) day = addDays(day, -1);
  let n = 0;
  while (complete(day)) { n++; day = addDays(day, -1); }
  return n;
}

/* ============================================================
   Rendering
   ============================================================ */
function setTitle(t) { el('view-title').textContent = t; }

async function render() {
  document.body.dataset.view = state.view;   // drives view-specific styling (e.g. the activity-page bokeh)
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  el('add-btn').style.display = (state.view === 'sessions' || state.view === 'dashboard') ? '' : 'none';
  window.scrollTo({ top: 0 });
  const v = el('view');
  switch (state.view) {
    case 'dashboard': setTitle('Today'); return renderDashboard(v);
    case 'sessions':  setTitle('Therapy Plans'); return renderPlans(v);
    case 'program':   return renderProgram(v);
    case 'cta':       setTitle('Daily At-Home'); return renderCTA(v);
    case 'resources': setTitle('Resources'); return renderResources(v);
  }
}

function greetingText() {
  const h = new Date().getHours();
  const word = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${word} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`;
}

/* ---------------- child profile (the app's one child, stored in kv) ---------------- */
const getChild = async () => (await DB.get(STORE.kv, 'childProfile'))?.value || null;
const saveChild = (c) => DB.put(STORE.kv, { key: 'childProfile', value: c });
const THERAPY_TYPES = ['Speech', 'OT', 'ABA', 'PT', 'Other'];
const childName = (child) => (child && child.displayName) ? child.displayName : 'your child';

function dashHeaderHtml(child) {
  const word = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
  const avatar = child?.photo
    ? `<img class="avatar" src="${child.photo}" alt="">`
    : `<div class="avatar avatar-fallback">${child?.displayName ? esc(child.displayName[0].toUpperCase()) : '🙂'}</div>`;
  const line = child?.displayName ? `${word}, ${esc(child.displayName)}'s parent 👋` : `${word} 👋`;
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return `<div class="dash-header" data-act="edit-child" role="button">
    ${avatar}
    <div class="dash-greet"><span class="dash-hi">${line}</span><span class="dash-date">${date}</span></div>
  </div>`;
}

// Crop+resize an uploaded image to a small square JPEG data URL (avatar storage).
function imageToAvatarDataUrl(file, size = 220) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas'); c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Aspect-preserving resize to a JPEG data URL (milestone photos).
function imageToDataUrl(file, max = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (Math.max(w, h) > max) { const r = max / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* ---------------- milestones (stored in kv) ---------------- */
const getMilestones = async () => (await DB.get(STORE.kv, 'milestones'))?.value || [];
const saveMilestones = (arr) => DB.put(STORE.kv, { key: 'milestones', value: arr });
const MILESTONE_CATS = { Communication: '#2563eb', Social: '#7c3aed', Independence: '#0f766e', Emotional: '#f59e0b', Physical: '#ea580c', Other: '#9b958a' };

/* ---------------- "Things to tell the therapist" (kv) ---------------- */
const getTNotes = async () => (await DB.get(STORE.kv, 'therapistNotes'))?.value || [];
const saveTNotes = (arr) => DB.put(STORE.kv, { key: 'therapistNotes', value: arr });

// Bottom snackbar with an optional action (used for undo on destructive actions).
let _snackTimer = null;
function showSnackbar(msg, actionLabel, onAction, ms = 4500) {
  document.getElementById('snackbar')?.remove();
  const s = document.createElement('div');
  s.id = 'snackbar'; s.className = 'snackbar';
  s.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button class="snack-btn">${esc(actionLabel)}</button>` : ''}`;
  document.body.appendChild(s);
  requestAnimationFrame(() => s.classList.add('show'));
  const close = () => { s.classList.remove('show'); setTimeout(() => s.remove(), 250); };
  if (actionLabel) s.querySelector('.snack-btn').addEventListener('click', () => { clearTimeout(_snackTimer); onAction && onAction(); close(); });
  clearTimeout(_snackTimer); _snackTimer = setTimeout(close, ms);
}

/* ---------------- parent wellbeing (kv map of dateISO -> 1..5; last 30 days) ---------------- */
const WB_EMOJI = ['😔', '😕', '😐', '🙂', '😊']; // index + 1 = score
const getWellbeing = async () => (await DB.get(STORE.kv, 'parentWellbeing'))?.value || {};
async function setWellbeing(score) {
  const wb = await getWellbeing();
  wb[todayISO()] = score;
  const keys = Object.keys(wb).sort();
  while (keys.length > 30) delete wb[keys.shift()];
  await DB.put(STORE.kv, { key: 'parentWellbeing', value: wb });
}
// True if two consecutive recent days are low (≤2) — drives the supportive card / resource pin.
function recentLowMood(wb) {
  const low = (d) => wb[d] != null && wb[d] <= 2;
  const d0 = todayISO(), d1 = addDays(d0, -1), d2 = addDays(d0, -2);
  return (low(d1) && low(d2)) || (low(d0) && low(d1));
}

/* ---------------- daily log (kv map of dateISO -> log; last 60 days) ---------------- */
const CHILD_MOOD = ['😢', '😟', '😐', '🙂', '😄'];
const TOGGLE_DEFS = [
  { key: 'sleep', icon: '💤', label: 'Sleep', opts: ['Good', 'Okay', 'Poor'] },
  { key: 'eating', icon: '🍽️', label: 'Eating', opts: ['Good', 'Picky', 'Refused'] },
  { key: 'medication', icon: '💊', label: 'Medication', opts: ['Given', 'Skipped', 'N/A'] },
  { key: 'homeExercise', icon: '🎯', label: 'Home exercise', opts: ['Done', 'Skipped', 'N/A'] },
];
const SENSORY_OPTS = ['Loud sounds', 'Bright lights', 'Crowds', 'Touch', 'Clothing', 'Food texture', 'Other'];
const getDailyLogs = async () => (await DB.get(STORE.kv, 'dailyLogs'))?.value || {};
const getDayLog = async (date) => (await getDailyLogs())[date] || {};
async function setDayLog(date, patch) {
  const all = await getDailyLogs();
  all[date] = { ...(all[date] || {}), ...patch };
  const keys = Object.keys(all).sort();
  while (keys.length > 60) delete all[keys.shift()];
  await DB.put(STORE.kv, { key: 'dailyLogs', value: all });
}

// Lightweight confetti burst (no library): a transient canvas of falling pieces.
function confettiBurst() {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:none';
  c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  const colors = ['#0f766e', '#f59e0b', '#22c55e', '#2563eb', '#7c3aed', '#ef4444'];
  const N = 90;
  const parts = Array.from({ length: N }, () => ({
    x: c.width / 2, y: c.height * 0.36,
    vx: (Math.cos(Math.random() * 6.283)) * (4 + Math.random() * 7),
    vy: (Math.sin(Math.random() * 6.283)) * (4 + Math.random() * 7) - 4,
    s: 5 + Math.random() * 6, rot: Math.random() * 6.283,
    col: colors[(Math.random() * colors.length) | 0],
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, c.width, c.height);
    frame++;
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += 0.2;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.globalAlpha = Math.max(0, 1 - frame / 80);
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
    }
    if (frame < 80) requestAnimationFrame(tick); else c.remove();
  })();
}

function planCardHtml(p, st) {
  const pct = st.total ? Math.round((st.attended / st.total) * 100) : 0;
  const end = cycleEnd(p);
  return `
    <div class="card plan-card tint-${p.type}" data-act="open" data-id="${p.id}">
      <div class="ring-wrap">${ring(pct, COLORVAR[p.type], { size: 56, stroke: 8, center: `<div class="big" style="font-size:14px">${pct}%</div>` })}</div>
      <div class="info">
        <span class="tag">${p.type}</span>
        <h2>${esc(p.name)}</h2>
        <div class="meta">${st.total ? `${st.attended}/${st.total} attended` : `${st.attended} attended`}${end ? ` · ends ${fmtDate(end)}` : ''}</div>
      </div>
      <div class="chev">›</div>
    </div>`;
}

/* ---------------- Dashboard (two tracks) ---------------- */
async function renderDashboard(v) {
  await loadPrograms();
  const child = await getChild();
  const milestones = await getMilestones();
  const wb = await getWellbeing();
  const ctas = await getCTAs();
  const counts = await checkCountsByDate();
  const doneToday = counts[todayISO()] || 0;
  const todayPct = ctas.length ? Math.round((doneToday / ctas.length) * 100) : 0;
  const streak = computeStreak(counts, ctas.length);

  const rows = [];
  for (const p of state.programs) {
    rows.push({ p, st: stats(p, await DB.byIndex(STORE.sessions, 'programId', p.id)) });
  }
  const inst = rows.filter((r) => r.p.track === 'Institute');
  const home = rows.filter((r) => r.p.track === 'Home');

  const sum = (list) => list.reduce((a, { st }) => ({ A: a.A + st.attended, M: a.M + st.missed, T: a.T + st.total }), { A: 0, M: 0, T: 0 });
  const iSum = sum(inst);
  const adherence = (iSum.A + iSum.M) ? Math.round((iSum.A / (iSum.A + iSum.M)) * 100) : 0;

  // activity heatmap (last 12 weeks of daily-ritual completion)
  const cells = [];
  for (let i = 83; i >= 0; i--) {
    const d = addDays(todayISO(), -i);
    const frac = ctas.length ? Math.min(1, (counts[d] || 0) / ctas.length) : 0;
    cells.push({ level: frac <= 0 ? 0 : Math.min(4, Math.ceil(frac * 4)), color: 'var(--green)', title: `${fmtDate(d)} — ${Math.round(frac * 100)}%` });
  }

  // ----- Institute track block -----
  let instBlock;
  if (inst.length) {
    const donutCard = (iSum.A + iSum.M) ? `
      <div class="card">
        <div class="stat-flex">
          ${donut([
            { value: iSum.A, color: 'var(--green)' },
            { value: iSum.M, color: 'var(--red)' },
            { value: Math.max(0, iSum.T - iSum.A - iSum.M), color: 'color-mix(in srgb, var(--muted) 22%, transparent)' },
          ], { center: `<div class="big">${adherence}%</div><div class="lbl">attended</div>` })}
          <div style="flex:1">
            <h2 style="margin-bottom:10px">Attendance</h2>
            <div class="legend">
              <span><i style="background:var(--green)"></i>${iSum.A} attended</span>
              <span><i style="background:var(--red)"></i>${iSum.M} missed</span>
              <span><i style="background:color-mix(in srgb,var(--muted) 35%,transparent)"></i>${Math.max(0, iSum.T - iSum.A - iSum.M)} upcoming</span>
            </div>
          </div>
        </div>
      </div>` : '';
    instBlock = donutCard + inst.map(({ p, st }) => planCardHtml(p, st)).join('');
  } else {
    instBlock = `<div class="card center" style="padding:22px">
      <p class="muted" style="margin:0 0 12px">No institute plans yet.</p>
      <button class="btn" data-act="new-plan" data-track="Institute" style="max-width:240px;margin:0 auto">Add a therapy plan</button>
    </div>`;
  }

  // ----- Home track block -----
  const streakBanner = `
    <div class="streak">
      <div class="flame-ico">${streak > 0 ? '🔥' : '🌱'}</div>
      <div>
        <div class="n">${streak} day${streak === 1 ? '' : 's'}</div>
        <div class="t">${streak > 0 ? 'Daily at-home ritual streak — keep it going!' : 'Complete today’s activities to start a streak'}</div>
      </div>
    </div>`;
  const todayCard = `
    <div class="card stat-flex" data-act="go-cta" style="cursor:pointer">
      <div class="ring-wrap">${ring(todayPct, 'var(--brand)', { size: 84, stroke: 11, center: `<div class="big" style="font-size:18px">${todayPct}%</div>` })}</div>
      <div style="flex:1">
        <h2>Today's at-home plan</h2>
        <p class="sub" style="margin:2px 0 0">${doneToday} of ${ctas.length} activities done</p>
      </div>
      <div class="chev" style="color:var(--muted);font-size:24px">›</div>
    </div>`;
  const heatCard = `
    <div class="card">
      <h2 style="margin-bottom:12px">Daily activity · last 12 weeks</h2>
      ${heatmap(cells)}
      <div class="hm-legend">Less
        <i style="background:color-mix(in srgb,var(--muted) 16%,transparent)"></i>
        <i style="background:var(--green);opacity:.45"></i>
        <i style="background:var(--green);opacity:.7"></i>
        <i style="background:var(--green)"></i>More</div>
    </div>`;
  const homeBlock = streakBanner + todayCard + heatCard + home.map(({ p, st }) => planCardHtml(p, st)).join('');

  const welcome = child ? '' : `
    <div class="card welcome-card" data-act="edit-child" role="button">
      <div class="welcome-emoji">💛</div>
      <h2>Welcome to Autism Central</h2>
      <p class="sub" style="margin:4px 0 12px">A loving record of your child's journey. Start by adding their profile — it personalizes everything.</p>
      <button class="btn" data-act="edit-child">Set up profile</button>
    </div>`;

  const latest = milestones.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const msCard = latest
    ? `<div class="card ms-recent" data-act="milestones" role="button">
        <div class="ms-star">★</div>
        <div style="flex:1;min-width:0">
          <div class="ms-recent-label">Latest milestone</div>
          <div class="ms-recent-text">${esc(latest.text)}</div>
          <div class="muted" style="font-size:12px;margin-top:2px">${fmtDate(latest.date)} · see all milestones →</div>
        </div>
      </div>`
    : (child ? `<div class="card ms-recent" data-act="add-milestone" role="button">
        <div class="ms-star">★</div>
        <div style="flex:1"><div class="ms-recent-text">Celebrate a win 🌟</div>
          <div class="muted" style="font-size:12.5px;margin-top:2px">Add ${esc(childName(child))}'s first milestone</div></div>
        <div class="chev">›</div>
      </div>` : '');

  const todayScore = wb[todayISO()];
  const wbCard = `<div class="card wb-card">
      <h2>How are <em>you</em> doing today?</h2>
      <div class="wb-row">${WB_EMOJI.map((e, i) =>
        `<button class="wb-emoji ${todayScore === i + 1 ? 'on' : ''}" data-act="wb-set" data-score="${i + 1}" aria-label="mood ${i + 1}">${e}</button>`).join('')}</div>
    </div>`;
  const supportCard = recentLowMood(wb) ? `<div class="card wb-support" data-act="go-resources" role="button">
      <div style="font-weight:800">Tough week. You're doing an incredible job. 💙</div>
      <p class="sub" style="margin:6px 0 0">Here are some resources just for you →</p>
    </div>` : '';

  v.innerHTML = `
    ${dashHeaderHtml(child)}
    ${welcome}
    ${supportCard}
    ${msCard}
    <div class="track-head">${ic('institute')}<span>${TRACKS.Institute.label}</span></div>
    ${instBlock}
    <div class="track-head" style="margin-top:24px">${ic('home')}<span>${TRACKS.Home.label}</span></div>
    ${homeBlock}
    ${wbCard}`;
}

/* ---------------- Plans list (grouped by track) ---------------- */
async function renderPlans(v) {
  await loadPrograms();
  const seg = `<div class="seg seg-tabs">
    <button class="${state.sessionsTab !== 'progress' ? 'on-brand' : ''}" data-act="sess-tab" data-tab="sessions">Sessions</button>
    <button class="${state.sessionsTab === 'progress' ? 'on-brand' : ''}" data-act="sess-tab" data-tab="progress">Progress</button>
  </div>`;
  if (state.sessionsTab === 'progress') return renderProgress(v, seg);
  const tnotes = await getTNotes();
  const tnBanner = tnotes.length
    ? `<div class="tn-banner" data-act="therapist-notes" role="button">📋 You have ${tnotes.length} thing${tnotes.length === 1 ? '' : 's'} to tell the therapist<span class="chev">›</span></div>`
    : `<button class="btn secondary small" data-act="therapist-notes" style="margin:0 0 14px">📋 Notes for the therapist</button>`;
  if (!state.programs.length) {
    v.innerHTML = `${seg}${tnBanner}
      <div class="empty"><div class="big">🧩</div>
      <p>No therapy plans yet.<br>Tap + to add OT, Speech, or ABA.</p>
      <button class="btn" data-act="new-plan" style="max-width:240px;margin:0 auto">New plan</button></div>`;
    return;
  }
  const rows = [];
  for (const p of state.programs) {
    const st = stats(p, await DB.byIndex(STORE.sessions, 'programId', p.id));
    rows.push({ p, st });
  }
  let html = '';
  for (const track of ['Institute', 'Home']) {
    const list = rows.filter((r) => r.p.track === track);
    if (!list.length) continue;
    html += `<div class="track-head">${ic(TRACKS[track].icon)}<span>${TRACKS[track].label}</span></div>`;
    for (const { p, st } of list) {
      const pct = st.total ? Math.round((st.attended / st.total) * 100) : 0;
      html += `
        <div class="card plan-card tint-${p.type}" data-act="open" data-id="${p.id}">
          <div class="ring-wrap">${ring(pct, COLORVAR[p.type], { size: 58, stroke: 8, center: `<div class="big" style="font-size:14px">${pct}%</div>` })}</div>
          <div class="info">
            <span class="tag">${p.type}</span>
            <h2>${esc(p.name)}</h2>
            <div class="meta">started ${fmtDate(p.cycleStart)}</div>
            ${statChips(st)}
          </div>
          <div class="chev">›</div>
        </div>`;
    }
  }
  v.innerHTML = seg + tnBanner + html;
}

/* ---------------- Progress view (inside the Sessions tab) ---------------- */
function barChart(data, { w = 320, h = 130 } = {}) {
  const pad = 18, base = h - 18, max = Math.max(1, ...data.map((d) => d.value));
  const bw = (w - pad * 2) / data.length;
  const bars = data.map((d, i) => {
    const bh = (d.value / max) * (base - 16);
    const x = pad + i * bw + bw * 0.18, y = base - bh;
    return `<rect x="${x}" y="${y}" width="${bw * 0.64}" height="${Math.max(2, bh)}" rx="4" fill="var(--brand)"></rect>
      ${d.value ? `<text x="${x + bw * 0.32}" y="${y - 4}" font-size="9" text-anchor="middle" fill="var(--muted)">${d.value}</text>` : ''}
      <text x="${x + bw * 0.32}" y="${h - 4}" font-size="8.5" text-anchor="middle" fill="var(--muted)">${esc(d.label)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

// Mood trend: data = [{ label, value(0-4)|null }]. Smooth line over weeks that
// have at least one logged mood; gaps in logging simply break the line.
function moodLineChart(data, { w = 320, h = 150 } = {}) {
  const padL = 30, padR = 12, padT = 14, padB = 20;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const n = data.length;
  const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (val) => padT + plotH - (val / 4) * plotH; // 0..4 -> bottom..top
  // gridlines at each mood level with emoji on the axis
  const grid = CHILD_MOOD.map((e, lvl) => {
    const gy = y(lvl);
    return `<line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="var(--line,#e2e8f0)" stroke-width="1"/>
      <text x="${padL - 6}" y="${gy + 4}" font-size="11" text-anchor="end">${e}</text>`;
  }).join('');
  // build polyline segments, breaking on null
  const pts = data.map((d, i) => (d.value == null ? null : { x: x(i), y: y(d.value), v: d.value }));
  let path = '', segStart = true;
  for (const p of pts) {
    if (!p) { segStart = true; continue; }
    path += `${segStart ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    segStart = false;
  }
  const line = path ? `<path d="${path}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const dots = pts.filter(Boolean).map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--brand)"/>`).join('');
  const xlabels = data.map((d, i) => `<text x="${x(i).toFixed(1)}" y="${h - 5}" font-size="8.5" text-anchor="middle" fill="var(--muted)">${esc(d.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet">${grid}${line}${dots}${xlabels}</svg>`;
}

function rangeStart(range) {
  if (range === 'all') return '1970-01-01';
  return addDays(todayISO(), range === '3months' ? -90 : -30);
}

async function renderProgress(v, seg) {
  const child = await getChild();
  const name = childName(child);
  // gather attended sessions (with dates) across all programs
  const attended = [];
  for (const p of state.programs) {
    const sess = await DB.byIndex(STORE.sessions, 'programId', p.id);
    for (const s of sess) if (s.status === 'attended' && s.date) attended.push(s.date);
  }
  const start = rangeStart(state.progressRange);
  const weeks = state.progressRange === '3months' ? 13 : state.progressRange === 'all' ? 12 : 5;
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wStart = addDays(todayISO(), -(i + 1) * 7 + 1), wEnd = addDays(todayISO(), -i * 7);
    const value = attended.filter((d) => d >= wStart && d <= wEnd).length;
    const label = new Date(wEnd + 'T00:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    buckets.push({ label, value });
  }
  const sessionsInRange = attended.filter((d) => d >= start).length;

  // mood trend — average logged child mood per week bucket (null when none)
  const dailyLogs = await getDailyLogs();
  const moodBuckets = [];
  let moodDays = 0;
  for (let i = weeks - 1; i >= 0; i--) {
    const wStart = addDays(todayISO(), -(i + 1) * 7 + 1), wEnd = addDays(todayISO(), -i * 7);
    const vals = [];
    for (const [d, log] of Object.entries(dailyLogs)) {
      if (d >= wStart && d <= wEnd && typeof log.childMood === 'number') { vals.push(log.childMood); moodDays++; }
    }
    const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const label = new Date(wEnd + 'T00:00:00').toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
    moodBuckets.push({ label, value });
  }
  const moodCard = moodDays
    ? `<div class="card"><h2 style="margin-bottom:8px">💛 How ${esc(name)} has been feeling</h2>
        ${moodLineChart(moodBuckets)}
        <p class="sub" style="margin:8px 0 0">${moodDays} ${moodDays === 1 ? 'day' : 'days'} logged in this period</p></div>`
    : '';

  // wins (milestones) in range + delta vs previous equal period
  const milestones = await getMilestones();
  const inRange = milestones.filter((m) => m.date >= start);
  let deltaTxt = '';
  if (state.progressRange !== 'all') {
    const span = state.progressRange === '3months' ? 90 : 30;
    const prevStart = addDays(todayISO(), -span * 2), prevEnd = addDays(todayISO(), -span);
    const prev = milestones.filter((m) => m.date >= prevStart && m.date < prevEnd).length;
    if (prev > 0) { const pct = Math.round(((inRange.length - prev) / prev) * 100); deltaTxt = ` — ${pct >= 0 ? '+' : ''}${pct}% vs last period ${pct >= 0 ? '🎉' : ''}`; }
  }

  const timeline = inRange.slice().sort((a, b) => (b.date < a.date ? -1 : 1)).map((m) => `
    <div class="tl2-item"><span class="tl2-dot" style="background:${MILESTONE_CATS[m.category] || MILESTONE_CATS.Other}"></span>
      <div><div class="tl2-text">${esc(m.text)}</div><div class="tl2-date">${fmtDate(m.date)} · ${esc(m.category || 'Other')}</div></div></div>`).join('')
    || `<p class="muted center" style="padding:12px">No milestones in this period yet.</p>`;

  const rangeBtn = (key, label) => `<button class="res-chip ${state.progressRange === key ? 'on' : ''}" data-act="prog-range" data-range="${key}">${label}</button>`;

  v.innerHTML = `${seg}
    <div class="res-filter-row">${rangeBtn('month', 'This month')}${rangeBtn('3months', 'Last 3 months')}${rangeBtn('all', 'All time')}</div>
    <h2 style="margin:4px 0 14px">Look how far ${esc(name)} has come</h2>
    <div class="card"><h2 style="margin-bottom:8px">${ic('chart')}Sessions delivered</h2>
      ${barChart(buckets)}
      <p class="sub" style="margin:8px 0 0">${sessionsInRange} attended in this period</p></div>
    ${moodCard}
    <div class="card"><div class="prog-bignum">${inRange.length}</div>
      <div style="font-weight:700">wins logged${deltaTxt}</div></div>
    <div class="card"><h2 style="margin-bottom:10px">🌟 Milestone timeline</h2>${timeline}</div>
    <button class="btn" data-act="export-report">⬇︎ Export report (PDF)</button>`;
}

async function exportReport() {
  const child = await getChild();
  const name = childName(child);
  const start = rangeStart(state.progressRange);
  const rangeLabel = state.progressRange === '3months' ? 'Last 3 months' : state.progressRange === 'all' ? 'All time' : 'This month';
  const rows = [], missed = [];
  for (const p of state.programs) {
    const sess = await DB.byIndex(STORE.sessions, 'programId', p.id);
    for (const s of sess) {
      if (s.status === 'attended' && s.date && s.date >= start) rows.push({ date: s.date, name: p.name, type: p.type, mood: s.sessionMood });
      else if (s.status === 'missed' && s.date && s.date >= start) missed.push({ date: s.date, name: p.name, type: p.type, reason: s.cancelReason });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  missed.sort((a, b) => (a.date < b.date ? 1 : -1));
  const milestones = (await getMilestones()).filter((m) => m.date >= start).sort((a, b) => (a.date < b.date ? 1 : -1));
  const tnotes = await getTNotes();
  // mood summary over the range
  const dailyLogs = await getDailyLogs();
  const moodVals = Object.entries(dailyLogs).filter(([d, l]) => d >= start && typeof l.childMood === 'number').map(([, l]) => l.childMood);
  const moodAvg = moodVals.length ? moodVals.reduce((a, b) => a + b, 0) / moodVals.length : null;
  const moodSummary = moodAvg == null ? '' :
    `<h2>How ${esc(name)} has been feeling (${moodVals.length} ${moodVals.length === 1 ? 'day' : 'days'})</h2>
     <p>Average mood: <strong>${CHILD_MOOD[Math.round(moodAvg)]} ${moodAvg.toFixed(1)} / 4</strong></p>`;
  const li = (s) => `<li>${s}</li>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} — Report</title>
    <style>body{font-family:-apple-system,Arial,sans-serif;color:#1e293b;padding:28px;max-width:720px;margin:auto;line-height:1.5}
    h1{color:#0f766e;margin-bottom:4px} h2{color:#0f766e;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin-top:28px}
    .meta{color:#64748b;margin-top:0} li{margin:5px 0}
    .cat{display:inline-block;background:#0f766e;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;margin-left:4px}
    button{margin-top:26px;padding:12px 20px;background:#0f766e;color:#fff;border:none;border-radius:10px;font-size:15px;cursor:pointer}
    @media print{button{display:none}}</style></head><body>
    <h1>${esc(name)} — Progress report</h1>
    <p class="meta">${rangeLabel} · generated ${fmtDate(todayISO())} · Autism Central</p>
    <h2>Sessions attended (${rows.length})</h2>
    <ul>${rows.map((r) => li(`${fmtDate(r.date)} — ${esc(r.name)} <span class="cat">${esc(r.type)}</span>${typeof r.mood === 'number' ? ` ${CHILD_MOOD[r.mood]}` : ''}`)).join('') || li('None in this period')}</ul>
    ${missed.length ? `<h2>Sessions missed (${missed.length})</h2>
    <ul>${missed.map((r) => li(`${fmtDate(r.date)} — ${esc(r.name)} <span class="cat">${esc(r.type)}</span>${r.reason ? ` — ${esc(r.reason)}` : ''}`)).join('')}</ul>` : ''}
    <h2>Milestones (${milestones.length})</h2>
    <ul>${milestones.map((m) => li(`<strong>${esc(m.text)}</strong> — ${fmtDate(m.date)} <span class="cat">${esc(m.category || 'Other')}</span>`)).join('') || li('None in this period')}</ul>
    ${moodSummary}
    <h2>Notes for the therapist (${tnotes.length})</h2>
    <ul>${tnotes.map((n) => li(`${esc(n.text)} <span class="meta">(${fmtDate(n.dateAdded)})</span>`)).join('') || li('None')}</ul>
    <button onclick="window.print()">Save as PDF / Print</button>
    <script>setTimeout(function(){window.print();},500);<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to export the report, then try again.'); return; }
  w.document.write(html); w.document.close();
}

/* ---------------- Single program (timeline + per-plan chart) ---------------- */
async function renderProgram(v) {
  const p = { track: 'Institute', ...(await DB.get(STORE.programs, state.programId)) };
  if (!p.id) { state.view = 'sessions'; return render(); }
  await loadSessions(p.id);
  setTitle(p.name);
  const st = stats(p, state.sessions);
  const end = cycleEnd(p);
  const monthly = TYPES[p.type].mode === 'monthly';
  const pct = st.total ? Math.round((st.attended / st.total) * 100) : 0;

  const items = state.sessions.map((s) => {
    const pill = s.status === 'attended' ? '<span class="pill yes">Yes · attended</span>'
      : s.status === 'missed' ? '<span class="pill no">No · missed</span>'
      : '<span class="pill none">Not logged</span>';
    return `
      <div class="tl-item ${s.status}">
        <div class="tl-node">${s.status === 'attended' ? '✓' : s.status === 'missed' ? '✕' : s.number}</div>
        <div class="tl-card" data-act="session" data-id="${s.id}">
          <div class="tl-top"><span class="tl-num">Session ${s.number}</span>${pill}</div>
          ${s.date ? `<div class="tl-date">${fmtDate(s.date)}${typeof s.sessionMood === 'number' ? ` · ${CHILD_MOOD[s.sessionMood]}` : ''}</div>` : (s.preTracked ? '<div class="tl-date">Completed before tracking</div>' : '<div class="tl-date">Tap to set date & status</div>')}
          ${s.status === 'missed' && s.cancelReason ? `<div class="tl-notes">Reason: ${esc(s.cancelReason)}</div>` : ''}
          ${s.notes ? `<div class="tl-notes">${esc(s.notes)}</div>` : ''}
          ${s.documents?.length ? `<div class="tl-docs">📎 ${s.documents.length} document${s.documents.length === 1 ? '' : 's'}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // "as of today" headline + completed-to-date stepper
  const cycleTotal = TYPES[p.type].total;            // null for ABA (monthly)
  const toGo = cycleTotal ? Math.max(0, cycleTotal - st.attended) : null;
  const toDate = cycleTotal
    ? `As of ${fmtDate(todayISO())} · <strong>${st.attended} of ${cycleTotal} done</strong> · ${toGo} to go`
    : `As of ${fmtDate(todayISO())} · <strong>${st.attended} session${st.attended === 1 ? '' : 's'} completed</strong> this cycle`;
  const stepper = cycleTotal ? `
    <div class="card">
      <div class="row-between">
        <div><h2 style="margin:0">${ic('chart')}Completed to date</h2>
          <p class="sub" style="margin:2px 0 0">Quick-set how many sessions are done</p></div>
        <div class="stepper">
          <button data-act="count-dec" aria-label="decrease">−</button>
          <span class="stepper-n">${st.attended}</span>
          <button data-act="count-inc" aria-label="increase">＋</button>
        </div>
      </div>
    </div>` : '';

  // per-plan breakdown bar
  const total = st.total || 1;
  const bar = `
    <div class="statbar">
      ${st.attended ? `<span style="flex:${st.attended};background:var(--green)"></span>` : ''}
      ${st.missed ? `<span style="flex:${st.missed};background:var(--red)"></span>` : ''}
      ${st.remaining ? `<span style="flex:${st.remaining};background:color-mix(in srgb,var(--muted) 22%,transparent)"></span>` : ''}
    </div>
    ${statChips(st)}`;

  v.innerHTML = `
    <button class="btn secondary small" data-act="back" style="margin:4px 0 14px">‹ All plans</button>
    <div class="card stat-flex tint-${p.type}">
      <div class="ring-wrap">${ring(pct, COLORVAR[p.type], { size: 92, stroke: 12, center: `<div class="big" style="font-size:20px">${pct}%</div><div class="lbl">done</div>` })}</div>
      <div style="flex:1">
        <span class="tag">${p.type}</span>
        <h2 style="margin-top:6px">${esc(p.name)}</h2>
        <div class="meta" style="color:var(--muted);font-size:12.5px;margin-top:4px">${ic(TRACKS[p.track].icon)}${TRACKS[p.track].label} · started ${fmtDate(p.cycleStart)}${end ? `<br>Cycle ends ${fmtDate(end)}` : ''}</div>
        <div class="todate">${toDate}</div>
      </div>
    </div>
    ${stepper}
    <div class="card">
      <h2>${ic('chart')}Attendance breakdown</h2>
      ${bar}
    </div>
    <div class="section-title">${ic('activity')}Session timeline</div>
    <div class="timeline">${items}</div>
    ${monthly ? `<div class="btn-row" style="margin-top:8px">
        <button class="btn secondary" data-act="add-session">+ Add session</button>
        <button class="btn secondary" data-act="next-cycle">Next month →</button>
      </div>` : ''}
    <button class="btn danger" data-act="del-plan" style="margin-top:22px">Delete this plan</button>`;
}

/* ---------------- Daily CTA ---------------- */
async function renderCTA(v) {
  const child = await getChild();
  const name = childName(child);
  const date = state.dailyDate || todayISO();
  const isToday = date === todayISO();
  const log = await getDayLog(date);
  const logs = await getDailyLogs();

  // last-7-days date strip
  const strip = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(todayISO(), -(6 - i));
    const dt = new Date(d + 'T00:00:00');
    const has = logs[d] && (logs[d].childMood || logs[d].win || logs[d].concern);
    return `<button class="day-pill ${d === date ? 'on' : ''}" data-act="daily-date" data-date="${d}">
      <span>${dt.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</span><b>${dt.getDate()}</b>${has ? '<i class="day-dot"></i>' : ''}</button>`;
  }).join('');

  const doneN = [log.childMood, log.win, log.concern,
    (log.sleep || log.eating || log.medication || log.homeExercise),
    (log.sensory && log.sensory.length)].filter(Boolean).length;

  const moodBtns = CHILD_MOOD.map((e, i) =>
    `<button class="wb-emoji big ${log.childMood === i + 1 ? 'on' : ''}" data-act="child-mood" data-score="${i + 1}" data-date="${date}">${e}</button>`).join('');

  const toggles = TOGGLE_DEFS.map((t) => `
    <div class="toggle-row"><div class="toggle-label">${t.icon} ${t.label}</div>
      <div class="seg toggle-seg">${t.opts.map((o) =>
        `<button class="${log[t.key] === o ? 'on-brand' : ''}" data-act="daily-toggle" data-key="${t.key}" data-val="${o}" data-date="${date}">${o}</button>`).join('')}</div>
    </div>`).join('');

  const sensorySel = new Set(log.sensory || []);
  const sensoryBlock = (state.sensoryOpen || sensorySel.size)
    ? `<div class="chip-row" style="margin-top:8px">${SENSORY_OPTS.map((s) =>
        `<button class="chip-select ${sensorySel.has(s) ? 'on' : ''}" data-act="daily-sensory" data-val="${esc(s)}" data-date="${date}">${s}</button>`).join('')}</div>`
    : `<button class="btn secondary small" data-act="sensory-open" style="margin-top:8px">+ Add sensory note</button>`;

  const concernPrompt = (log.concern && !log.concernHandled)
    ? `<div class="concern-prompt">Add this to your therapist list?
        <button class="btn secondary small" data-act="concern-yes" data-date="${date}">Yes</button>
        <button class="btn secondary small" data-act="concern-no" data-date="${date}">No</button></div>` : '';

  // existing at-home activities (kept below the daily log)
  const ctas = await getCTAs();
  const counts = await checkCountsByDate();
  const doneToday = counts[todayISO()] || 0;
  const actPct = ctas.length ? Math.round((doneToday / ctas.length) * 100) : 0;
  let actRows = '';
  for (const c of ctas) {
    const cdone = !!(await DB.get(STORE.checks, `${todayISO()}|${c.id}`));
    actRows += `<div class="check-item ${cdone ? 'done' : ''}" data-act="toggle-cta" data-id="${c.id}">
      <div class="check-box">${cdone ? '✓' : ''}</div><div class="check-text">${esc(c.text)}</div>
      <span class="check-cat" style="background:${CAT_COLORS[c.cat] || '#888'}">${c.cat}</span></div>`;
  }

  v.innerHTML = `
    <div class="day-strip">${strip}</div>
    <div class="row-between" style="margin:2px 4px 12px">
      <h2 style="margin:0">Daily moments</h2>
      <span class="muted" style="font-size:13px">${doneN} of 5 logged ${doneN >= 5 ? '✓' : ''}</span>
    </div>
    ${!isToday ? `<div class="muted" style="font-size:12.5px;margin:-6px 4px 10px">Viewing ${fmtDate(date)}</div>` : ''}

    <div class="card"><h2>How was ${esc(name)} today?</h2>
      <div class="wb-row" style="margin-top:12px">${moodBtns}</div></div>

    <div class="card"><h2>A moment worth remembering 🌟</h2>
      <p class="sub" style="margin:2px 0 8px">Optional</p>
      <textarea id="daily-win" maxlength="200" placeholder="e.g. Said thank you unprompted…">${esc(log.win || '')}</textarea></div>

    <div class="card"><h2>Anything to note? 📝</h2>
      <p class="sub" style="margin:2px 0 8px">Optional</p>
      <textarea id="daily-concern" placeholder="e.g. Meltdown at the supermarket…">${esc(log.concern || '')}</textarea>
      ${concernPrompt}</div>

    <div class="card"><h2>Quick log</h2><div style="margin-top:8px">${toggles}</div></div>

    <div class="card"><h2>Any sensory triggers today?</h2>${sensoryBlock}</div>

    <div class="section-title">${ic('home')}Home activities</div>
    <div class="card stat-flex">
      <div class="ring-wrap">${ring(actPct, 'var(--green)', { size: 64, stroke: 9, center: `<div class="big" style="font-size:14px">${actPct}%</div>` })}</div>
      <div style="flex:1"><h2>Today's activities</h2><p class="sub" style="margin:2px 0 0">${doneToday}/${ctas.length} complete</p></div>
    </div>
    ${await aiTodayCardHtml()}
    <div class="card">${actRows}</div>
    <button class="btn secondary" data-act="add-cta">+ Add my own activity</button>

    <button class="btn daily-save" data-act="daily-save">Save today's log ✓</button>`;

  const win = el('daily-win'), concern = el('daily-concern');
  if (win) win.addEventListener('input', () => setDayLog(date, { win: win.value }));
  if (concern) {
    concern.addEventListener('input', () => setDayLog(date, { concern: concern.value }));
    concern.addEventListener('blur', () => { if (concern.value && !log.concernHandled) render(); });
  }
}

/* Today's slice of the AI-generated weekly plan, shown on the Daily tab. */
async function aiTodayCardHtml() {
  const plan = await getAiPlan();
  if (!plan || !Array.isArray(plan.days)) {
    return `<div class="card ai-cta" data-act="ai-generate" style="cursor:pointer">
      <h2>${ic('chart')}Therapist-based home plan</h2>
      <p class="sub" style="margin:2px 0 10px">Upload your therapist's weekly plan and let AI turn it into a daily 15-minute routine.</p>
      <button class="btn" data-act="ai-generate">✨ Generate this week's plan</button>
    </div>`;
  }
  const idx = Math.floor((new Date(todayISO()) - new Date(plan.weekStartDate)) / 86400000);
  const day = plan.days[idx];
  const header = `<div class="row-between"><h2 style="margin:0">${ic('chart')}Therapist-based plan</h2>
      <button class="btn secondary small" data-act="ai-view">Full week</button></div>`;
  if (idx < 0 || idx >= plan.days.length || !day) {
    return `<div class="card">${header}<p class="sub" style="margin:8px 0 0">This week's plan is set. Open “Full week” to view it, or regenerate for the current week.</p></div>`;
  }
  let steps = '';
  for (let j = 0; j < (day.steps || []).length; j++) {
    const s = day.steps[j];
    const done = !!(await DB.get(STORE.checks, aiCheckKey(todayISO(), idx, j)));
    steps += `
      <div class="check-item ${done ? 'done' : ''}" data-act="toggle-ai" data-d="${idx}" data-s="${j}">
        <div class="check-box">${done ? '✓' : ''}</div>
        <div class="check-text">${esc(s.text)}${s.minutes ? ` <span class="muted">· ${s.minutes} min</span>` : ''}</div>
      </div>`;
  }
  const video = day.video
    ? `<a class="btn secondary small" href="${esc(day.video.url)}" target="_blank" rel="noopener" style="margin-top:8px">▶ ${esc(day.video.title.slice(0, 40))}…</a>`
    : '';
  return `<div class="card">
    ${header}
    <div class="meta" style="color:var(--muted);font-size:12.5px;margin:6px 0 4px">${esc(day.label || 'Today')}${day.area ? ` · ${day.area}` : ''}</div>
    ${steps}
    ${video}
  </div>`;
}

/* ---------------- Resources ---------------- */
async function getResources() {
  const custom = (await DB.get(STORE.kv, 'customResources'))?.value || [];
  return [...DEFAULT_RESOURCES, ...custom];
}
async function renderResources(v) {
  const res = await getResources();
  const wb = await getWellbeing();
  // Contextual pin: if the parent's mood has been low two days running, surface support for them.
  const pin = recentLowMood(wb) ? `
    <a class="card res-item wb-pin" href="https://www.autismspeaks.org/tool-kit/family-support-tool-kit" target="_blank" rel="noopener">
      <h3>Support for you — you matter too 💙</h3>
      <p>Caregiving is hard. A few gentle resources for parents and caregivers.</p>
      <span class="host">autismspeaks.org ↗</span>
    </a>` : '';
  // Category filter chips (horizontal scroll): All + the categories present.
  const cats = ['All', ...[...new Set(res.map((r) => r.cat))]];
  if (!cats.includes(state.resFilter)) state.resFilter = 'All';
  const chips = `<div class="res-filter-row">${cats.map((c) =>
    `<button class="res-chip ${state.resFilter === c ? 'on' : ''}" data-act="res-filter" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
  const shown = res.filter((r) => state.resFilter === 'All' || r.cat === state.resFilter);
  const cards = shown.map((r) => {
    let host = ''; try { host = new URL(r.url).hostname.replace('www.', ''); } catch {}
    return `<a class="card res-item" href="${esc(r.url)}" target="_blank" rel="noopener">
        <span class="tag">${esc(r.cat)}</span>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.desc)}</p>
        <span class="host">${esc(host)} ↗</span>
      </a>`;
  }).join('');
  v.innerHTML = `${chips}${pin}${cards}
    <button class="btn secondary" data-act="add-res" style="margin-top:8px">+ Add a resource link</button>
    <div class="section-title" style="margin-top:22px">⚙️ More</div>
    <button class="btn secondary" data-act="open-settings">Settings &amp; backup</button>`;
}

/* ============================================================
   Modal helper
   ============================================================ */
function openModal(innerHTML) {
  const root = el('modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal"><div class="modal-handle"></div>${innerHTML}</div></div>`;
  root.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
  });
}
function closeModal() { el('modal-root').innerHTML = ''; }

/* ---------------- New plan modal ---------------- */
function newPlanModal(defaultTrack = 'Institute') {
  openModal(`
    <h2>New therapy plan</h2>
    <p class="modal-sub">OT & Speech run 24 sessions. ABA runs a monthly cycle.</p>
    <label class="field"><span>Track</span>
      <div class="seg" id="track-seg">
        <button data-track="Institute" class="on-brand">🏛️ Institute</button>
        <button data-track="Home">🏠 Home</button>
      </div>
    </label>
    <label class="field"><span>Type</span>
      <div class="seg" id="type-seg">
        <button data-type="OT" class="on-OT">OT</button>
        <button data-type="Speech">Speech</button>
        <button data-type="ABA">ABA</button>
      </div>
    </label>
    <label class="field"><span>Plan name (optional)</span>
      <input id="plan-name" placeholder="e.g. OT with Dr. Mehta" /></label>
    <label class="field"><span>Start date</span>
      <input id="plan-date" type="date" value="${todayISO()}" /></label>
    <label class="field"><span>Sessions already completed (before today)</span>
      <input id="plan-completed" type="number" inputmode="numeric" min="0" value="0" />
      <span style="font-weight:400;color:var(--muted);font-size:12px;margin-top:6px">Already partway? Enter how many you've done. They'll count toward your total (no dates needed).</span>
    </label>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="save-plan">Create plan</button>
    </div>`);
  let track = defaultTrack, type = 'OT';
  const seg = (id, attr, val, cls) => {
    el(id).querySelectorAll('button').forEach((x) => x.className = '');
    el(id).querySelector(`button[data-${attr}="${val}"]`).className = cls;
  };
  seg('track-seg', 'track', track, 'on-brand');
  el('track-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-track]'); if (!b) return;
    track = b.dataset.track; seg('track-seg', 'track', track, 'on-brand');
  });
  el('type-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]'); if (!b) return;
    type = b.dataset.type; seg('type-seg', 'type', type, `on-${type}`);
  });
  el('save-plan').addEventListener('click', async () => {
    const cycleStart = el('plan-date').value || todayISO();
    let completed = Math.max(0, parseInt(el('plan-completed').value, 10) || 0);
    if (TYPES[type].total) completed = Math.min(completed, TYPES[type].total);
    const p = await createProgram({ type, track, name: el('plan-name').value.trim(), cycleStart, completed });
    closeModal(); state.view = 'program'; state.programId = p.id; render();
  });
}

/* ---------------- documents: cloud Storage when signed in, local blob otherwise ---------------- */
async function saveDocFile(file) {
  if (cloud && currentUser) return cloud.uploadDocument(file);
  return { id: uid(), name: file.name, type: file.type, size: file.size, blob: file };
}
function openDoc(d) {
  if (d?.url) window.open(d.url, '_blank');
  else if (d?.blob) window.open(URL.createObjectURL(d.blob), '_blank');
}
async function removeDoc(d) {
  if (d?.path && cloud) await cloud.deleteDocument(d.path);
}

/* ---------------- Session detail modal ---------------- */
async function sessionModal(id) {
  const s = await DB.get(STORE.sessions, id);
  if (!s) return;
  const docs = (s.documents || []).map((d, i) => `
    <div class="doc-row">
      <span>${d.type?.startsWith('image/') ? '🖼️' : d.type === 'application/pdf' ? '📄' : '📎'}</span>
      <span class="doc-name" data-act="view-doc" data-i="${i}" style="cursor:pointer">${esc(d.name)}</span>
      <button class="btn danger small" data-act="del-doc" data-i="${i}">Remove</button>
    </div>`).join('') || '<p class="muted center" style="padding:8px">No documents yet</p>';

  openModal(`
    <h2>Session ${s.number}</h2>
    <p class="modal-sub">Mark attendance, add notes, and attach documents.</p>
    <label class="field"><span>Status</span>
      <div class="seg" id="status-seg">
        <button data-status="attended" class="${s.status === 'attended' ? 'on-green' : ''}">Attended · Yes</button>
        <button data-status="missed" class="${s.status === 'missed' ? 'on-red' : ''}">Missed · No</button>
      </div>
    </label>
    <label class="field"><span>Date</span><input id="s-date" type="date" value="${s.date || ''}" /></label>
    <div class="field" id="mood-field"><span>How did it go?</span>
      <div class="wb-row" id="s-mood">${CHILD_MOOD.map((e, i) => `<button type="button" class="wb-emoji${s.sessionMood === i ? ' on' : ''}" data-mood="${i}">${e}</button>`).join('')}</div>
    </div>
    <label class="field" id="reason-field"><span>Reason for missing <span class="muted">(optional)</span></span>
      <input id="s-reason" placeholder="e.g. unwell, travel, clashed with school" value="${esc(s.cancelReason || '')}" /></label>
    <label class="field"><span>Notes</span>
      <textarea id="s-notes" placeholder="What was worked on, progress, homework…">${esc(s.notes)}</textarea></label>
    <div class="section-title" style="margin-left:0">Documents</div>
    <div id="doc-list">${docs}</div>
    <label class="btn secondary" style="margin-top:8px;cursor:pointer">
      📎 Upload document / photo
      <input id="doc-input" type="file" accept="image/*,application/pdf,.doc,.docx" multiple hidden />
    </label>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn secondary" data-act="cancel">Close</button>
      <button class="btn" id="save-session">Save</button>
    </div>`);

  let status = s.status;
  let sessionMood = typeof s.sessionMood === 'number' ? s.sessionMood : null;
  const syncFields = () => {
    el('mood-field').style.display = status === 'attended' ? '' : 'none';
    el('reason-field').style.display = status === 'missed' ? '' : 'none';
  };
  syncFields();
  el('status-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]'); if (!b) return;
    status = (status === b.dataset.status) ? 'scheduled' : b.dataset.status;
    el('status-seg').querySelectorAll('button').forEach((x) => x.className = '');
    if (status === 'attended') b.className = 'on-green';
    if (status === 'missed') b.className = 'on-red';
    syncFields();
  });
  el('s-mood').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mood]'); if (!b) return;
    const m = +b.dataset.mood;
    sessionMood = (sessionMood === m) ? null : m;
    el('s-mood').querySelectorAll('button').forEach((x) => x.classList.toggle('on', +x.dataset.mood === sessionMood));
  });
  el('doc-input').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      s.documents = s.documents || [];
      s.documents.push(await saveDocFile(file));
    }
    await DB.put(STORE.sessions, s); sessionModal(id);
  });
  el('doc-list').addEventListener('click', async (e) => {
    const view = e.target.closest('[data-act="view-doc"]');
    const del = e.target.closest('[data-act="del-doc"]');
    if (view) openDoc(s.documents[+view.dataset.i]);
    if (del) { await removeDoc(s.documents[+del.dataset.i]); s.documents.splice(+del.dataset.i, 1); await DB.put(STORE.sessions, s); sessionModal(id); }
  });
  el('save-session').addEventListener('click', async () => {
    s.status = status; s.date = el('s-date').value; s.notes = el('s-notes').value;
    if (status === 'attended' && sessionMood != null) s.sessionMood = sessionMood; else delete s.sessionMood;
    const reason = el('s-reason').value.trim();
    if (status === 'missed' && reason) s.cancelReason = reason; else delete s.cancelReason;
    if (status !== 'scheduled' && !s.date) s.date = todayISO();
    await DB.put(STORE.sessions, s); closeModal(); render();
  });
}

/* ---------------- Add custom CTA / resource ---------------- */
function addCtaModal() {
  openModal(`
    <h2>Add daily activity</h2>
    <label class="field"><span>Activity</span><input id="cta-text" placeholder="e.g. 10 min sensory play" /></label>
    <label class="field"><span>Area</span>
      <select id="cta-cat"><option>General</option><option>OT</option><option>Speech</option><option>ABA</option></select></label>
    <div class="btn-row"><button class="btn secondary" data-act="cancel">Cancel</button><button class="btn" id="save-cta">Add</button></div>`);
  el('save-cta').addEventListener('click', async () => {
    const text = el('cta-text').value.trim(); if (!text) return;
    const cur = (await DB.get(STORE.kv, 'customCtas'))?.value || [];
    cur.push({ id: 'cta-' + uid(), cat: el('cta-cat').value, text });
    await DB.put(STORE.kv, { key: 'customCtas', value: cur }); closeModal(); render();
  });
}
function addResModal() {
  openModal(`
    <h2>Add resource</h2>
    <label class="field"><span>Title</span><input id="r-title" /></label>
    <label class="field"><span>Link (URL)</span><input id="r-url" type="url" placeholder="https://" /></label>
    <label class="field"><span>Note</span><input id="r-desc" /></label>
    <label class="field"><span>Area</span>
      <select id="r-cat"><option>General</option><option>OT</option><option>Speech</option><option>ABA</option></select></label>
    <div class="btn-row"><button class="btn secondary" data-act="cancel">Cancel</button><button class="btn" id="save-res">Add</button></div>`);
  el('save-res').addEventListener('click', async () => {
    const title = el('r-title').value.trim(), url = el('r-url').value.trim();
    if (!title || !url) return;
    const cur = (await DB.get(STORE.kv, 'customResources'))?.value || [];
    cur.push({ id: 'res-' + uid(), cat: el('r-cat').value, title, url, desc: el('r-desc').value.trim() });
    await DB.put(STORE.kv, { key: 'customResources', value: cur }); closeModal(); render();
  });
}

/* ---------------- AI home-plan generation (calls the Cloud Function) ---------------- */
async function toggleAi(dateISO, dayIdx, stepIdx) {
  const key = aiCheckKey(dateISO, dayIdx, stepIdx);
  const cur = await DB.get(STORE.checks, key);
  if (cur) await DB.delete(STORE.checks, key); else await DB.put(STORE.checks, { key, done: true });
}

function aiGenerateModal() {
  if (!CLOUD_ENABLED || !cloud) {
    openModal(`<h2>Cloud sync needed</h2><p class="modal-sub">AI generation runs securely in the cloud. It isn't configured on this build.</p><button class="btn secondary" data-act="cancel">Close</button>`);
    return;
  }
  if (!currentUser || !cloudHealthy) {
    openModal(`<h2>Sign in first</h2><p class="modal-sub">AI generation needs your account. Open ⚙️ Settings → Account & sync, sign in, then try again.</p><button class="btn secondary" data-act="cancel">Close</button>`);
    return;
  }
  openModal(`
    <h2>Generate home plan</h2>
    <p class="modal-sub">Add your therapist's weekly plan — a photo or pasted text — and AI builds a 7-day, ~15-min daily routine with videos.</p>
    <label class="btn secondary" style="cursor:pointer;margin-bottom:8px">📷 Upload plan photo
      <input id="ai-image" type="file" accept="image/*" hidden></label>
    <div id="ai-image-name" class="muted" style="font-size:12px;margin-bottom:12px"></div>
    <label class="field"><span>…or paste the plan text</span>
      <textarea id="ai-text" placeholder="e.g. OT: pencil grip & scissor skills. Speech: target /s/ words. ABA: requesting with PECS."></textarea></label>
    <label class="field"><span>About your child (optional)</span>
      <input id="ai-context" placeholder="e.g. 5 yrs, minimally verbal, loves music"></label>
    <label class="field"><span>Week starts</span><input id="ai-week" type="date" value="${todayISO()}"></label>
    <div id="ai-status" class="muted" style="font-size:13px;margin:8px 0"></div>
    <div class="btn-row">
      <button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="ai-go">✨ Generate</button>
    </div>`);
  let imageFile = null;
  el('ai-image').addEventListener('change', (e) => {
    imageFile = e.target.files[0] || null;
    el('ai-image-name').textContent = imageFile ? `Selected: ${imageFile.name}` : '';
  });
  el('ai-go').addEventListener('click', async () => {
    const text = el('ai-text').value.trim();
    if (!imageFile && !text) { alert('Add a photo or paste the plan text first.'); return; }
    const status = el('ai-status'), btn = el('ai-go');
    btn.disabled = true; status.style.color = 'var(--muted)';
    status.textContent = '⏳ Reading the plan and researching activities — this can take up to a minute…';
    try {
      const payload = {
        weekStartDate: el('ai-week').value || todayISO(),
        childContext: el('ai-context').value.trim() || undefined,
      };
      if (text) payload.planText = text;
      if (imageFile) { payload.planImageBase64 = await fileToBase64(imageFile); payload.planImageMediaType = imageFile.type || 'image/jpeg'; }
      const result = await cloud.callFunction('generateHomePlan', payload);
      const plan = result?.plan;
      if (!plan || !Array.isArray(plan.days)) throw new Error('No plan was returned.');
      plan.weekStartDate = payload.weekStartDate;
      aiPreviewModal(plan);
    } catch (e) {
      status.style.color = 'var(--red)';
      status.textContent = 'Generation failed: ' + (e?.message || e);
      btn.disabled = false;
    }
  });
}

function aiPreviewModal(plan) {
  const days = plan.days.map((d, i) => `
    <div class="card" style="padding:12px;margin-bottom:8px">
      <div style="font-weight:700">${esc(d.label || ('Day ' + (i + 1)))}${d.area ? ` · <span class="muted">${esc(d.area)}</span>` : ''}</div>
      ${(d.steps || []).map((s) => `<div style="font-size:13px;margin-top:4px">• ${esc(s.text)}${s.minutes ? ` <span class="muted">(${s.minutes}m)</span>` : ''}</div>`).join('')}
      ${d.video ? `<div style="font-size:12px;color:var(--brand);margin-top:6px">▶ ${esc(d.video.title)}</div>` : ''}
    </div>`).join('');
  openModal(`
    <h2>Review the plan</h2>
    ${plan.week_focus ? `<p class="modal-sub">${esc(plan.week_focus)}</p>` : ''}
    ${plan.disclaimer ? `<p class="muted" style="font-size:12px;margin:0 0 10px">⚠️ ${esc(plan.disclaimer)}</p>` : ''}
    ${days}
    <div class="btn-row" style="margin-top:8px">
      <button class="btn secondary" data-act="ai-generate">↻ Start over</button>
      <button class="btn" id="ai-save">Save plan</button>
    </div>`);
  el('ai-save').addEventListener('click', async () => {
    await saveAiPlan(plan); closeModal(); state.view = 'cta'; render();
  });
}

async function aiViewModal() {
  const plan = await getAiPlan();
  if (!plan) return aiGenerateModal();
  let html = '';
  for (let i = 0; i < plan.days.length; i++) {
    const d = plan.days[i];
    const date = addDays(plan.weekStartDate, i);
    let steps = '';
    for (let j = 0; j < (d.steps || []).length; j++) {
      const done = !!(await DB.get(STORE.checks, aiCheckKey(date, i, j)));
      steps += `<div class="check-item ${done ? 'done' : ''}" data-act="toggle-ai-d" data-date="${date}" data-d="${i}" data-s="${j}">
        <div class="check-box">${done ? '✓' : ''}</div><div class="check-text">${esc(d.steps[j].text)}</div></div>`;
    }
    html += `<div class="card" style="margin-bottom:8px">
      <div style="font-weight:700">${esc(d.label || ('Day ' + (i + 1)))} <span class="muted" style="font-weight:400;font-size:12px">· ${fmtDate(date)}</span></div>
      ${steps}
      ${d.video ? `<a class="btn secondary small" href="${esc(d.video.url)}" target="_blank" rel="noopener" style="margin-top:6px">▶ ${esc(d.video.title.slice(0, 40))}…</a>` : ''}
    </div>`;
  }
  openModal(`
    <h2>This week's plan</h2>
    ${plan.week_focus ? `<p class="modal-sub">${esc(plan.week_focus)}</p>` : ''}
    ${html}
    <div class="btn-row" style="margin-top:8px">
      <button class="btn secondary" data-act="ai-generate">↻ Regenerate</button>
      <button class="btn danger" id="ai-clear">Delete plan</button>
    </div>
    <button class="btn secondary" data-act="cancel" style="margin-top:10px">Close</button>`);
  el('ai-clear').addEventListener('click', async () => {
    if (confirm('Delete this AI plan?')) { await clearAiPlan(); closeModal(); render(); }
  });
}

/* ============================================================
   Settings: backup / restore + reminders
   ============================================================ */
const getSettings = async () => (await DB.get(STORE.kv, 'settings'))?.value || {};
const saveSettings = (s) => DB.put(STORE.kv, { key: 'settings', value: s });

function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportData() {
  const programs = await DB.getAll(STORE.programs);
  const sessions = await DB.getAll(STORE.sessions);
  const checks = await DB.getAll(STORE.checks);
  const kv = await DB.getAll(STORE.kv);
  for (const s of sessions) {
    if (s.documents) for (const d of s.documents) {
      if (d.blob) { d.dataUrl = await blobToDataUrl(d.blob); delete d.blob; }
    }
  }
  const data = { app: 'session-tracker', version: 1, exportedAt: new Date().toISOString(), programs, sessions, checks, kv };
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `session-tracker-backup-${todayISO()}.json`);
}
async function importData(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'session-tracker') { alert('That file is not a Session Tracker backup.'); return; }
  if (!confirm('Restore this backup? It will REPLACE all current data on this device.')) return;
  for (const store of [STORE.programs, STORE.sessions, STORE.checks, STORE.kv]) await DB.clear(store);
  for (const p of data.programs || []) await DB.put(STORE.programs, p);
  for (const s of data.sessions || []) {
    if (s.documents) for (const d of s.documents) {
      if (d.dataUrl) { d.blob = await (await fetch(d.dataUrl)).blob(); delete d.dataUrl; }
    }
    await DB.put(STORE.sessions, s);
  }
  for (const c of data.checks || []) await DB.put(STORE.checks, c);
  for (const k of data.kv || []) await DB.put(STORE.kv, k);
  closeModal(); alert('Backup restored.'); state.view = 'dashboard'; render();
}

/* ---------------- Things to tell the therapist ---------------- */
async function therapistNotesModal() {
  const child = await getChild();
  const notes = await getTNotes();
  const rows = notes.length
    ? notes.map((n) => `
      <div class="tn-item">
        <div class="tn-text">${esc(n.text)}<div class="tn-date">${fmtDate(n.dateAdded)}</div></div>
        <button class="tn-del" data-act="tn-del" data-id="${n.id}" aria-label="Remove">✕</button>
      </div>`).join('')
    : `<div class="empty" style="padding:28px 12px"><div class="big">📝</div>
        <p>Nothing to tell the therapist yet.<br>Concerns from your daily log will appear here.</p></div>`;
  openModal(`<h2>📋 For the therapist</h2>
    <p class="modal-sub">A running list to bring to ${esc(childName(child))}'s next session</p>
    <div id="tn-list">${rows}</div>
    <div class="tn-add-row">
      <input id="tn-input" placeholder="Add something to mention…" autocomplete="off">
      <button class="btn" id="tn-add">Add</button>
    </div>
    <button class="btn secondary" data-act="cancel" style="margin-top:12px">Close</button>`);
  const add = async () => {
    const text = el('tn-input').value.trim(); if (!text) return;
    const arr = await getTNotes(); arr.push({ id: 'tn-' + uid(), text, dateAdded: todayISO() });
    await saveTNotes(arr); therapistNotesModal();
  };
  el('tn-add').addEventListener('click', add);
  el('tn-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}

/* ---------------- Milestone wall ---------------- */
function milestoneCardHtml(m) {
  const color = MILESTONE_CATS[m.category] || MILESTONE_CATS.Other;
  return `<div class="ms-card">
    ${m.photo ? `<img class="ms-photo" src="${m.photo}" alt="">` : ''}
    <div class="ms-star">★</div>
    <div class="ms-text">${esc(m.text)}</div>
    <div class="ms-meta"><span class="ms-cat" style="background:${color}">${esc(m.category || 'Other')}</span><span class="ms-date">${fmtDate(m.date)}</span></div>
    <button class="btn secondary small" data-act="share-milestone" data-id="${m.id}">Share this moment</button>
  </div>`;
}

async function milestonesModal() {
  const child = await getChild();
  const ms = (await getMilestones()).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const body = ms.length
    ? `<div class="ms-grid">${ms.map(milestoneCardHtml).join('')}</div>
       <button class="btn" data-act="add-milestone" style="margin-top:12px">+ Add milestone</button>`
    : `<div class="empty"><div class="big">✨</div>
        <p>Every small win counts. What did ${esc(childName(child))} do today that made you smile?</p>
        <button class="btn" data-act="add-milestone" style="max-width:240px;margin:0 auto">+ Add milestone</button></div>`;
  openModal(`<h2>🌟 Milestones</h2>
    <p class="modal-sub">${esc(childName(child))}'s moments worth remembering</p>
    ${body}
    <button class="btn secondary" data-act="cancel" style="margin-top:12px">Close</button>`);
}

function addMilestoneModal() {
  const cats = Object.keys(MILESTONE_CATS).map((c, i) =>
    `<button type="button" class="chip-select ${i === 0 ? 'on' : ''}" data-c="${c}">${c}</button>`).join('');
  openModal(`<h2>Add a milestone 🌟</h2>
    <label class="field"><span>What happened?</span>
      <textarea id="ms-text" placeholder="e.g. Said 'thank you' unprompted for the first time"></textarea></label>
    <label class="field"><span>Category</span><div class="chip-row" id="ms-cats">${cats}</div></label>
    <label class="field"><span>Date</span><input id="ms-date" type="date" value="${todayISO()}"></label>
    <label class="btn secondary" style="cursor:pointer">📷 Add photo (optional)
      <input id="ms-photo" type="file" accept="image/*" hidden></label>
    <div id="ms-photo-name" class="muted" style="font-size:12px;margin:6px 0"></div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="ms-save">Save milestone</button>
    </div>`);
  let cat = 'Communication', photo = null;
  el('ms-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    cat = b.dataset.c; el('ms-cats').querySelectorAll('.chip-select').forEach((x) => x.classList.remove('on')); b.classList.add('on');
  });
  el('ms-photo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return; photo = await imageToDataUrl(f, 700); el('ms-photo-name').textContent = 'Photo added ✓';
  });
  el('ms-save').addEventListener('click', async () => {
    const text = el('ms-text').value.trim();
    if (!text) { alert('Add a few words about the moment.'); return; }
    const ms = await getMilestones();
    ms.push({ id: 'ms-' + uid(), text, category: cat, date: el('ms-date').value || todayISO(), photo: photo || null, createdAt: Date.now() });
    await saveMilestones(ms);
    closeModal(); render(); confettiBurst();
  });
}

async function shareMilestone(id) {
  const child = await getChild();
  const m = (await getMilestones()).find((x) => x.id === id);
  if (!m) return;
  const W = 1080, H = 1080;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // teal gradient background
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0f766e'); g.addColorStop(1, '#0b5650');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f59e0b'; ctx.font = '120px serif'; ctx.textAlign = 'center'; ctx.fillText('★', W / 2, 280);
  // wrapped milestone text
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 56px -apple-system, Arial, sans-serif';
  const words = m.text.split(' '); let line = '', y = 440; const lines = [];
  for (const w of words) { if (ctx.measureText(line + w).width > W - 200 && line) { lines.push(line.trim()); line = ''; } line += w + ' '; }
  lines.push(line.trim());
  for (const l of lines.slice(0, 6)) { ctx.fillText(l, W / 2, y); y += 74; }
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '36px -apple-system, Arial, sans-serif';
  ctx.fillText(`${m.category} · ${fmtDate(m.date)}`, W / 2, y + 30);
  ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '32px -apple-system, Arial, sans-serif';
  ctx.fillText(`${childName(child)} · Autism Central`, W / 2, H - 80);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], 'milestone.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'A milestone 🌟' });
      return;
    }
  } catch {}
  // fallback: download
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = 'milestone.png'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function childProfileModal() {
  const child = (await getChild()) || { displayName: '', dob: '', therapyTypes: [], photo: null };
  const chips = THERAPY_TYPES.map((t) =>
    `<button type="button" class="chip-select ${child.therapyTypes.includes(t) ? 'on' : ''}" data-t="${t}">${t}</button>`).join('');
  const avatarInner = child.photo
    ? `<img class="avatar" src="${child.photo}" alt="" style="width:80px;height:80px">`
    : (child.displayName ? esc(child.displayName[0].toUpperCase()) : '🙂');
  openModal(`
    <h2>${child.displayName ? 'Edit profile' : "Your child's profile"}</h2>
    <p class="modal-sub">This personalizes the app. A nickname is perfectly fine.</p>
    <div class="avatar-edit">
      <label class="avatar-pick">
        <div id="cp-avatar" class="avatar avatar-fallback" style="width:80px;height:80px;font-size:30px">${avatarInner}</div>
        <span class="avatar-cam">📷</span>
        <input id="cp-photo" type="file" accept="image/*" hidden>
      </label>
    </div>
    <label class="field"><span>What would you like to call your child in the app?</span>
      <input id="cp-name" value="${esc(child.displayName)}" placeholder="Nickname is fine"></label>
    <label class="field"><span>Date of birth</span>
      <input id="cp-dob" type="date" value="${child.dob || ''}"></label>
    <label class="field"><span>What therapies does your child attend?</span>
      <div class="chip-row" id="cp-therapies">${chips}</div></label>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="cp-save">Save profile</button>
    </div>`);
  let photo = child.photo;
  const selected = new Set(child.therapyTypes);
  el('cp-photo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    photo = await imageToAvatarDataUrl(f);
    el('cp-avatar').innerHTML = `<img class="avatar" src="${photo}" alt="" style="width:80px;height:80px">`;
  });
  el('cp-therapies').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t;
    if (selected.has(t)) { selected.delete(t); b.classList.remove('on'); }
    else { selected.add(t); b.classList.add('on'); }
  });
  el('cp-save').addEventListener('click', async () => {
    const name = el('cp-name').value.trim();
    if (!name) { alert("Please enter your child's name or a nickname."); return; }
    await saveChild({ displayName: name, dob: el('cp-dob').value || '', therapyTypes: [...selected], photo: photo || null });
    closeModal(); render();
  });
}

async function settingsModal() {
  const s = await getSettings();
  const child = await getChild();
  openModal(`
    <h2>Settings</h2>
    <p class="modal-sub">Your data is stored privately on this device.</p>

    <div class="section-title" style="margin-left:0">🧒 Child profile</div>
    <div class="settings-row">
      <div><div style="font-weight:600">${child?.displayName ? esc(child.displayName) : 'Not set up yet'}</div>
        <div class="muted" style="font-size:12.5px">${child?.therapyTypes?.length ? esc(child.therapyTypes.join(' · ')) : 'Name, photo, therapies'}</div></div>
      <button class="btn secondary small" data-act="edit-child">${child?.displayName ? 'Edit' : 'Set up'}</button>
    </div>

    <div class="section-title" style="margin-left:0;margin-top:22px">${ic('home')}Account & sync</div>
    ${cloudSyncHtml()}

    <div class="section-title" style="margin-left:0;margin-top:22px">${ic('flame')}Daily reminder</div>
    <div class="settings-row">
      <div><div style="font-weight:600">Remind me</div><div class="muted" style="font-size:12.5px">Nudge to do today's at-home activities</div></div>
      <input type="checkbox" class="switch" id="rem-enable" ${s.reminderEnabled ? 'checked' : ''}>
    </div>
    <div class="settings-row">
      <div style="font-weight:600">Reminder time</div>
      <input type="time" id="rem-time" value="${s.reminderTime || '18:00'}" style="width:130px">
    </div>
    <button class="btn secondary small" id="rem-test" style="margin-top:6px">Send a test reminder</button>
    <p class="muted" style="font-size:12px;margin-top:8px">On iPhone, reminders work only after you add this app to your Home Screen, and may appear when you next open it.</p>

    <div class="section-title" style="margin-left:0;margin-top:22px">${ic('chart')}Backup & restore</div>
    <p class="muted" style="font-size:12.5px;margin:0 0 12px">Save everything (plans, sessions, notes & documents) to a file you can keep or move to another phone.</p>
    <div class="btn-row">
      <button class="btn" id="do-export">⬇︎ Export backup</button>
      <label class="btn secondary" style="cursor:pointer">⬆︎ Import backup
        <input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>

    <div class="section-title" style="margin-left:0;margin-top:22px">🗑 Start fresh</div>
    <p class="muted" style="font-size:12.5px;margin:0 0 10px">Erase everything and begin with a clean slate${cloud && currentUser ? ' — clears this device <em>and</em> your synced cloud data' : ''}.</p>
    <button class="btn danger" id="delete-all">Delete all data & start fresh</button>

    <button class="btn secondary" data-act="cancel" style="margin-top:18px">Close</button>`);

  el('rem-enable').addEventListener('change', async (e) => {
    const next = await getSettings();
    next.reminderEnabled = e.target.checked;
    if (e.target.checked && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    await saveSettings(next);
  });
  el('rem-time').addEventListener('change', async (e) => {
    const next = await getSettings(); next.reminderTime = e.target.value; await saveSettings(next);
  });
  el('rem-test').addEventListener('click', async () => {
    if (!('Notification' in window)) { alert('Notifications are not supported in this browser.'); return; }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Notifications are blocked. Enable them in your browser/site settings.'); return; }
    showReminder('This is a test reminder 🌱');
  });
  el('do-export').addEventListener('click', exportData);
  el('import-file').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); });
  el('delete-all').addEventListener('click', deleteAllData);
  wireCloudSync();
}

async function deleteAllData() {
  if (!confirm('Delete ALL data — plans, sessions, documents, daily activity, and settings — and start fresh?\n\nThis cannot be undone.')) return;
  const stores = [STORE.programs, STORE.sessions, STORE.checks, STORE.kv];
  try {
    if (cloud && currentUser) { for (const s of stores) await cloud.db.clear(s); }  // wipe cloud copy
    for (const s of stores) await localDB.clear(s);                                  // wipe this device
    alert('All data cleared. Starting fresh.');
    closeModal(); state.view = 'dashboard'; state.programId = null; render();
  } catch (e) {
    alert('Could not clear everything: ' + (e?.message || e));
  }
}

/* ---------------- Account & sync UI ---------------- */
function cloudSyncHtml() {
  if (!CLOUD_ENABLED || !cloud) {
    return `<p class="muted" style="font-size:12.5px;margin:0 0 4px">Cloud sync is off — your data stays on this device only. To sync across devices and share with another caregiver, follow “Cloud sync setup” in the README, then turn it on.</p>`;
  }
  if (currentUser) {
    const health = cloudHealthy
      ? '<span class="pill yes">Synced ✓</span>'
      : '<span class="pill no">Not connected</span>';
    const warn = cloudHealthy ? '' : `<p class="muted" style="font-size:12px;margin:0 0 10px;color:var(--red)">Can't reach the cloud database, so the app is working on this device only. This usually means the Firestore database hasn't been created yet (Firebase console → Build → Firestore Database → Create database).</p>`;
    return `
      <div class="settings-row">
        <div><div style="font-weight:600">Signed in</div><div class="muted" style="font-size:12.5px">${esc(currentUser.email)}</div></div>
        ${health}
      </div>
      ${warn}
      <p class="muted" style="font-size:12px;margin:8px 0 10px">Changes sync across every device signed in to this account. If this device has data that isn't in the cloud yet, upload it once:</p>
      <button class="btn" id="cloud-upload" style="margin-bottom:10px"${cloudHealthy ? '' : ' disabled'}>⬆︎ Upload this device's data to the cloud</button>
      <button class="btn secondary" id="cloud-signout">Sign out</button>`;
  }
  return `
    <p class="muted" style="font-size:12.5px;margin:0 0 10px">Sign in to sync across devices. Use the same email & password on each phone (or for each caregiver) to share the same data.</p>
    <label class="field"><span>Email</span><input id="cloud-email" type="email" autocomplete="username" placeholder="you@example.com"></label>
    <label class="field"><span>Password</span><input id="cloud-pass" type="password" autocomplete="current-password" placeholder="at least 6 characters"></label>
    <div class="btn-row">
      <button class="btn secondary" id="cloud-create">Create account</button>
      <button class="btn" id="cloud-signin">Sign in</button>
    </div>`;
}

async function uploadThisDevice() {
  try {
    const programs = await localDB.getAll(STORE.programs);
    if (!programs.length) {
      alert('This device has no local plans to upload. (Your data may have been entered at a different web address — open that address, use Settings → Export backup, then come back here and use Import backup while signed in.)');
      return;
    }
    if (!confirm(`Upload ${programs.length} plan(s) and their sessions/documents from this device to your account?`)) return;
    for (const p of programs) await cloud.db.put(STORE.programs, p);
    for (const s of await localDB.getAll(STORE.sessions)) {
      if (s.documents) for (const d of s.documents) {
        if (d.blob) { Object.assign(d, await cloud.uploadDocument(d.blob, d.name)); delete d.blob; }
      }
      await cloud.db.put(STORE.sessions, s);
    }
    for (const c of await localDB.getAll(STORE.checks)) await cloud.db.put(STORE.checks, c);
    for (const k of await localDB.getAll(STORE.kv)) await cloud.db.put(STORE.kv, k);
    alert('Uploaded! Your data is now in the cloud. Sign in with the same email & password on your other devices to see it.');
    closeModal(); render();
  } catch (e) {
    alert('Upload failed: ' + (e?.message || e) + '\n\nIf this mentions permissions, the Firestore/Storage security rules may need to be published.');
  }
}

function wireCloudSync() {
  if (!CLOUD_ENABLED || !cloud) return;
  const out = el('cloud-signout');
  if (out) {
    el('cloud-upload')?.addEventListener('click', uploadThisDevice);
    out.addEventListener('click', async () => { await cloud.signOutUser(); closeModal(); });
    return;
  }
  const run = async (fn) => {
    const email = el('cloud-email')?.value.trim();
    const pass = el('cloud-pass')?.value;
    if (!email || !pass) { alert('Enter an email and password.'); return; }
    try { await fn(email, pass); closeModal(); }
    catch (err) { alert(err?.message?.replace('Firebase: ', '') || 'Sign-in failed.'); }
  };
  el('cloud-signin')?.addEventListener('click', () => run(cloud.signIn));
  el('cloud-create')?.addEventListener('click', () => run(cloud.signUp));
}

async function showReminder(body) {
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'daily-reminder' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification('Session Tracker', opts);
  } catch {}
  new Notification('Session Tracker', opts);
}

async function maybeRemind() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const s = await getSettings();
  if (!s.reminderEnabled) return;
  const today = todayISO();
  if (s.lastNotified === today) return;
  const [hh, mm] = (s.reminderTime || '18:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() < hh || (now.getHours() === hh && now.getMinutes() < mm)) return;
  const ctas = await getCTAs();
  const counts = await checkCountsByDate();
  if ((counts[today] || 0) >= ctas.length) return; // already done today
  await showReminder('Time for today’s at-home activities 🌱');
  s.lastNotified = today; await saveSettings(s);
}

/* ============================================================
   Event wiring
   ============================================================ */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  state.view = b.dataset.view; state.programId = null; render();
});
el('add-btn').addEventListener('click', () => newPlanModal());
el('settings-btn').addEventListener('click', settingsModal);

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  switch (act) {
    case 'cancel': return closeModal();
    case 'new-plan': return newPlanModal(t.dataset.track || 'Institute');
    case 'go-cta': state.view = 'cta'; return render();
    case 'go-resources': state.view = 'resources'; return render();
    case 'daily-date': state.dailyDate = t.dataset.date; state.sensoryOpen = false; return render();
    case 'child-mood': await setDayLog(t.dataset.date, { childMood: +t.dataset.score }); return render();
    case 'daily-toggle': {
      const d = t.dataset.date, log = await getDayLog(d);
      await setDayLog(d, { [t.dataset.key]: log[t.dataset.key] === t.dataset.val ? '' : t.dataset.val });
      return render();
    }
    case 'sensory-open': state.sensoryOpen = true; return render();
    case 'daily-sensory': {
      const d = t.dataset.date, log = await getDayLog(d), set = new Set(log.sensory || []), val = t.dataset.val;
      set.has(val) ? set.delete(val) : set.add(val);
      await setDayLog(d, { sensory: [...set] });
      return render();
    }
    case 'concern-yes': {
      const d = t.dataset.date, log = await getDayLog(d);
      if (log.concern) { const arr = await getTNotes(); arr.push({ id: 'tn-' + uid(), text: log.concern, dateAdded: d }); await saveTNotes(arr); }
      await setDayLog(d, { concernHandled: true }); render(); showSnackbar('Added to therapist list');
      return;
    }
    case 'concern-no': await setDayLog(t.dataset.date, { concernHandled: true }); return render();
    case 'daily-save': showSnackbar('Saved ✓'); return;
    case 'wb-set': await setWellbeing(+t.dataset.score); return render();
    case 'open': state.view = 'program'; state.programId = t.dataset.id; return render();
    case 'back': state.view = 'sessions'; state.programId = null; return render();
    case 'session': return sessionModal(t.dataset.id);
    case 'count-inc': return adjustCompleted(1);
    case 'count-dec': return adjustCompleted(-1);
    case 'add-cta': return addCtaModal();
    case 'add-res': return addResModal();
    case 'res-filter': state.resFilter = t.dataset.cat; return render();
    case 'open-settings': return settingsModal();
    case 'sess-tab': state.sessionsTab = t.dataset.tab; return render();
    case 'prog-range': state.progressRange = t.dataset.range; return render();
    case 'export-report': return exportReport();
    case 'edit-child': return childProfileModal();
    case 'therapist-notes': return therapistNotesModal();
    case 'tn-del': {
      const id = t.dataset.id;
      const arr = await getTNotes();
      const idx = arr.findIndex((n) => n.id === id);
      if (idx < 0) return;
      const [removed] = arr.splice(idx, 1);
      await saveTNotes(arr); therapistNotesModal();
      showSnackbar('Removed', 'Undo', async () => {
        const a2 = await getTNotes(); a2.splice(idx, 0, removed); await saveTNotes(a2); therapistNotesModal();
      });
      return;
    }
    case 'milestones': return milestonesModal();
    case 'add-milestone': return addMilestoneModal();
    case 'share-milestone': return shareMilestone(t.dataset.id);
    case 'ai-generate': return aiGenerateModal();
    case 'ai-view': return aiViewModal();
    case 'toggle-ai': { await toggleAi(todayISO(), +t.dataset.d, +t.dataset.s); return render(); }
    case 'toggle-ai-d': { await toggleAi(t.dataset.date, +t.dataset.d, +t.dataset.s); return aiViewModal(); }
    case 'toggle-cta': {
      const key = `${todayISO()}|${t.dataset.id}`;
      const cur = await DB.get(STORE.checks, key);
      if (cur) await DB.delete(STORE.checks, key); else await DB.put(STORE.checks, { key, done: true });
      return render();
    }
    case 'add-session': {
      const sess = await DB.byIndex(STORE.sessions, 'programId', state.programId);
      await DB.put(STORE.sessions, blankSession(state.programId, sess.length + 1, todayISO()));
      return render();
    }
    case 'next-cycle': {
      const p = await DB.get(STORE.programs, state.programId);
      const next = await createProgram({ type: p.type, track: p.track, name: p.name, cycleStart: cycleEnd(p) });
      state.programId = next.id; return render();
    }
    case 'del-plan': {
      if (confirm('Delete this plan and all its sessions & documents?')) {
        await deleteProgram(state.programId); state.view = 'sessions'; state.programId = null; return render();
      }
      return;
    }
  }
});

/* ============================================================
   Cloud sync init (optional)
   ============================================================ */
async function checkCloudHealth() {
  try { await cloud.db.getAll(STORE.programs); return true; }
  catch (e) { console.warn('Cloud unhealthy:', e?.message || e); return false; }
}

async function initCloud() {
  try {
    cloud = await createCloud(firebaseConfig, firestoreDatabaseId);
    cloud.onUser(async (user) => {
      currentUser = user;
      // ALWAYS default to local so the UI renders instantly and never hangs.
      DB = localDB; cloudHealthy = false;
      render();
      if (user) {
        // Only switch to the cloud once we've confirmed it actually responds
        // (guards against a missing/unreachable Firestore freezing the app).
        cloudHealthy = await checkCloudHealth();
        DB = cloudHealthy ? cloud.db : localDB;
        render();
      }
    });
  } catch (e) {
    console.warn('Cloud sync unavailable:', e);
    cloud = null;
    render();
  }
}

/* service worker (offline support) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* offline banner — logging never blocks; data syncs when back online */
window.addEventListener('offline', () => document.body.classList.add('is-offline'));
window.addEventListener('online', () => document.body.classList.remove('is-offline'));
if (!navigator.onLine) document.body.classList.add('is-offline');

/* reminders: check at boot, when returning to the app, and periodically while open */
maybeRemind();
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeRemind(); });
setInterval(maybeRemind, 5 * 60 * 1000);

render();
if (CLOUD_ENABLED) initCloud();   // onUser callback re-renders once auth state is known
