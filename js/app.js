import { db, STORE, uid } from './db.js';
import { DEFAULT_CTAS, DEFAULT_RESOURCES, CAT_COLORS } from './content.js';

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
  // handle month overflow (e.g. Jan 31 -> Feb 28)
  if (d.getDate() < day) d.setDate(0);
  return toISO(d);
}

/* ---------------- app state ---------------- */
const state = {
  view: 'dashboard',
  programId: null,
  programs: [],
  sessions: [],   // sessions for the currently-open program
};

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
  const program = {
    id: uid(), type, name: name || TYPES[type].label,
    cycleStart, createdAt: Date.now(),
  };
  await db.put(STORE.programs, program);

  if (TYPES[type].mode === 'fixed') {
    for (let i = 1; i <= TYPES[type].total; i++) {
      await db.put(STORE.sessions, blankSession(program.id, i));
    }
  } else {
    // ABA monthly: start with one session on the start date
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
  return { attended, missed, total, done: attended + missed };
}

/* ============================================================
   Rendering
   ============================================================ */
function setTitle(t) { el('view-title').textContent = t; }

async function render() {
  // sync active tab
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === state.view));
  const v = el('view');
  el('add-btn').style.display = (state.view === 'sessions' || state.view === 'dashboard') ? '' : 'none';

  switch (state.view) {
    case 'dashboard': setTitle('Dashboard'); return renderDashboard(v);
    case 'sessions':  setTitle('Therapy Plans'); return renderPlans(v);
    case 'program':   return renderProgram(v);
    case 'cta':       setTitle('Daily At-Home'); return renderCTA(v);
    case 'resources': setTitle('Resources'); return renderResources(v);
  }
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard(v) {
  await loadPrograms();

  // today's checklist progress
  const ctas = await getCTAs();
  let doneToday = 0;
  for (const c of ctas) if (await db.get(STORE.checks, `${todayISO()}|${c.id}`)) doneToday++;

  let plansHtml = '';
  if (!state.programs.length) {
    plansHtml = `<div class="empty"><div class="big">📅</div>
      <p>No therapy plans yet.</p>
      <button class="btn" data-act="new-plan">Create your first plan</button></div>`;
  } else {
    for (const p of state.programs) {
      const sess = await db.byIndex(STORE.sessions, 'programId', p.id);
      const st = stats(p, sess);
      const pct = st.total ? Math.round((st.attended / st.total) * 100) : 0;
      const end = cycleEnd(p);
      plansHtml += `
        <div class="card plan-card" data-act="open" data-id="${p.id}">
          <span class="tag ${p.type}">${p.type}</span>
          <h2>${esc(p.name)}</h2>
          <div class="meta">Started ${fmtDate(p.cycleStart)}${end ? ` · cycle ends ${fmtDate(end)}` : ''}</div>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="progress-row">
            <span>✅ ${st.attended} attended · ❌ ${st.missed} missed</span>
            <span>${st.total ? `${st.attended}/${st.total}` : `${sess.length} logged`}</span>
          </div>
        </div>`;
    }
  }

  v.innerHTML = `
    <div class="card" data-act="go-cta" style="cursor:pointer">
      <div class="row-between">
        <div><h2>Today's at-home plan</h2><p class="sub" style="margin:0">${doneToday}/${ctas.length} done today</p></div>
        <div class="pill ${doneToday === ctas.length && ctas.length ? 'yes' : 'none'}">${doneToday === ctas.length && ctas.length ? 'All done 🎉' : 'Open'}</div>
      </div>
      <div class="progress" style="margin-bottom:0"><span style="width:${ctas.length ? (doneToday / ctas.length) * 100 : 0}%"></span></div>
    </div>
    <div class="section-title">Your therapy plans</div>
    ${plansHtml}`;
}

/* ---------------- Plans list ---------------- */
async function renderPlans(v) {
  await loadPrograms();
  if (!state.programs.length) {
    v.innerHTML = `<div class="empty"><div class="big">🧩</div>
      <p>No therapy plans yet.<br>Tap + to add OT, Speech, or ABA.</p>
      <button class="btn" data-act="new-plan">New plan</button></div>`;
    return;
  }
  let html = '';
  for (const p of state.programs) {
    const sess = await db.byIndex(STORE.sessions, 'programId', p.id);
    const st = stats(p, sess);
    html += `
      <div class="card plan-card" data-act="open" data-id="${p.id}">
        <span class="tag ${p.type}">${p.type}</span>
        <h2>${esc(p.name)}</h2>
        <div class="meta">${st.total ? `${st.attended}/${st.total} attended` : `${sess.length} sessions logged`} · started ${fmtDate(p.cycleStart)}</div>
      </div>`;
  }
  v.innerHTML = html;
}

