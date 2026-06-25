import { db, STORE, uid } from './db.js';
import { DEFAULT_CTAS, DEFAULT_RESOURCES, CAT_COLORS } from './content.js';
import { donut, ring, heatmap } from './charts.js';

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
const state = { view: 'dashboard', programId: null, programs: [], sessions: [] };

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============================================================
   Data operations
   ============================================================ */
async function loadPrograms() {
  state.programs = (await db.getAll(STORE.programs)).sort((a, b) => b.createdAt - a.createdAt);
}
async function loadSessions(programId) {
  state.sessions = (await db.byIndex(STORE.sessions, 'programId', programId))
    .sort((a, b) => (a.number || 0) - (b.number || 0));
}
async function createProgram({ type, name, cycleStart }) {
  const program = { id: uid(), type, name: name || TYPES[type].label, cycleStart, createdAt: Date.now() };
  await db.put(STORE.programs, program);
  if (TYPES[type].mode === 'fixed') {
    for (let i = 1; i <= TYPES[type].total; i++) await db.put(STORE.sessions, blankSession(program.id, i));
  } else {
    await db.put(STORE.sessions, blankSession(program.id, 1, cycleStart));
  }
  return program;
}
function blankSession(programId, number, date = '') {
  return { id: uid(), programId, number, date, status: 'scheduled', notes: '', documents: [] };
}
async function deleteProgram(id) {
  const sess = await db.byIndex(STORE.sessions, 'programId', id);
  for (const s of sess) await db.delete(STORE.sessions, s.id);
  await db.delete(STORE.programs, id);
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
  const custom = (await db.get(STORE.kv, 'customCtas'))?.value || [];
  return [...DEFAULT_CTAS, ...custom];
}
// distinct checks per date, from the whole checks store
async function checkCountsByDate() {
  const all = await db.getAll(STORE.checks);
  const map = {};
  for (const c of all) { const d = c.key.split('|')[0]; map[d] = (map[d] || 0) + 1; }
  return map;
}
function computeStreak(countsByDate, ctaCount) {
  if (!ctaCount) return 0;
  const complete = (iso) => (countsByDate[iso] || 0) >= ctaCount;
  let day = todayISO();
  if (!complete(day)) day = addDays(day, -1); // today not done yet shouldn't break the streak
  let n = 0;
  while (complete(day)) { n++; day = addDays(day, -1); }
  return n;
}

/* ============================================================
   Rendering
   ============================================================ */
function setTitle(t) { el('view-title').textContent = t; }

async function render() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const v = el('view');
  el('add-btn').style.display = (state.view === 'sessions' || state.view === 'dashboard') ? '' : 'none';
  window.scrollTo({ top: 0 });
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

/* ---------------- Dashboard ---------------- */
async function renderDashboard(v) {
  await loadPrograms();
  const ctas = await getCTAs();
  const counts = await checkCountsByDate();
  const doneToday = counts[todayISO()] || 0;
  const todayPct = ctas.length ? Math.round((doneToday / ctas.length) * 100) : 0;
  const streak = computeStreak(counts, ctas.length);

  // overall attendance across all plans
  let A = 0, M = 0, T = 0;
  const planRows = [];
  for (const p of state.programs) {
    const sess = await db.byIndex(STORE.sessions, 'programId', p.id);
    const st = stats(p, sess);
    A += st.attended; M += st.missed; T += st.total;
    planRows.push({ p, st });
  }
  const adherence = (A + M) ? Math.round((A / (A + M)) * 100) : 0;

  // activity heatmap (last 12 weeks of daily-ritual completion)
  const cells = [];
  for (let i = 83; i >= 0; i--) {
    const d = addDays(todayISO(), -i);
    const frac = ctas.length ? Math.min(1, (counts[d] || 0) / ctas.length) : 0;
    cells.push({ level: frac <= 0 ? 0 : Math.min(4, Math.ceil(frac * 4)), color: 'var(--green)', title: `${fmtDate(d)} — ${Math.round(frac * 100)}%` });
  }

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

  const adherenceCard = (A + M) ? `
    <div class="card">
      <div class="stat-flex">
        ${donut([
          { value: A, color: 'var(--green)' },
          { value: M, color: 'var(--red)' },
          { value: Math.max(0, T - A - M), color: 'color-mix(in srgb, var(--muted) 22%, transparent)' },
        ], { center: `<div class="big">${adherence}%</div><div class="lbl">attended</div>` })}
        <div style="flex:1">
          <h2 style="margin-bottom:10px">Attendance</h2>
          <div class="legend">
            <span><i style="background:var(--green)"></i>${A} attended</span>
            <span><i style="background:var(--red)"></i>${M} missed</span>
            <span><i style="background:color-mix(in srgb,var(--muted) 35%,transparent)"></i>${Math.max(0, T - A - M)} upcoming</span>
          </div>
        </div>
      </div>
    </div>` : '';

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

  let plansHtml = '';
  if (!state.programs.length) {
    plansHtml = `<div class="empty"><div class="big">🧩</div>
      <p>No therapy plans yet.<br>Add OT, Speech, or ABA to begin.</p>
      <button class="btn" data-act="new-plan" style="max-width:240px;margin:0 auto">Create your first plan</button></div>`;
  } else {
    for (const { p, st } of planRows) {
      const pct = st.total ? Math.round((st.attended / st.total) * 100) : 0;
      const end = cycleEnd(p);
      plansHtml += `
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
  }

  v.innerHTML = `
    <p class="greeting">${greetingText()}</p>
    ${streakBanner}
    ${todayCard}
    ${adherenceCard}
    ${heatCard}
    <div class="section-title">Your therapy plans</div>
    ${plansHtml}`;
}

/* ---------------- Plans list ---------------- */
async function renderPlans(v) {
  await loadPrograms();
  if (!state.programs.length) {
    v.innerHTML = `<div class="empty"><div class="big">🧩</div>
      <p>No therapy plans yet.<br>Tap + to add OT, Speech, or ABA.</p>
      <button class="btn" data-act="new-plan" style="max-width:240px;margin:0 auto">New plan</button></div>`;
    return;
  }
  let html = '';
  for (const p of state.programs) {
    const sess = await db.byIndex(STORE.sessions, 'programId', p.id);
    const st = stats(p, sess);
    const pct = st.total ? Math.round((st.attended / st.total) * 100) : 0;
    html += `
      <div class="card plan-card tint-${p.type}" data-act="open" data-id="${p.id}">
        <div class="ring-wrap">${ring(pct, COLORVAR[p.type], { size: 58, stroke: 8, center: `<div class="big" style="font-size:14px">${pct}%</div>` })}</div>
        <div class="info">
          <span class="tag">${p.type}</span>
          <h2>${esc(p.name)}</h2>
          <div class="meta">started ${fmtDate(p.cycleStart)}</div>
          <div class="counts"><span>✅ ${st.attended}</span><span>❌ ${st.missed}</span><span>⏳ ${st.remaining}</span></div>
        </div>
        <div class="chev">›</div>
      </div>`;
  }
  v.innerHTML = html;
}

/* ---------------- Single program (timeline) ---------------- */
async function renderProgram(v) {
  const p = await db.get(STORE.programs, state.programId);
  if (!p) { state.view = 'sessions'; return render(); }
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
          ${s.date ? `<div class="tl-date">${fmtDate(s.date)}</div>` : '<div class="tl-date">Tap to set date & status</div>'}
          ${s.notes ? `<div class="tl-notes">${esc(s.notes)}</div>` : ''}
          ${s.documents?.length ? `<div class="tl-docs">📎 ${s.documents.length} document${s.documents.length === 1 ? '' : 's'}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  v.innerHTML = `
    <button class="btn secondary small" data-act="back" style="margin:4px 0 14px">‹ All plans</button>
    <div class="card stat-flex tint-${p.type}">
      <div class="ring-wrap">${ring(pct, COLORVAR[p.type], { size: 92, stroke: 12, center: `<div class="big" style="font-size:20px">${pct}%</div><div class="lbl">done</div>` })}</div>
      <div style="flex:1">
        <span class="tag">${p.type}</span>
        <h2 style="margin-top:6px">${esc(p.name)}</h2>
        <div class="meta" style="color:var(--muted);font-size:12.5px;margin-top:4px">Started ${fmtDate(p.cycleStart)}${end ? `<br>Cycle ends ${fmtDate(end)}` : ''}</div>
        <div class="counts" style="display:flex;gap:12px;font-size:13px;color:var(--ink-soft);margin-top:8px">
          <span>✅ ${st.attended}</span><span>❌ ${st.missed}</span><span>⏳ ${st.remaining}</span>
        </div>
      </div>
    </div>
    <div class="section-title">Session timeline</div>
    <div class="timeline">${items}</div>
    ${monthly ? `<div class="btn-row" style="margin-top:8px">
        <button class="btn secondary" data-act="add-session">+ Add session</button>
        <button class="btn secondary" data-act="next-cycle">Next month →</button>
      </div>` : ''}
    <button class="btn danger" data-act="del-plan" style="margin-top:22px">Delete this plan</button>`;
}

/* ---------------- Daily CTA ---------------- */
async function renderCTA(v) {
  const ctas = await getCTAs();
  const counts = await checkCountsByDate();
  const doneToday = counts[todayISO()] || 0;
  const pct = ctas.length ? Math.round((doneToday / ctas.length) * 100) : 0;
  let rows = '';
  for (const c of ctas) {
    const done = !!(await db.get(STORE.checks, `${todayISO()}|${c.id}`));
    rows += `
      <div class="check-item ${done ? 'done' : ''}" data-act="toggle-cta" data-id="${c.id}">
        <div class="check-box">${done ? '✓' : ''}</div>
        <div class="check-text">${esc(c.text)}</div>
        <span class="check-cat" style="background:${CAT_COLORS[c.cat] || '#888'}">${c.cat}</span>
      </div>`;
  }
  v.innerHTML = `
    <div class="card stat-flex">
      <div class="ring-wrap">${ring(pct, 'var(--green)', { size: 76, stroke: 10, center: `<div class="big" style="font-size:16px">${pct}%</div>` })}</div>
      <div style="flex:1"><h2>${doneToday === ctas.length && ctas.length ? 'All done today 🎉' : "Today's activities"}</h2>
        <p class="sub" style="margin:2px 0 0">${doneToday}/${ctas.length} complete · resets each day</p></div>
    </div>
    <div class="card">${rows}</div>
    <button class="btn secondary" data-act="add-cta">+ Add my own activity</button>`;
}

/* ---------------- Resources ---------------- */
async function getResources() {
  const custom = (await db.get(STORE.kv, 'customResources'))?.value || [];
  return [...DEFAULT_RESOURCES, ...custom];
}
async function renderResources(v) {
  const res = await getResources();
  let html = '';
  for (const cat of ['OT', 'Speech', 'ABA', 'General']) {
    const items = res.filter((r) => r.cat === cat);
    if (!items.length) continue;
    html += `<div class="section-title">${cat}</div>`;
    for (const r of items) {
      let host = '';
      try { host = new URL(r.url).hostname.replace('www.', ''); } catch {}
      html += `
        <a class="card res-item" href="${esc(r.url)}" target="_blank" rel="noopener">
          <h3>${esc(r.title)}</h3>
          <p>${esc(r.desc)}</p>
          <span class="host">${esc(host)} ↗</span>
        </a>`;
    }
  }
  v.innerHTML = html + `<button class="btn secondary" data-act="add-res" style="margin-top:8px">+ Add a resource link</button>`;
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
function newPlanModal() {
  openModal(`
    <h2>New therapy plan</h2>
    <p class="modal-sub">OT & Speech run 24 sessions. ABA runs a monthly cycle.</p>
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
    <div class="btn-row" style="margin-top:8px">
      <button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="save-plan">Create plan</button>
    </div>`);
  let selected = 'OT';
  el('type-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]'); if (!b) return;
    selected = b.dataset.type;
    el('type-seg').querySelectorAll('button').forEach((x) => x.className = '');
    b.className = `on-${selected}`;
  });
  el('save-plan').addEventListener('click', async () => {
    const cycleStart = el('plan-date').value || todayISO();
    const p = await createProgram({ type: selected, name: el('plan-name').value.trim(), cycleStart });
    closeModal(); state.view = 'program'; state.programId = p.id; render();
  });
}

/* ---------------- Session detail modal ---------------- */
async function sessionModal(id) {
  const s = await db.get(STORE.sessions, id);
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
  el('status-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]'); if (!b) return;
    status = (status === b.dataset.status) ? 'scheduled' : b.dataset.status;
    el('status-seg').querySelectorAll('button').forEach((x) => x.className = '');
    if (status === 'attended') b.className = 'on-green';
    if (status === 'missed') b.className = 'on-red';
  });
  el('doc-input').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      s.documents = s.documents || [];
      s.documents.push({ id: uid(), name: file.name, type: file.type, size: file.size, blob: file });
    }
    await db.put(STORE.sessions, s); sessionModal(id);
  });
  el('doc-list').addEventListener('click', async (e) => {
    const view = e.target.closest('[data-act="view-doc"]');
    const del = e.target.closest('[data-act="del-doc"]');
    if (view) window.open(URL.createObjectURL(s.documents[+view.dataset.i].blob), '_blank');
    if (del) { s.documents.splice(+del.dataset.i, 1); await db.put(STORE.sessions, s); sessionModal(id); }
  });
  el('save-session').addEventListener('click', async () => {
    s.status = status; s.date = el('s-date').value; s.notes = el('s-notes').value;
    if (status !== 'scheduled' && !s.date) s.date = todayISO();
    await db.put(STORE.sessions, s); closeModal(); render();
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
    const cur = (await db.get(STORE.kv, 'customCtas'))?.value || [];
    cur.push({ id: 'cta-' + uid(), cat: el('cta-cat').value, text });
    await db.put(STORE.kv, { key: 'customCtas', value: cur }); closeModal(); render();
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
    const cur = (await db.get(STORE.kv, 'customResources'))?.value || [];
    cur.push({ id: 'res-' + uid(), cat: el('r-cat').value, title, url, desc: el('r-desc').value.trim() });
    await db.put(STORE.kv, { key: 'customResources', value: cur }); closeModal(); render();
  });
}