/* ---------------- Single program (session grid) ---------------- */
async function renderProgram(v) {
  const p = await db.get(STORE.programs, state.programId);
  if (!p) { state.view = 'sessions'; return render(); }
  await loadSessions(p.id);
  setTitle(p.name);
  const st = stats(p, state.sessions);
  const end = cycleEnd(p);
  const monthly = TYPES[p.type].mode === 'monthly';

  const cells = state.sessions.map((s) => {
    const label = s.status === 'attended' ? 'Yes' : s.status === 'missed' ? 'No' : '—';
    return `<div class="sess-cell ${s.status}" data-act="session" data-id="${s.id}">
      ${s.documents?.length ? '<span class="doc-dot">📎</span>' : ''}
      <span class="n">#${s.number}</span>
      <span class="s">${label}</span>
    </div>`;
  }).join('');

  v.innerHTML = `
    <button class="btn secondary small" data-act="back" style="margin-bottom:12px">‹ All plans</button>
    <div class="card">
      <span class="tag ${p.type}">${p.type}</span>
      <h2>${esc(p.name)}</h2>
      <div class="meta">Started ${fmtDate(p.cycleStart)}${end ? ` · cycle ends ${fmtDate(end)}` : ''}</div>
      <div class="progress"><span style="width:${st.total ? (st.attended / st.total) * 100 : 0}%"></span></div>
      <div class="progress-row">
        <span>✅ ${st.attended} · ❌ ${st.missed} · ⏳ ${st.total ? st.total - st.done : 0} left</span>
        <span>${st.total ? `${st.attended}/${st.total}` : `${state.sessions.length} sessions`}</span>
      </div>
    </div>
    <div class="section-title">Sessions — tap to log attendance & attach documents</div>
    <div class="sess-grid">${cells}</div>
    <div style="margin-top:16px" class="btn-row">
      ${monthly ? `<button class="btn secondary" data-act="add-session">+ Add session</button>
                   <button class="btn secondary" data-act="next-cycle">Start next month →</button>` : ''}
    </div>
    <button class="btn danger" data-act="del-plan" style="margin-top:20px">Delete this plan</button>`;
}