/* ============================================================
   Event wiring
   ============================================================ */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  state.view = b.dataset.view; state.programId = null; render();
});
el('add-btn').addEventListener('click', newPlanModal);

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  switch (act) {
    case 'cancel': return closeModal();
    case 'new-plan': return newPlanModal();
    case 'go-cta': state.view = 'cta'; return render();
    case 'open': state.view = 'program'; state.programId = t.dataset.id; return render();
    case 'back': state.view = 'sessions'; state.programId = null; return render();
    case 'session': return sessionModal(t.dataset.id);
    case 'add-cta': return addCtaModal();
    case 'add-res': return addResModal();
    case 'toggle-cta': {
      const key = `${todayISO()}|${t.dataset.id}`;
      const cur = await db.get(STORE.checks, key);
      if (cur) await db.delete(STORE.checks, key); else await db.put(STORE.checks, { key, done: true });
      return render();
    }
    case 'add-session': {
      const sess = await db.byIndex(STORE.sessions, 'programId', state.programId);
      await db.put(STORE.sessions, blankSession(state.programId, sess.length + 1, todayISO()));
      return render();
    }
    case 'next-cycle': {
      const p = await db.get(STORE.programs, state.programId);
      const next = await createProgram({ type: p.type, name: p.name, cycleStart: cycleEnd(p) });
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

/* service worker (offline support) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

render();