/* ---------------- Daily CTA ---------------- */
async function getCTAs() {
  const custom = (await db.get(STORE.kv, 'customCtas'))?.value || [];
  return [...DEFAULT_CTAS, ...custom];
}
async function renderCTA(v) {
  const ctas = await getCTAs();
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
    <div class="card">
      <h2>${fmtDate(todayISO())}</h2>
      <p class="sub">Daily activities to do at home. Resets each day.</p>
      ${rows}
    </div>
    <button class="btn secondary" data-act="add-cta">+ Add my own activity</button>`;
}

/* ---------------- Resources ---------------- */
async function getResources() {
  const custom = (await db.get(STORE.kv, 'customResources'))?.value || [];
  return [...DEFAULT_RESOURCES, ...custom];
}
async function renderResources(v) {
  const res = await getResources();
  const cats = ['OT', 'Speech', 'ABA', 'General'];
  let html = '';
  for (const cat of cats) {
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
  root.innerHTML = `<div class="modal-overlay"><div class="modal">
    <div class="modal-handle"></div>${innerHTML}</div></div>`;
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
        <button data-type="OT" class="active OT">OT</button>
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
    b.className = `active ${selected}`;
  });
  el('save-plan').addEventListener('click', async () => {
    const cycleStart = el('plan-date').value || todayISO();
    const p = await createProgram({ type: selected, name: el('plan-name').value.trim(), cycleStart });
    closeModal();
    state.view = 'program'; state.programId = p.id; render();
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
    <h2>Session #${s.number}</h2>
    <p class="modal-sub">Mark attendance, add notes, and attach documents.</p>

    <label class="field"><span>Status</span>
      <div class="seg" id="status-seg">
        <button data-status="attended" class="${s.status === 'attended' ? 'active OT' : ''}" style="${s.status === 'attended' ? 'background:var(--green);border-color:var(--green);color:#fff' : ''}">Attended · Yes</button>
        <button data-status="missed" class="${s.status === 'missed' ? 'active' : ''}" style="${s.status === 'missed' ? 'background:var(--red);border-color:var(--red);color:#fff' : ''}">Missed · No</button>
      </div>
    </label>
    <label class="field"><span>Date</span>
      <input id="s-date" type="date" value="${s.date || ''}" /></label>
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
    status = (status === b.dataset.status) ? 'scheduled' : b.dataset.status; // tap again to clear
    el('status-seg').querySelectorAll('button').forEach((x) => { x.className = ''; x.removeAttribute('style'); });
    if (status === 'attended') b.style.cssText = 'background:var(--green);border-color:var(--green);color:#fff';
    if (status === 'missed') b.style.cssText = 'background:var(--red);border-color:var(--red);color:#fff';
  });

  // file upload
  el('doc-input').addEventListener('change', async (e) => {
    for (const file of e.target.files) {
      s.documents = s.documents || [];
      s.documents.push({ id: uid(), name: file.name, type: file.type, size: file.size, blob: file });
    }
    await db.put(STORE.sessions, s);
    sessionModal(id); // re-render modal
  });

  el('doc-list').addEventListener('click', async (e) => {
    const view = e.target.closest('[data-act="view-doc"]');
    const del = e.target.closest('[data-act="del-doc"]');
    if (view) {
      const d = s.documents[+view.dataset.i];
      const url = URL.createObjectURL(d.blob);
      window.open(url, '_blank');
    }
    if (del) {
      s.documents.splice(+del.dataset.i, 1);
      await db.put(STORE.sessions, s);
      sessionModal(id);
    }
  });

  el('save-session').addEventListener('click', async () => {
    s.status = status;
    s.date = el('s-date').value;
    s.notes = el('s-notes').value;
    if (status !== 'scheduled' && !s.date) s.date = todayISO();
    await db.put(STORE.sessions, s);
    closeModal();
    render();
  });
}

/* ---------------- Add custom CTA / resource modals ---------------- */
function addCtaModal() {
  openModal(`
    <h2>Add daily activity</h2>
    <label class="field"><span>Activity</span><input id="cta-text" placeholder="e.g. 10 min sensory play" /></label>
    <label class="field"><span>Area</span>
      <select id="cta-cat"><option>General</option><option>OT</option><option>Speech</option><option>ABA</option></select></label>
    <div class="btn-row"><button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="save-cta">Add</button></div>`);
  el('save-cta').addEventListener('click', async () => {
    const text = el('cta-text').value.trim(); if (!text) return;
    const cur = (await db.get(STORE.kv, 'customCtas'))?.value || [];
    cur.push({ id: 'cta-' + uid(), cat: el('cta-cat').value, text });
    await db.put(STORE.kv, { key: 'customCtas', value: cur });
    closeModal(); render();
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
    <div class="btn-row"><button class="btn secondary" data-act="cancel">Cancel</button>
      <button class="btn" id="save-res">Add</button></div>`);
  el('save-res').addEventListener('click', async () => {
    const title = el('r-title').value.trim(), url = el('r-url').value.trim();
    if (!title || !url) return;
    const cur = (await db.get(STORE.kv, 'customResources'))?.value || [];
    cur.push({ id: 'res-' + uid(), cat: el('r-cat').value, title, url, desc: el('r-desc').value.trim() });
    await db.put(STORE.kv, { key: 'customResources', value: cur });
    closeModal(); render();
  });
}

/* ============================================================
   Event wiring (delegation)
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
      if (cur) await db.delete(STORE.checks, key);
      else await db.put(STORE.checks, { key, done: true });
      return render();
    }
    case 'add-session': {
      const sess = await db.byIndex(STORE.sessions, 'programId', state.programId);
      const n = sess.length + 1;
      await db.put(STORE.sessions, blankSession(state.programId, n, todayISO()));
      return render();
    }
    case 'next-cycle': {
      const p = await db.get(STORE.programs, state.programId);
      const next = await createProgram({ type: p.type, name: p.name, cycleStart: cycleEnd(p) });
      state.programId = next.id;
      return render();
    }
    case 'del-plan': {
      if (confirm('Delete this plan and all its sessions & documents?')) {
        await deleteProgram(state.programId);
        state.view = 'sessions'; state.programId = null;
        return render();
      }
      return;
    }
  }
});

/* ============================================================
   Service worker (offline support)
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* boot */
render();
